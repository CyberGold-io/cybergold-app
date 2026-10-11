import assert from "node:assert/strict";
import test from "node:test";
import { simulateRecoveryRedemption } from "./recoveryRedemption.ts";

const holder=`0x${"1".repeat(40)}` as const, asset=`0x${"2".repeat(40)}` as const;

test("exact holder, asset, shares and payout minimum survive JSON without alternate targets", async () => {
  for (const shares of [0n, 1n, 2n**200n+1n]) {
    const result = await simulateRecoveryRedemption({holder,asset,shares,minRawOut:7n}, (async (url,init) => {
      assert.equal(url,"/api/transaction/recovery-redemption");assert.equal(init?.method,"POST");assert.equal(init?.cache,"no-store");
      assert.equal(new Headers(init?.headers).has("authorization"),false);
      assert.deepEqual(JSON.parse(String(init?.body)),{holder,asset,shares:shares.toString(),minRawOut:"7"});
      return Response.json({rawOut:(shares*3n).toString()});
    }) as typeof fetch);
    assert.equal(result.rawOut,(shares*3n).toString());
  }
});

test("failed simulation never authorizes a preview or falls back to browser RPC", async () => {
  let count=0;
  await assert.rejects(simulateRecoveryRedemption({holder,asset,shares:1n,minRawOut:1n},(async()=>{
    count++;return Response.json({error:"unavailable"},{status:503});
  }) as typeof fetch),/simulation is unavailable/);
  assert.equal(count,1);
});

test("transport rejection propagates before the wallet submission step", async () => {
  await assert.rejects(simulateRecoveryRedemption({holder,asset,shares:1n,minRawOut:1n},(async()=>{
    throw new Error("fixture connection failure");
  }) as typeof fetch),/fixture connection failure/);
});
