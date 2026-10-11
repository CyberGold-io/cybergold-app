import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const script = fileURLToPath(new URL("../../scripts/validate-active-env.mjs", import.meta.url));
const fixture = fileURLToPath(new URL("../../tests/fixtures/validation-rpc-loopback.mjs", import.meta.url));
const authorization = `Bearer ${"a".repeat(64)}`;

test("runtime validation forwards configured authorization and rejects redirects", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "cybergold-rpc-validation-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const envFile = path.join(directory, "app.env");
  let redirectStatus = 0;
  const requests: { url: string | undefined; authorization: string | undefined; method: string }[] = [];
  const server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    const { method, id } = body ? JSON.parse(body) : { method: request.method, id: undefined };
    requests.push({ url: request.url, authorization: request.headers.authorization, method });
    if (redirectStatus && request.url === "/") {
      response.writeHead(redirectStatus, { Location: "/different-rpc" });
      response.end();
      return;
    }
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify(request.method === "GET" ?
      (request.url?.startsWith("/api/transaction/wait/head") ? { chainId: 1 } : { hasCode: true }) :
      { jsonrpc: "2.0", id, result: method === "eth_chainId" ? "0x1" : "0x6000" }));
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  t.after(() => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  async function validate(upstream: string | undefined, bearer: string | undefined, staticOnly = false, appOrigin?: string) {
    requests.length = 0;
    await writeFile(envFile, [
      "NEXT_PUBLIC_CHAIN_ID=1",
      ...(upstream ? [`RPC_VALIDATION_URL=${upstream}`] : []),
      ...(appOrigin ? [`NEXT_PUBLIC_APP_ORIGIN=${appOrigin}`] : []),
      ...(bearer ? [`RPC_AUTHORIZATION=${bearer}`] : []),
    ].join("\n"), { mode: 0o600 });
    return new Promise<{ code: number | null; output: string }>((resolve, reject) => {
      const child = spawn(process.execPath, ["--import", fixture, script, envFile], {
        env: { ...process.env, TEST_VALIDATION_RPC_ORIGIN: origin, SKIP_RPC_VALIDATION: staticOnly ? "1" : "0" },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let output = "";
      child.stdout.on("data", chunk => { output += chunk; });
      child.stderr.on("data", chunk => { output += chunk; });
      child.on("error", reject);
      child.on("close", code => resolve({ code, output }));
    });
  }

  for (const appOrigin of [undefined, "http://localhost:4317"]) {
    const local = await validate(undefined, undefined, false, appOrigin);
    assert.equal(local.code, 0, local.output);
    assert.equal(requests.length, 1);
    assert.deepEqual(requests.map(request => request.url?.split("?")[0]),
      ["/api/transaction/wait/head"]);
    assert.ok(requests.every(request => request.method === "GET" && request.authorization === undefined));
  }

  const broker = await validate("http://rpc-broker:19546", authorization);
  assert.equal(broker.code, 0, broker.output);
  assert.equal(requests.length, 1);
  assert.deepEqual(requests.map(request => request.method), ["eth_chainId"]);
  assert.ok(requests.every(request => request.authorization === authorization && request.url === "/"));
  assert.equal(broker.output.includes(authorization), false);

  const fork = await validate("https://rpc-fork.cybergold.io/", authorization);
  assert.equal(fork.code, 0, fork.output);
  assert.equal(requests.length, 1);
  assert.ok(requests.every(request => request.authorization === authorization && request.url === "/"));

  const publicFork = await validate("https://rpc-fork.cybergold.io/", undefined);
  assert.equal(publicFork.code, 0, publicFork.output);
  assert.ok(requests.every(request => request.authorization === undefined));

  const publicProvider = await validate("https://ethereum-rpc.publicnode.com", authorization);
  assert.equal(publicProvider.code, 0, publicProvider.output);
  assert.ok(requests.every(request => request.authorization === authorization));

  const mainnet = await validate("https://rpc-mainnet.cybergold.io/", authorization);
  assert.equal(mainnet.code, 0, mainnet.output);
  assert.ok(requests.every(request => request.authorization === authorization));

  const unexpectedPath = await validate("https://rpc-fork.cybergold.io/other", authorization);
  assert.equal(unexpectedPath.code, 0, unexpectedPath.output);
  assert.ok(requests.every(request => request.authorization === authorization));

  const malformedForkBearer = await validate("https://rpc-fork.cybergold.io/", "Bearer malformed");
  assert.equal(malformedForkBearer.code, 0, malformedForkBearer.output);
  assert.ok(requests.every(request => request.authorization === "Bearer malformed"));

  const unauthenticated = await validate("http://rpc-broker:19546", undefined);
  assert.equal(unauthenticated.code, 0, unauthenticated.output);
  assert.ok(requests.every(request => request.authorization === undefined));

  for (const status of [307, 308]) {
    redirectStatus = status;
    const redirected = await validate("http://rpc-broker:19546", authorization);
    assert.equal(redirected.code, 1, redirected.output);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, "/");
    const forkRedirected = await validate("https://rpc-fork.cybergold.io/", authorization);
    assert.equal(forkRedirected.code, 1, forkRedirected.output);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].authorization, authorization);
  }

  const publicBuild = await validate("https://app.cybergold.io/api/rpc", undefined, true);
  assert.equal(publicBuild.code, 0, publicBuild.output);
  assert.equal(requests.length, 0);
});
