interface JwtPayload {
  sub: string;
  email: string;
  role: string;
  iat?: number;
  exp?: number;
}

export function decodeJwtPayload(token: string): JwtPayload | null {
  try {
    const parts = token.split('.');
    const payloadPart = parts[1];
    if (parts.length !== 3 || !payloadPart) return null;
    // Convert Base64url → Base64, then add required '=' padding.
    // JWT payloads are unpadded by spec (RFC 7515); atob() requires padding.
    const b64 = payloadPart.replace(/-/g, '+').replace(/_/g, '/');
    const json = atob(b64.padEnd(b64.length + (4 - (b64.length % 4)) % 4, '='));
    const parsed: unknown = JSON.parse(json);
    if (
      parsed === null ||
      typeof parsed !== 'object' ||
      typeof (parsed as Record<string, unknown>)['sub'] !== 'string' ||
      typeof (parsed as Record<string, unknown>)['email'] !== 'string' ||
      typeof (parsed as Record<string, unknown>)['role'] !== 'string'
    ) {
      return null;
    }
    return parsed as JwtPayload;
  } catch {
    return null;
  }
}
