/**
 * The one-shot WaiterPad TCP client.
 *
 * THE CENTRAL RULE: this module sends a packet AT MOST ONCE and has no retry
 * path of any kind. There is no loop, no backoff, no reconnect. If you want a
 * second attempt you must persist a new attempt and call again from a layer
 * that made that decision deliberately - because on this protocol a resend is
 * how a customer gets charged twice.
 *
 * WHY THAT IS NOT PARANOIA. Three runtime facts, all from this venue's till:
 *
 *   * ACK is emitted BEFORE durable processing, and is byte-identical to the
 *     ACK for a no-op Test command. It carries no order identity.
 *   * A NAK can arrive for a trailing TCP FRAGMENT of an order that was already
 *     accepted and already printed in the kitchen (2026-09-04 17:15:24).
 *   * The receiver returns ACK even when its 200-slot buffer is full and the
 *     packet was silently dropped (static, 0x01826751).
 *
 * So "no response" and "a discouraging response" both mean UNCERTAIN, not
 * FAILED, once bytes have left. The result type below makes that distinction
 * unavoidable: `bytesLeftHost` is on every outcome, and callers must branch on
 * it rather than on the response alone.
 *
 * The socket is opened only by `sendOrder2Once`. Nothing else in this module
 * tree imports `node:net`.
 *
 * THE TIMER RULE, which is separate from the retry rule and was got wrong once:
 * a deadline may only end the phase it was set for. Connect, write and read are
 * three bounded phases, each disarming its own timer at its own boundary, and
 * at most one is armed at a time. A single shared timer list let the connect
 * deadline stay armed into the response phase and truncate it - see the
 * comment on `connectTimer` for what that cost.
 */

import { createConnection, type Socket } from 'node:net';

import { parseWaiterPadResponse, type WaiterPadResponse } from './waiterpad-response';
import type { WaiterPadTimeouts } from './waiterpad-config';

export class WaiterPadTransportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WaiterPadTransportError';
  }
}

export interface WaiterPadSendTarget {
  readonly host: string;
  readonly port: number;
  readonly timeouts: WaiterPadTimeouts;
}

/**
 * Why a send ended.
 *
 * `bytesLeftHost` is the safety-critical field, not `kind`. It is false ONLY
 * when we can prove nothing was written to the socket - a DNS/connect failure
 * or a pre-write timeout. Everything else is potentially mutating.
 */
export type WaiterPadSendOutcome =
  | {
      readonly kind: 'responded';
      readonly bytesLeftHost: true;
      readonly response: WaiterPadResponse;
      readonly raw: string;
      readonly elapsedMs: number;
    }
  | {
      readonly kind: 'unparseableResponse';
      readonly bytesLeftHost: true;
      readonly raw: string;
      readonly detail: string;
      readonly elapsedMs: number;
    }
  | {
      readonly kind: 'noResponse';
      readonly bytesLeftHost: true;
      readonly detail: string;
      readonly elapsedMs: number;
    }
  | {
      readonly kind: 'failedBeforeSend';
      readonly bytesLeftHost: false;
      readonly detail: string;
      readonly elapsedMs: number;
    };

/** Injectable so tests can drive a fake server without patching globals. */
export interface WaiterPadSocketFactory {
  (host: string, port: number): Socket;
}

const defaultFactory: WaiterPadSocketFactory = (host, port) => createConnection({ host, port });

/**
 * Send one packet, once.
 *
 * The payload is serialised by the caller and passed in complete: this function
 * never builds a packet, so a half-formed order cannot be produced under a
 * timeout. It is encoded UTF-8 exactly as given - the receiver declares
 * `encoding="UTF-8"` and parses the byte stream looking for `</WPPacket>`.
 */
export async function sendOrder2Once(
  payload: string,
  target: WaiterPadSendTarget,
  factory: WaiterPadSocketFactory = defaultFactory,
): Promise<WaiterPadSendOutcome> {
  if (typeof payload !== 'string' || payload.length === 0) {
    throw new WaiterPadTransportError('payload must be a non-empty string');
  }
  const bytes = Buffer.from(payload, 'utf8');
  const started = Date.now();
  const since = (): number => Date.now() - started;

  return await new Promise<WaiterPadSendOutcome>((resolve) => {
    let settled = false;
    let wrote = false;
    const chunks: Buffer[] = [];
    let socket: Socket;

    // ── THREE PHASES, THREE TIMERS, AND AT MOST ONE OF THEM ARMED. ──
    //
    // Held individually rather than in a list, because the bug this shape
    // exists to prevent was a timer that could not be cancelled on its own.
    // The connect deadline used to be pushed onto a shared array and cleared
    // only at settlement, so it stayed armed through the response phase and
    // fired inside it: with connectMs 5000 and readMs 10000, the effective read
    // window was `5000 minus however long connecting took`, and more than half
    // the configured budget was unreachable. A till answering at 6s - ordinary
    // under load - was recorded as `noResponse`, which is UNCERTAIN, which
    // blocks the table for the rest of the service. It failed safe and it
    // failed constantly.
    //
    // Each phase now disarms its own timer at its own boundary, so a deadline
    // can only ever end the phase it was set for.
    let connectTimer: NodeJS.Timeout | null = null;
    let writeTimer: NodeJS.Timeout | null = null;
    let readTimer: NodeJS.Timeout | null = null;

    const disarm = (t: NodeJS.Timeout | null): null => {
      if (t) clearTimeout(t);
      return null;
    };
    const clearTimers = (): void => {
      connectTimer = disarm(connectTimer);
      writeTimer = disarm(writeTimer);
      readTimer = disarm(readTimer);
    };

    const settle = (outcome: WaiterPadSendOutcome): void => {
      if (settled) return;
      settled = true;
      clearTimers();
      try {
        socket.destroy();
      } catch {
        /* already gone */
      }
      resolve(outcome);
    };

    /** Anything after the first byte is written is UNCERTAIN, never failed. */
    const settleAfterWrite = (detail: string): void => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (raw.length === 0) {
        settle({ kind: 'noResponse', bytesLeftHost: true, detail, elapsedMs: since() });
        return;
      }
      finishWithRaw(raw);
    };

    const finishWithRaw = (raw: string): void => {
      const parsed = parseWaiterPadResponse(raw);
      if (parsed.ok) {
        settle({
          kind: 'responded',
          bytesLeftHost: true,
          response: parsed.response,
          raw,
          elapsedMs: since(),
        });
      } else {
        settle({
          kind: 'unparseableResponse',
          bytesLeftHost: true,
          raw,
          detail: parsed.reason ?? 'unparseable',
          elapsedMs: since(),
        });
      }
    };

    try {
      socket = factory(target.host, target.port);
    } catch (err) {
      resolve({
        kind: 'failedBeforeSend',
        bytesLeftHost: false,
        detail: err instanceof Error ? err.message : 'connect threw',
        elapsedMs: since(),
      });
      return;
    }

    socket.setNoDelay(true);

    // ── PHASE 1: CONNECT. ──
    //
    // The only phase whose deadline may report `failedBeforeSend`, because it
    // is the only one that runs while nothing can have been written. The
    // `wrote` guard is belt-and-braces: this timer is disarmed the instant the
    // socket connects, so it cannot reach a state where bytes have gone - but
    // if it somehow did, answering `failedBeforeSend` would license a resend of
    // an order that may be in the kitchen, so the safe branch stays.
    connectTimer = setTimeout(() => {
      connectTimer = null;
      if (wrote) settleAfterWrite('connect deadline elapsed after write');
      else
        settle({
          kind: 'failedBeforeSend',
          bytesLeftHost: false,
          detail: 'connect timeout',
          elapsedMs: since(),
        });
    }, target.timeouts.connectMs);

    socket.on('connect', () => {
      // THE FIX. Connected, so the connect deadline is spent and must not be
      // able to end any later phase.
      connectTimer = disarm(connectTimer);

      // Mark BEFORE write(): once the syscall is issued we can no longer prove
      // that nothing reached the till.
      wrote = true;

      // ── PHASE 2: WRITE. ──
      //
      // Bounded separately because a peer that accepts a connection and then
      // stops reading stalls here rather than in the read phase, and the two
      // want different numbers. `writeMs` was configured, validated and bounded
      // long before anything consumed it; this is where it starts meaning
      // something. Its deadline is UNCERTAIN, never failure - `wrote` is
      // already true.
      writeTimer = setTimeout(() => {
        writeTimer = null;
        settleAfterWrite('write deadline elapsed');
      }, target.timeouts.writeMs);

      socket.write(bytes, () => {
        // Flushed to the kernel. Nothing to do if the exchange already ended -
        // a reply can beat this callback, and re-arming a timer on a settled
        // promise would leave a handle behind.
        if (settled) return;
        writeTimer = disarm(writeTimer);

        // ── PHASE 3: READ. ──
        //
        // Starts at the write boundary, which is what makes `readMs` the real
        // budget for the till's answer rather than a number the connect
        // deadline quietly overrode.
        readTimer = setTimeout(() => {
          readTimer = null;
          settleAfterWrite('read deadline elapsed');
        }, target.timeouts.readMs);
      });
    });

    socket.on('data', (d: Buffer) => {
      chunks.push(d);
      // The receiver's replies are single small packets terminated by
      // </WPPacket>. Settle as soon as one is complete rather than waiting out
      // the read deadline.
      const raw = Buffer.concat(chunks).toString('utf8');
      if (raw.includes('</WPPacket>')) finishWithRaw(raw);
    });

    socket.on('error', (err: Error) => {
      if (wrote) settleAfterWrite(`socket error after write: ${err.message}`);
      else
        settle({
          kind: 'failedBeforeSend',
          bytesLeftHost: false,
          detail: `socket error before write: ${err.message}`,
          elapsedMs: since(),
        });
    });

    socket.on('close', () => {
      if (wrote) settleAfterWrite('closed');
      else
        settle({
          kind: 'failedBeforeSend',
          bytesLeftHost: false,
          detail: 'closed before write',
          elapsedMs: since(),
        });
    });
  });
}
