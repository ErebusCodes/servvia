import { IncomingMessage } from 'node:http';
import { isLoopbackAddress, trustLoopbackProxies } from './client-ip';

// proxy-addr is what Express computes req.ip with (its own dependency), so
// these cases are Express's behaviour, not a re-implementation of it.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const proxyaddr = require('proxy-addr') as (
  req: IncomingMessage,
  trust: (address: string, hop: number) => boolean,
) => string;

/** Express's req.ip: proxy-addr with the configured trust function. */
function clientIp(socket: string, forwardedFor: string | undefined, hops: number): string {
  const req = {
    socket: { remoteAddress: socket },
    connection: { remoteAddress: socket },
    headers: forwardedFor === undefined ? {} : { 'x-forwarded-for': forwardedFor },
  } as unknown as IncomingMessage;
  return proxyaddr(req, trustLoopbackProxies(hops));
}

describe('client IP behind the venue proxy', () => {
  it('recognises loopback addresses only', () => {
    for (const a of ['127.0.0.1', '127.8.9.10', '::1', '::ffff:127.0.0.1']) {
      expect(isLoopbackAddress(a)).toBe(true);
    }
    for (const a of [
      '192.168.1.20',
      '10.0.0.1',
      '::ffff:192.168.1.20',
      'fe80::1',
      '128.0.0.1',
      '',
    ]) {
      expect(isLoopbackAddress(a)).toBe(false);
    }
  });

  it('believes no forwarding header by default', () => {
    expect(clientIp('::ffff:127.0.0.1', '203.0.113.9', 0)).toBe('::ffff:127.0.0.1');
  });

  it('names the client the local proxy forwarded', () => {
    expect(clientIp('::ffff:127.0.0.1', '192.168.1.20', 1)).toBe('192.168.1.20');
  });

  it('ignores the header of a client that connects directly, whatever the hop budget', () => {
    expect(clientIp('192.168.1.20', '203.0.113.9', 1)).toBe('192.168.1.20');
    expect(clientIp('192.168.1.20', '127.0.0.1, 203.0.113.9', 5)).toBe('192.168.1.20');
  });

  it('stops at the first forwarded address that is not a loopback proxy', () => {
    // A client behind the local proxy cannot extend the chain with forged hops.
    expect(clientIp('127.0.0.1', '203.0.113.9, 192.168.1.20', 3)).toBe('192.168.1.20');
  });
});
