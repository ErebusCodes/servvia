# DL-111 — Support request to IdealPOS dealer / IdealPOS Solutions (ready to send)

Contains no passwords, PINs, API keys, licence keys or tokens. Send as-is.

---

**Subject:** Sila Restaurant (Dunedin) — IDEAL HANDHELD licence status + WaiterPad order-ingestion protocol documentation

Hello,

We are building a local, on-premise integration for this site and need two things confirmed:
the licence state of one module, and the documented protocol for the interface it gates.

**Site:** Sila Restaurant — Dunedin
**Installed front-end:** IdealPOS v7.1 Build 33 — `IPS.exe` v7.133.0200
**Installed POSServer:** v8.0.0.1

**What we have already established locally (read-only, no changes made):**

- The licence gateway currently reports `Options=Pack 2`, Licence Enabled, expiry 14 Sep 2026.
- `IDEAL HANDHELD` appears as a separately named module in the installed licensing vocabulary,
  as a peer of `Pack 1` and `Pack 2`.
- The runtime gate is `HandheldLicensed`; when it is false the handheld listener accepts the TCP
  connection and then silently discards the payload.
- There is no historical handheld activity at this site — the handheld duplicate store has never
  been written and no handheld device has ever registered.
- The installed POSServer v8.0.0.1 build does not appear to expose a handheld *order-creation*
  command (we can see sale/enquiry/payment handling only), so `IPS.exe` on TCP 12183 appears to
  be the only order-ingestion path present on this installation.

**Our questions:**

1. Does this site's current `Pack 2` licence include the `IDEAL HANDHELD` module?

2. If it does not:
   - Which licence or add-on must be enabled to obtain it?
   - How many handheld device licences would that include?
   - Does enabling it require a licence refresh, a service restart, or a POS restart?

3. Please provide the protocol documentation for the handheld / WaiterPad order-ingestion
   interface on TCP port 12183 as implemented in `IPS.exe` v7.133.0200, specifically covering:
   - device registration / pairing, and whether a device must be pre-registered in Back Office
   - request framing and character encoding
   - the ORDER packet shape and required field order
   - `Checksum` / `LastCheckSum` semantics
   - duplicate-detection semantics, and whether they persist across a restart
   - the Table, Map, POS terminal, Clerk and Device identity fields and their valid values
   - pricing behaviour — in particular whether the POS prices the line itself from the stock code,
     or whether the supplied price is authoritative
   - kitchen-print (KOT) behaviour — how many dockets one accepted packet produces
   - behaviour when the requested table already has an open sale (append vs reject vs new sale),
     and whether already-printed items are preserved and only new items printed
   - the meaning of each response: `ACK`, `NAK`, `DUPLICATE`, `LOCKED`, `NAKREGO`, `NAKPRINT`

4. Is that interface the supported mechanism for a third-party local integration to create — and
   later append to — dine-in orders directly on an IdealPOS table?

5. If it is not the supported mechanism, please identify the supported local API or protocol for:
   an external order → assigned to a native table → native kitchen docket → subsequent rounds
   appended to the same table.

6. May a third-party integration run locally on the same Windows host and connect to
   `127.0.0.1:12183` without exposing a LAN or internet-facing port?

7. On IdealPOS v7.133.0200 we can identify **two different transfer paths**, and they behave
   differently. We would like to know which one is the supported route, if either.

   **Path 1 — recall the pending sale into the normal sale screen, then attempt a table transfer.**
   This is rejected by the installed native code with:

   ```
   Cannot Transfer to Table!
   ```

   The relevant `frmSale` branch identifies the sale currently on screen as a recalled *Pending Sale*
   and prevents conversion through that route. We reproduced this on this installation.

   **Path 2 — the separate native Pending Sales action** `cmdTransferToTable`, audit/action code
   `PDTF` ("Transfer Pending Sale to Table: "), shown as **Transfer to Table** on the normal
   Table / Pending Sales screen.

   However, when the same `frmPendingSales` form runs in **Web Orders mode**:
   - `WB*` orders are listed;
   - `cmdTransferToTable` is hidden;
   - and the standard Pending Sales mode, which does expose **Transfer to Table**, filters `WB*`
     rows out of its list.

   So neither screen currently offers a `WB*` web order a route to a native table.

   Please tell us explicitly:

   - Is `cmdTransferToTable` / `PDTF` intended to support `WB*` Web Orders?
   - If **yes**, how is that control enabled or exposed for Web Orders on v7.133.0200?
   - Is that governed by a licence, an option, a sale type, a user or clerk permission, a
     configuration setting, or something else? Please name the specific mechanism.
   - If **no**, are `WB*` Web Orders intentionally non-transferable to native tables in this version?
   - What is the supported workflow or API for converting an existing Web Order pending sale into a
     native dine-in table sale **without finalizing or tendering it**?

   For completeness, if `PDTF` is the supported route we would also like to know whether it prompts
   the operator to select the destination table, and whether it moves the existing pending sale
   rather than creating a second sale.

8. With the site option `TableTransfersToKitchen = 1`, what is the exact kitchen-print behaviour of a
   `PDTF` pending-sale-to-table transfer?

   Specifically, does it:
   - print a table-transfer notification docket only?
   - reprint all food lines?
   - print only lines with `Printed=0`?
   - ignore lines already marked `Printed=1`?
   - and can it be configured **not** to generate another kitchen docket?

   This matters because a web order at this site has already printed exactly one kitchen docket at
   ingest (`IdealWebitAutoPrintKitchen = -1`), and its line is already `Printed=1`. We need this
   documented before we can use a native transfer as even a temporary operating workflow — a second
   kitchen docket would send the food to the kitchen twice.

**Context on why the existing web-order path is not sufficient for us:**

We already have a working Webit integration at this site. It is proven end to end: it ingests our
order, creates the native Web Orders entry, and prints exactly one kitchen docket. What it does not
do is assign the order to the specific dine-in table our staff requested — the order stays in the
Web Orders queue and the table map continues to show that table as Ready, so a staff member has to
reconcile it manually. That manual step is what we are trying to remove.

Thank you,
Verdura — Order Tablet integration
