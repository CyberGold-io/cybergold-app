import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const writeSources = [
  "../hooks/cybergold-helpers/useIssueFromBasketExactInWithPermit2.ts",
  "../hooks/cybergold-helpers/useIssueFromBasketExactOutWithPermit2.ts",
  "../hooks/cybergold-helpers/useIssueFromTokenExactOutWithPermit2.ts",
  "../hooks/cybergold-helpers/useRedeemToBasketExactInWithPermit.ts",
  "../hooks/cybergold-helpers/useRedeemToTokenExactInWithPermit.ts",
  "../hooks/flows/shared/usePermit2Transfer.ts",
  "../hooks/flows/shared/usePurchaseAuthorization.ts",
  "../hooks/flows/shared/useBasketPurchaseExecution.ts",
  "../hooks/flows/shared/useRedemptionExecution.ts",
  "../hooks/flows/shared/useCygldPermit.ts",
  "../[locale]/governance/_hooks/useDiamondGovernanceActions.ts",
  "../[locale]/governance/_components/GovernanceClient.tsx",
];

function read(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

function writeCalls(source: string) {
  const calls: string[] = [];
  const marker = "writeContractAsync({";
  let offset = 0;

  while ((offset = source.indexOf(marker, offset)) !== -1) {
    let depth = 0;
    let cursor = offset + "writeContractAsync".length;
    for (; cursor < source.length; cursor += 1) {
      if (source[cursor] === "(") depth += 1;
      if (source[cursor] === ")") {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    calls.push(source.slice(offset, cursor + 1));
    offset = cursor + 1;
  }

  return calls;
}

test("every contract write is pinned to the configured chain", () => {
  for (const relativePath of writeSources) {
    const calls = writeCalls(read(relativePath));
    assert.ok(calls.length > 0, `${relativePath} contains no guarded writes`);
    for (const call of calls) {
      assert.match(call, /chainId:\s*(?:EXPECTED_CHAIN_ID|targetChainId)\b/);
    }
  }
});

test("native-input helper writes retain explicit chain pinning", () => {
  for (const relativePath of [
    "../hooks/cybergold-helpers/useIssueFromTokenExactOutWithPermit2.ts",
  ]) {
    const valueCalls = writeCalls(read(relativePath)).filter((call) => /\bvalue:/.test(call));
    assert.ok(valueCalls.length > 0, `${relativePath} contains no native-value write`);
    for (const call of valueCalls) {
      assert.match(call, /chainId:\s*EXPECTED_CHAIN_ID/);
    }
  }
});

test("permit and Safe signatures re-read the live wallet chain", () => {
  for (const relativePath of [
    "../hooks/flows/shared/usePermit2Transfer.ts",
    "../hooks/flows/shared/useCygldPermit.ts",
    "../hooks/flows/shared/usePurchaseAuthorization.ts",
    "../[locale]/governance/_hooks/useDiamondGovernanceActions.ts",
    "../[locale]/governance/_components/GovernanceClient.tsx",
  ]) {
    const source = read(relativePath);
    assert.match(source, /assertWalletOnExpectedChain\(walletClient\)/);
    assert.match(source, /chainId:\s*(?:EXPECTED_CHAIN_ID|targetChainId)\b/);
  }
});
