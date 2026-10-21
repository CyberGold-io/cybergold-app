import assert from "node:assert/strict";
import { test } from "node:test";
import { parsePassivePageSnapshot } from "./passivePageSnapshot.ts";

const snapshot = (tag = "section", attributes: Record<string, string> = {}) => ({
  scope: "chain:locale:currency:unit", account: null, scrollY: 128,
  tree: [{ tag, attributes, children: ["123 CYGLD"] }],
});

test("passive snapshots retain primitive text, forms and fixed canvas presentation", () => {
  assert.deepEqual(parsePassivePageSnapshot(snapshot()), snapshot());
  assert.ok(parsePassivePageSnapshot(snapshot("input", { type: "text", value: "0.01", "aria-label": "Amount" })));
  assert.ok(parsePassivePageSnapshot(snapshot("img", { src: "data:image/png;base64,iVBORw0KGgo=", alt: "" })));
  assert.ok(parsePassivePageSnapshot(snapshot("path", { d: "M0 0 L10 10", fill: "url(#gradient)" })));
});

test("passive snapshots reject active elements, events, HTML, CSS and remote resources", () => {
  for (const tag of ["script", "iframe", "foreignObject", "style", "object", "embed", "video"]) {
    assert.equal(parsePassivePageSnapshot(snapshot(tag)), undefined, tag);
  }
  const invalidAttributes: Record<string, string>[] = [{ onclick: "alert(1)" }, { innerHTML: "<b>cached</b>" },
    { style: "position:fixed" }, { href: "javascript:alert(1)" }, { src: "https://example.com/token.png" },
    { fill: "url(https://example.com/paint.svg)" }, { formaction: "/api/execute" }];
  for (const attributes of invalidAttributes) {
    assert.equal(parsePassivePageSnapshot(snapshot("button", attributes)), undefined, JSON.stringify(attributes));
  }
  assert.equal(parsePassivePageSnapshot({ ...snapshot(), account: "cached authorization" }), undefined);
});

test("passive snapshots reject malformed layout and unsafe image payloads", () => {
  for (const size of [{ width: Infinity }, { height: -1 }, { position: "fixed" }, { color: "red" }]) {
    assert.equal(parsePassivePageSnapshot({ ...snapshot(), tree: [{ ...snapshot().tree[0], size }] }), undefined);
  }
  assert.equal(parsePassivePageSnapshot(snapshot("img", { src: "data:image/svg+xml,<svg onload='alert(1)'/>" })), undefined);
  assert.equal(parsePassivePageSnapshot(snapshot("img", { src: "//example.com/token.png" })), undefined);
  for (const src of ["/\\evil/path.png", "/tokens/\nevil.png", "/tokens/a\t.png"]) {
    assert.equal(parsePassivePageSnapshot(snapshot("img", { src })), undefined);
  }
  for (const appearance of [{ color: "url(https://example.com/image.png)" }, { backgroundColor: "expression(alert(1))" }, { fontSize: "calc(1px + 1em)" }]) {
    assert.equal(parsePassivePageSnapshot({ ...snapshot(), tree: [{ ...snapshot().tree[0], appearance }] }), undefined);
  }
  assert.ok(parsePassivePageSnapshot({ ...snapshot(), tree: [{ ...snapshot().tree[0],
    size: { width: 120, height: 80, position: "relative" },
    appearance: { color: "rgb(255, 255, 255)", backgroundColor: "var(--background)", fontSize: "12px", fontWeight: "600", textAlign: "right" },
  }] }));
});
