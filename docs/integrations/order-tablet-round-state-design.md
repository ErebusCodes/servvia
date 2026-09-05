# Order Tablet — round state design

**Written:** 2026-09-05 (offline), by tracing
`apps/admin-console/src/pages/order-tablet/OrderTabletPage.tsx` (2,922 lines)
and `billing.ts`. **Design only — no tablet code was changed.** The
server-side half is
[`multi-round-implementable-design.md`](./multi-round-implementable-design.md).

---

## 1. What the tablet actually holds today

Traced, not assumed:

| Thing | Where it lives | Survives browser restart? |
| --- | --- | --- |
| cart lines | `useState<TabletCartItem[]>` (`:338`) | **no** |
| per-line "already sent" marker | `TabletCartItem.sent: boolean` (`:190`) | **no** — dies with the cart |
| line identity | `TabletCartItem.key`, a **client-side integer counter** (`handleAddLine`, `hydrateTableOrder`'s `keyN`) | **no** |
| order idempotency key | `useState<string>(() => crypto.randomUUID())` (`:422`) | **no** |
| created order reference | `createdOrderRef` (`:355`), re-derived from the live-orders query (`:1157`) | yes, indirectly |
| unresolved-submission marker | `localStorage['verdura-order-tablet-pending-submission-v1']` — **`{context, submittedAt}` only** (`:113`) | yes |
| the order, its items, its `POSSyncRecord` | backend | yes |

### The four states the brief names, and what represents each today

| State | Represented as | Verdict |
| --- | --- | --- |
| already confirmed items | `sent: true` on a cart line, set either by `hydrateTableOrder` (all hydrated lines are `sent: true`, `:597`) or by `setCart(prev => prev.map(i => ({...i, sent: true})))` after a 2xx (`:980`) | **wrong name.** `sent: true` means "a 2xx came back", not "IdealPOS confirmed". Since the fail-closed change nothing is ever *confirmed*, so this label currently overstates |
| current unsent cart | `sent: false` lines | exists, **not durable** |
| unresolved submitted round | the `localStorage` marker | exists, but carries **no round identity** — just a context string and a timestamp |
| newly-added next-round items | *nothing* | **absent by design**: `:964`/`:1212` explicitly refuse — *"Adding a further round to an open table isn't supported yet"* |

### The three gaps that matter

1. **The idempotency key dies with the tab.** It is React state minted at
   render, not server-issued. After a restart, a resubmit generates a *new*
   key, which the backend correctly treats as a *new order*. The `localStorage`
   marker exists to stop staff walking into that hole — but it **blocks, it
   does not recover**. There is no way to resume an interrupted submission.
2. **Line identity is a client integer.** `key` is a local counter. Two devices
   would mint colliding keys, and no key survives a restart. Nothing can be
   said about "this line" across a device boundary or a reload.
3. **The unresolved marker is device-scoped.** `localStorage` is per-origin,
   per-device. Device B knows nothing about device A's unresolved round. The
   file's own comment is accurate about this: *"the marker is a property of the
   DEVICE's submission state"*. For rounds, that is the wrong granularity —
   an unresolved round is a property of the **table**.

---

## 2. The design: server-authoritative round identity

The rule that resolves all three gaps in one move:

> **The client never invents identity. The server issues a round id and an
> idempotency key when the round is OPENED, before any item exists, and the
> client stores only that id.**

`localStorage` stops being the truth and becomes a **pointer to the truth**
plus a crash-safe draft cache. Its contents are advisory; the server's round
state is authoritative and always re-read on mount.

### Persistent client state

```jsonc
// localStorage['verdura-order-tablet-round-v2']
{
  "orderId":        "…",     // the session (Order.id)
  "roundId":        "…",     // server-issued, the ONLY identity that matters
  "sequence":       2,
  "idempotencyKey": "…",     // server-issued at OPEN; the client never mints one
  "lastKnownState": "submitting",
  "draftLines":     [ /* advisory cache, see below */ ],
  "writtenAt":      "2026-09-05T…Z"
}
```

Three properties make this safe:

- **`roundId` and `idempotencyKey` are never generated client-side.** They come
  from `POST /admin/orders/:orderId/rounds`, which is the round-OPEN call.
- **`lastKnownState` is a hint, never a decision input.** On mount the tablet
  calls `GET /admin/orders/:orderId/rounds` and adopts the server's state. If
  the two disagree, the server wins, always, with no merge.
- **`draftLines` is advisory and only ever read while the server says
  `drafting`.** If the server says the round is `submitting`, `unresolved` or
  terminal, the cache is discarded unread — it cannot resurrect a payload that
  is already frozen.

### Why not IndexedDB, or nothing at all

`localStorage` is retained (not replaced) because it already carries the
unresolved-submission guard and is proven durable across the exact cases that
matter — tab close, browser restart, device restart. The change is not the
*storage*, it is *what is stored*: an id issued by the server instead of a
value invented by the client. Storing nothing at all would lose the
crash-recovery draft, which is a real staff-hours cost with no safety benefit.

---

## 3. The seven questions, answered

### 3.1 When does the server create the round ID?

**At round OPEN — the moment staff begin composing, before the first item is
added.** Not at submit.

`POST /admin/orders/:orderId/rounds` → `{ roundId, sequence, idempotencyKey,
state: "drafting" }`.

This is the whole fix. The identity is durable *before* any payload exists, so
every subsequent event — an add, a submit, a crash, a restart, a retry —
happens under an identity the server already knows. There is no window in
which the client holds identity the server has not seen.

Cost: one extra round-trip when a table is opened. That is the correct place to
pay it — staff are picking a table, not waiting on a kitchen.

If that call fails, the tablet is **offline for ordering on this table** and
says so. It must not fall back to a client-minted id; that reintroduces exactly
the hole this closes.

### 3.2 When does the payload become immutable?

**On the `drafting → submitting` transition, server-side, in the same
transaction that sets `payloadFrozenAt`.**

The client sends the line set to `POST …/rounds/:roundId/submit`. The server
snapshots it into `submittedPayload`, stamps `payloadFrozenAt`, and from that
instant refuses every edit to that round — enforced by the payload-freeze
trigger, not by convention (§3.8 of the schema design).

The client's optimistic "freeze" (disabling the cart UI) happens at the same
moment, but is presentation only. The authority is the trigger.

### 3.3 When does the UI clear the unsent cart?

**Never as a side effect of sending.** The cart is not cleared; it is
*reclassified*.

Today, `setCart(prev => prev.map(i => ({...i, sent: true})))` mutates every
line in place on a 2xx — which is why an ambiguous outcome has nowhere to live.
Under the round model:

- Lines belong to a round. When round N freezes, its lines move to the
  **"With the kitchen"** group, rendered read-only.
- The **"Not yet sent"** group becomes empty and is where round N+1's lines
  will go — but only once round N is terminal (§3.6).
- The local `draftLines` cache is cleared only when the server confirms the
  round left `drafting`.

The user-visible consequence: staff always see the whole table — what the
kitchen has, and what it does not — instead of a cart that silently becomes
"all sent".

### 3.4 What happens after an ambiguous network failure?

The submit produced no definite outcome — no response at all, torn connection,
device restarted mid-flight.

1. The client writes `lastKnownState: "submitting"` **before** issuing the
   request (it already does the equivalent, `writePendingSubmissionMarker` at
   `:864`).
2. No response arrives. The client does **not** retry, does **not** clear, does
   **not** mark lines sent.
3. On next mount it re-reads the server. Three cases:
   - server says `awaiting_native_confirmation` or terminal → **the submit
     landed.** Adopt server state. Nothing was lost.
   - server says `submitting` past a timeout → the server marks the round
     `unresolved` on its own sweep. The tablet shows the unresolved banner.
   - server says `drafting` → the request never arrived. The draft cache is
     still valid; staff may submit again **under the same round id and the same
     idempotency key**.

The critical property: **case 1 and case 3 are distinguished by the server, not
guessed by the client.** Today they are indistinguishable, which is why the
current guard has to block rather than resume.

If staff resubmit while the true state is case 1, the identical
`idempotencyKey` collapses the retry onto the original round. No second native
round. That is the concrete payoff of issuing the key at OPEN.

**An `unresolved` round is never auto-resolved and never auto-retried.** It is
cleared by a human who has looked at the real kitchen/POS state — the same
posture the current `localStorage` guard takes, raised from device scope to
table scope.

### 3.5 What does staff see while native confirmation is pending?

Three groups, always all visible, never collapsed:

```
┌ Table 5 ─────────────────────────────────────────────┐
│ WITH THE KITCHEN                                     │
│   Round 1  ·  Sent 19:42  ·  Awaiting POS confirmation│
│     2× Lahmacun                                       │
│     1× Ayran                                          │
│   ⓘ Sent and accepted. IdealPOS has not confirmed —   │
│     this is normal; confirmation is not available yet.│
├──────────────────────────────────────────────────────┤
│ NOT YET SENT                    (Round 2 · drafting)  │
│     1× Künefe                                         │
│                              [ Send Round 2 ]         │
└──────────────────────────────────────────────────────┘
```

The wording matters and must not drift. Since the fail-closed change,
`awaiting_native_confirmation` is where a round **stays**, indefinitely, for
every successful submission. So the pending state is the *normal* state, not an
error, and the UI must say so — otherwise every table permanently displays what
looks like a fault.

The label must not say "confirmed", "synced" or "in IdealPOS". The honest
claim, and the strongest one available today, is: **sent, and the POS accepted
delivery.** The existing `POSSyncStatus` label map (`:2484`) already gets this
right for `submitted_awaiting_confirmation` and should be reused verbatim
rather than re-worded per round.

### 3.6 May staff compose Round N+1 while Round N is unresolved?

**Composing: yes. Sending: no.**

This is the conservative rule the brief asks for, split at the point where it
actually costs something:

- **Composing is allowed** because forbidding it loses real work. Staff are
  standing at a table taking an order; a network fault must not make them stop
  writing things down. Round N+1's lines accumulate locally as an
  *unopened* draft — no server round exists for them yet.
- **Sending is refused**, hard, until round N is terminal. `canOpenNextRound`
  returns false while any round is `drafting`, `submitting`,
  `awaiting_native_confirmation` or `unresolved`; and the partial unique index
  `order_round_one_open_per_order` makes that refusal hold **across devices**,
  which is the part `localStorage` can never do.

Why refuse rather than queue: if round N is `unresolved`, we do not know
whether the kitchen has it. Sending N+1 could produce a duplicate, an
out-of-order docket, or a round that appends to a native sale that does not
exist. None of those are recoverable from the tablet. Blocking is the only
option whose worst case is a delay.

**Note the asymmetry with `awaiting_native_confirmation`.** Round N sitting in
`awaiting_native_confirmation` *also* blocks round N+1 — and since nothing
currently reaches `confirmed`, that would block every second round forever.
That is a real consequence and it is stated plainly rather than designed
around: **until a causal native identity exists, a second round cannot be sent
safely, so the model refuses to send it.** The alternative — treating "the
Bridge returned 2xx" as good enough to append a second round — is exactly the
correlation-grade reasoning the fail-closed change removed. This design does
not reintroduce it at a different layer.

The operational escape, when the venue needs one before that identity exists,
is a **deliberate, audited staff override**: a human asserts that round N is
with the kitchen, which transitions it `unresolved → awaiting_native_confirmation`
(or terminal) with the acting staff id recorded. A human decision on the
record — not an inference.

### 3.7 How does a rejected round return to editable without changing identity?

`reopenRejectedRound` (implemented and tested):

```
rejected ──► drafting     roundId        unchanged
                          sequence       unchanged
                          idempotencyKey unchanged
                          payloadFrozenAt → null   (lines editable again)
```

Staff fix the bad line and press Send again. The POS sees the **same**
idempotency key it already rejected, so there is no second round and no
ambiguity about which round the correction belongs to.

Three guards make this safe, each with a test:

- only `rejected` may reopen — `failed`, `confirmed` and `abandoned` are
  terminal and throw (*"a FAILED round is terminal and cannot be reopened"*);
- reopening clears `payloadFrozenAt`, which is the only thing that re-enables
  editing (*"the reopened round is editable again"*);
- the key survives (*"resubmitting a reopened round presents the SAME key — no
  second native round"*).

A `rejected` round does **not** block the session, because its resolution is a
transition of the same round rather than a new one — which is why `rejected` is
excluded from `IN_FLIGHT_ROUND_STATES`.

---

## 4. Browser-restart guarantee

The brief's requirement: *"a browser restart must preserve enough state that
staff cannot unknowingly reconstruct an unresolved round."*

| Restart happens… | Before | After this design |
| --- | --- | --- |
| while drafting | cart lost, key regenerated | round id survives; draft cache restores lines; same key |
| mid-submit, response lost | key lost → a resubmit creates a **second real order**; the `localStorage` marker blocks it but cannot resume | server holds the round; client re-reads state and either adopts the landed submit or resubmits under the **same** key |
| after a 2xx | `sent` flags lost; re-selecting the table rehydrates (dine-in only) | round is `awaiting_native_confirmation` server-side; lines render under "With the kitchen" on any device |
| on a different device | knows nothing | reads the same server round; the partial unique index prevents it opening a competing round |

The last row is the one `localStorage` structurally cannot deliver and is the
strongest argument for server-authoritative identity.

---

## 5. Client changes required (not made)

For completeness, so the work is sized rather than discovered later:

1. Replace `orderIdempotencyKey` (`:422`) with the server-issued key; delete
   the `crypto.randomUUID()` initialiser.
2. Replace `TabletCartItem.sent: boolean` with `roundId: string | null` —
   `null` means not yet in a round. Group rendering keys off it.
3. Replace `TabletCartItem.key` (client integer) with a server line id once
   lines are round-scoped, so line identity survives a device boundary.
4. Migrate `verdura-order-tablet-pending-submission-v1` →
   `verdura-order-tablet-round-v2`, keeping the existing one-time-migration
   pattern (`readPendingSubmissionMarker`, `:125`) so an in-flight marker
   written by the current build is not dropped on the deploy that changes this.
5. Replace both *"Adding a further round to an open table isn't supported yet"*
   messages (`:964`, `:1212`) with the round flow.
6. `billing.ts` reduces over the session's rounds, not one order's lines —
   otherwise a seat-split bill omits every round but one.

None of these were made tonight. Item 6 in particular must land in the same
change as the server-side step 6, or the tablet will under-bill.
