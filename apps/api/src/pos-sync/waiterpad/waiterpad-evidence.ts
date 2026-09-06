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
 *              independent. Everything in this file is [STATIC].
 *   [BACK]   — observed on Back / Machine 1 (the POSServer host). Nothing in
 *              this file depends on a [BACK] observation.
 *   [FRONT]  — operator-captured on Front / Machine 2 (the till that actually
 *              runs the handheld server). Nothing here depends on one either.
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
 * The ingress port. PROVEN STATIC only — that the same binary on Front is
 * actually BOUND to it has never been observed, and this module must never
 * imply otherwise. Recorded for documentation; deliberately not used by any
 * code here, because no code here connects to anything.
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
    'handheld application is not installed on either machine. The generation ' +
    'algorithm is therefore NOT SHOWN and is left unimplemented.',
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
