import assert from "node:assert/strict";
import test from "node:test";
import { environmentConfig, environmentSetting, validateEnvironmentValue } from "../config/environmentValidation.ts";
import { publicEnv, validatePublicEnvironment } from "../config/publicEnvironment.ts";
import { appEnvironment, withEnvironment } from "../../tests/fixtures/environment.mts";

test("the CI fixture satisfies startup configuration and required values stay mandatory", async () => {
  await withEnvironment(appEnvironment, () => assert.doesNotThrow(validatePublicEnvironment));
  const requiredStartup = ["NEXT_PUBLIC_CHAIN_ID", "NEXT_PUBLIC_CHAIN_NAME"];
  for (const name of requiredStartup) {
    await withEnvironment({ ...appEnvironment, [name]: undefined }, () => {
      assert.throws(validatePublicEnvironment, { message: `${name} is required.` });
    });
  }
  assert.equal(Object.keys(publicEnv).some(name => name.endsWith("_ADDRESS")), false);
  await withEnvironment({ ...appEnvironment, NEXT_PUBLIC_CORE_DIAMOND_ADDRESS: "legacy-invalid",
    NEXT_PUBLIC_UNISWAP_ADAPTER_ADDRESS: "legacy-invalid" }, () => assert.doesNotThrow(validatePublicEnvironment));
});

test("required configuration rejects missing and blank values", () => {
  for (const value of [undefined, "", "   "]) {
    assert.throws(() => validateEnvironmentValue("REQUIRED", value, "text", true), /REQUIRED is required/);
  }
  assert.equal(validateEnvironmentValue("OPTIONAL", ""), undefined);
});

test("WalletConnect configuration is public and optional for injected-only checkouts", async () => {
  await withEnvironment({ NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID: undefined }, () => {
    assert.equal(publicEnv.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID, undefined);
  });
  await withEnvironment({ NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID: "  synthetic-project  " }, () => {
    assert.equal(publicEnv.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID, "synthetic-project");
  });
});

test("App reads use their own adapter even if an old public RPC setting remains", async () => {
  await withEnvironment({
    ...appEnvironment,
    NEXT_PUBLIC_RPC_URL: "https://app.example.com/api/rpc",
    NEXT_PUBLIC_WALLET_RPC_URL: "https://wallet-rpc.example.com/",
  }, async () => {
    const { targetChain, addEthereumChainParameter } = await import("../config/chain.ts");
    assert.deepEqual(targetChain.rpcUrls.default.http, ["https://wallet-rpc.example.com"]);
    assert.deepEqual(addEthereumChainParameter.rpcUrls, ["https://wallet-rpc.example.com"]);
  });
});

test("wallet RPC defaults keep the public wallet hosts independent of the frontend origin", async () => {
  for (const [id, expected] of [["1", "https://rpc-mainnet.cybergold.io"], ["31338", "https://rpc-fork.cybergold.io"], ["31337", "http://127.0.0.1:8545"]]) {
    await withEnvironment({ ...appEnvironment, NEXT_PUBLIC_CHAIN_ID: id,
      NEXT_PUBLIC_RPC_URL: undefined, NEXT_PUBLIC_WALLET_RPC_URL: undefined }, async () => {
      const path = `../config/chain.ts?wallet-default-${id}`;
      const chain = await import(path);
      assert.equal(chain.targetWalletRpcUrl, expected);
      assert.equal(chain.canAddTargetChainWithCurrentWalletRpcUrl, true);
    });
  }
});

test("chain IDs reject invalid, zero and unsafe values", () => {
  for (const value of ["0", "-1", "1.5", "NaN", "9007199254740992"]) {
    assert.throws(() => validateEnvironmentValue("CHAIN", value, "positiveInteger"));
  }
  assert.equal(validateEnvironmentValue("CHAIN", "1", "positiveInteger"), "1");
});

test("addresses are checked and normalized centrally", () => {
  assert.equal(validateEnvironmentValue("ADDRESS", "0x000000000022d473030f116ddee9f6b43ac78ba3", "address"), "0x000000000022D473030F116dDEE9F6B43aC78BA3");
  assert.throws(() => validateEnvironmentValue("ADDRESS", "0x123", "address"));
});

test("URL validation rejects unsupported protocols without leaking credentials", () => {
  const secret = "ftp://user:private-password@example.com";
  assert.throws(() => validateEnvironmentValue("RPC_URL", secret, "url"), (error: Error) => {
    assert.match(error.message, /RPC_URL/);
    assert.ok(!error.message.includes("private-password"));
    return true;
  });
  assert.equal(validateEnvironmentValue("DATABASE_URL", "postgresql://user:password@localhost/db", "database"), "postgresql://user:password@localhost/db");
});

test("shared settings are readonly and revalidate changed inputs", () => {
  let raw: string | undefined = "1";
  const config = environmentConfig({ FLAG: environmentSetting("FLAG", () => raw, "flag") });
  assert.equal(config.FLAG, "1");
  assert.equal(Reflect.set(config, "FLAG", "0"), false);
  raw = "invalid";
  assert.throws(() => config.FLAG, /FLAG/);
  raw = "0";
  assert.equal(config.FLAG, "0");
});
