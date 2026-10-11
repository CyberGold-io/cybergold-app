---
title: Sandbox transaction state after a fork refresh
doc_type: architecture
status: active
owner: app-maintainer
created: 2026-10-01
last_reviewed: 2026-10-01
canonical_for: Browser pending transaction and receipt cleanup after Sandbox fork replacement
---

# Sandbox fork state

The existing dashboard summary supplies an optional `sandboxForkGeneration`.
The Sandbox browser checks it every 30 seconds and on window focus. A changed
generation cancels and removes old query/mutation state, clears local Sandbox
Safe execution/nonce records and remounts the DApp content, clearing transient
pending transactions, receipt errors and permit reservations. This also works
when the refreshed Safe has the same nonce. The wallet connection, Mainnet
records and display preferences are retained.

The first tracked generation clears legacy Sandbox records once. Each open tab
tracks its own last generation; a late old-fork callback cannot recreate an
erased execution record. Missing fields from a retained backend and unavailable
requests do not establish a fork change and do not clear current state.

This uses the existing summary adapter and backend bearer. Signing and receipt
watching stay with the wallet. Backend support is deployed before the browser cleanup. Normal installed
refresh/browser acceptance remains separate.
