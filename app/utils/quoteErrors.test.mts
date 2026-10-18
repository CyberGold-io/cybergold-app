import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { knownQuoteError, QuotePreviewError, quoteErrorMessage, quoteResponseError, safeQuoteConstraint } from "./quoteErrors.ts";
import { failureResult, resultFor } from '../../tests/trading/regression.ts';
import { tradeScenarios } from '../../tests/trading/scenarios.ts';
import { providerSummaries } from '../../tests/trading/providerEvidence.ts';
import type { TradeQuote } from './tradeQuote.ts';

test("RPC error codes survive an HTTP error without exposing provider text", async () => {
  const error = await quoteResponseError(Response.json({ code: "rpc-rate-limit", error: "private-provider-url-and-token" }, { status: 503 }));
  assert.equal(error.code, "rpc-rate-limit");
  assert.equal(quoteErrorMessage(error, key => key), "quoteRpcRateLimit");
  assert.doesNotMatch(error.message, /private/);
  assert.equal((await quoteResponseError(new Response("private HTML", { status: 502 }))).code, "quote-service-unavailable");
});

test('capacity causes retain safe producer facts in HTTP, stream, scenario and provider evidence', async () => {
  const constraint = { kind: 'issuance-cap', quantity: 'gross-cygld-mint', limitKind: 'effective-supply-cap', requestedRaw: '12', availableRaw: '10',
    currentSupplyRaw: '100', limitRaw: '110', privateUrl: 'private-provider-url', message: 'private-error' };
  const error = await quoteResponseError(Response.json({ code: 'issuance-cap-exceeded', constraint }, { status: 422 }));
  assert.deepEqual(error.constraint, { kind: 'issuance-cap', quantity: 'gross-cygld-mint', limitKind: 'effective-supply-cap', requestedRaw: '12', availableRaw: '10', currentSupplyRaw: '100', limitRaw: '110' });
  const result = failureResult(resultFor(tradeScenarios[0], 'browser'), error);
  assert.deepEqual(result.constraint, error.constraint); assert.doesNotMatch(JSON.stringify(result.constraint), /private/);
  const providers = providerSummaries({ providerAssessments: { core: { availability: 'unavailable', searchOutcome: 'error', code: 'issuance-cap-exceeded', constraint } } } as unknown as TradeQuote);
  assert.deepEqual(providers.core.constraint, error.constraint);
  const high = String(2n ** 256n - 1n);
  assert.deepEqual(safeQuoteConstraint({ kind: 'redemption-supply', quantity: 'gross-cygld-input', requestedRaw: high, availableRaw: '01', limitRaw: String(2n ** 256n), limitKind: 'guessed-cap', other: 'private' }),
    { kind: 'redemption-supply', quantity: 'gross-cygld-input', requestedRaw: high });
  assert.equal(safeQuoteConstraint({ kind: 'unknown', requestedRaw: '12' }), undefined);
});

test('specific redemption names and legacy ambiguity are clear and localized without upstream text', () => {
  for (const locale of ['en', 'fr', 'de', 'ru']) {
    const messages = JSON.parse(readFileSync(new URL(`../../messages/${locale}.json`, import.meta.url), 'utf8')).Home;
    for (const code of ['redemption-supply-exceeded', 'redemption-capacity-exceeded', 'issuance-cap-exceeded', 'insufficient-protocol-supply']) {
      const error = knownQuoteError({ code, error: 'private-provider-text', constraint: { kind: 'redemption-capacity', quantity: 'core-output-minima' } })!;
      assert.equal(error.code, code); assert.equal(typeof quoteErrorMessage(error, key => messages[key]), 'string');
      assert.doesNotMatch(error.message, /private/);
    }
  }
  assert.match(knownQuoteError({ code: 'insufficient-protocol-supply' })!.message, /supply or redemption capacity/);
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
