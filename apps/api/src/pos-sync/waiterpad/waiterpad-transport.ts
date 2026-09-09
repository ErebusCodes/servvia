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

    const timers: NodeJS.Timeout[] = [];
    const clearTimers = (): void => {
      for (const t of timers) clearTimeout(t);
      timers.length = 0;
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

    timers.push(
      setTimeout(() => {
        if (wrote) settleAfterWrite('connect/write deadline elapsed after write');
        else
          settle({
            kind: 'failedBeforeSend',
            bytesLeftHost: false,
            detail: 'connect timeout',
            elapsedMs: since(),
          });
      }, target.timeouts.connectMs),
    );

    socket.on('connect', () => {
      // Mark BEFORE write(): once the syscall is issued we can no longer prove
      // that nothing reached the till.
      wrote = true;
      socket.write(bytes);
      timers.push(
        setTimeout(() => settleAfterWrite('read deadline elapsed'), target.timeouts.readMs),
      );
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
