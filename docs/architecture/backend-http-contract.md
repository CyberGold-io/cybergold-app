---
title: Focused protocol facts
doc_type: architecture
status: active
owner: app-maintainer
created: 2026-10-01
last_reviewed: 2026-10-02
canonical_for: U5 A1 focused protocol facts consumers and release compatibility
---

# Focused protocol facts (U5 A1)

## Current consumer boundary

Current App and Wagmi/RainbowKit clients use fixed product APIs for protocol,
pool, quote, governance, balance/ENS, preparation and receipt observations.
The Next.js adapters add the environment backend bearer privately. Wallet
connection, signing and submission remain in the browser. The current App has retired `/api/rpc`; older open tabs must reload. Retained
images keep their own adapter and backend compatibility. Public wallet RPC hosts
remain useful.
The detailed A1/B1 qualification below records those earlier slices, not the
final runtime caller inventory. The [qualification record](fixed-library-client-qualification.json)
describes the final library client and its remaining compatibility boundary.

## A1 contract and original qualification

The Swap basket, reference price, issuance/Helpers fees and pause state use
`GET /api/protocol/facts`. The server reads configured contracts at one canonical
block hash, returning decimal strings and independent field failures. The
same-origin Next.js adapter adds the backend bearer privately; no bearer is
placed in a public variable or browser query. Query reuse remains in TanStack
Query with one retry; pause retains its five-second stale/ten-second refresh policy.

Install the backend capability before this frontend. H25 in Ops records the
release order and existing retained-pair rollback. At this first A1 release,
other quote, wallet and library callers still used the previous transport; A1 did not retire `/api/rpc`
or the public wallet RPC hosts. Partial basket metadata remains unavailable,
and an unavailable facts endpoint does not fall back to generic browser RPC.

Qualification: 177 unit cases plus lint/typecheck/build against the App CI's
pinned Protocol/Helpers artifacts, and all 25 Chromium browser cases, including
language switching, recovery wallet races, facts partial/outage handling and
wallet-modal opening. Installed A1 acceptance was subsequently recorded in H25;
ordinary later source releases and browser checks are handled by the agent.

The same release applies upstream dependency patches: Next.js 16.3.8, Axios
1.20.0 and Hono 4.13.7. The existing dependency audit reports zero findings.
The upstream advisories are [Next.js](https://github.com/advisories/GHSA-vcvr-r3jv-pc5j),
[Axios](https://github.com/advisories/GHSA-vh66-26gq-q6x8) and
[Hono](https://github.com/advisories/GHSA-hxh3-vqpv-xpqv). The new facts outage
case passes with the same two-worker browser execution used by hosted CI.

## Authoritative pool observations (U3/U5 B1)

Pool discovery and liquidity use `POST /api/pools/snapshot` through the same
private server adapter. Browsers send only token addresses and fee. The backend
selects its configured factory and RPC, reads price/liquidity/balances at one
canonical block and returns wide integers as strings. Quote orchestration keeps
its existing routes, tie-breaking and liquidity scoring; wallet intent stays
in the browser.

TanStack Query shares discovery and liquidity reads for five seconds, keyed by
configured chain, sorted token pair and fee. Twenty concurrent consumers issue
one API request. No failed refresh becomes successful cache data, and liquidity
observations preserve the producer acquisition time. Unavailable/empty pools
keep the current quote-probe behavior; no generic RPC fallback is added to these
two consumers. Generic Helpers quotations and wallet-library reads were later
completed through their own U5 slices. The public wallet RPC hosts stay available.

Install the backend B1 capability before this frontend using H27 in Ops.
The legacy cache envelopes still accept the retained frontend, but the backend
refreshes and replaces derived observations itself. H27 records installed
acceptance and retained restoration in both environments; a recovery pair
retains the producer-capable backend. Browser/API source qualification alone
does not establish installed acceptance.
