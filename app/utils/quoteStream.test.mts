import assert from "node:assert/strict";
import test from "node:test";
import { fetchQuoteStream } from "./quoteStream.ts";
import { diagnosticReferences } from "./diagnosticReferences.ts";
import { QuotePreviewError } from "./quoteErrors.ts";

test("an interrupted ready stream retains its request reference for the caller's refinement error", async () => {
  const requestId = "11111111-1111-4111-8111-111111111111", ready: unknown[] = [];
  const fetcher = (async () => new Response('{"type":"qualified","value":{"quotedOutput":"12"}}\n', {
    headers: { "content-type": "application/x-ndjson", "X-CyberGold-Request-Id": requestId },
  })) as typeof fetch;
  await assert.rejects(fetchQuoteStream("/api/economic-quotes/stream", {}, new AbortController().signal,
    event => ready.push(event), fetcher), error => {
    assert.ok(error instanceof QuotePreviewError);
    assert.equal(error.code, "quote-stream-interrupted");
    assert.equal(diagnosticReferences(error).requestId, requestId);
    return true;
  });
  assert.equal(ready.length, 1);
  assert.equal(diagnosticReferences(ready[0]).requestId, requestId);
});
