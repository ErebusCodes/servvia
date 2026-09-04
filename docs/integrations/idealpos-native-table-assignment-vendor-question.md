# IdealPOS native table assignment — vendor question and evidence package

**Status: LOCAL INVESTIGATION EXHAUSTED. External vendor answer required.**
Prepared 2026-09-04 against the live DUNEDIN installation.

The question is narrow and factual:

> **Is there a supported IdealPOS entry point by which an external system can
> create or submit a sale that carries a table assignment (`Table` /
> `TableMap`), such that the sale appears in IdealPOS on that table?**

Everything below is what we established locally so the vendor does not have
to re-derive it, and so the question cannot be answered with something we
have already ruled out.

---

## 1. What we need, in product terms

Verdura sends a dine-in order to IdealPOS. It must land **on the table the
customer is sitting at**, without a staff member re-keying or manually
assigning it. Today it does not: the order reaches IdealPOS, but as an
unassigned web order.

## 2. Installation under test

| Item | Value |
| --- | --- |
| IdealPOS install path | `C:\Program Files (x86)\Idealpos Solutions\Idealpos` |
| `IPS.exe` | 40,143,120 bytes, dated 2023-09-11 |
| SQL instance | `localhost\IDEALSQL` |
| Databases | `IPSTransaction`, `POSServer` |
| Integration currently used | `IdealPos.Webit.Core.dll` (`WebOrder`) |

## 3. What we have already ruled out — please do not re-suggest these

### 3.1 `IdealPos.Webit.Core` `WebOrder` has no table field

Its complete field set is: `HostReference`, `OrderReference`, `Items`,
`Customer`, `UseCustomerAddressing`, `DeliveryAddress`, `PostalAddress`,
`DeliverTo`, `PriceMode`, `OrderedDate`, `DeliveryDate`,
`TriggerPromotions`, `CalculatePoints`, `GiftOrder`, `PaymentDetail`, the
four amount fields, `OrderDetail`, `GiftMessage`, `Message`, `DatebaseId`,
`Processed`. `OrderDetail` is an `OrderMode` whose values are `None`,
`Pickup`, `EatIn`, `Delivery`, `ErrorReport`.

**There is no table field anywhere in the contract.** Encoding a table into
`DeliverTo`, `Message`, or `OrderReference` was tried and rejected: those
are not table fields, and two of them are actively harmful (`Message`
prints a table on the kitchen docket that was never assigned; a rewritten
`OrderReference` moves the pending-sale code that reconciliation anchors on).

**Live confirmation.** Order `ORD-600002` reached
`WebPendingOrder.Processed = 1` — native IdealPOS definitely consumed it —
and **no `PendingSales` row was ever created for it**. Consumed, but never
placed on a table.

### 3.2 `IdealposObjects.Sale` has `Table`/`TableMap` but cannot be submitted

`IdealposObjects.dll` exposes a COM-visible `ISale` (IID
`9DC1CBB4-BC88-4665-AA0D-CCC28BD017D1`) and class `Sale` (CLSID
`174C1477-6C24-48D9-8DA8-591D7028D190`, ProgID `IdealposObjects.Sale`,
registered under `HKLM\SOFTWARE\WOW6432Node\Classes\CLSID`). It carries
`string Table` and `int TableMap`.

**But it is a data object with no submission path:**

- `ISale`'s only methods are `ConvertJson(string)` (deserialize) and
  `SetupItem()` (return a sample JSON string). There is no `Save`, `Post`,
  `Submit`, `Send` or `Commit`.
- `IdealposObjects.IManager` — the only manager/factory in the assembly —
  exposes only `Initialize`, `GetCustomerTransactionsJSONString`,
  `GetCustomerAccountUpdatesJSONString`, `WriteCustomerTransactions`,
  `GetCustomerTransactions`, `GetCustomerAccountUpdates`,
  `GetCustomerTransactionsArray`. **No method accepts or returns a `Sale`.**
- No other type in `IdealposObjects` takes or returns a `Sale`.
- Across every IdealPOS assembly we decompiled, the only consumer of
  `IdealposObjects` is `POSServer.Communication`, and it uses it
  **exclusively for `CustomerTransaction`** (two call sites). Nothing in
  the shipped product ever constructs a `Sale`.

So `Sale.Table` appears to be an unused DTO field on this build. We are
explicitly **not** assuming it is supported merely because the property
exists.

### 3.3 `IdealposTransactions` is outbound-only

`IdealposTransactions.Sale` does carry `tableNumber`, and
`IdealposTransactions.Manager` does expose `SendTransaction`. However
`SendTransaction(string Cons, string POS, string url)` **reads an
already-completed sale out of the IdealPOS database** (`GetSale` queries by
`Cons`/`POS`) and **HTTP-POSTs it to a partner URL**. It is transaction
export/reporting. It cannot create anything in IdealPOS.

### 3.4 No other COM-exposed assembly pairs a table with a submission

We reflected over every assembly shipped with a type library in the install
directory — `idealPOS.NET`, `IdealposTransactions`, `IPSSupport`,
`Idealpos.Webit.Core`, `IdealposObjects`, `IKM.API`, `SmartConnect`,
`ResDiaryPOS`, `RTBSLive`, `IdealposAllotrac`, `IPS_EPay`, `IPSLabels`,
`IdealposPAX`, `IdealposPLBPOS`, `IdealposSlyp`, `IdealposTenerum`,
`idealposXeroAPI`, `CAAAffinity`, `FijiVatMonitor`, `FirstAmericanEftpos`,
`ImagePrinter`, `PayLinqI`, `Syncro3Eftpos`, `variPad`,
`IdealposLicensingLocal` — and found **no type exposing both a table member
and a create/submit-style method**.

### 3.5 Table state appears to be set by an internal terminal protocol

In `POSServer.Communication`, table status is written by a `SENDSTAT` text
packet handler (`UpdateStatus`) that terminals send to POSServer; it
creates/updates `TableMaps` and `TableMapSetups` rows. This is an internal
terminal-to-POSServer socket protocol, not a documented external API, and
we are **not** going to reverse-engineer or write to it.

### 3.6 We have not written anything

All of the above is from read-only inspection: decompiled assemblies, COM
registry reads, reflection, and `SELECT`-only SQL. **No experimental write
has been made to IdealPOS, POSServer or IPSTransaction**, and we will not
make one against a live restaurant database on a guess.

---

## 4. The exact questions for Idealpos Solutions

1. **Is there any supported way for an external system to create a sale on a
   specific table in IdealPOS?** If yes, which interface, and is there
   documentation or a sample?

2. **What is `IdealposObjects.ISale.Table` / `TableMap` for?** It is
   COM-registered and carries a table, but exposes no submission method and
   is not consumed by any shipped IdealPOS code we can find. Is it dead, is
   it consumed by a component we do not have, or does it require a licence
   or module we do not have enabled?

3. **Is a table-carrying field planned or available for `Webit` `WebOrder`**
   on a newer IdealPOS build than 2023-09-11? If so, which version?

4. **If there is no such entry point**, what is the vendor-recommended way to
   get a third-party dine-in order onto the correct table — for example a
   licensed module, the handheld/`IdealHandheld` path, or a documented
   POSServer API?

5. **Is any part of the POSServer terminal protocol supported for
   third-party use?** We assume not, and will not use it unless you tell us
   it is supported.

## 5. Where to send it

Idealpos Solutions support / developer-integration channel:

- Support portal / email: <https://www.idealpos.com.au/support/>
- The installation's own support tooling: `IdealposSupport.FileTools`
  (`SendFileToIdealposOnline`) and the Support menu inside IdealPOS, which
  are the vendor's own supported channels for raising a case with the
  installation's licensing ID attached.

Include: the installation's licensing ID, the IdealPOS version, and
sections 2–3 of this document.

**No authenticated Idealpos support channel is available to this
engineering environment, so this question has not been sent. It needs to go
from an account authorised on this installation.**
