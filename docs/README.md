---
title: CyberGold App documentation
doc_type: portal
status: active
owner: app-maintainer
created: 2026-07-11
last_reviewed: 2026-10-19
canonical_for: App documentation navigation
---

# CyberGold App documentation

| Document | Status | Owner | Last reviewed |
| --- | --- | --- | --- |
| [Root README](../README.md) | active | App maintainer | 2026-10-11 |
| [Contributor guide](../CONTRIBUTING.md) | active | App maintainer | 2026-10-11 |
| [Branch and promotion workflow](development/branch-workflow.md) | active | App maintainer | 2026-10-11 |
| [Dependency coverage](development/dependency-coverage.md) | active | App maintainer | 2026-09-26 |
| [Runtime profiles](development/runtime-profiles.md) | active | App maintainer | 2026-07-11 |
| [Frontend and swap audit](development/frontend-swap-audit.md) | active | App maintainer | 2026-10-05 |
| [Environment configuration](architecture/environment.md) | active | App maintainer | 2026-09-20 |
| [Focused API adapter release](architecture/focused-api-adapters.md) | active | App maintainer | 2026-10-08 |
| [Dashboard indexer](architecture/dashboard-indexer.md) | active | App maintainer | 2026-09-26 |
| [Swap flows](architecture/swap-flows.md) | active | App maintainer | 2026-07-11 |
| [E2E and MetaMask guide](../tests/README.md) | active | App maintainer | 2026-07-23 |
| [Basket-flow acceptance](acceptance/basket-flows.md) | active | App maintainer | 2026-10-19 |
| [Token-flow acceptance](acceptance/token-flows.md) | active | App maintainer | 2026-10-19 |
| [Retained prior basket acceptance](acceptance/deferred/basket-flows.md) | archived | App maintainer | 2026-10-19 |
| [Retained prior token acceptance](acceptance/deferred/token-flows.md) | archived | App maintainer | 2026-10-19 |

The three `.github/agents/*.agent.md` files are executable automation
configuration. They are owned by the App maintainer, reviewed with test-policy
changes, and are not ordinary documentation. A healer may mark a persistent
test `fixme` only with explicit failure and issue/closure evidence.

Current production blockers live only in the Ops [work
register](../../cybergold-ops/docs/work/README.md).

- [Focused protocol facts](architecture/backend-http-contract.md): U5 A1 consumers, partial results and release order.
- [Next.js generated agent instructions](../AGENTS.md).
- [Sandbox fork state](architecture/sandbox-fork-state.md) explains pending transaction and receipt cleanup after a fork replacement.

Public contributor and licensing entry points:

- [Contributor guide](../CONTRIBUTING.md).
- [Project licensing scope](../LICENSING.md).
