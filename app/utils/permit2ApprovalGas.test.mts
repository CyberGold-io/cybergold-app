import assert from "node:assert/strict";
import test from "node:test";
import { permit2ApprovalGasLimit } from "./permit2ApprovalGas.ts";

const owner=`0x${"1".repeat(40)}` as const,token=`0x${"2".repeat(40)}` as const;

test("fixed approval estimate retains 20 percent gas padding and lossless amounts", async () => {
  for (const gas of [0n,21000n,2n**100n+1n]) {
    const result = await permit2ApprovalGasLimit(owner,token,(async(url,init)=>{
      assert.equal(url,"/api/transaction/permit2-approval-gas");assert.equal(init?.method,"POST");assert.equal(init?.cache,"no-store");
      assert.equal(new Headers(init?.headers).has("authorization"),false);
      assert.deepEqual(JSON.parse(String(init?.body)),{owner,token});
      return Response.json({gas:gas.toString()});
    }) as typeof fetch);
    assert.equal(result,gas*12n/10n);
  }
});

test("supplier failure keeps the existing 100000 gas fallback without RPC retry", async()=>{
  let count=0;
  assert.equal(await permit2ApprovalGasLimit(owner,token,(async()=>{
    count++;return Response.json({error:"unavailable"},{status:503});
  }) as typeof fetch),100_000n);
  assert.equal(count,1);
});

test("transport and malformed estimate failures retain the same fallback",async()=>{
  for (const supplier of [async()=>{throw new Error("fixture transport failure");},async()=>Response.json({gas:"invalid"})]) {
    assert.equal(await permit2ApprovalGasLimit(owner,token,supplier as typeof fetch),100_000n);
  }
});
