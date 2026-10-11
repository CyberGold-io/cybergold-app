import assert from "node:assert/strict";
import test from "node:test";
import { appEnvironment, withEnvironment } from "../../tests/fixtures/environment.mts";

const {
  EXPECTED_CHAIN_ID,
  WRONG_CHAIN_ERROR,
  assertExpectedChainId,
  assertWalletOnExpectedAccount,
  assertWalletOnExpectedChain,
} = await withEnvironment(appEnvironment, () => import("./expectedChain.ts"));

const ALICE = "0x00000000000000000000000000000000000000a1" as const;
const BOB = "0x00000000000000000000000000000000000000b2" as const;

test("accepts the configured chain", () => {
  assert.doesNotThrow(() => assertExpectedChainId(EXPECTED_CHAIN_ID));
});

test("rejects a stale or wrong connected chain", () => {
  assert.throws(
    () => assertExpectedChainId(EXPECTED_CHAIN_ID + 1),
    new Error(WRONG_CHAIN_ERROR)
  );
  assert.throws(() => assertExpectedChainId(undefined), new Error(WRONG_CHAIN_ERROR));
});

test("re-reads the live wallet chain before an action", async () => {
  let reads = 0;
  const walletClient = {
    async getChainId() {
      reads += 1;
      return EXPECTED_CHAIN_ID;
    },
  };

  await assertWalletOnExpectedChain(walletClient);
  await assertWalletOnExpectedChain(walletClient);
  assert.equal(reads, 2);
});

test("rejects a missing wallet client", async () => {
  await assert.rejects(
    () => assertWalletOnExpectedChain(undefined),
    /Wallet client is unavailable/
  );
});

test("re-reads and pins the displayed recovery-share holder account", async () => {
  const current = {
    account: { address: ALICE },
    async getAddresses() {
      return [ALICE] as const;
    },
  };
  assert.equal((await assertWalletOnExpectedAccount(current, ALICE)).toLowerCase(), ALICE);

  const switched = {
    account: { address: ALICE },
    async getAddresses() {
      return [BOB] as const;
    },
  };
  await assert.rejects(
    () => assertWalletOnExpectedAccount(switched, ALICE),
    /Wallet account changed/
  );
});
