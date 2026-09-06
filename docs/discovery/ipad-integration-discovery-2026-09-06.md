# On-site read-only session — 2026-09-06

**Method:** read-only throughout. No click, keystroke, `SetForegroundWindow`,
posted message or coordinate probe. No IdealPOS configuration change, no
service restart, no packet sent to any IdealPOS port, no undocumented protocol
command, no live order, no database opened. Evidence is process/session
metadata, TCP state, filesystem listings and IdealPOS's own logs.

**Session context:** host `DESKTOP-SOKKOQ7`, user `Posmate`, 2026-09-06 ~14:05
NZST, reached over SSH.

---

## 1. Front-desk native ownership capture — NOT RUN (Stage 0 not satisfied)

Two independent Stage-0 preconditions of
`docs/integrations/front-desk-capture-procedure.md` fail, so the capture was
not executed. Running it anyway would have produced an empty
`desktopWindowInventory` and a `NO EVIDENCE` verdict that means nothing.

### 1.1 Wrong session

```
powershell.exe  pid=30876  sess=0
claude.exe      pid=20612  sess=0
powershell.exe  pid=26256  sess=0
cmd.exe         pid=34224  sess=0
conhost.exe     pid=19572  sess=0
sshd.exe        pid=30196  sess=0   <-- SSH service context
services.exe    pid=748    sess=0
```

The shell is in **Session 0**. IdealPOS's UI processes are in **Session 1**.
Stage 0 names this exact case: *"A Session-0 run returns an empty snapshot by
design and proves nothing."* Corroborated independently — `MainWindowTitle` is
empty for every Session-1 IdealPOS process when read from Session 0.

### 1.2 Host identity for "Front desk" is unestablished

This machine is the **POSServer host**, and a second IdealPOS terminal exists:

| | `DESKTOP-SOKKOQ7` | `DESKTOP-70DQTGJ` |
| --- | --- | --- |
| IPv4 | 192.168.1.250 | 192.168.1.199 |
| Role observed | POSServer + IPS + IPSClient + IPSPrinterServer | connects **in** to 5501 and 11000 |
| Licence header | `POSNumber=1` | not observed |

`docs/discovery/idealpos-table5-two-round-result-2026-09-05.md` records the
operating till header as **POS 2** during the Table 5 capture, and this host
reports **POS 1** at every startup. That is a reason to suspect the Front desk
till is `DESKTOP-70DQTGJ`, not this machine — but it is a suspicion, not
evidence, and the procedure's own rule is not to force a binding to match an
assumption. **Which physical machine is "Front desk" must be confirmed by the
operator before the capture is run.**

### 1.3 What *was* obtainable, and its limits

Valid from Session 0 (process to path to session). Not obtainable: HWND, window
class, window title — the three fields the binding verdict actually turns on.

| PID | Process | Session | Executable path |
| --- | --- | --- | --- |
| 20056 | `IPS.exe` | 1 | `C:\Program Files (x86)\Idealpos Solutions\Idealpos\IPS.exe` |
| 12800 | `IPSClient.exe` | 1 | `C:\Program Files (x86)\Idealpos Solutions\Idealpos\IPSClient.exe` |
| 12668 | `ipsdeploy.exe` | 1 | `...\Idealpos\IPSDeploy.EXE` |
| 2528 | `IPSPrinterServer.exe` | 1 | `...\Idealpos\IPSPrinterServer.exe` |
| 11820 | `IdealPos.Licensing.exe` | 1 | — |
| 7136 | `POSServer.exe` | 0 | `C:\Program Files\Idealpos Solutions\POSServer\POSServer.exe /mode=service` |
| 31620 | `IdealposService.exe` | 0 | `...\IdealposService\IdealposService.exe` |

**HWND: not captured. Class: not captured. Title: not captured.**

**Binding verdict: NOT ESTABLISHED — capture not run (Stage 0 failed on session
context and on unconfirmed host identity).** This is neither `CONSISTENT` nor
`CONTRADICTION`; no window was enumerated, so `IPS.exe` remains an *assumption*
about native UI ownership exactly as it was before today.

### 1.4 To actually obtain it

At the **physical console** of the Front-desk till, signed in to the
interactive desktop, with the real Table Map on screen:

```
mkdir C:\verdura-capture
set TRACER_MODE=capture
set TRACER_CAPTURE_OUT=C:\verdura-capture\01-tablemap-owner.json
dotnet "C:\Users\Posmate\Documents\verdura_MVP\apps\venue-connector\src\VerduraIdealposTracer.Cli\bin\Release\net8.0-windows\VerduraIdealposTracer.Cli.dll"
```

An SSH, RDP-redirected or service-context run does not substitute for this.

---

## 2. iPad to IdealPOS integration discovery

### 2.1 Network and process topology (observed)

Listeners on this host:

| Port | Owner |
| --- | --- |
| 5501, 5502 | `IPSClient.exe` (12800) |
| 11000 | `POSServer.exe` (7136) |
| 11183 | `IPSPrinterServer.exe` (2528) |
| 12183 | `IPS.exe` (20056) — internal printer-error channel (previously established) |
| 13184 | `ipsdeploy.exe` (12668) |
| 808 | `IdealPos.Licensing.exe` — licensing WCF |

Established connections at capture time:

```
192.168.1.250:56830 -> 192.168.1.250:11000   owner IPS.exe (20056)
192.168.1.250:11000 <- 192.168.1.250:56830   owner POSServer (7136)
192.168.1.250:11000 <- 192.168.1.199:49707   owner POSServer (7136)
192.168.1.250:5501  <- 192.168.1.199:49706   owner IPSClient (12800)
```

Two structural facts follow:

1. **The VB6 UI is itself a network client of POSServer.** `IPS.exe` holds a
   loopback TCP session to 11000. The UI is not the bottom of the stack.
2. **The only remote peer on any IdealPOS port is the other Windows till**
   (`DESKTOP-70DQTGJ`). No non-Windows device is connected to any IdealPOS
   port.

ARP shows several locally-administered (randomised) MACs on the venue LAN —
192.168.1.4, .71, .143, .161, .215, .231 — consistent with iOS/Android devices
using private Wi-Fi addresses. **None of them holds a connection to any
IdealPOS port.**

### 2.2 Vendor handheld / WaiterPad (the Idealpos iPad product): present, dormant

| Artifact | Date | Reading |
| --- | --- | --- |
| `IdealHandheldMenus.xml`, `IdealHandheldMenuItems.xml` | **2014-05-06** | shipped product defaults, byte-identical to install date — not venue configuration |
| `MTIPADLIB.dll` | 2014-05-06 | ships with install |
| `VariPad.dll` / `variPad.tlb` | 2022 / 2014 | file-drop adapter, never invoked here |

Two negative results, both strong:

- **Licence.** Every `IPS.exe` startup for the last twelve months logs
  `UserName=Sila Restaurant  POSNumber=1  Options=Pack 2  License Enabled=True
  : Type=2`. `Pack 2` is the only entitlement named. **No handheld / WaiterPad
  / eCommerce option appears in any licence line ever recorded.**
- **Usage.** A case-insensitive grep for `handheld`, `waiterpad` and `varipad`
  across the entire IdealPOS log tree (`POSActivity.log`, `IPSError.log`,
  `IPSClient.log`, `IPSDeploy.log`, `IdealposService-*.log`, Gateway logs back
  to 2019) returns **zero matches**.

There is no evidence that a vendor iPad handheld integration has ever run on
this installation.

### 2.3 What *is* live and tablet-shaped: Webit — and it is Verdura's own

`Webit.log`, 2026-09-02 21:04, is a complete recorded lifecycle:

```
Webit_CheckForOrders Fired, Count=1
Webit_ProcessOrders, attempting to GetOrders.
Webit_ProcessOrders - successfully got 1 WebOrders.
Webit_AddWebOrder, Adding Weborder ORD-600003 to Pending Sales.
AddLineItems code=649 description=GUACAMOLE WITH CORN CHIPS PricePaid=0 Quantity=1
  StockItem.Type=1   StockItem.PricingMode=1
  About to add description GUACAMOLE WITH CORN CHIPS Pline=1  PricePaid=15
message = Order Tablet Checkout (Guests: 2)
  AddLineItems code= description=Order Tablet Checkout (Guests: ... StockItem.Type=3
  Text Item
Webit_PrintWebOrder, Sending Weborder ORD-600003 to Kitchen Printers.
```

What this proves, from IdealPOS's own log:

| Property | Evidence |
| --- | --- |
| **IdealPOS is the price authority** | we sent `PricePaid=0`; IdealPOS resolved `PricePaid=15` from `StockItem.PricingMode=1` |
| **Deterministic, observable, logged** | every step timestamped to the millisecond, with our own order id `ORD-600003` |
| **Reaches the kitchen** | `Webit_PrintWebOrder ... Sending Weborder ORD-600003 to Kitchen Printers` |
| **Pull, not push** | `Webit_CheckForOrders Fired` — IdealPOS polls us; no inbound port, no injection |
| **Table is NOT bound** | `Order Tablet Checkout (Guests: 2)` is decomposed into `StockItem.Type=3` **text items** (`Pline=3`, `Pline=4`). Table and guest count arrive as free text on the docket, not as a table binding. |

This corroborates evidence item **A** of
`idealpos-native-table-assignment-vendor-question.md` from a second, independent
source: a Verdura order becomes a `WBORD-*` pending sale at `Map 0` and never
becomes a native table sale.

### 2.4 The gap, stated precisely

Webit already satisfies the safety properties the VB6 route is being built to
approximate — determinism, observability, native pricing, no synthetic input,
no undocumented protocol. It fails on exactly two things, and only two:

1. **No native table binding.** The order does not appear on the Table Map.
2. **No causal identity returned.** Nothing in the log or the contract hands
   back a native sale or line identifier we can retain (question **D** of the
   vendor package, still open).

Round-append semantics are untested on this path and are a third unknown.

---

## 3. Steps not taken, and why

| Step | Why not |
| --- | --- |
| Stage 1 tracer capture | Session 0; host identity unconfirmed (section 1) |
| Opening `ips.mdb` to read handheld/licence tables | opening the live Jet store writes a lock entry to `ips.ldb` — a side effect on a live installation. Not taken without approval. |
| `SELECT` against `POSServer` / `IPSTransaction` | in scope per Stage 4 and safe, but not required for today's question. Available on request. |
| Any traffic to 5501/5502/11000/12183 | would be undocumented protocol transmission — out of bounds. |
| Inspecting `DESKTOP-70DQTGJ` | not attempted; no session on that host. |

---

## 4. Architecture verdict

**D — INCONCLUSIVE, NEED SPECIFIC PASSIVE EVIDENCE**, trending toward **C**.

On this host the answer is already clear: there is no live iPad-to-IdealPOS
integration, the vendor handheld product is unlicensed and has never run, and
the only tablet ingress is Verdura's own Webit path, which cannot bind a table.
That is a **C** on the evidence available.

It is reported as **D** rather than **C** because the two places an iPad
integration would most plausibly live were both out of reach today: the
Front-desk till (`DESKTOP-70DQTGJ`, never inspected) and the interactive
Session 1 desktop. Declaring **C** from a host that may not be the one in
question would repeat the `IPS.exe` / "POSServer is a replica" failure mode this
procedure exists to prevent.

### Evidence that would settle it

1. **Is there physically an iPad in this restaurant talking to IdealPOS?** An
   operator observation, not a measurement. If no, the answer is **C** today.
2. **The same licence line from `DESKTOP-70DQTGJ`** — `IPSError.log`, the
   `License Gateway:` line. If it also reads `Options=Pack 2` with no handheld
   entitlement, **C** is settled for the venue.
3. **`grep -i handheld` over `DESKTOP-70DQTGJ`'s IdealPOS log tree.**
4. **Stage 1 tracer at the Front-desk console** — still required regardless of
   which path is chosen, because it is what turns `IPS.exe` from assumption
   into evidence.
5. If an iPad *is* in use: `Get-NetTCPConnection -State Established` on the till
   it talks to, taken **while an order is being placed on it**, naming the port.
   That single reading distinguishes the vendor handheld listener from a
   third-party product from a Webit-style poller.

Until 1–4 are in hand, the guarded VB6 executor stays unimplemented, and the
Webit route remains the default in `dine-in-route.ts`.
