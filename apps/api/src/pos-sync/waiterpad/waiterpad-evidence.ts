/**
 * The evidence ledger for the WaiterPad / Ideal Handheld route.
 *
 * WHY THIS FILE EXISTS. Every constant below is a claim about a third-party
 * binary we do not own and cannot run. Scattering those claims through the
 * implementation would make them look like ordinary code. Collecting them here,
 * each with its grade and the address it came from, means a reader can audit
 * the whole protocol surface against
 * `docs/integrations/idealpos-waiterpad-protocol-contract-2026-09-06.md`
 * without reading a single line of logic.
 *
 * SCOPE DISCIPLINE, carried over from that document. Findings are graded and
 * scoped, and the scopes never mix:
 *
 *   [STATIC] — read out of the `IPS.exe` binary (40,143,120 bytes, 2023-09-11),
 *              which is the same build on both venue machines. Machine
 *              independent, and the grade of every protocol claim here.
 *   [BACK]   — observed on Back / Machine 1 (the POSServer host). Two notes
 *              added on 2026-09-07 carry a [BACK] observation, and each says so
 *              in its own text: `IPS_AND_IPSWORKER_SAME_IMAGE` and the closing
 *              paragraph of `HANDHELD_LOG_LOCATION_EVIDENCE`. No claim about
 *              the PROTOCOL rests on either.
 *   [FRONT]  — operator-captured on Front / Machine 2 (the till that actually
 *              runs the handheld server). Nothing here depends on one.
 *
 * NOTHING IN THIS MODULE TREE OPENS A SOCKET. See `waiterpad-gate.ts`.
 */

/** Where every address in this file points. */
export const EVIDENCE_BINARY = {
  file: 'C:\\Program Files (x86)\\Idealpos Solutions\\Idealpos\\IPS.exe',
  sizeBytes: 40_143_120,
  built: '2023-09-11',
  imageBase: 0x00400000,
} as const;

export type EvidenceGrade =
  | 'PROVEN_RUNTIME'
  | 'PROVEN_STATIC'
  | 'STRONGLY_INDICATED'
  | 'NOT_SHOWN'
  | 'CONTRADICTED';

export interface EvidenceNote {
  readonly grade: EvidenceGrade;
  /** Virtual addresses in IPS.exe supporting the claim. */
  readonly addresses: readonly string[];
  readonly note: string;
}

/**
 * The ingress port.
 *
 * UPDATED 2026-09-09. This was PROVEN STATIC only, with the caveat that Front
 * had never been observed bound to it. Both halves are now closed: Front is
 * observed LISTENING on 6983 under `IPS.exe`, and cross-host timing correlation
 * ties the `Ideal Handheld` listener specifically to 6983 rather than to the
 * other port `IPS.exe` owns. See `HANDHELD_INGRESS_PORT_RUNTIME_EVIDENCE`,
 * including its one residual assumption.
 *
 * KNOWING THE PORT CHANGES NOTHING ABOUT SAFETY. It is still recorded for
 * documentation only and is still not used by any code here, because no code
 * here connects to anything. See `waiterpad-gate.ts`.
 */
export const WAITERPAD_PORT = 6983 as const;

export const WAITERPAD_PORT_EVIDENCE: EvidenceNote = {
  grade: 'PROVEN_STATIC',
  addresses: ['0x02811abb', '0x02811b68', '0x02811cf8'],
  note:
    'mov dword [ebp-0x68], 0x1b47 (=6983) as a VT_I4 variant, passed to ' +
    '__vbaLateIdSt(wsWaiterPad.Item(0), dispid 2 = LocalPort), followed by ' +
    '__vbaLateIdCall(dispid 0x41 = Listen). The dispid decoding is corroborated ' +
    'by the identical pattern at 0x0283ecd9 carrying 12183, a port observed ' +
    'listening under IPS.exe on Back. Whether Front binds 6983 is NOT SHOWN.',
};

/**
 * THE PRICE SENTINEL. The single most load-bearing constant in this route.
 *
 * IPS.exe holds exactly one IEEE-754 double equal to -9999.0, at 0x00474698,
 * and both of its cross-references are inside the handheld order routines. On
 * equality the receiver replaces the submitted price with
 * `StockItems.Price<PriceLevel>` read from its own catalogue. On INEQUALITY it
 * branches past the substitution entirely, so any other number Verdura sends
 * becomes the line price verbatim.
 */
export const NATIVE_PRICE_SENTINEL = -9999 as const;

export const NATIVE_PRICE_SENTINEL_EVIDENCE: EvidenceNote = {
  grade: 'PROVEN_STATIC',
  addresses: ['0x00474698', '0x01828538', '0x0182fdd1'],
  note:
    'fld qword [0x474698] (-9999.0) then __vbaFpCmpCy against the parsed ' +
    '<Price>. On equality: Fields.Item("Price" & PriceLevel).Value overwrites ' +
    'the parsed value (0x01828583-0x0182862c). On inequality: jne skips the ' +
    'substitution (0x01828546), so a numeric price is a silent override.',
};

/**
 * Response packet types. This list is CLOSED: these six literals are the
 * complete set of bodies the binary can emit on this path, four of them
 * constant strings with no interpolation. Anything else on the wire is not a
 * WaiterPad response and must fail closed.
 */
export const WAITERPAD_RESPONSE_TYPES = [
  'ACK',
  'NAK',
  'DUPLICATE',
  'NAKREGO',
  'NAKPRINT',
  // LOCK is the one interpolated form: 'LOCK' + (12000 + posNumber).
  'LOCK',
] as const;

export const WAITERPAD_RESPONSE_EVIDENCE: EvidenceNote = {
  grade: 'PROVEN_STATIC',
  addresses: ['0x01824ab0', '0x01824b20', '0x01824b90', '0x01824c00', '0x01824cd0', '0x01824d80'],
  note:
    'Six accessor subs each returning one literal body. Selection decoded at ' +
    '0x02818878-0x0281895f from the Integer returned by CheckWPOrder: ' +
    '0 or 3 -> NAK, 1 -> ACK, > 0x2EE0 (12000) -> LOCK&r, 4 -> DUPLICATE, ' +
    'otherwise -> NAKREGO.',
};

/**
 * The LOCK encoding. CheckWPOrder parses the POS number out of the table-status
 * string after InStr(..., "LOCKED BY") and adds 12000 before returning it, so
 * the wire form is 'LOCK' + (12000 + posNumber) — e.g. LOCK12002 for POS 2.
 *
 * The comparison at the response site is STRICTLY greater than 12000, so a
 * well-formed lock code is >= 12001 and a POS number is >= 1.
 */
export const LOCK_CODE_BASE = 12000 as const;

export const LOCK_CODE_EVIDENCE: EvidenceNote = {
  grade: 'PROVEN_STATIC',
  addresses: ['0x018264d7', '0x018264f8', '0x01826503', '0x028188e5'],
  note:
    '__vbaFpI2 on the parsed POS number, then `add di, 0x2ee0`, then stored as ' +
    'the function result. The response site tests `cmp word [ebp-0x30], 0x2ee0 ' +
    '/ jle`, i.e. strictly greater than 12000.',
};

/**
 * WHAT `ACK` MEANS, AND WHAT IT DOES NOT.
 *
 * CheckWPOrder sets its result to 1, then walks a 200-slot module-level array
 * looking for a free slot, stores the XML document there, and returns. No row
 * has been written to PendingSales or PendingSaleLines at that point; the
 * database work happens later, when a separate drain loop ("Buffered packet
 * index=") calls WPOrder.
 *
 * So an ACK proves the packet was accepted into volatile memory on the till.
 * It does not prove a sale exists, a line exists, or a kitchen docket was
 * produced. If IPS.exe dies between the ACK and the drain, the round is gone
 * and leaves no trace in any store we can read.
 */
export const ACK_MEANS_BUFFERED_NOT_EXECUTED: EvidenceNote = {
  grade: 'PROVEN_STATIC',
  addresses: ['0x01826566', '0x018265ee', '0x018265f4', '0x0281244a'],
  note:
    'result = 1 at 0x01826566; __vbaObjSetAddref into g_WPPackets(i) at ' +
    '0x018265ee; __vbaExitProc immediately after at 0x018265f4. The drain that ' +
    'calls WPOrder is a separate code path at 0x0281244a.',
};

/**
 * AND IT IS WORSE THAN THAT: an ACK does not even prove buffering.
 *
 * The slot search is `for i = 1 to 200`. When every slot is occupied the loop
 * falls out to 0x01826751, which calls `__vbaExitProc` immediately WITHOUT
 * touching the result variable — and the result was set to 1 at 0x01826566,
 * before the loop began. So a buffer-exhausted till returns 1, the caller
 * emits ACK, and the packet is silently discarded.
 *
 * Nothing on the wire distinguishes that from a genuine acceptance. It is the
 * reason `requiresReadback` is true for ACK in the round-state mapping, and it
 * is tracked as production blocker WAITERPAD-ACKLOSS-001.
 */
export const ACK_ON_BUFFER_EXHAUSTION: EvidenceNote = {
  grade: 'PROVEN_STATIC',
  addresses: ['0x01826566', '0x01826575', '0x0182657d', '0x01826751'],
  note:
    'mov eax, 0xc8 / cmp di, ax / jg 0x1826751 bounds the slot scan at 200. ' +
    '0x01826751 is __vbaExitProc with no preceding write to the result local ' +
    '[ebp-0x30], which still holds the 1 written at 0x01826566. An ACK is ' +
    'therefore emitted for a packet that was never buffered.',
};

/**
 * The duplicate guard, and its exact limits.
 *
 * `<Checksum>` and `<DeviceID>` are both SENDER-supplied. The receiver stores
 * the last checksum it accepted for a device in a database row keyed
 * `ColumnType='IH-<DeviceID>'` and compares the next arrival to it by plain
 * string equality. That makes the guard durable across an IPS restart, and
 * exactly ONE deep: send A, then B, then A again, and A is accepted a second
 * time.
 *
 * It is also OPTIONAL: an absent or empty `<Checksum>` skips the check
 * entirely, which is a footgun rather than a feature.
 */
export const DUPLICATE_GUARD_EVIDENCE: EvidenceNote = {
  grade: 'PROVEN_STATIC',
  addresses: ['0x018261ad', '0x01826202', '0x01826289', '0x01835070', '0x01835390'],
  note:
    'CheckWPOrder skips the guard when the Checksum node Is Nothing ' +
    '(0x018261ad) or its text is empty (0x01826202). Otherwise ' +
    'IsDuplicateHandheldOrder2 SELECTs AAAExampleData WHERE ' +
    "ColumnType='IH-<DeviceID>' and returns True on __vbaStrCmp equality " +
    'with the stored Data column (0x01835390).',
};

/**
 * WHY WE CANNOT GENERATE A CHECKSUM. See `waiterpad-checksum.ts`.
 *
 * The receiver never computes a checksum. It compares the sender's string to
 * the stored one and nothing else — there is no checksum routine anywhere in
 * the WaiterPad code path (the binary's only two checksum routines,
 * `VerifyCheckSum` at 0x002bde80 and `frmChartsInterface.CalculateCheckSum`,
 * belong to unrelated subsystems). The GENERATING side is the vendor handheld
 * application, whose code is not installed on either venue machine —
 * `MTIPADLIB.dll` was checked and contains only device-connection handlers.
 *
 * That the receiver treats the value opaquely is PROVEN STATIC. What algorithm
 * a genuine Ideal Handheld device uses to produce it is NOT SHOWN, and this
 * codebase must not invent one.
 */
export const CHECKSUM_ALGORITHM_EVIDENCE: EvidenceNote = {
  grade: 'NOT_SHOWN',
  addresses: ['0x018261fa', '0x0183534d'],
  note:
    'Receiver-side treatment is opaque string equality (__vbaStrCmp) — PROVEN ' +
    'STATIC. No generation routine exists in the WaiterPad path. The vendor ' +
    'handheld GENERATING application is not installed on either inspected ' +
    'Windows POS machine (a physical Idealpos-branded handheld device is ' +
    'separate evidence and is NOT erased by this note). The generation ' +
    'algorithm is therefore NOT SHOWN and is left unimplemented. ' +
    'Strengthened 2026-09-07 by CHECKSUM_NO_GENERATOR_EVIDENCE, which shows ' +
    'by call graph - not by absence of a name - that no generator exists ' +
    'anywhere in this binary, so further search of IPS.exe is wasted effort.',
};

/**
 * The readback, and the field it is missing.
 *
 * REQUESTTABLESTATUS returns one <OrderItem> per PendingSaleLines row for the
 * table, carrying Index, StockItem, Description, Quantity, Price, SeatNumber
 * and PriceLevel. It does NOT carry OrderedTime, and OrderedTime is the only
 * field the live Table 5 capture found that partitions a sale's lines into
 * rounds.
 *
 * Consequence, and it is load-bearing for recovery: the readback tells us what
 * is on the table, never which round put it there.
 */
export const READBACK_FIELDS = [
  'Index',
  'StockItem',
  'Description',
  'Quantity',
  'Price',
  'SeatNumber',
  'PriceLevel',
] as const;

export const READBACK_EVIDENCE: EvidenceNote = {
  grade: 'PROVEN_STATIC',
  addresses: [
    '0x01823a2a',
    '0x01823c19',
    '0x01823dd5',
    '0x01823ffa',
    '0x018241a9',
    '0x0182437d',
    '0x018245c7',
    '0x01824725',
  ],
  note:
    "Builder issues SELECT * FROM PendingSaleLines WHERE Code='<table>' AND " +
    'POS=1 ORDER BY Line and emits exactly the seven elements above. No ' +
    'OrderedTime and no Printed element appear anywhere in the builder.',
};

/**
 * The unresolved fork that keeps reconciliation policy unimplemented.
 *
 * Two different routines write a handheld order. `WPOrder` — reached from the
 * socket drain — contains no DELETE and seeks by the CodePOS / CodePOSLine
 * indexes. `ProcessHandheldOrder` — reached from the POSServerMessages
 * `IH-DATA` relay — deletes PendingSaleLines and PendingSales for the table
 * and rewrites them.
 *
 * What selects one over the other is NOT SHOWN, and this venue is exactly the
 * topology a relay exists to serve: the handheld terminal (Front) and the
 * POSServer host (Back) are different machines. Until that is settled we
 * cannot know whether a second round appends to a table or replaces it, so any
 * automatic reconciliation would be a guess about whether a kitchen gets one
 * round or the whole table again.
 */
export const APPEND_VS_RELAY_EVIDENCE: EvidenceNote = {
  grade: 'NOT_SHOWN',
  addresses: ['0x0182cad0', '0x01826b90', '0x01827665', '0x0182770a', '0x029507aa'],
  note:
    'WPOrder (0x0182cad0) has no DELETE against PendingSales/PendingSaleLines; ' +
    'ProcessHandheldOrder (0x01826b90) has both (0x01827665, 0x0182770a) and is ' +
    'called only from the IH-DATA relay block at 0x029507aa. What routes an ' +
    'order to the relay is NOT SHOWN.',
};

/* ==========================================================================
 * Added 2026-09-07, from a second read-only static pass on Back / Machine 1.
 *
 * Everything below is [STATIC] — read out of the same IPS.exe build that runs
 * on Front — except where a note explicitly says [BACK], meaning it was
 * observed on the POSServer host and says nothing about Front.
 * ========================================================================== */

/**
 * `IPS.exe` and `IPSWorker.exe` ARE THE SAME FILE.
 *
 * Byte-identical on Back: both 40,143,120 bytes, both
 * SHA-256 F18475A784C996351048D4F537CF0CC8E2D5EE9AA7B01B38130CDADCC85A520E.
 * One image, two names, and the role is chosen at startup rather than by which
 * file was launched.
 *
 * WHY THIS MATTERS, AND IT IS NOT A CURIOSITY. Both images therefore contain
 * the listener code for 6983, 7983 and 12183. So "IPS.exe contains the
 * WaiterPad port" says nothing whatever about which process binds it. A
 * listener may only ever be attributed to a PID, by joining the TCP table to
 * the owning process, its path and its command line — never by reasoning from
 * a file's contents or from a process name.
 */
export const IPS_AND_IPSWORKER_SAME_IMAGE: EvidenceNote = {
  grade: 'PROVEN_RUNTIME',
  addresses: [],
  note:
    '[BACK] Get-FileHash of both files in the Idealpos program directory, ' +
    '2026-09-07: identical SHA-256 and identical length. The [STATIC] ' +
    'consequence — one image carrying every listener — is machine independent ' +
    'and therefore applies to Front.',
};

/**
 * TWO GATES IN `wsWaiterPad_DataArrival` THAT ANSWER NOTHING AT ALL.
 *
 * Before any parsing, DataArrival tests two globals and, on either, logs a line
 * and exits. No response is written. The socket stays open; the sender sees a
 * connection that accepted its bytes and never replied.
 *
 * This is why "no reply" is a first-class protocol outcome on this route and
 * not merely a network fault. A licence lapse, or `NoReceiving` being set, is
 * indistinguishable at the wire from a lost response — and both are
 * indistinguishable from a round that was accepted and executed.
 */
export const SILENT_DROP_GATES: EvidenceNote = {
  grade: 'PROVEN_STATIC',
  addresses: ['0x02815759', '0x0281577a', '0x028157d0', '0x028157fa'],
  note:
    "cmp word [0x2a2f46e], 0 then a log of 'WaiterPad_DataArrival EXIT because " +
    "NOT HandheldLicensed'. A second pair at 0x028157d0-0x028157fa logs 'EXIT " +
    "because NoReceiving=TRUE'. Neither branch writes a response body. " +
    '[0x2a2f46e] is set at 0x027e3978 as (handheldLicenceCount > 0), from the ' +
    'licensing object at [0x2a2f178].',
};

/**
 * ONE `NAK` CONDITION IS NOW TRACED, AND IT IS A BUSY SIGNAL.
 *
 * Inside `WPParsePacket`, an ORDER arriving while `HandheldProcessing` is
 * already set is answered with NAK — the till is mid-drain, not refusing the
 * order's contents.
 *
 * This does NOT license retrying a NAK. `CheckWPOrder` returning 0 or 3 also
 * produces NAK and those conditions remain untraced, so the conservative
 * mapping stands. It is recorded because it is the first NAK condition with a
 * known cause, and because it means a NAK can be a transient property of
 * TIMING rather than of the packet.
 */
export const NAK_ON_HANDHELD_PROCESSING: EvidenceNote = {
  grade: 'PROVEN_STATIC',
  addresses: ['0x0281852d'],
  note:
    "The string 'parsing ORDER but HandheldProcessing set - sending NAK back' " +
    'is referenced at 0x0281852d, inside WPParsePacket (0x02817900-0x02818b30) ' +
    'and between the ORDER/ORDER2 dispatch at 0x0281838c and the item-count ' +
    'check at 0x02818602.',
};

/**
 * HOW A DEVICE BECOMES REGISTERED — and why we must not take a slot.
 *
 * There is no enrolment ceremony. The registration sub logs
 * `"Ideal Handheld" & deviceId & " - WP Current Count=" & n & " - Waiters=" & m`,
 * and then:
 *
 *   - if the device is already known                   -> accept
 *   - else if currentCount >= licensedHandheldCount    -> log "BAD REGO",
 *                                                         reject (NAKREGO)
 *   - else scan a 99-slot global string array for a
 *     free slot, store the DeviceID, log
 *     "Adding <id> to current devices."                -> accept
 *
 * TWO CONSEQUENCES, BOTH OPERATIONAL RATHER THAN THEORETICAL:
 *
 *   1. The registry is an in-process VB array. It does not survive an IPS.exe
 *      restart, so registration state is not durable and a post-restart packet
 *      re-registers from scratch.
 *   2. THE CAP IS THE LICENCE. Front's licence reads `Ideal Handheld 2`. If
 *      that grants two handheld slots and both are held by real waiter
 *      devices, a Verdura DeviceID would be refused — and if Verdura got in
 *      first, a real waiter's handheld would be the one refused. Connecting a
 *      new device to a working service is therefore not a read-only act even
 *      before a single ORDER is sent.
 */
export const DEVICE_REGISTRATION_EVIDENCE: EvidenceNote = {
  grade: 'PROVEN_STATIC',
  addresses: [
    '0x01824fdc',
    '0x0182500d',
    '0x0182507d',
    '0x0182508b',
    '0x018250b8',
    '0x01825107',
    '0x01825193',
  ],
  note:
    'cmp word [ebp-0x1c], word [0x2a2f470] then jge to the BAD REGO branch at ' +
    '0x01825183. Otherwise a for-1-to-99 scan of the global string array at ' +
    '[0x2a2fc18] finds an empty slot (__vbaStrCmp against the empty string at ' +
    '0x683b24) and __vbaStrCopy stores the DeviceID at 0x01825116. ' +
    '[0x2a2f470] is written at 0x027e3965 from the licensing object; ' +
    '[0x2a2f46e], the HandheldLicensed boolean, is set from the same value.',
};

/**
 * THE PORT FAMILY, AND THE SCHEME THAT IS NOT THERE.
 *
 * It is tempting to read 11183 / 12183 / 13183 as a terminal-indexed
 * `1<n>183` scheme. It is not one, and the counter-evidence is direct:
 *
 *   6983   IPS.exe    wsWaiterPad     LocalPort (dispid 2) + Listen (0x41)
 *   7983   IPS.exe    POSWorker       LocalPort
 *   11183  IPSPrinterServer           LocalPort + Listen
 *          IPS.exe                    RemotePort (dispid 1) + Connect (0x40),
 *                                     on the printing path and on wsSynch
 *   12183  IPS.exe    wsPrinterError  LocalPort + Listen
 *          IPSPrinterServer           RemotePort
 *   13184  IPSDeploy                  LocalPort AND RemotePort
 *
 *   13183  DOES NOT APPEAR as an immediate anywhere in IPS.exe's .text.
 *
 * IPSDeploy uses 13184, not 13183, which breaks the pattern outright. Every
 * value is a literal immediate; no site computes a port from a terminal or POS
 * number. So Front's IPS.exe binds the SAME 12183 that Back's did — and an
 * observed 12183 on Front is emphatically not the WaiterPad ingress.
 */
export const PORT_FAMILY_EVIDENCE: EvidenceNote = {
  grade: 'PROVEN_STATIC',
  addresses: [
    '0x02811abb',
    '0x029938be',
    '0x00fb3c7e',
    '0x01780b49',
    '0x0283ecd9',
    '0x00413a92',
    '0x0041cb37',
    '0x00426b8f',
  ],
  note:
    'Exhaustive scan of each candidate port as a 32-bit immediate across the ' +
    '.text of IPS.exe, IPSPrinterServer.exe, IPSDeploy.EXE and IPSClient.exe. ' +
    'Every hit is a literal; none is computed. 13183 has zero .text ' +
    'occurrences in IPS.exe. dispid 1 = RemotePort and dispid 2 = LocalPort, ' +
    'corroborated by the Connect (0x40) / Listen (0x41) calls that follow each. ' +
    'The last three addresses are in IPSPrinterServer.exe and IPSDeploy.EXE, ' +
    'not IPS.exe.',
};

/**
 * WHAT THE SOCKET PATH WRITES TO `POSServerMessages`, AND WHAT IT DOES NOT.
 *
 * Refines APPEND_VS_RELAY_EVIDENCE rather than replacing it.
 *
 *   - The socket ORDER path — inside `WPParsePacket`, right after the no-items
 *     discard check — INSERTs a `POSServerMessages` row of MessageType
 *     `'IH-PRINT'` WITH a Data payload.
 *   - The only `'IH-DATA'` INSERT in the whole binary sits in a database
 *     housekeeping routine, among `FixLocation0` / `MiscellaneousFixes` /
 *     one-off schema repairs, is guarded by an existence SELECT, and writes
 *     only `(CreatedDate, MessageType)` — NO Data column. It is a provisioning
 *     marker, not an order.
 *   - `ProcessHandheldOrder` — the delete-and-rewrite routine — is called from
 *     `frmPOSWorker`'s timer, which polls
 *     `MessageType='IH-ERROR' OR (ProcessedDate IS NULL AND (MessageType=
 *     'IH-PRINT' OR MessageType='IH-CMD'))` and dispatches on a `messageType`
 *     ELEMENT inside a `WPPacket` document.
 *
 * SO THE HAZARD IS NARROWED, NOT REMOVED — and it is narrowed in an
 * uncomfortable direction. The socket path does write a row that the worker
 * picks up, and the worker is the process that owns the delete-and-rewrite
 * routine. What the worker's `messageType` dispatch does with an order-shaped
 * packet is still NOT SHOWN. `WAITERPAD-RECON-001` stands.
 */
export const RELAY_TRIGGER_EVIDENCE: EvidenceNote = {
  grade: 'NOT_SHOWN',
  addresses: ['0x02818755', '0x0281877c', '0x01a30f01', '0x01a31089', '0x0294f7c0', '0x029507aa'],
  note:
    "WPParsePacket INSERTs an 'IH-PRINT' row at 0x02818755/0x0281877c. The " +
    'sole IH-DATA INSERT (0x01a31089) carries no Data column and sits between ' +
    'FixLocation0 (0x01a30c8c) and MiscellaneousFixes (0x01a315dc). ' +
    'ProcessHandheldOrder is reached from the frmPOSWorker timer whose SELECT ' +
    'is at 0x0294f7c0. What routes an ORDER into that routine is still NOT ' +
    'SHOWN.',
};

/**
 * WHERE FRONT'S HANDHELD LOG LIVES, AND THE WATERMARK THAT SAYS IF IT IS USED.
 *
 * IPS.exe's own log-housekeeping table pairs the glob `Ideal Handheld*.*` with
 * the `\LOGS` directory, beside `POSWorker*.*`, `POSActivity*.*`,
 * `Printing*.*`, `Webit*.*` and `PrintJobs*.*`. The category is gated by a
 * `HandheldLog` config key, and its rotation watermark is the registry value
 * `CurrentHandheldLogDate` under
 * `HKCU\SOFTWARE\VB and VBA Program Settings\Ideal POS System\System Options`.
 *
 * [BACK] Back's value reads `06/06/2019 11:17:12` — identical to
 * `CurrentFuelConsoleDate` and `CurrentSmartlinkDate`, features this venue does
 * not use — while `CurrentIPSLogDate` and `CurrentWebitDate` read 01 Sep 2026.
 * That is the shape of a log category that has never been written. It is
 * evidence about Back only, and it is the cheapest single reading available on
 * Front.
 */
export const HANDHELD_LOG_LOCATION_EVIDENCE: EvidenceNote = {
  grade: 'PROVEN_STATIC',
  addresses: ['0x0153a0e2', '0x0153a0f7', '0x00349cac'],
  note:
    "The glob 'Ideal Handheld*.*' at 0x0153a0e2 is immediately followed by " +
    "'\\LOGS' at 0x0153a0f7, in the same table as the other log categories. " +
    "'HandheldLog' at 0x00349cac is the config key naming the category. " +
    '[BACK] the CurrentHandheldLogDate watermark was read read-only from HKCU ' +
    'on 2026-09-07 and reads 06/06/2019.',
};

/**
 * THE GENERATOR HUNT, 2026-09-07 third pass. A negative, established by
 * call graph rather than by absence of a name.
 *
 * The earlier grade rested on "no checksum routine on the WaiterPad path".
 * That is a claim about what was not found, and the obvious objection is that
 * the search was for the wrong word. This pass answered the objection three
 * independent ways, and each one holds on its own:
 *
 *   1. NO CONSTRUCTION SITE. `IPS.exe` contains no `<Checksum>`, `</Checksum>`,
 *      `<WPOrder`, `<DeviceID` or `<OrderNo` opening-tag literal anywhere. It
 *      reads those names only as `selectSingleNode` arguments against a parsed
 *      DOM. The six response bodies are the ONLY packets this binary builds,
 *      and none of them carries a Checksum. A generator with no place to put
 *      its output is not a generator.
 *   2. THE MD5 HELPER IS ON A DIFFERENT SUBSYSTEM. `Support.GetMD5Hash`
 *      (0x01de4a60) is real, and it is the trap. It has exactly five callers
 *      binary-wide; not one is in the handheld module (0x01823000-0x01836000)
 *      or the `wsWaiterPad` listener (0x02811000-0x02813000). Its caller at
 *      0x01f5b030 sits beside `SELECT * FROM Users WHERE UPPER([Name])='ADMIN'`
 *      and `encryptedPassword`: it hashes operator passwords.
 *   3. THE PRIMITIVES ARE ABSENT. The import table holds no RNG, no timer, no
 *      CryptoAPI and no Base64 — the only matches are `__vbaStrDate`,
 *      `__vbaDateR8`, `__vbaDateStr`, `__vbaDateVar`. `CoCreateGuid` appears as
 *      an import name with no code reference from this module.
 *
 * So the grade on the ALGORITHM does not move: still NOT_SHOWN, because the
 * generating side is the vendor handheld application and this binary is the
 * receiver. What moves is the confidence that looking harder in THIS binary is
 * wasted effort. The algorithm will come from a captured packet on Front or
 * from the vendor, and from nowhere else.
 */
export const CHECKSUM_NO_GENERATOR_EVIDENCE: EvidenceNote = {
  grade: 'STRONGLY_INDICATED',
  addresses: ['0x01de4a60', '0x01f5b030', '0x01f5ae4a', '0x01f5af22'],
  note:
    'No checksum generator has been IDENTIFIED in IPS.exe, and the known ' +
    'candidate construction and hash paths are now strongly excluded. No ' +
    '<Checksum>/<WPOrder construction literal exists; the binary only reads ' +
    'those names via selectSingleNode. Support.GetMD5Hash at 0x01de4a60 has five callers ' +
    'binary-wide (0x0133eb4f, 0x0175d78f, 0x01f5b030, 0x01f5bea3, 0x02512eb7), ' +
    'NONE in the handheld module 0x01823000-0x01836000 or the listener ' +
    '0x02811000-0x02813000; its 0x01f5b030 caller sits beside the Users/ADMIN ' +
    'SELECT and encryptedPassword, so it hashes operator passwords. No RNG, ' +
    'timer, CryptoAPI or Base64 import exists. IPS.exe behaves as the RECEIVER ' +
    'in every traced WaiterPad path. This is strong NEGATIVE evidence, not an ' +
    'exhaustive control-flow proof: absence of imports and strings does not by ' +
    'itself exclude a custom arithmetic or string algorithm somewhere in the ' +
    'image. Further blind searching of this image is low-value unless a new ' +
    'concrete xref or data-flow lead appears.',
};

/**
 * THE TEST-VECTOR SOURCE, now with a known line format.
 *
 * `CheckWPOrder` writes the checksum it received, verbatim and beside its
 * `DeviceID`, into the `Ideal Handheld` log — before it decides anything about
 * the packet. The log writer is the handheld module's own, called 44 times
 * across the module with the log name as its first argument.
 *
 * This is the single most useful thing this pass produced for tomorrow. It
 * means a genuine vendor checksum and the device that produced it appear as a
 * greppable pair in a file the Front capture already collects, so the capture
 * needs no change to yield a test vector - only a `Checksum=` grep. What the
 * line does NOT carry is the packet body, so one line alone gives a value
 * without its input. Pairing it with the same round's order content is what
 * turns it into a vector, and that pairing is still unproven.
 */
export const CHECKSUM_LOG_LINE_EVIDENCE: EvidenceNote = {
  grade: 'PROVEN_STATIC',
  addresses: ['0x0182620f', '0x0182621f', '0x01826236', '0x01826262', '0x01538380'],
  note:
    'CheckWPOrder builds "Checksum=" & <received checksum> & "  DeviceID=" & ' +
    '<deviceId> (__vbaStrCat at 0x01826228/0x0182623b/0x0182624d) and passes it ' +
    'with the log name "Ideal Handheld" (0x0182620f) to the module log writer ' +
    'sub_01538380 at 0x01826262. Written whenever the Checksum node is present ' +
    'and non-empty, before the duplicate decision. Subject to the HandheldLog ' +
    'config gate. GREP TARGET for the Front capture: "Checksum=".',
};

/**
 * The duplicate guard reads TWO stores, not one, and one of them is switchable.
 *
 * §12 recorded the `AAAExampleData` / `ColumnType='IH-<DeviceID>'` lookup. There
 * is a second, separate one: a settings getter keyed
 * `"LastCheckSum" & <handheld number>` under the section `Ideal Handheld`,
 * compared by `__vbaStrCmp` in its own routine at 0x01834f10, with the matching
 * writer in the 0x0182d5xx packet handler.
 *
 * And the `AAAExampleData` duplicate check is GATED on a global word at
 * 0x2a2f1e4: when clear, `CheckWPOrder` jumps past `IsDuplicateHandheldOrder2`
 * entirely. What sets that global is NOT SHOWN, and it matters — it is a switch
 * that can disable the receiver's duplicate protection. Verdura's idempotency
 * must not assume the guard is armed.
 */
export const CHECKSUM_STORAGE_DUALITY_EVIDENCE: EvidenceNote = {
  grade: 'PROVEN_STATIC',
  addresses: [
    '0x01834f10',
    '0x01834fe2',
    '0x01834ff5',
    '0x01825313',
    '0x01826289',
    '0x0182d6b0',
    '0x00fc6cc1',
  ],
  note:
    'Two independent stores of the last-accepted checksum. (a) settings getter ' +
    'sub_00fc6c90(section "Ideal Handheld", key "LastCheckSum" & CStr(handheld ' +
    'number), ...) at 0x01834fe2, compared by __vbaStrCmp at 0x01834ff5; key ' +
    'built via __vbaStrI2/__vbaStrCat at 0x01825313-0x01825333; written back ' +
    'from the 0x0182d5xx handler at 0x0182d6b0. (b) the AAAExampleData ' +
    'ColumnType=IH- lookup of section 12. The (b) path is GATED: cmp word ' +
    '[0x2a2f1e4] / je at 0x01826289 skips IsDuplicateHandheldOrder2 when clear. ' +
    'What sets 0x2a2f1e4 is NOT SHOWN. Do not assume the guard is armed. ' +
    'The (a) getter resolves against the REGISTRY root ' +
    'Software > Idealpos Solutions > Idealpos (0x00fc6cc1), so on Front the ' +
    'value LastCheckSum<handheld number> under an Ideal Handheld subkey may ' +
    'hold a GENUINE vendor checksum readable without any packet capture. ' +
    'Back has no such subkey under HKCU or HKLM, consistent with Back never ' +
    'having run a handheld.',
};

/**
 * `WAITERPAD-REGO-001`, the body half — closed.
 *
 * The open vendor question had two halves: what causes `NAKREGO`, and what its
 * body carries. The second half is now answered statically, and the answer is
 * "nothing".
 *
 * `NAKREGO` and `NAKPRINT` are stored as split open/close tag literals rather
 * than as whole strings, which looks like interpolation and is not. Their
 * builders take NO parameters — zero `[ebp+...]` reads across the whole
 * procedure — and concatenate exactly three constants: the XML declaration, the
 * opening tag, and the closing `</WPPacket>`. They are constant-valued packets
 * that happen to be assembled at runtime. `LOCK` remains the only genuinely
 * interpolated response.
 *
 * So a `NAKREGO` tells the sender only that it was refused. It never says why.
 * The remaining half of `WAITERPAD-REGO-001` — whether slot exhaustion is the
 * only cause — stands, and no readback can substitute for it, because the wire
 * carries no distinguishing detail.
 */
export const NAKREGO_EMPTY_BODY_EVIDENCE: EvidenceNote = {
  grade: 'PROVEN_STATIC',
  addresses: ['0x01824cd0', '0x01824d01', '0x01824d1b', '0x01824d33', '0x01824dcc'],
  note:
    'The NAKREGO builder at 0x01824cd0 takes no parameters (zero [ebp+] reads) ' +
    'and concatenates three constants: the XML declaration (0x01824d01), the ' +
    'NAKREGO opening tag (0x01824d1b) and the closing WPPacket tag ' +
    '(0x01824d33). NAKPRINT has the identical shape at 0x01824dcc. The split ' +
    'open/close storage is not interpolation. NAKREGO therefore carries NO ' +
    'body and no reason code; LOCK stays the only interpolated response. ' +
    'WAITERPAD-REGO-001 body half is closed; its cause half stands.',
};

/**
 * WAITERPAD-RECON-001 — the relay path, traced end to end.
 *
 * This is the finding the route has been missing since the first session, and
 * it is not the comfortable one. The question was: what routes a handheld order
 * to the delete-and-rewrite relay path rather than an appending socket path?
 * The answer is that for a socket ORDER there is no choice to route. **Every
 * socket order is relayed, and the relay applies it by deleting the table's
 * native sale and rewriting it.**
 *
 * THE CHAIN, each edge with its own evidence.
 *
 *   1. [STATIC-PROVEN] `wsWaiterPad_DataArrival` parses `<OrderItem>`
 *      (0x02818602), discards a packet with no items (0x02818628), and INSERTs
 *      `POSServerMessages (CreatedDate, MessageType, Data)` with MessageType
 *      `'IH-PRINT'` and a Data payload (0x02818755 / 0x0281877c).
 *   2. [STATIC-PROVEN] It calls `CheckWPOrder` (0x01825f30) from exactly one
 *      site, 0x02818883 — the response-selection block. `CheckWPOrder` decides
 *      ACK/NAK/DUPLICATE/LOCK/NAKREGO. It does NOT touch PendingSales.
 *   3. [STATIC-PROVEN] The worker timer polls
 *      `SELECT * FROM POSServerMessages WHERE MessageType='IH-ERROR' OR
 *      (ProcessedDate IS NULL AND (MessageType='IH-PRINT' OR
 *      MessageType='IH-CMD')) ORDER BY CreatedDate` (0x0294f7c0), behind a
 *      `SEMAPHORE.TMP` guard (0x0294f86f).
 *   4. [STATIC-PROVEN] It reads the row's `messageType`, compares against
 *      `IH-CMD` (0x0294fa9c), `IH-PRINT` (0x02950134) and `IH-ERROR`
 *      (0x0295016c). At 0x0295038e-0x02950390 a NON-`IH-ERROR` row branches to
 *      0x02950555; an `IH-ERROR` row falls through to stamp `ProcessedDate`
 *      (0x029503f1) and is not applied.
 *   5. [STATIC-PROVEN] The non-`IH-ERROR` path logs `Loaded xml to process
 *      Handheld Order` (0x0295063a), parses a `WPPacket` (0x02950673), and at
 *      0x029507aa calls `ProcessHandheldOrder` (0x01826b90).
 *   6. [STATIC-PROVEN] `ProcessHandheldOrder` has **exactly one caller in the
 *      whole image** — that site. Verified by a binary-wide E8 scan.
 *
 * So an `IH-PRINT` row written by the socket handler is picked up by the worker
 * and applied by `ProcessHandheldOrder`. The routing question is answered for
 * the socket ORDER case: it is not conditional.
 *
 * KEEP THESE TWO APART. `WPOrder` (0x0182cad0) is a DIFFERENT procedure with
 * different callers (0x0281244a and 0x0282c146) and different behaviour — it
 * logs `Handheld Order successfully added to Pending Sales.` (0x0183293c) and
 * `About to Send to POSServer`. It is not `ProcessHandheldOrder` and must never
 * be merged with it on the strength of a similar name.
 */
export const RELAY_PATH_CHAIN_EVIDENCE: EvidenceNote = {
  grade: 'PROVEN_STATIC',
  addresses: [
    '0x02818755',
    '0x02818883',
    '0x0294f7c0',
    '0x02950390',
    '0x0295063a',
    '0x029507aa',
    '0x01826b90',
  ],
  note:
    'Socket ORDER -> IH-PRINT row -> worker poll -> ProcessHandheldOrder, every ' +
    'edge STATIC. wsWaiterPad_DataArrival INSERTs POSServerMessages MessageType ' +
    "'IH-PRINT' with Data (0x02818755) and calls CheckWPOrder once (0x02818883). " +
    'The worker polls IH-ERROR/IH-PRINT/IH-CMD (0x0294f7c0); at 0x02950390 a ' +
    'non-IH-ERROR row branches to the XML load (0x0295063a) and calls ' +
    'ProcessHandheldOrder at 0x029507aa. ProcessHandheldOrder (0x01826b90) has ' +
    'EXACTLY ONE caller image-wide, that site. WPOrder (0x0182cad0) is a ' +
    'DIFFERENT procedure with different callers (0x0281244a, 0x0282c146); do ' +
    'not merge them.',
};

/**
 * What the relay actually does to native sale state, and why it is a hazard.
 *
 * `ProcessHandheldOrder` (0x01826b90 .. its error handler at 0x0182c221) issues
 * BOTH of these, in this order:
 *
 *     DELETE * FROM PendingSaleLines WHERE Code='<value>'     (0x01827665)
 *     DELETE * FROM PendingSales     WHERE Code='<value>'     (0x0182770a)
 *
 * and then rewrites. There is **no `INSERT INTO PendingSales` SQL literal
 * anywhere in the image** — the rewrite is an ADO recordset opened on
 * `PendingSales` (0x0182778d) and `PendingSaleLines` (0x0182759a) with fields
 * assigned by name: `Code`, `Date`, then per `OrderItem` (0x01827c02)
 * `StockItem`, `Quantity`, `Type`, `Text`, `Seat`, `PriceLevel`, `Price`,
 * `Description` (0x01827c7d-0x0182803c).
 *
 * THE KEY. The `WHERE Code='…'` operand is a RUNTIME VALUE, not a string
 * constant, so this note does not claim to have decoded its provenance. That
 * it is the table code is `[INFERENCE]` — strongly indicated by `PendingSales.Code`
 * carrying the table code elsewhere in the schema and by the surrounding
 * `----------- TABLE ORDER : ` / `  Covers:` logging (0x018274cf), but the
 * variable itself was not traced to its source. Do not upgrade this without
 * decoding it.
 *
 * WHY IT MATTERS. This is destructive to NATIVE sale state, not to a queue or
 * an intermediate table. If the deleted scope is the whole table code, then
 * every round already on that table is removed and re-created from the packet
 * currently being applied — which means the packet must carry complete table
 * state for the operation to be non-lossy. That requirement is `[INFERENCE]`
 * from the delete-and-rewrite shape, and it is the single most important thing
 * still to confirm.
 */
export const RELAY_DELETE_REWRITE_EVIDENCE: EvidenceNote = {
  grade: 'PROVEN_STATIC',
  addresses: ['0x01827665', '0x0182770a', '0x0182759a', '0x0182778d', '0x01827c02'],
  note:
    'ProcessHandheldOrder issues DELETE * FROM PendingSaleLines WHERE Code= ' +
    '(0x01827665) then DELETE * FROM PendingSales WHERE Code= (0x0182770a), ' +
    'then rewrites via ADO recordsets on PendingSaleLines (0x0182759a) and ' +
    'PendingSales (0x0182778d) with fields set by name (Code, Date, StockItem, ' +
    'Quantity, Type, Text, Seat, PriceLevel, Price, Description). There is NO ' +
    'INSERT INTO PendingSales SQL literal in the image. This reaches NATIVE ' +
    'sale state, not a queue. The WHERE operand is a RUNTIME value: that it is ' +
    'the table code is INFERENCE, not decoded. Whether the packet must ' +
    'therefore carry COMPLETE table state is the open question.',
};

/**
 * The recovery question, and the answer Verdura has to live with.
 *
 * Asked plainly: after an uncertain round, is there any durable token that
 * distinguishes "Verdura caused this exact PLU/quantity delta" from "a human
 * added the same items while we were recovering"?
 *
 * On the evidence so far: **no.** The fields the rewrite assigns are
 * `Code`, `Date`, `StockItem`, `Quantity`, `Type`, `Text`, `Seat`,
 * `PriceLevel`, `Price`, `Description`. **No `DeviceID` and no `Checksum`
 * appear among them.** Both live on the receiver side only — the checksum in
 * the `Ideal Handheld` log, in `AAAExampleData` under `ColumnType='IH-…'`, and
 * in the `LastCheckSum<n>` setting; the `DeviceID` in the same places. None of
 * that is joined to a `PendingSales` or `PendingSaleLines` row by any SQL this
 * pass found.
 *
 * That absence is `[STATIC]` over the traced rewrite and `[UNKNOWN]` beyond it:
 * the field list was read from the recordset assignments in
 * `ProcessHandheldOrder`, not from the live schema, and a column that exists
 * but is never assigned there would not appear. A Front `SELECT TOP 1 *` on
 * `PendingSales` would settle it in one read.
 *
 * CONSEQUENCE, and it is the reason `reconcileRoundAgainstReadback()` stays
 * unimplemented: an exact PLU/quantity match after an uncertain round is
 * consistent with two different causes, and nothing durable separates them.
 * `ACK` cannot close the gap either — it is emitted before execution
 * (`ACK_MEANS_BUFFERED_NOT_EXECUTED`) and even for a packet dropped on a full
 * buffer (`ACK_ON_BUFFER_EXHAUSTION`). Neither can `PendingSales.ID`, which is
 * unstable, nor `Printed`, which says a kitchen docket was produced and not who
 * caused it.
 */
export const RECOVERY_CAUSAL_TOKEN_EVIDENCE: EvidenceNote = {
  grade: 'NOT_SHOWN',
  addresses: ['0x01827c7d', '0x0182803c'],
  note:
    'NO durable causal token links a native PendingSales/PendingSaleLines row ' +
    'to the Verdura submission that caused it. The rewrite in ' +
    'ProcessHandheldOrder assigns Code, Date, StockItem, Quantity, Type, Text, ' +
    'Seat, PriceLevel, Price, Description - NO DeviceID and NO Checksum. Those ' +
    'two survive only receiver-side (Ideal Handheld log, AAAExampleData ' +
    "ColumnType='IH-', LastCheckSum<n>) and are joined to no sale row by any " +
    'SQL found. So an exact PLU/qty match cannot be distinguished from a human ' +
    'adding the same items. ACK cannot close it (pre-execution, and emitted on ' +
    'buffer exhaustion); nor can unstable PendingSales.ID or a Printed flag. ' +
    'Recovery of an uncertain round stays MANUAL_RESOLUTION_REQUIRED.',
};

/* ===========================================================================
 * FRONT RUNTIME PASS - 2026-09-09
 *
 * Everything above this line was read out of IPS.exe or observed on Back. The
 * notes below are the first [FRONT] RUNTIME observations of the live handheld
 * route, recovered from Front's own application logs over read-only SSH.
 *
 * SOURCE ARTIFACTS (raw evidence is deliberately NOT in this repository; see
 * .tmp-back-evidence/20260909-124209/PROVENANCE.txt and PROVENANCE-2.txt for
 * paths, lengths, LastWriteTime and source==copy SHA-256 for every file):
 *
 *   Ideal Handheld-2026090{5175525,7112553,8113029,9113154}.LOG
 *       C:\ProgramData\Idealpos Solutions\Idealpos\LOGS
 *       The WaiterPad listener's own log. 41 distinct genuine Order2 packets,
 *       2853 ACK responses, 1 NAK, across 2026-09-04..09.
 *   POSWorker.log                   same directory. ProcessHandheldOrder runs.
 *   POSActivity-20260909113154.LOG  same directory. POS-terminal side.
 *   Printing.log, PrintJobs.log, IPSPrinterServer.LOG   same directory.
 *   POSServerClient.log             same directory. The POSServer 11000 channel.
 *   ErrorLog.log   C:\ProgramData\Idealpos Solutions\POSServer\logs
 *       The ONLY duplicate-detection evidence anywhere on Front.
 *
 * These notes carry no IPS.exe addresses; `addresses` is empty by design. They
 * are graded PROVEN_RUNTIME only where the log text itself states the fact, and
 * STRONGLY_INDICATED or NOT_SHOWN where a step had to be inferred by
 * correlation. No note here upgrades a claim that only correlation supports.
 * =========================================================================== */

/**
 * The live packet, at last. `WPOrder` as a NAME remains unobserved on the wire;
 * what the live iPad actually sends is `<WPPacket><Order Type="Order2">`.
 *
 * This is the most important artifact of the pass, because every prior
 * order-shape claim in this file was read out of a binary. This one was sent by
 * a real iPad, to a real till, for a real table, and the kitchen printed it.
 */
export const LIVE_ORDER2_PACKET_EVIDENCE: EvidenceNote = {
  grade: 'PROVEN_RUNTIME',
  addresses: [],
  note:
    '[FRONT] The genuine live handheld order frame is <?xml version="1.0" ' +
    'encoding="UTF-8" ?><WPPacket><Order Type="Order2"> with scalar children ' +
    'Map, Location, POSTerminal, Table, Clerk, Guests, SkipKitchen, ' +
    'KitchenOnly, VoidMode, Total, CashAmount, PointsAmount, SalesCaption, ' +
    'PrintReceipt, LocalAddress, DeviceID, PocketPad, DeviceModel, DeviceOS, ' +
    'Checksum, followed by repeated <OrderItem Index="0"> each carrying Type, ' +
    'StockItem, Description, Quantity, Price, Seat, PriceLevel, TaxString. ' +
    'Type is "StockItem" for a sold line and "Text" for a free-text kitchen ' +
    'instruction (StockItem "#", Quantity 0, Price 0.00). NOTE Index is ' +
    'literally "0" on EVERY item - it does NOT enumerate. Observed verbatim ' +
    '2026-09-08 16:38:31 in Ideal Handheld-20260909113154.LOG: Table 10, ' +
    'Clerk 108, POSTerminal 901, Map 1, Location 1, Guests 0, Total 75, ' +
    'Checksum 1024185259, DeviceID 10DF1A7881284E2E95CA107E82EE7D0D. 41 ' +
    'distinct such packets exist across the four retained logs.',
};

/**
 * A ROUND IS A DELTA. This answers half of `WAITERPAD-RECON-001` point 2 and
 * opens a sharper question in its place.
 *
 * The old blocker text said delete-and-rewrite is non-lossy "only if the packet
 * carries COMPLETE table state", and that answering it "needs one captured
 * genuine packet". We now have 41, including consecutive rounds on one table.
 * The packet does NOT carry complete table state.
 */
export const ROUND_IS_DELTA_NOT_FULL_STATE_EVIDENCE: EvidenceNote = {
  grade: 'PROVEN_RUNTIME',
  addresses: [],
  note:
    '[FRONT] A second physical round on the same table sends ONLY the new ' +
    'items, not the accumulated table state, and the per-round line index ' +
    'restarts at 1. Cleanest instance, POSWorker.log 2026-09-08: TABLE 12 at ' +
    '18:04:11 carried exactly 2 lines (SHIRAZ Glass, Apple Tea); TABLE 12 at ' +
    '18:13:40, nine minutes later, carried 4 lines (HAMSA KUWAITI, Grill ' +
    'Prawns, CAULIFLOWER FRITTERS, GREEK EGGPLANT LAMB MOUSSAKA) - a DISJOINT ' +
    'set numbered 1..4 with no repetition of round one. Same shape at TABLE 18 ' +
    'on 2026-09-06 (14:18:19 seven lines, then 16:48:57 eleven entirely ' +
    'different lines). Each round independently fires SendToKitchen. ' +
    'CONSEQUENCE: any implementation that treats a round as full table state, ' +
    'or that re-sends a table to make state converge, would double-charge the ' +
    'customer and double-fire the kitchen.',
};

/**
 * What the delete in `ProcessHandheldOrder` actually appears to target.
 *
 * DELIBERATELY NOT UPGRADED. Static analysis says ProcessHandheldOrder DELETEs
 * PendingSales/PendingSaleLines and rewrites them. Runtime says the packet is a
 * delta and that tables plainly accumulate across rounds in normal trade. Both
 * cannot be true of the SAME rows, so the delete must be narrower than "the
 * customer's tab" - but the logs show a deletion of a DIFFERENT, IH-prefixed
 * code, and never show the row set the SQL touched. Reconciling the two
 * readings is NOT SHOWN and is now the sharp end of WAITERPAD-RECON-001.
 */
export const IH_STAGING_CODE_EVIDENCE: EvidenceNote = {
  grade: 'STRONGLY_INDICATED',
  addresses: [],
  note:
    '[FRONT] The handheld route uses a distinct IH-prefixed PendingSales code ' +
    'that is created and then deleted within about a second, separate from the ' +
    "table's own tab code. 2026-09-08: POSWorker.log 16:38:32.435 " +
    '"SendToKitchen Code=`IH10 POS=1"; POSActivity 16:38:33.225 ' +
    '"CheckHandheldMessages data=`IH10108" (table 10 and clerk 108 ' +
    'concatenated), 16:38:33.255 "ProcessAlertLevelPacket Entry ' +
    'tabletag=`IH10", 16:38:33.355 "Deleting PendSale record `IH10 p=1". This ' +
    'three-line pattern recurs identically for every one of the 36 handheld ' +
    'rounds in the POSActivity log. The POS terminal separately writes its OWN ' +
    'tab as code="<padded table>" POS=1 plus a transient "`<table>" POS=2, ' +
    'e.g. 17:55:27.095 code padded 10 POS=1, then 17:55:29.096 code=`10 POS=2, ' +
    'then delete. So at least three code namespaces coexist. WHAT IS NOT ' +
    'SHOWN: no log records the SQL row set, so whether the static ' +
    'delete-and-rewrite targets `IH10 (staging) or table 10 durable tab is NOT ' +
    'resolved. Do not assume the benign reading.',
};

/**
 * ACK BEFORE DURABLE PROCESSING - now runtime, not just static.
 *
 * `ACK_MEANS_BUFFERED_NOT_EXECUTED` said this from the binary. Front's clocks
 * now say it out loud, in two different log files, for the same packet.
 */
export const ACK_PRECEDES_PROCESSING_RUNTIME_EVIDENCE: EvidenceNote = {
  grade: 'PROVEN_RUNTIME',
  addresses: [],
  note:
    '[FRONT] For the SAME order on 2026-09-08, the Ideal Handheld log shows: ' +
    'received 16:38:31.595-.735, parsed .745, "Adding <DeviceID> to current ' +
    'devices" .805, ACK sent 16:38:31.875. POSWorker.log only THEN begins - ' +
    '"Loaded xml to process Handheld Order" 16:38:32.105, ' +
    '"ProcessHandheldOrder Processing STARTED : Table 10 and Map 1" .195, ' +
    'SendToKitchen .435, "Totally finished : Table 10" 16:38:33.065. The ACK ' +
    'precedes the START of durable processing by about 230ms and its ' +
    'COMPLETION by about 1.19s. The ACK body is a fixed 73 bytes and is ' +
    'BYTE-IDENTICAL to the ACK returned for a Test command - it carries no ' +
    'order identity, no table, no sequence and no result. ACK IS NOT ' +
    'ACCEPTANCE, and no later message on the socket revises it.',
};

/**
 * NAK MEANS "I COULD NOT PARSE THAT", NOT "I REJECTED YOUR ORDER" - and it can
 * arrive AFTER the order it appears to refer to was already accepted.
 *
 * This is a retry trap and the reason auto-retry must stay prohibited.
 */
export const NAK_IS_A_PARSE_FAILURE_EVIDENCE: EvidenceNote = {
  grade: 'PROVEN_RUNTIME',
  addresses: [],
  note:
    '[FRONT] Exactly one NAK exists in 2853 responses across four logs. ' +
    'Ideal Handheld-20260905175525.LOG, 2026-09-04 17:15:24: an Order2 was ' +
    'received and ACKed at 17:15:24.050; the receiver then read a TRAILING TCP ' +
    'FRAGMENT of the same transmission (logged as a bare <DeviceID> line), ' +
    'logged "XML parsing error" at .140, and sent NAK at .170. The receiver ' +
    'parses on socket-read boundaries and does not always reassemble - the ' +
    '16:38:31 order on 2026-09-08 arrived as TWO "----RECEIVED Socket 2----" ' +
    'chunks and DID reassemble, so the behaviour is not deterministic. ' +
    'CONSEQUENCE: a NAK does not mean the round was refused. Here the round ' +
    'was already accepted and had gone to the kitchen. Retrying on that NAK ' +
    'would have double-posted it. NEVER auto-retry a NAK.',
};

/**
 * The receiver's duplicate guard is REAL, has FIRED, and is currently EMPTY.
 *
 * `CHECKSUM_STORAGE_DUALITY_EVIDENCE` predicted store (a) would be readable in
 * the Front registry. It is. It holds nothing.
 */
export const DUPLICATE_GUARD_STATE_EVIDENCE: EvidenceNote = {
  grade: 'PROVEN_RUNTIME',
  addresses: [],
  note:
    '[FRONT] (1) The guard is real and has fired: ' +
    'C:\\ProgramData\\Idealpos Solutions\\POSServer\\logs\\ErrorLog.log holds ' +
    'eight lines "HandheldOrder DUPLICATE! Checksum - " followed by the ' +
    'decimal checksum CONCATENATED with the device id, e.g. ' +
    '502244953A0ECF63167035A9E822A9B2A01CE137489A55CCD - so the key is ' +
    'checksum+DeviceID, not checksum alone. All eight are dated 2019-07-25 to ' +
    '2019-07-28 under POSServer 1.7.1.6, against a 40-hex device id. (2) It ' +
    'has NOT fired since: zero occurrences in any 2020-2026 Front log. (3) ' +
    'Store (a) exists but is EMPTY: HKLM\\SOFTWARE\\WOW6432Node\\Idealpos ' +
    'Solutions\\Idealpos\\Ideal Handheld carries values LastCheckSum1 and ' +
    'LastCheckSum2, BOTH blank, read read-only on 2026-09-09 with 41 genuine ' +
    'orders having passed through in the preceding five days. So this till is ' +
    'NOT recording last-accepted checksums today. Verdura must carry ' +
    'exactly-once entirely on its own side. This does NOT prove the guard is ' +
    'disarmed - store (b) was not inspected - but it removes any basis for ' +
    'assuming it is armed.',
};

/**
 * The `Checksum=` grep that `CHECKSUM_LOG_LINE_EVIDENCE` planned for does not
 * work on Front as configured. Recorded so nobody re-runs that plan.
 */
export const CHECKSUM_LOG_LINE_ABSENT_ON_FRONT_EVIDENCE: EvidenceNote = {
  grade: 'NOT_SHOWN',
  addresses: ['0x0182620f', '0x01826262'],
  note:
    '[FRONT] CHECKSUM_LOG_LINE_EVIDENCE named "Checksum=" as the grep target ' +
    'that would yield a genuine vendor checksum beside its DeviceID. That ' +
    'literal appears ZERO times in any Front log, including the four Ideal ' +
    'Handheld logs that DO contain 41 genuine <Checksum> XML nodes. Either the ' +
    'HandheldLog config gate on that writer is off, or CheckWPOrder is not ' +
    'reached on this path. The checksums ARE recoverable anyway - from the ' +
    "logged packet body's own <Checksum> node, paired with the full order " +
    'content in the same log entry, which is a BETTER vector than the planned ' +
    'one because it includes the input. What is still missing is the ' +
    'ALGORITHM: 41 input/output pairs now exist but no generator has been ' +
    'derived from them, and deriving one is not attempted here.',
};

/**
 * The identification exchange, as it actually happens.
 */
export const LIVE_SESSION_MODEL_EVIDENCE: EvidenceNote = {
  grade: 'PROVEN_RUNTIME',
  addresses: [],
  note:
    '[FRONT] There is no separate registration handshake on this path. Every ' +
    'packet self-identifies: Command packets carry LocalAddress, DeviceID, ' +
    'MachineDescription, WPType (Protocol2), Table and RootMenuCode. The only ' +
    'Command Types observed are "Test" (1706 in one log) and "RequestProgram" ' +
    '(38); no TABLESTATUS or REQUESTTABLESTATUS literal appears anywhere in ' +
    'any Front log. The receiver answers Test with the same bare ACK and logs ' +
    '"<DeviceID> - WP Current Count=<n> - Waiters=<n>" plus, on first sight, ' +
    '"Adding <DeviceID> to current devices." RequestProgram triggers a menu ' +
    'build (WPTables, WPClerks, BuildStructureFromPOSScreen, AddBasePOSLayers, ' +
    'AddEachPOSLayer, AddPOSMenus, AddPOSGrids, "Saving handheld data...") ' +
    'answered by "---Sent Large Return Packet---", about 5.7s end to end. The ' +
    'transport is connect / one command / response / close: each exchange ' +
    'opens a new socket, and the listener logs "Current State=8 Closing socket ' +
    'from old connection" when a request arrives on a busy index.',
};

/**
 * The kitchen path, end to end, with the docket text.
 */
export const LIVE_KITCHEN_PATH_EVIDENCE: EvidenceNote = {
  grade: 'PROVEN_RUNTIME',
  addresses: [],
  note:
    '[FRONT] A handheld round reaches the kitchen through the native printer ' +
    'path. 2026-09-08 16:38: POSWorker "SendToKitchen Code=`IH10 POS=1" at ' +
    '.435 writes C:\\ProgramData\\Idealpos Solutions\\Idealpos\\PrintJobs\\' +
    'KitchenPrinter_20.Dat (.885) and BPrinter_20.Dat (33.045); Printing.log ' +
    'then connects to Ethernet printers 192.168.1.211 and 192.168.1.212, ' +
    'prints, and DELETES each .Dat file. The docket body is table-attached and ' +
    'clerk-attributed - it reads "! TABLE 10", "4:38pm! 08-Sep-2026", ' +
    '"! chowdhury!", then quantity-collapsed lines under a "----MAINS----" ' +
    'header with modifiers indented beneath their parent line. The bar printer ' +
    'receives only the drink lines. NOTE the docket collapses 3 x CHICKEN ' +
    'SHAWARMA into a single "3!x" line although the packet sent three separate ' +
    'OrderItem entries, so docket text cannot be used to count packet lines.',
};

/**
 * The POSServer (11000) channel is a DIFFERENT subsystem and the handheld round
 * does not touch it. Recorded because it is the natural place to look for a
 * lock lifecycle, and the answer is "not here".
 */
export const HANDHELD_BYPASSES_POSSERVER_CHANNEL_EVIDENCE: EvidenceNote = {
  grade: 'PROVEN_RUNTIME',
  addresses: [],
  note:
    '[FRONT] POSServerClient.log shows the POS terminal speaking a fixed-width ' +
    'text protocol to POSServer on 11000: CONNECT, "Sending Identification ' +
    'POS 2", then ~SENDSTAT (83), ~UNLOCK (76), ~REQUEST (65), ~TABLEDATA ' +
    '(62), ~GETCUSTP (55), ~LOCKONE (48), ~GETSIM (29), ~SETCUSTP (23), ' +
    '~DELETE (18), ~MISCELLAN (2), ~GETALL (2) - each padded and terminated ' +
    'with "@@@". This CORROBORATES that 11000 is not exclusively table-status ' +
    'traffic. But the 16:38:31 handheld order produced NO POSServerClient ' +
    'activity at all: that log is silent from before 16:38 until an unrelated ' +
    '~GETSIM at 16:39:43. The handheld ingest does not lock the table over ' +
    'this channel. The only handheld lock evidence on Front is Handheld.log, ' +
    'which contains exactly two lines in its entire life - "Table Locked by ' +
    'Handheld POS!" on 2024-12-13 and 2026-03-24 - a rare contention message, ' +
    'not a routine lifecycle. The lock lifecycle for the HANDHELD path is ' +
    'therefore still NOT SHOWN.',
};

/**
 * THE PORT. `WAITERPAD-BIND-001` is closed by this note.
 *
 * Read the residual assumption at the end before relying on it.
 */
export const HANDHELD_INGRESS_PORT_RUNTIME_EVIDENCE: EvidenceNote = {
  grade: 'PROVEN_RUNTIME',
  addresses: [],
  note:
    '[FRONT+BACK] TCP 6983 on Front IS the Ideal Handheld / WaiterPad ' +
    'listener, established by cross-host timing correlation. On 2026-09-08 ' +
    'Back ran a sequential TcpClient scan (2.5s timeout) against Front over ' +
    'the authored list 6983, 7983, 12183, 5501, 11183, 13184 - a logged ' +
    'deviation recorded in back-to-front-access-discovery.txt. Front logs ' +
    'record the resulting accepts, each in a DIFFERENT subsystem, at about ' +
    '4.8s intervals in exactly that order: Ideal Handheld log 15:51:27.821 ' +
    '("Connection Request from 192.168.1.250", accepted, closed); ' +
    'POSWorker.log 15:51:32.652 (same wording, same source IP); Printing.log ' +
    '15:51:37.352 ("wsPrinterError_ConnectionRequest"); IPSPrinterServer.LOG ' +
    '15:51:48.419; IPSDeploy.log 15:51:53.013. Slot 3 is the anchor: it landed ' +
    'on the socket control named wsPrinterError, which INDEPENDENT STATIC ' +
    'analysis had already attributed to 12183 - so the alignment is confirmed ' +
    'by a second, non-timing line of evidence. Slot 1 is therefore 6983 = the ' +
    'handheld listener and slot 2 is 7983 = POSWorker. Two of the five accepts ' +
    'name 192.168.1.250 explicitly, removing doubt about whose connection it ' +
    'was. RESIDUAL ASSUMPTION: that the scan issued the list in the recorded ' +
    'order. Front never caught an iPad connection in a netstat sample because ' +
    'the handheld exchange is connect/command/ACK/close in well under a second.',
};

/**
 * The iPad, identified. Recorded so a future capture can be aimed correctly.
 */
export const LIVE_HANDHELD_DEVICE_EVIDENCE: EvidenceNote = {
  grade: 'PROVEN_RUNTIME',
  addresses: [],
  note:
    '[FRONT] The venue handheld is 192.168.1.161, DeviceID ' +
    '10DF1A7881284E2E95CA107E82EE7D0D, an iPad Pro 12.9-inch (iPad7,2) on ' +
    'iPadOS 17.7.11 running PocketPad "Version 2.2.51", speaking WPType ' +
    'Protocol2 and submitting as POSTerminal 901 / Clerk 108. It is NOT ' +
    '192.168.1.45 - that address is the AnyDesk peer. See ' +
    'ETL_CAPTURES_ARE_EVIDENTIALLY_VOID_EVIDENCE.',
};

/**
 * Why the two operator packet captures answered nothing, so that the next
 * capture is set up differently.
 */
export const ETL_CAPTURES_ARE_EVIDENTIALLY_VOID_EVIDENCE: EvidenceNote = {
  grade: 'NOT_SHOWN',
  addresses: [],
  note:
    '[FRONT] Both 2026-09-08 netsh packet captures contain ZERO IdealPOS ' +
    'protocol traffic and cannot support any protocol claim. Decoded offline ' +
    'on Back. For front-ipad-passive-20260908-143705.etl the timing file ' +
    'records the trace running 14:37:05.154 to 14:42:20.307 (+12:00), but the ' +
    'file holds events only from 14:37:11.333 to 14:37:43.187 - 32 seconds of ' +
    'a 5m15s window - because the 9 x 128KB buffer filled and logging halted. ' +
    'Of 354 checksum-validated IPv4 frames, 291 are 192.168.1.45 to and from ' +
    'Front:7070, which is AnyDesk.exe (confirmed by live read-only listener ' +
    'attribution on Front, PID 2072) carrying TLS 1.2 application data - ' +
    'encrypted, and it is what exhausted the buffer. The remainder: 21 frames ' +
    'Front to and from Back:5501 carrying single 0x00 bytes (an IPSClient ' +
    'keepalive with no protocol content), a few HTTPS flows to Microsoft and ' +
    'CDN hosts, and mDNS/SSDP multicast. NO frame on 6983, 7983, 11000, 12183, ' +
    '11183 or 13184. The iPad appears only as mDNS. The 13:53 capture is the ' +
    'same but worse: 15 seconds, 283 frames, 246 of them AnyDesk. report.etl ' +
    'inside each .cab is byte-identical to the standalone .etl, so the CABs ' +
    'add no packet data. CONSEQUENCE: the undocumented physical iPad action of ' +
    'the 14:37 session CANNOT be reconstructed - the window in which it would ' +
    'have occurred was never recorded. Any future capture must exclude TCP ' +
    '7070 and raise maxSize.',
};
