/**
 * A deterministic stand-in for the IdealPOS handheld listener on 6983.
 *
 * TEST-ONLY, and it lives under `testing/` so it is obvious it is not part of
 * the shipped path. It exists because the real receiver is a live restaurant
 * till: every behaviour we must handle - a NAK for a fragment of an accepted
 * order, an ACK then an immediate disconnect, a reset mid-write - is either
 * unreproducible or unsafe to reproduce there.
 *
 * The scripted behaviours mirror what the venue's till was actually observed
 * doing, plus the failure modes the transport must survive.
 */

import { createServer, type Server, type Socket } from 'node:net';

export const ACK_BODY = "<?xml version='1.0' encoding='utf-8' ?><WPPacket Type = 'ACK'></WPPacket>";
export const NAK_BODY = "<?xml version='1.0' encoding='utf-8' ?><WPPacket Type = 'NAK'></WPPacket>";
export const NAKREGO_BODY =
  "<?xml version='1.0' encoding='utf-8' ?><WPPacket Type = 'NAKREGO'></WPPacket>";

export type FakeBehaviour =
  /** Reply ACK once the request looks complete. */
  | { readonly kind: 'ack' }
  | { readonly kind: 'nak' }
  /** What the real till did to Verdura on 2026-09-09: refuse registration. */
  | { readonly kind: 'nakrego' }
  | { readonly kind: 'delayedAck'; readonly delayMs: number }
  /** Reply, then drop the connection immediately. */
  | { readonly kind: 'ackThenDisconnect' }
  /** Well-formed XML, meaningless content. */
  | { readonly kind: 'malformedXml' }
  /** Half a reply, then silence. */
  | { readonly kind: 'truncated' }
  /** Accept the bytes and say nothing at all. */
  | { readonly kind: 'silent' }
  /** Destroy the socket the moment it is accepted, before we can write. */
  | { readonly kind: 'resetOnConnect' }
  /** Read the request, then destroy without replying. */
  | { readonly kind: 'resetAfterRequest' };

export interface FakeWaiterPadServer {
  readonly port: number;
  /** Every complete request body the server received, in order. */
  readonly requests: readonly string[];
  /** How many TCP connections were accepted. */
  readonly connections: number;
  close(): Promise<void>;
}

/**
 * Start a fake listener on an ephemeral port.
 *
 * `requests` is the assertion surface that matters most: a test proving
 * "exactly one send" asserts `requests.length === 1` AND
 * `connections === 1`, which together rule out a silent reconnect.
 */
export async function startFakeWaiterPadServer(
  behaviour: FakeBehaviour,
): Promise<FakeWaiterPadServer> {
  const requests: string[] = [];
  let connections = 0;

  const server: Server = createServer((socket: Socket) => {
    connections += 1;

    if (behaviour.kind === 'resetOnConnect') {
      socket.destroy();
      return;
    }

    let buffer = '';
    let answered = false;

    const reply = (body: string, thenClose = true): void => {
      if (answered) return;
      answered = true;
      socket.write(body, () => {
        if (thenClose) socket.end();
      });
    };

    socket.on('data', (d: Buffer) => {
      buffer += d.toString('utf8');
      if (!buffer.includes('</WPPacket>')) return;
      requests.push(buffer);

      switch (behaviour.kind) {
        case 'ack':
          reply(ACK_BODY);
          break;
        case 'nak':
          reply(NAK_BODY);
          break;
        case 'nakrego':
          reply(NAKREGO_BODY);
          break;
        case 'delayedAck':
          setTimeout(() => reply(ACK_BODY), behaviour.delayMs);
          break;
        case 'ackThenDisconnect':
          answered = true;
          socket.write(ACK_BODY);
          socket.destroy();
          break;
        case 'malformedXml':
          reply('<?xml version="1.0"?><NotAPacket><Type>ACK</Type></NotAPacket>');
          break;
        case 'truncated':
          answered = true;
          socket.write("<?xml version='1.0' encoding='utf-8' ?><WPPacket Type = 'A");
          break;
        case 'silent':
          break;
        case 'resetAfterRequest':
          socket.destroy();
          break;
        default:
          break;
      }
    });

    socket.on('error', () => {
      /* a reset from our own side is expected in several scripts */
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('fake server did not bind a TCP port');
  }

  return {
    port: address.port,
    get requests() {
      return requests;
    },
    get connections() {
      return connections;
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}
