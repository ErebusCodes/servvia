/**
 * The WaiterPad response parser. Closed set, fail closed.
 *
 * THE SET IS COMPLETE AND IT IS SMALL. `IPS.exe` holds six response bodies for
 * this path, each returned by its own accessor sub. Four are constant strings
 * with no interpolation; `LOCK` interpolates one integer; `NAKREGO` and
 * `NAKPRINT` have a body we have not decoded and therefore do not read. There
 * is no seventh, and there is no field carrying a native identifier in any of
 * them.
 *
 * WHY THIS PARSER REFUSES RATHER THAN GUESSES. Every unknown response shape
 * has the same safe interpretation and it is not "probably fine": we do not
 * know whether the order was accepted. Returning an error variant forces the
 * caller to route that into the unresolved path instead of pattern-matching
 * on a best guess. A parser that accepted `Type='ACKNOWLEDGED'` as an ACK,
 * or that treated an empty body as success, would convert an unknown outcome
 * into a false confirmation — which on this route means a table's food either
 * never arrives or arrives twice.
 *
 * WHAT AN ACK DOES NOT MEAN. See `WaiterPadAck` below. This is the single most
 * important comment in the module.
 *
 * PURE. Parsing only. No I/O.
 */

import { LOCK_CODE_BASE } from './waiterpad-evidence';
import { parseWaiterPadXml, WaiterPadXmlError, type XmlElement } from './waiterpad-xml';

/**
 * The packet was accepted into the till's IN-MEMORY buffer.
 *
 * NOT: a sale exists. NOT: a line exists. NOT: a kitchen docket was produced.
 * NOT: anything durable happened at all.
 *
 * `CheckWPOrder` sets its result to 1, parks the XML document in a 200-slot
 * module-level array and returns. The database work happens later, in a
 * separate drain loop. If the process dies in between, the round is gone and
 * leaves no trace in any store we can read.
 *
 * Consequently an ACK may only ever move a round to
 * `awaiting_native_confirmation`. It may never confirm one.
 */
export interface WaiterPadAck {
  readonly type: 'ACK';
}

/** The order was refused. No evidence it was buffered. */
export interface WaiterPadNak {
  readonly type: 'NAK';
}

/**
 * The receiver recognised this `<Checksum>` as the last one it accepted from
 * this `<DeviceID>`.
 *
 * Read carefully: this says a packet with the same checksum was accepted
 * BEFORE. It does not say the resulting sale exists now, or that it contained
 * what we think, or that it was ours. The guard is one-deep and the comparison
 * is a plain string equality against a single stored value.
 *
 * So DUPLICATE is not success. It is a reason to read the table back.
 */
export interface WaiterPadDuplicate {
  readonly type: 'DUPLICATE';
}

/** The device is not registered with the POS. */
export interface WaiterPadNakRego {
  readonly type: 'NAKREGO';
  /** Undecoded body, retained verbatim for evidence. */
  readonly body: string;
}

/** A bill print was refused. Only reachable from PRINTBILL. */
export interface WaiterPadNakPrint {
  readonly type: 'NAKPRINT';
  readonly body: string;
}

/**
 * The table is held by another terminal.
 *
 * The wire form is `LOCK` + (12000 + posNumber). The check that produces it
 * runs BEFORE the buffering step, so a LOCK is the one non-ACK outcome where
 * we have positive evidence the packet was not taken.
 *
 * This is a retryable condition — but nothing in this codebase retries it
 * automatically tonight.
 */
export interface WaiterPadLock {
  readonly type: 'LOCK';
  /** The raw code as sent, e.g. 12002. */
  readonly lockCode: number;
  /** The holding terminal, i.e. `lockCode - 12000`. */
  readonly posNumber: number;
}

export type WaiterPadResponse =
  | WaiterPadAck
  | WaiterPadNak
  | WaiterPadDuplicate
  | WaiterPadNakRego
  | WaiterPadNakPrint
  | WaiterPadLock;

export type WaiterPadResponseParse =
  | { readonly ok: true; readonly response: WaiterPadResponse }
  | {
      readonly ok: false;
      /** Machine-readable reason, for metrics and for tests. */
      readonly reason:
        | 'not_xml'
        | 'wrong_root'
        | 'missing_type'
        | 'unknown_type'
        | 'malformed_lock'
        | 'empty_input';
      readonly detail: string;
      /** The raw input, truncated, so an operator can see what arrived. */
      readonly raw: string;
    };

const MAX_RETAINED_RAW = 512;

function truncate(raw: string): string {
  return raw.length <= MAX_RETAINED_RAW ? raw : `${raw.slice(0, MAX_RETAINED_RAW)}…`;
}

function fail(
  reason: Extract<WaiterPadResponseParse, { ok: false }>['reason'],
  detail: string,
  raw: string,
): WaiterPadResponseParse {
  return { ok: false, reason, detail, raw: truncate(raw) };
}

/** Inner text of an element and its descendants, for the undecoded NAK bodies. */
function innerText(el: XmlElement): string {
  const parts: string[] = [el.text];
  for (const child of el.children) parts.push(innerText(child));
  return parts.join('').trim();
}

/**
 * Parse one response document.
 *
 * Never throws. Every failure is an `ok: false` the caller must handle, which
 * makes it impossible to forget the unknown case with a try/catch that
 * swallows.
 */
export function parseWaiterPadResponse(input: string): WaiterPadResponseParse {
  if (typeof input !== 'string' || input.trim() === '') {
    return fail('empty_input', 'response was empty', typeof input === 'string' ? input : '');
  }

  let root: XmlElement;
  try {
    root = parseWaiterPadXml(input);
  } catch (err) {
    const detail = err instanceof WaiterPadXmlError ? err.message : 'unparseable document';
    return fail('not_xml', detail, input);
  }

  if (root.name !== 'WPPacket') {
    return fail('wrong_root', `root element was '${root.name}', expected 'WPPacket'`, input);
  }

  const rawType = root.attributes['Type'];
  if (rawType === undefined) {
    return fail('missing_type', "root element has no 'Type' attribute", input);
  }
  // The emitter writes `Type = 'ACK'` with spaces around '='; the attribute
  // VALUE itself is never padded in any observed body. Trimming anyway is
  // harmless and guards against a whitespace-tolerant peer.
  const type = rawType.trim();

  switch (type) {
    case 'ACK':
      return { ok: true, response: { type: 'ACK' } };
    case 'NAK':
      return { ok: true, response: { type: 'NAK' } };
    case 'DUPLICATE':
      return { ok: true, response: { type: 'DUPLICATE' } };
    case 'NAKREGO':
      return { ok: true, response: { type: 'NAKREGO', body: innerText(root) } };
    case 'NAKPRINT':
      return { ok: true, response: { type: 'NAKPRINT', body: innerText(root) } };
    default:
      break;
  }

  if (type.startsWith('LOCK')) {
    const suffix = type.slice('LOCK'.length);
    if (!/^\d+$/.test(suffix)) {
      return fail('malformed_lock', `lock code '${suffix}' is not a positive integer`, input);
    }
    const lockCode = Number(suffix);
    // The response site tests strictly greater than 12000, so 12000 itself is
    // not a lock and a POS number is at least 1.
    if (!Number.isSafeInteger(lockCode) || lockCode <= LOCK_CODE_BASE) {
      return fail(
        'malformed_lock',
        `lock code ${lockCode} is not greater than ${LOCK_CODE_BASE}`,
        input,
      );
    }
    return {
      ok: true,
      response: { type: 'LOCK', lockCode, posNumber: lockCode - LOCK_CODE_BASE },
    };
  }

  return fail('unknown_type', `unrecognised response type '${type}'`, input);
}
