import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);

test("RainbowKit's installed QR renderer can encode a WalletConnect pairing URI", async () => {
  const rainbowKitRequire = createRequire(require.resolve("@rainbow-me/rainbowkit"));
  const QrCode = await import(pathToFileURL(rainbowKitRequire.resolve("cuer/QrCode")).href);
  const uri = `wc:${"ab".repeat(32)}@2?relay-protocol=irn&symKey=${"cd".repeat(32)}`;
  const result = QrCode.create(uri, { errorCorrection: "medium" });
  assert.equal(result.value, uri);
  assert.ok(result.edgeLength >= 21);
  assert.equal(result.grid.length, result.edgeLength);
  assert.ok(result.grid.every((row: boolean[]) => row.length === result.edgeLength));
  assert.ok(result.grid.flat().some(Boolean));
});

const sdkRequire = createRequire(require.resolve("@metamask/sdk"));
const metaMaskConsumers = [
  sdkRequire,
  createRequire(sdkRequire.resolve("@metamask/sdk-communication-layer")),
  createRequire(require.resolve("@metamask/utils")),
];

// These are the UUID APIs consumed by the published MetaMask packages. Exercise
// their actual dependency resolution instead of adding a direct UUID dependency.
test("MetaMask UUID consumers retain CommonJS and ESM v4/validate compatibility", async () => {
  const expected = "00010203-0405-4607-8809-0a0b0c0d0e0f";
  const esm = await import("uuid");
  for (const consumerRequire of metaMaskConsumers) {
    const commonJs = consumerRequire("uuid");
    for (const api of [commonJs, esm]) {
      assert.equal(api.v4({ random: Uint8Array.from({ length: 16 }, (_, index) => index) }), expected);
      assert.equal(api.validate(expected), true);
      assert.equal(api.validate("not-a-uuid"), false);
      assert.equal(api.validate("00000000-0000-0000-0000-000000000000"), true);
      assert.match(api.v4(), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    }
  }
});

const walletConnectConsumers = [
  require,
  ...["@reown/appkit", "@reown/appkit-utils", "@reown/appkit-controllers"].map(
    (name) => createRequire(require.resolve(name)),
  ),
];

test("every WalletConnect utility copy retains URI round trips with the patched parser installed", async () => {
  const topic = "ab".repeat(32);
  const symKey = "cd".repeat(32);
  for (const consumerRequire of walletConnectConsumers) {
    const utilities = consumerRequire("@walletconnect/utils");
    const uri = utilities.formatUri({
      protocol: "wc", topic, version: 2, symKey, relay: { protocol: "irn" },
      expiryTimestamp: 1_800_000_000,
    });
    const parsed = utilities.parseUri(uri);
    assert.match(uri, /^wc:/);
    assert.equal(parsed.topic, topic);
    assert.equal(parsed.version, 2);
    assert.equal(parsed.symKey, symKey);
    assert.equal(parsed.relay.protocol, "irn");
    assert.equal(parsed.expiryTimestamp, 1_800_000_000);

    const utilitiesRequire = createRequire(consumerRequire.resolve("@walletconnect/utils"));
    const { default: queryString } = await import(pathToFileURL(utilitiesRequire.resolve("query-string")).href);
    assert.deepEqual({ ...queryString.parse("name=J%C3%B6rg&space=hello+world&bad=%E0%A4%A") }, {
      name: "Jörg", space: "hello world", bad: "%E0%A4%A",
    });
  }
});
