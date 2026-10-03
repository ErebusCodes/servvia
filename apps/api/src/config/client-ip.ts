import { isIP } from 'node:net';

/**
 * Which forwarding headers the API believes, and so which address rate
 * limits, audit records and security events name as the client.
 *
 * A forwarded address is believed only from a proxy the API can verify is
 * its own: a loopback peer (the venue's static proxy runs on the same host,
 * windows-deploy/static-proxy-server.mjs, and writes X-Forwarded-For itself),
 * and at most TRUST_PROXY_HOPS of them. A client that reaches the API
 * directly is named by its socket address whatever headers it sends, so it
 * cannot choose the address its rate limit is counted against. With
 * TRUST_PROXY_HOPS=0, the default, no forwarding header is believed.
 *
 * Go Core applies the same rule (internal/ratelimit ClientIP), so both
 * services key a client's shared rate-limit budget alike.
 */
export function isLoopbackAddress(address: string): boolean {
  const plain = address.startsWith('::ffff:') ? address.slice('::ffff:'.length) : address;
  if (isIP(plain) === 4) return plain.split('.')[0] === '127';
  return plain === '::1';
}

/** Express `trust proxy`: trust hop `i` only if it is within the budget and on loopback. */
export function trustLoopbackProxies(hops: number): (address: string, hop: number) => boolean {
  return (address, hop) => hop < hops && isLoopbackAddress(address);
}

export function configureTrustProxy(
  expressApp: { set?: (name: string, value: unknown) => void },
  hops: number,
): void {
  expressApp.set?.('trust proxy', trustLoopbackProxies(hops));
}
