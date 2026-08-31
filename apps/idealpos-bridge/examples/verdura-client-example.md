# Verdura → VerduraIdealposBridge — example calls

All requests need `Authorization: Bearer <Bridge:ApiKey from App.config>`.
Replace `http://localhost:5588` with wherever the bridge is actually
reachable (see README.md "Security" before binding it anywhere but
loopback).

## Health

```
GET /api/health
Authorization: Bearer <key>
```
```bash
curl -s http://localhost:5588/api/health \
  -H "Authorization: Bearer $BRIDGE_API_KEY" | jq
```
```json
{
  "bridgeRunning": true,
  "bridgeVersion": "1.0.0.0",
  "sqlConnected": true,
  "sqlDetail": "ok",
  "assembliesLoaded": true,
  "assembliesDetail": "IdealPos.Webit.Core, Version=1.0.0.0, ...",
  "ipsExeRunning": true,
  "ipsExePathExists": true,
  "tableAssignmentStrategy": "DeliverTo",
  "tableAssignmentConfirmed": true,
  "orderProcessingPathAvailable": true,
  "connectedRealtimeClients": 2,
  "reasons": []
}
```
`orderProcessingPathAvailable: false` means don't let Verdura staff try to
submit an order yet — check `reasons` for why.

## Tables

```bash
curl -s http://localhost:5588/api/tables -H "Authorization: Bearer $BRIDGE_API_KEY" | jq
```
```json
[
  { "table": "12", "code": 12, "tableMap": 12, "seats": 4, "status": 0, "amount": 0.0, "likelyOccupied": false, "type": 3, "index": 0, "guestsSaved": 0 }
]
```
`likelyOccupied` is a heuristic — see the field's doc comment in
`Idealpos/Dto.cs`. Don't build a hard "table is locked" business rule on it
without your own live confirmation.

## Products

```bash
curl -s http://localhost:5588/api/products -H "Authorization: Bearer $BRIDGE_API_KEY" | jq
```
```json
[
  { "id": "101002", "code": "101002", "description": "Burger", "available": true, "price": 18.50, "departmentCode": 30 }
]
```

## Submit an order

```bash
curl -s -X POST http://localhost:5588/api/orders \
  -H "Authorization: Bearer $BRIDGE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
        "externalOrderId": "VERDURA-12345",
        "table": "12",
        "items": [
          { "productCode": "101002", "quantity": 2 },
          { "productCode": "101003", "quantity": 1 }
        ],
        "notes": "No onion"
      }' | jq
```
`201` on first submission, `200` with `"duplicate": true` if you retry the
same `externalOrderId` (e.g. after a Wi-Fi timeout) — same body shape
either way, safe to always read the response the same way.
```json
{
  "externalOrderId": "VERDURA-12345",
  "status": "submitted_to_idealpos",
  "table": "12",
  "idealposWebPendingOrderId": null,
  "idealposPendingSaleId": null,
  "idealposPendingSaleCode": null,
  "tableMatchesRequest": null,
  "processed": false,
  "tableOccupiedWarning": false,
  "strategyUsed": "DeliverTo",
  "submittedAtUtc": "2026-08-19T10:15:00Z",
  "lastObservedAtUtc": "2026-08-19T10:15:00Z",
  "lastError": null,
  "duplicate": false
}
```

## Poll status

```bash
curl -s http://localhost:5588/api/orders/VERDURA-12345 -H "Authorization: Bearer $BRIDGE_API_KEY" | jq
```
Prefer the WebSocket channel below over polling this in a tight loop.

## Real-time updates (WebSocket)

Browsers can't set custom headers on the WebSocket handshake, so the key
goes in the query string for this one endpoint only (see
`Http/HttpServer.cs`'s `CheckAuth`):

```
ws://localhost:5588/ws/orders?api_key=<key>
```

Every connected client receives every `order.statusChanged` event
(broadcast, not per-table filtered — see `Realtime/WebSocketHub.cs`):

```json
{ "type": "order.statusChanged", "externalOrderId": "VERDURA-12345", "status": "pending_idealpos_processing", "table": "12", "pendingSalesId": null, "tableMatchesRequest": null }
{ "type": "order.statusChanged", "externalOrderId": "VERDURA-12345", "status": "processed", "table": "12", "pendingSalesId": null, "tableMatchesRequest": null }
{ "type": "order.statusChanged", "externalOrderId": "VERDURA-12345", "status": "assigned_to_table", "table": "12", "pendingSalesId": 1234, "tableMatchesRequest": true }
{ "type": "order.statusChanged", "externalOrderId": "VERDURA-12345", "status": "paid", "table": "12", "pendingSalesId": 1234, "tableMatchesRequest": true }
{ "type": "order.statusChanged", "externalOrderId": "VERDURA-12345", "status": "closed", "table": "12", "pendingSalesId": 1234, "tableMatchesRequest": true }
```

See `verdura-client-example.html` in this folder for a runnable browser
example of both the HTTP calls and this WebSocket subscription.

## What Verdura must never call

There is no `/pay` endpoint and none should be added. Payment happens when
staff use Idealpos's own controls after opening the table — see the
investigation's Section K.4/K.6 and this project's README "Payment stays
in Idealpos".
