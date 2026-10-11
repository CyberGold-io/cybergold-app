import assert from "node:assert/strict";
import test from "node:test";
import { QueryClient } from "@tanstack/react-query";
import { canPersistForkExecution, createSandboxForkTracker, resetSandboxQueries, SANDBOX_FORK_GENERATION_KEY } from "./sandboxForkState.ts";

class MemoryStorage {
  rows = new Map<string, string>();
  get length() { return this.rows.size; }
  key(index: number) { return [...this.rows.keys()][index] ?? null; }
  getItem(key: string) { return this.rows.get(key) ?? null; }
  setItem(key: string, value: string) { this.rows.set(key, value); }
  removeItem(key: string) { this.rows.delete(key); }
}

test("a fork replacement clears pending Safe executions and receipt state even with an unchanged nonce", async () => {
  const storage = new MemoryStorage();
  storage.setItem(SANDBOX_FORK_GENERATION_KEY, "fork-one");
  storage.setItem("cybergold:governance-safe-executions:31338:same-safe", "old pending and receipt");
  storage.setItem("cybergold:governance-safe-nonce:31338:same-safe", "7");
  storage.setItem("cybergold:governance-safe-executions:1:same-safe", "mainnet history");
  storage.setItem("currency", "EUR");
  const tabA = createSandboxForkTracker(storage), tabB = createSandboxForkTracker(storage);
  let resets = 0;
  const reset = async () => { resets++; };
  assert.equal(await tabA("fork-one", reset), false);
  assert.equal(await tabA(undefined, reset), false);
  assert.equal(await tabA(null, reset), false);
  assert.equal(await tabA("fork-two", reset), true);
  assert.equal(storage.getItem("cybergold:governance-safe-executions:31338:same-safe"), null);
  assert.equal(storage.getItem("cybergold:governance-safe-nonce:31338:same-safe"), null);
  assert.equal(storage.getItem("cybergold:governance-safe-executions:1:same-safe"), "mainnet history");
  assert.equal(storage.getItem("currency"), "EUR");
  assert.equal(await tabB("fork-two", reset), true, "another tab's marker write cannot hide this tab's old cache");
  assert.equal(await tabA("fork-two", reset), false);
  assert.equal(resets, 2);
  assert.equal(canPersistForkExecution(31338, "fork-one", storage), false, "old wallet callback cannot restore erased state");
  assert.equal(canPersistForkExecution(31338, "fork-two", storage), true);
  assert.equal(canPersistForkExecution(1, undefined, storage), true);
});

test("first tracked generation cleans legacy unscoped Sandbox state once", async () => {
  const storage = new MemoryStorage();
  storage.setItem("cybergold:governance-safe-executions:31338:safe", "legacy");
  const observe = createSandboxForkTracker(storage);
  let resets = 0;
  await observe("current-fork", async () => { resets++; });
  assert.equal(storage.getItem("cybergold:governance-safe-executions:31338:safe"), null);
  await observe("current-fork", async () => { resets++; });
  assert.equal(resets, 1);
});

test("reset removes cached pending rows, receipt errors and mutations, and ignores a late old-fork fetch", async () => {
  const client = new QueryClient();
  client.setQueryData(["sandbox-fork-generation"], "new-fork");
  client.setQueryData(["safe-pending-transactions", "same-safe"], ["old pending"]);
  client.setQueryData(["uniswap-pool-catalog", 31338], { entries: ["old V4 pool"] });
  await assert.rejects(client.fetchQuery({ queryKey: ["safe-execution-receipts"], retry: false,
    queryFn: () => { throw new Error("Old fork receipt missing"); } }));
  client.getMutationCache().build(client, { mutationKey: ["executeSafe"] });
  let finish!: (value: string) => void;
  const inFlight = client.fetchQuery({ queryKey: ["safe-local-execution-receipts"],
    queryFn: () => new Promise<string>((resolve) => { finish = resolve; }) }).catch(() => undefined);
  let finishPool!: (value: string) => void;
  const poolKey = ["uniswap-pool-snapshot", 31338, "v4", "old pool"];
  const inFlightPool = client.fetchQuery({ queryKey: poolKey,
    queryFn: () => new Promise<string>(resolve => { finishPool = resolve; }) }).catch(() => undefined);
  await resetSandboxQueries(client);
  finish("old receipt");
  finishPool("old pool state");
  await Promise.all([inFlight, inFlightPool]);
  assert.equal(client.getQueryData(["sandbox-fork-generation"]), "new-fork");
  assert.equal(client.getQueryState(["safe-pending-transactions", "same-safe"]), undefined);
  assert.equal(client.getQueryState(["safe-execution-receipts"]), undefined);
  assert.equal(client.getQueryState(["safe-local-execution-receipts"]), undefined);
  assert.equal(client.getQueryState(["uniswap-pool-catalog", 31338]), undefined);
  assert.equal(client.getQueryState(poolKey), undefined);
  assert.equal(client.getMutationCache().getAll().length, 0);
  client.clear();
});
