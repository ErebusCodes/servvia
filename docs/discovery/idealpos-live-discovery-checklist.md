# Idealpos Live Windows Discovery — Work Package

**Created:** 2026-08-16
**Expanded:** 2026-08-16 (session 2, story `9-2` — added §J); 2026-08-17 (session 3 — static-only assessment of the copied Idealpos installation materials, item I and item J's module-enumeration bullet updated with deeper evidence; no existing item was answered from live observation in any session).
**Status:** Not started — no item has live-observation or vendor-response evidence. All evidence to date is static-file evidence recorded in `idealpos.md` §12/§12.4/§12.5, which does not satisfy this checklist for any item (see "How to use this checklist" below).
**Owner:** Product/technical owner of the Idealpos relationship, in coordination with venue staff and, where needed, Idealpos/Oolio/the reseller of record (per DL-064).
**Governs:** unblocking [DL-064](../decisions-log.md#dl-064-idealpos-vendor-discovery-decision-record-formal) beyond the truthfulness fix already shipped in story 9-1; unblocking the tracer bullet story [`9-2-idealpos-uibridge-tracer`](../../_bmad-output/implementation-artifacts/9-2-idealpos-uibridge-tracer.md); resolving the KDS/KOT duplicate-print decision in [`idealpos.md` §18](../integrations/idealpos.md#18--kdskot-duplicate-print-blocking-decision).

## Safety boundary for this discovery work

This checklist is executed against a **real or demo Windows machine with Idealpos installed and running** — unlike the read-only static inspection recorded in `idealpos.md` §12, discovery here may involve logging in, opening menus, and observing live behaviour. The following still apply throughout:

- **Never record a credential, licence key, API key, certificate content, or database row value.** Record only that a setting/capability *exists* and, where relevant, its non-secret shape (e.g. "the external-reference field allows up to 40 characters" is fine; the actual license key or password is not).
- Do not perform any action against a real production venue database unless explicitly scoped as a "real venue" item below and separately authorized.
- Prefer a demo/cloned/sandbox Idealpos install for anything destructive or exploratory (creating test transactions, toggling settings).
- Do not attempt undocumented DLL/COM calls, direct database writes, or reverse engineering as part of this discovery — if a question can only be answered that way, record it as `BLOCKED — requires vendor/reseller answer`, not attempted independently.
- Any reseller/vendor conversation about UI automation must record their position as evidence (approve / object / no position), not be treated as tacit approval by default.

## How to use this checklist

Each item below records one of: a value/fact, a yes/no + brief description, or `BLOCKED — <reason>`. Nothing in this checklist may be marked complete from inference, the local installation copy (`idealpos.md` §12), or assumption — only from direct observation against a running Idealpos instance or a written vendor/reseller answer.

---

## A — Environment identification

- [ ] Exact Idealpos version and build number (as shown in the application, e.g. Help/About).
- [ ] Windows version and architecture of the host machine(s) running Idealpos.
- [ ] Licensed number of terminals and which Licence Gateway modules are enabled (module names/entitlement, not licence key values).
- [ ] Whether Idealpos Online/ecommerce is already enabled/licensed for this installation, and if so, on what commercial terms.
- [ ] Current Idealpos service status (which of `IPSClient.exe`/`IPS.exe`/`IdealposService.exe` are installed as services vs. run interactively, and whether they are currently running).

## B — Payment and EFTPOS topology

- [ ] Existing EFTPOS provider (e.g. Oolio Pay/Verifone, PayLinq, etc. — whichever is actually configured) and terminal topology (how many terminals, which map to which POS terminal/till).
- [ ] How Idealpos surfaces payment/tender completion for a transaction (screen state, report, or other observable signal) — this is what any reconciliation mechanism will read.

## C — Order entry and reference fields

- [ ] Which order/note/external-reference fields are available on a sale (free-text note, customer reference, table reference, etc.) and their field-length and permitted-character constraints.
- [ ] Whether any such field is **searchable** — i.e. can a later screen/report find a transaction by that field's value, not just view it once already open.
- [ ] Whether stock/menu items can be entered by a stable code (PLU/stock code) reliably, or only by menu-tree navigation.
- [ ] How table selection and table-transaction recall work (select existing open table transaction vs. create new).
- [ ] How modifiers/instructions are entered against a line item.
- [ ] Whether an **open/unpaid table transaction** can be created and saved without immediately taking payment, and what that transaction's visible state looks like.

## D — Online/prepaid tender

- [ ] Whether an `ONLINE` or `PREPAID / ONLINE` tender (or equivalent) is configured, and its exact name/code as it appears in Idealpos.
- [ ] How completing a sale under that tender differs from a normal cash/EFTPOS sale from a data-entry perspective.

## E — Transaction reference and reconciliation

- [ ] Whether Idealpos issues/displays a stable transaction reference at time of save, and where it appears (screen field, receipt, report).
- [ ] Whether that reference (or the external reference from §C) can be used to look up the transaction later, for reconciliation purposes.

## F — Kitchen printing and duplicate-print prevention

- [ ] Whether kitchen-printer triggering can be suppressed for a specific terminal, a specific clerk/user, a specific sale/order source, or the specific order-entry workflow the Bridge would use.
- [ ] If suppression is possible, exactly which of the above scopes it applies to, and how it is configured.
- [ ] If suppression is **not** possible by any scope, record that plainly — this triggers the formal decision required in `idealpos.md` §18.
- [ ] Whether the environment used for the tracer bullet (story `9-2`) has **any** kitchen-print target configured — physical printer, virtual/PDF printer, or an on-screen KDS target — that would fire a print/display event for a saved transaction. A "no live kitchen printer attached" claim is only sufficient to satisfy story 9-2's blocking condition 6 if this item confirms **no print target of any kind** (physical or virtual/software) is configured, not merely that no physical hardware is plugged in.

## G — Automation feasibility and resilience

- [ ] Whether a dedicated terminal and a dedicated, always-logged-in interactive Windows session is feasible for the Bridge to run in.
- [ ] Whether that dedicated session can run under a **non-administrator, least-privilege local account**, scoped to only the Bridge application and Idealpos, with remote-desktop/remote-interactive-logon rights disabled — confirm this is achievable, not just that a session is achievable (`idealpos.md` §14.2 makes this normative, not optional).
- [ ] Behaviour under: pop-ups/dialogs appearing mid-entry, session timeout/lock-screen, application restart, focus loss to another window, and Windows Update-triggered restarts — does Idealpos recover gracefully, and what does each state look like on screen (so the Bridge can detect it)?
- [ ] Accessibility/UI Automation support: do the relevant screens (table selection, item entry, save/finalise) expose usable Automation IDs/accessible names, or would the Bridge need to fall back to control handles/coordinates?

## H — Operational safety

- [ ] Backup and rollback procedure for the Idealpos database/configuration, in case discovery or the later tracer bullet needs to be undone.
- [ ] Whether a safe demo/cloned Idealpos environment is available for the tracer bullet (story `9-2`) — a real production database must never be used for that story.

## I — Vendor/reseller position

- [ ] Idealpos's (or the reseller's) position on UI-automation-based integration: approve / object / no position, recorded as their actual written response, not assumed.
- [ ] Any supported interface the vendor/reseller identifies that this discovery had not already found (ecommerce API, Doshii, other).
- [ ] **The full consolidated vendor/reseller question set lives in `idealpos.md` §12.6** (16 questions assembled from every static finding through §12.5, covering licence entitlement, version, Doshii/WebIt/ecommerce availability, import mechanisms, EFTPOS/KOT preservation, sandbox availability, support and upgrade implications) — answer against that list rather than duplicating questions here; record only the answers here, or in a vendor-correspondence artifact this checklist links to once one exists.
- [ ] **If, and only if,** the vendor/reseller records "no position" (not merely "not yet asked" or "blocked — no answer obtained") — record Verdura's own internal risk-acceptance decision: who authorized proceeding without vendor endorsement, on what date, and where that authorization is filed. This is the only mechanism by which story `9-2`'s blocking condition 7 may be satisfied in the absence of a vendor/reseller position; it does not apply if the vendor/reseller simply has not been asked yet.

---

## J — Additional items (story `9-2`, session 2, 2026-08-16)

Added to cover this session's governing brief for story `9-2`'s discovery matrix, not previously explicit above. Same rules apply: only direct observation or a recorded vendor/reseller answer, never inference from the static installation-copy evidence (`idealpos.md` §12/§12.4). Each item below is answered here using this session's evidence-state vocabulary (`VERIFIED` / `OBSERVED_NOT_PROVEN` / `NOT_AVAILABLE` / `BLOCKED_REQUIRES_VENDOR` / `BLOCKED_REQUIRES_LIVE_WINDOWS` / `NOT_APPLICABLE`) — earlier sections' `BLOCKED — <reason>` wording means the same thing and is not being retroactively rewritten.

- [ ] **Installation paths** on the real host (Idealpos program directory, data directory, service install directories). **`BLOCKED_REQUIRES_LIVE_WINDOWS`** — the installation-copy path is a local artifact of how the copy was made, not evidence of any real venue's actual path.
- [ ] **Process privilege levels** the running Idealpos processes (`IPS.exe`, `IPSClient.exe`, `IdealposService.exe`, `IdealposUpgradeService.exe`) actually run under at a real venue, and whether any require administrator rights to run or to be automated against. **`BLOCKED_REQUIRES_LIVE_WINDOWS`**.
- [ ] **Duplicate-submission detection possibilities** beyond the external-reference search already covered in §C/§E — e.g. does Idealpos itself warn or block on a near-duplicate table/time/item combination independent of any Verdura-supplied reference? **`BLOCKED_REQUIRES_LIVE_WINDOWS`**.
- [ ] **Operator cancellation and recovery**: if a staff member at the terminal notices an in-progress automated entry and wants to stop it, what does that look like from Idealpos's side (can they cancel a partially-entered sale safely, does Idealpos leave any residual draft state)? **`BLOCKED_REQUIRES_LIVE_WINDOWS`**.
- [ ] **Supported import/watch-folder/command-line ingestion mechanisms**, if any, distinct from UI automation or the online/ecommerce service architecture already noted (`idealpos.md` §12.1/§12.4) — e.g. a documented CSV/XML drop-folder or command-line order-submission tool. **`BLOCKED_REQUIRES_VENDOR`** — not found in the static installation-copy evidence; would need vendor/reseller confirmation either way (absence of evidence in the local copy is not proof of absence at a real venue).
- [ ] **Available audit/event/log evidence**: does Idealpos write to Windows Event Viewer, or maintain its own log files, in a way that could corroborate a transaction after the fact (defense-in-depth for reconciliation, not a replacement for the transaction reference itself)? **`BLOCKED_REQUIRES_LIVE_WINDOWS`**.
- [ ] **Confirmation that UI automation can be performed without ever reading, displaying, or storing a payment secret** (card number, CVV, EFTPOS terminal state beyond a plain completion/decline signal) — this session's tracer (`windows-connector/`) is structurally incapable of this by scope (it never reaches an order/payment screen at all), but this item remains open for whichever later story implements real order entry: confirm the actual Idealpos payment screens do not expose any such data through the same UI Automation tree the order-entry screens use. **`BLOCKED_REQUIRES_LIVE_WINDOWS`**.
- [ ] **Explicit enumeration of installed vendor-integration modules** for the real venue's installation, cross-checked against every capability-evidence-only surface found in the static copy: Doshii (now a full `DoshiiService`/`PosserverService` OAuth client with `ApiKey`/`LocationId` fields, not just one method name — `idealpos.md` §12.5), "WebIt" web-ordering (`IdealPos.Webit.Core.dll`, WCF/DataContract order/customer/stock-item schema — §12.4/§12.5), the Ecommerce/Online service architecture (confirmed outbound-only, no local server-hosting evidence — §12.5), the licensing-service SOAP contract (`IdealPos.Licensing.Service2.ClientApi.dll`), a generic file import/export framework (`IPS.Data.ImporterExporter.dll`, not evidenced as order-related — §12.5), and ResDiary EPOS consumer helpers (`ResDiary.EposServiceConsumer.Helpers.dll`, booking-only) — `idealpos.md` §12.4/§12.5. Which, if any, are actually licensed/enabled for this venue? **`BLOCKED_REQUIRES_VENDOR`**.

---

## Completion gate

This work package is **complete** only when every item above is answered from direct observation or a recorded vendor/reseller response (not left blank, not inferred). A `BLOCKED — <reason>` entry is a valid, honest interim answer for tracking purposes, but **it does not, by itself, satisfy this work package for any purpose** — in particular, a `BLOCKED` entry on any of items A, C (open/unpaid and searchability sub-items), E, F, G, or I does **not** satisfy story `9-2`'s corresponding blocking condition, which requires "direct observation or recorded vendor/reseller response" verbatim. Marking this checklist "complete" with `BLOCKED` entries on any gating item does not unblock story 9-2 or DL-064 for those items — only a substantive answer does. The remainder of the items (outside 9-2's named gating subset) gate the broader DL-064 vendor-discovery decision and production-scale adapter work.
