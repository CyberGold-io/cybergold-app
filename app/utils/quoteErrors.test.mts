import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { knownQuoteError, QuotePreviewError, quoteErrorMessage, quoteResponseError } from "./quoteErrors.ts";

test("RPC error codes survive an HTTP error without exposing provider text", async () => {
  const error = await quoteResponseError(Response.json({ code: "rpc-rate-limit", error: "private-provider-url-and-token" }, { status: 503 }));
  assert.equal(error.code, "rpc-rate-limit");
  assert.equal(quoteErrorMessage(error, key => key), "quoteRpcRateLimit");
  assert.doesNotMatch(error.message, /private/);
  assert.equal((await quoteResponseError(new Response("private HTML", { status: 502 }))).code, "quote-service-unavailable");
});

test("service connection, request, stream and RPC failures are not conflated", async () => {
  assert.equal((await quoteResponseError(Response.json({}, { status: 429 }))).code, "quote-request-limit");
  assert.equal((await quoteResponseError(Response.json({}, { status: 400 }))).code, "quote-invalid-input");
  assert.equal((await quoteResponseError(Response.json({}, { status: 504 }))).code, "quote-timeout");
  assert.equal(quoteErrorMessage(new QuotePreviewError("quote-stream-interrupted", "internal"), key => key), "quoteStreamInterrupted");
  assert.equal(quoteErrorMessage(new Error("private-provider-url-and-token"), key => key), "quoteUnexpectedError");
});

test("RPC failure descriptions are translated in every supported locale", () => {
  for (const locale of ["en", "fr", "de", "ru"]) {
    const messages = JSON.parse(readFileSync(new URL(`../../messages/${locale}.json`, import.meta.url), "utf8")).Home;
    for (const code of ["rpc-rate-limit", "rpc-timeout", "rpc-unavailable", "rpc-access-denied"]) {
      const error = knownQuoteError({ code, error: "private upstream text" })!;
      const description = quoteErrorMessage(error, key => messages[key]);
      assert.equal(typeof description, "string");
      assert.match(description, /RPC/);
      assert.doesNotMatch(description, /private|temporarily unavailable/);
    }
  }
});
