/**
 * The WaiterPad checksum — an abstraction with no implementation, on purpose.
 *
 * THE FINDING. Static analysis answered a narrower question than the one we
 * need. What IPS.exe does with `<Checksum>` is settled: it stores the last
 * value it accepted per `DeviceID` in a database row and compares the next
 * arrival to it with plain string equality. It never recomputes it, never
 * validates it against the packet body, and contains no checksum routine on
 * the WaiterPad path at all.
 *
 * What produces that value is a different question, and it is NOT SHOWN. The
 * generating side is the vendor's Ideal Handheld application, which is not
 * installed on either INSPECTED WINDOWS POS MACHINE; `MTIPADLIB.dll` was
 * checked and holds only device-connection handlers.
 *
 * That wording is deliberate. Front runtime evidence includes a physical
 * Idealpos-branded handheld / PROTOCOL2 device. The generator plainly runs
 * somewhere — on that device. "Not installed on either Windows machine we
 * inspected" is the true claim; "does not exist at this venue" is not, and
 * must never be written here.
 *
 * WHY "THE RECEIVER TREATS IT OPAQUELY" IS NOT A LICENCE TO INVENT ONE.
 * It is tempting to reason: the receiver only does string equality, therefore
 * any deterministic string is a valid checksum, therefore ship a hash. That
 * argument is unsound in three places, and each one is enough on its own:
 *
 *   1. It generalises one traced path to the protocol. We decoded the socket
 *      ORDER path on this build. The POSServerMessages relay path, the
 *      PROTOCOL2 variant, other builds and the vendor's own device were not
 *      traced. A consumer that does validate the value would reject or, worse,
 *      silently mis-handle ours.
 *   2. Collision semantics are the vendor's to define, not ours. The guard is
 *      one-deep per device: it compares against the single most recent
 *      accepted value. Whatever invariant the real device relies on for that
 *      to be sufficient is unknown, and a hash chosen by us encodes our guess
 *      about it.
 *   3. A wrong guess fails in the direction that hurts. The failure is not a
 *      rejected packet — it is a duplicate round accepted, which puts a second
 *      copy of a table's food in a kitchen.
 *
 * So this module defines the TYPE and the SEAM and stops there. There is no
 * default provider. The only provider that ships fails closed.
 *
 * WHAT WOULD RESOLVE IT. One genuine successful order captured from Front /
 * Machine 2's `Ideal Handheld.log`, with the packet body it corresponds to.
 * That gives a value and its input, which is a test vector. Several give the
 * algorithm. Until then this stays unimplemented.
 *
 * THE LINE TO GREP FOR, established 2026-09-07 (`CHECKSUM_LOG_LINE_EVIDENCE`).
 * `CheckWPOrder` logs every non-empty checksum it receives, verbatim, as
 * `Checksum=<value>  DeviceID=<value>` into the `Ideal Handheld` log, before
 * it decides anything about the packet. So the value half of a test vector is
 * a grep away in a file the Front capture already collects. The line does not
 * carry the order body, so it is half a vector: pairing it with the round that
 * produced it is the unproven step, and it is what tomorrow must establish.
 */

import { CHECKSUM_ALGORITHM_EVIDENCE } from './waiterpad-evidence';

declare const WAITERPAD_CHECKSUM_BRAND: unique symbol;

/**
 * A checksum whose provenance is a real WaiterPad generator.
 *
 * Branded so it cannot be produced by writing a string literal. The only way
 * to obtain one is through a `WaiterPadChecksumProvider`, and no provider that
 * can actually return one exists yet.
 */
export type WaiterPadChecksum = string & { readonly [WAITERPAD_CHECKSUM_BRAND]: true };

/** The inputs any future generator will be a function of. */
export interface ChecksumInputs {
  /** The stable device identity this submission is made under. */
  readonly deviceId: string;
  /** The immutable round identity, minted when the round was opened. */
  readonly roundIdempotencyKey: string;
  /** The exact serialised order packet body the checksum accompanies. */
  readonly serialisedOrderPacket: string;
}

export class WaiterPadChecksumUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WaiterPadChecksumUnavailableError';
  }
}

/**
 * The seam. Implement this ONLY against captured evidence, and ship the
 * implementation with test vectors taken from real observed packets.
 */
export interface WaiterPadChecksumProvider {
  /** A short identifier recorded alongside anything this provider signs. */
  readonly providerId: string;
  /**
   * True only when this provider's algorithm is backed by observed evidence.
   * The submission path refuses to build a checksummed packet otherwise.
   */
  readonly isEvidenceBacked: boolean;
  generate(inputs: ChecksumInputs): WaiterPadChecksum;
}

/**
 * The only provider that exists. It always throws.
 *
 * This is not a placeholder to be quietly replaced with a hash. Replacing it
 * requires the evidence named in the module comment.
 */
export class UnresolvedChecksumProvider implements WaiterPadChecksumProvider {
  readonly providerId = 'unresolved';
  readonly isEvidenceBacked = false;

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  generate(inputs: ChecksumInputs): WaiterPadChecksum {
    throw new WaiterPadChecksumUnavailableError(
      'The WaiterPad checksum generation algorithm is NOT SHOWN ' +
        `(evidence grade: ${CHECKSUM_ALGORITHM_EVIDENCE.grade}). ` +
        'IPS.exe only compares the value; no generator has been identified in ' +
        'it, and the vendor generating application is not installed on either ' +
        'inspected Windows POS machine. ' +
        "Resolve it from a genuine order in Front / Machine 2's " +
        '"Ideal Handheld.log" before implementing a provider. A deterministic ' +
        'Verdura hash is not a WaiterPad checksum.',
    );
  }
}

/**
 * Guard for the submission path: refuse to proceed with a provider whose
 * algorithm is not evidence-backed, before any packet is built.
 */
export function assertChecksumProviderUsable(
  provider: WaiterPadChecksumProvider,
): asserts provider is WaiterPadChecksumProvider {
  if (!provider.isEvidenceBacked) {
    throw new WaiterPadChecksumUnavailableError(
      `checksum provider '${provider.providerId}' is not evidence-backed; ` +
        'WaiterPad submission is blocked',
    );
  }
}

/**
 * Accept a checksum observed on the wire or read out of a captured log.
 *
 * This is the ONE way to obtain the branded type without a generator, and it
 * exists for exactly two uses: parsing evidence, and test vectors. It performs
 * no validation of meaning because we have none to perform — it only rejects
 * values the protocol could not carry.
 */
export function checksumFromObservedEvidence(value: string): WaiterPadChecksum {
  if (typeof value !== 'string' || value.length === 0) {
    throw new WaiterPadChecksumUnavailableError('observed checksum must be a non-empty string');
  }
  if (value.length > 128) {
    throw new WaiterPadChecksumUnavailableError('observed checksum is implausibly long');
  }
  if (/[<>&'"]/.test(value)) {
    throw new WaiterPadChecksumUnavailableError(
      'observed checksum contains XML metacharacters; refusing rather than escaping, ' +
        'because no observed checksum has ever contained one',
    );
  }
  return value as WaiterPadChecksum;
}
