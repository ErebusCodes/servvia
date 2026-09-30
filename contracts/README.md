# Servvia contracts

These files are the interface contracts at the migration boundaries of the [Servvia-native POS migration](../docs/migration/README.md). Every Servvia Core client targets them: web, Android, Windows POS and Venue Edge. The Go Core must satisfy them before any caller is switched from the NestJS API.

A contract is written from the **current running code**. Each claim cites its source (`x-source: path:line`). Anything the code does not settle is marked `x-unverified`. Current defects are recorded under `x-known-issues`, not tidied away. Changing a contract is a deliberate, reviewed API change.

| Directory | Contents |
|---|---|
| `openapi/` | HTTP APIs (OpenAPI 3.1): identity and devices, menu reads, venue configuration reads, orders, the connector/device command protocol, and the new Servvia-native APIs, table sessions, canonical orders (`servvia-orders.yaml`), kitchen tickets (`kitchen-tickets.yaml`), checks (`checks.yaml`), payments and settlement (`payments.yaml`), shifts and cash (`shifts.yaml`), devices and terminals (`devices.yaml`), refunds and reversals (`refunds.yaml`) and promotions (`promotions.yaml`), which are specifications rather than records of Nest behaviour |
| `schemas/` | Shared shapes and rules: access-token claims, venue scope, the ConnectorCommand state machine |
| `realtime/` | WebSocket contracts: the Servvia Core realtime protocol and message schemas (`servvia-realtime.md`, `servvia-realtime.schema.json`, Phase D12), and the legacy NestJS socket.io `orderUpdate` channel (`orders-socket.md`, frozen) |
| `events/` | The canonical fact catalog (`catalog.md`, Phase D12: one definition per fact, delivered by realtime and, for `order.round_submitted`, the kitchen outbox) and the inventory of NestJS-era asynchronous mechanisms (`README.md`). |

Shared business logic is **not** shared as code across languages. Go Core implements the rules, and clients get typed models generated from these contracts.

`scripts/check-contracts.test.mjs` checks that every file parses and every OpenAPI document is structurally complete. Run it with `npm run test:dev-scripts`.
