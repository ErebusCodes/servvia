import { timingSafeEqual } from 'crypto';

/**
 * Constant-time string comparison for secrets (service tokens, PINs). Avoids
 * leaking length/prefix information via `!==`/`===` short-circuit timing.
 */
export function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    // Still do a comparison of equal-length buffers so the function's timing
    // doesn't trivially reveal a length mismatch on the fast path.
    timingSafeEqual(bufA, bufA);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}
