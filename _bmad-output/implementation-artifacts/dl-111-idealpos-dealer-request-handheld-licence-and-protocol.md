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

**Context on why the existing web-order path is not sufficient for us:**

We already have a working Webit integration at this site. It is proven end to end: it ingests our
order, creates the native Web Orders entry, and prints exactly one kitchen docket. What it does not
do is assign the order to the specific dine-in table our staff requested — the order stays in the
Web Orders queue and the table map continues to show that table as Ready, so a staff member has to
reconcile it manually. That manual step is what we are trying to remove.

Thank you,
Verdura — Order Tablet integration
