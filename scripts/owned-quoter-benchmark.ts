import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { promisify } from 'node:util';
import { quoterProducerTimings, quoterBenchmarkApiFailure, type CacheConditionObservation, type CacheResource,
  type QuoterBenchmarkAttempt, type QuoterBenchmarkCase, type QuoterBenchmarkDefinition,
  type QuoterBenchmarkMeasurement } from '../tests/trading/quoterBenchmark.ts';
import { quoteResponseError } from '../app/utils/quoteErrors.ts';

type Variant = QuoterBenchmarkAttempt['variant'];
type Header = { number: string; hash: string; timestamp: string };
export type OwnedQuoterResourceConfiguration = {
  baselineImage: string; candidateImage: string; forkUrl: string; backendForkUrl: string;
  chainId: number; core: string; helpers: string; routingAdapter: string;
  cases: QuoterBenchmarkCase[]; repetitions?: number; dockerCommand?: string; platform?: string;
  postgresImage: string;
};
export type OwnedQuoterResources = {
  restoreFork: () => Promise<Header>;
  advanceFork: (timestamp: number) => Promise<Header>;
  resetDatabase: (variant: Variant) => Promise<void>;
  restartApi: (variant: Variant, secondary?: boolean) => Promise<void>;
  ensureApi: (variant: Variant) => Promise<void>;
  quote: (attempt: QuoterBenchmarkAttempt, refresh: boolean, secondary?: boolean) => Promise<QuoterBenchmarkMeasurement>;
  close: () => Promise<void>;
};
type Receipt = CacheConditionObservation & { priming: 'not-needed' | 'succeeded' | 'failed';
  primingFailure?: ReturnType<typeof quoterBenchmarkApiFailure>; unavailable: CacheResource[];
  stateChange: 'snapshot-restored' | 'header-only-advance' };
const memory: CacheResource[] = ['api-process', 'sdk-worker', 'rpc-reads', 'fast-models'];
const database: CacheResource[] = ['pool-catalog', 'pool-state', 'completed-quotes'];
const conditions = ['application-cold', 'process-cold-database-warm', 'warm-search', 'shared-quote-hit', 'warm-changed-state'] as const;

/** Quote-only phase of the existing owned-fork profile; every receipt follows actual controls. */
export function ownedQuoterBenchmark(resources: OwnedQuoterResources, cases: readonly QuoterBenchmarkCase[], repetitions = 3): QuoterBenchmarkDefinition {
  return { profile: 'mainnet-fork-execution', cases, conditions, repetitions,
    prepare: async attempt => {
      let head = await resources.restoreFork();
      const receipt: Receipt = { reset: ['fork-state'], preserved: [], blockNumber: String(BigInt(head.number)),
        blockHash: head.hash, priming: 'not-needed', stateChange: 'snapshot-restored',
        unavailable: attempt.variant === 'baseline' ? ['completed-quotes'] : [] };
      if (attempt.condition === 'application-cold') {
        await resources.resetDatabase(attempt.variant);
        await resources.restartApi(attempt.variant);
        receipt.reset.push(...memory, ...database);
      } else {
        await resources.ensureApi(attempt.variant);
        try { await resources.quote(attempt, true); receipt.priming = 'succeeded'; }
        catch (error) { receipt.priming = 'failed'; receipt.primingFailure = quoterBenchmarkApiFailure(error); }
        // An unsuccessful prime may still acquire useful dependencies. Record
        // it, then measure the real next request rather than hiding that case.
        if (attempt.condition === 'process-cold-database-warm') {
          await resources.restartApi(attempt.variant);
          receipt.reset.push(...memory); receipt.preserved.push(...database);
        } else {
          receipt.preserved.push(...memory, ...database);
          if (attempt.condition === 'shared-quote-hit') await resources.restartApi(attempt.variant, true);
          if (attempt.condition === 'warm-changed-state') {
            head = await resources.advanceFork(Number(BigInt(head.timestamp)) + 1);
            receipt.stateChange = 'header-only-advance';
            receipt.blockNumber = String(BigInt(head.number)); receipt.blockHash = head.hash;
          }
        }
      }
      receipt.reset = receipt.reset.filter(name => !receipt.unavailable.includes(name));
      receipt.preserved = receipt.preserved.filter(name => !receipt.unavailable.includes(name));
      return receipt;
    },
    measure: attempt => resources.quote(attempt, attempt.condition !== 'shared-quote-hit', attempt.condition === 'shared-quote-hit'),
  };
}

const execute = promisify(execFile);
type Execute = (command: string, args: string[], input?: string) => Promise<string>;
async function run(command: string, args: string[], input?: string): Promise<string> {
  if (input === undefined) {
    try { return (await execute(command, args, { encoding: 'utf8', maxBuffer: 1024*1024 })).stdout.trim(); }
    catch { throw new Error('owned-profile-command-failed'); }
  }
  return new Promise((resolve, reject) => {
    const child = execFile(command, args, { encoding: 'utf8', maxBuffer: 1024*1024 }, (error, stdout) =>
      error ? reject(new Error('owned-profile-command-failed')) : resolve(stdout.trim()));
    child.stdin!.end(input);
  });
}
async function freePort() {
  const server = createServer();
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = (server.address() as { port: number }).port;
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
type Dependencies = { execute?: Execute; fetch?: typeof fetch; freePort?: () => Promise<number>; delay?: typeof delay };

/** Owns only resources it creates; the calling qualifier owns the supplied Anvil. */
export class DockerQuoterResources implements OwnedQuoterResources {
  private readonly prefix = 'cybergold-quoter-' + randomUUID().slice(0, 12);
  private readonly network = this.prefix + '-network';
  private readonly pg = this.prefix + '-pg';
  private readonly created = new Set<string>();
  private readonly apis = new Map<string, { name: string; origin: string }>();
  private readonly schemas = new Set<Variant>();
  private directory = ''; private snapshot = ''; private networkCreated = false;
  private readonly cancellation = new AbortController();
  private readonly command: Execute; private readonly request: typeof fetch;
  private readonly port: () => Promise<number>; private readonly pause: typeof delay;
  private readonly config: OwnedQuoterResourceConfiguration;
  constructor(config: OwnedQuoterResourceConfiguration, dependencies: Dependencies = {}) {
    this.config = config;
    this.command = dependencies.execute ?? run; this.request = dependencies.fetch ?? fetch;
    this.port = dependencies.freePort ?? freePort; this.pause = dependencies.delay ?? delay;
  }
  private docker(...args: string[]) { return this.command(this.config.dockerCommand ?? 'docker', args); }
  private database(variant: Variant) { return 'quoter_' + variant; }
  cancel() { this.cancellation.abort(); }
  private signal(cleanup = false) {
    return cleanup ? AbortSignal.timeout(60_000) : AbortSignal.any([this.cancellation.signal, AbortSignal.timeout(60_000)]);
  }
  private async rpc(method: string, params: unknown[], cleanup = false) {
    const response = await this.request(this.config.forkUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: this.signal(cleanup) });
    const value = await response.json();
    if (!response.ok || value.error) throw new Error('owned-fork-operation-failed');
    return value.result;
  }
  private async head(): Promise<Header> { return await this.rpc('eth_getBlockByNumber', ['latest', false]); }
  async start() {
    this.directory = await mkdtemp(join(tmpdir(), 'cybergold-quoter-'));
    try {
      this.snapshot = await this.rpc('evm_snapshot', []);
      await this.docker('network', 'create', this.network); this.networkCreated = true;
      this.created.add(this.pg);
      await this.docker('run', '-d', '--name', this.pg, '--network', this.network, '--network-alias', 'pg',
        '--tmpfs', '/var/lib/postgresql:rw,size=536870912', '-e', 'POSTGRES_HOST_AUTH_METHOD=trust',
        '-e', 'POSTGRES_USER=fixture', '-e', 'POSTGRES_DB=postgres', this.config.postgresImage);
      for (let attempt = 0; ; attempt++) {
        try { await this.docker('exec', this.pg, 'pg_isready', '-U', 'fixture', '-d', 'postgres'); break; }
        catch (error) { if (this.cancellation.signal.aborted || attempt === 119) throw error; await this.pause(500); }
      }
    } catch (error) { try { await this.close(); } catch { /* preserve startup error */ } throw error; }
    return this;
  }
  async restoreFork() {
    if (!await this.rpc('evm_revert', [this.snapshot])) throw new Error('owned-fork-restore-failed');
    this.snapshot = await this.rpc('evm_snapshot', []);
    return await this.head();
  }
  async advanceFork(timestamp: number) {
    await this.rpc('evm_mine', [timestamp]);
    return await this.head();
  }
  private async environment(variant: Variant) {
    const path = join(this.directory, variant + '.env');
    const values = { NEXT_PUBLIC_CHAIN_ID: String(this.config.chainId), NEXT_PUBLIC_CORE_DIAMOND_ADDRESS: this.config.core,
      NEXT_PUBLIC_HELPERS_DIAMOND_ADDRESS: this.config.helpers, CYBERGOLD_UNISWAP_ROUTING_ADAPTER_ADDRESS: this.config.routingAdapter,
      NEXT_PUBLIC_RPC_URL: this.config.backendForkUrl, RPC_URL: this.config.backendForkUrl,
      DATABASE_URL: `postgresql://fixture@pg:5432/${this.database(variant)}`, HOST: '0.0.0.0', PORT: '3000' };
    await writeFile(path, Object.entries(values).map(([key, value]) => `${key}=${value}\n`).join(''), { mode: 0o600 });
    return path;
  }
  private async removeApi(key: string) {
    const api = this.apis.get(key);
    if (api) { await this.docker('rm', '-f', api.name); this.created.delete(api.name); this.apis.delete(key); }
  }
  async resetDatabase(variant: Variant) {
    await this.removeApi(variant + ':secondary'); await this.removeApi(variant);
    const sql = `DROP DATABASE IF EXISTS ${this.database(variant)} WITH (FORCE);\nCREATE DATABASE ${this.database(variant)};\n`;
    await this.command(this.config.dockerCommand ?? 'docker', ['exec', '-i', this.pg, 'psql', '-U', 'fixture', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'], sql);
    await this.docker('run', '--rm', '--platform', this.config.platform ?? 'linux/amd64', '--network', this.network, '--add-host', 'host.docker.internal:host-gateway',
      '--env-file', await this.environment(variant), '--entrypoint', 'python',
      variant === 'baseline' ? this.config.baselineImage : this.config.candidateImage,
      '-m', 'alembic', '-c', 'schema/alembic.ini', 'upgrade', 'head');
    this.schemas.add(variant);
  }
  async restartApi(variant: Variant, secondary = false) {
    if (!this.schemas.has(variant)) await this.resetDatabase(variant);
    const key = variant + (secondary ? ':secondary' : '');
    await this.removeApi(key);
    const name = this.prefix + '-' + key.replace(':', '-');
    const port = await this.port();
    const api = { name, origin: `http://127.0.0.1:${port}` };
    this.created.add(name); this.apis.set(key, api);
    await this.docker('run', '-d', '--platform', this.config.platform ?? 'linux/amd64', '--name', name,
      '--network', this.network, '--add-host', 'host.docker.internal:host-gateway', '--env-file', await this.environment(variant),
      '-p', `127.0.0.1:${port}:3000`, variant === 'baseline' ? this.config.baselineImage : this.config.candidateImage);
    // Metrics is an in-memory readiness read, not a quote/configuration/RPC warm-up.
    for (let attempt = 0; ; attempt++) {
      try { if ((await this.request(api.origin + '/metrics', { signal: this.signal() })).ok) break; }
      catch { if (this.cancellation.signal.aborted) throw new Error('owned-profile-cancelled'); }
      if (attempt === 119) throw new Error('owned-api-startup-failed');
      await this.pause(500);
    }
  }
  async ensureApi(variant: Variant) { if (!this.apis.has(variant)) await this.restartApi(variant); }
  async quote(attempt: QuoterBenchmarkAttempt, refresh: boolean, secondary = false): Promise<QuoterBenchmarkMeasurement> {
    const api = this.apis.get(attempt.variant + (secondary ? ':secondary' : ''))!;
    const body = { intent: 0, inputs: [{ currency: attempt.case.inputCurrency, amount: attempt.case.amountRaw }], outputCurrency: attempt.case.outputCurrency };
    const legacy = attempt.variant === 'baseline';
    const response = await this.request(api.origin + (legacy ? '/api/quotes/universal-exact-input' : '/api/economic-quotes'), {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: this.signal(),
      body: JSON.stringify(legacy ? { ...body, recipient: '0x'+'0'.repeat(40), deadline: String(Math.floor(Date.now()/1000)+600), slippageBps: 100 }
        : { ...body, refresh }) });
    if (!response.ok) throw Object.assign(await quoteResponseError(response), { httpStatus: response.status });
    const value = await response.json();
    const funding = value.inputs ?? value.plan?.inputs;
    const route = value.economicQuote?.plan ?? (legacy ? { intent: value.plan.intent, body: value.plan.body } : value.plan);
    return { operation: value.observation?.source === 'stored' ? 'lookup' : 'search',
      requiredFundingRaw: String(BigInt(funding[0].amount)), netOutputRaw: String(BigInt(value.quotedOutput)),
      blockNumber: String(BigInt(value.context.blockNumber)), blockHash: value.context.blockHash,
      routeId: createHash('sha256').update(JSON.stringify(route)).digest('hex'),
      ...(quoterProducerTimings(value) ? { producerTimings: quoterProducerTimings(value) } : {}) };
  }
  async close() {
    let failed = false;
    for (const name of [...this.created].reverse()) {
      try { await this.docker('rm', '-f', '-v', name); this.created.delete(name); } catch { failed = true; }
    }
    if (this.networkCreated) {
      try { await this.docker('network', 'rm', this.network); this.networkCreated = false; } catch { failed = true; }
    }
    if (this.snapshot) {
      try { if (!await this.rpc('evm_revert', [this.snapshot], true)) failed = true; this.snapshot = ''; }
      catch { failed = true; }
    }
    if (this.directory) {
      try { await rm(this.directory, { recursive: true, force: true }); this.directory = ''; } catch { failed = true; }
    }
    if (failed) throw new Error('owned-profile-cleanup-failed:'+this.prefix);
  }
}
