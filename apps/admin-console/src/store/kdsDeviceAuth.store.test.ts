import { describe, it, expect } from 'vitest';
import { isKdsDeviceTokenValid } from './kdsDeviceAuth.store';

describe('isKdsDeviceTokenValid', () => {
  const baseState = { accessToken: 'token', venueId: 'venue-1', expiresAt: Date.now() + 60_000 };

  it('is valid for a matching venue with a future expiry', () => {
    expect(isKdsDeviceTokenValid(baseState as never, 'venue-1')).toBe(true);
  });

  it('is invalid when there is no token', () => {
    expect(isKdsDeviceTokenValid({ ...baseState, accessToken: null } as never, 'venue-1')).toBe(false);
  });

  it('is invalid for a different venue (device tokens do not cross venues)', () => {
    expect(isKdsDeviceTokenValid(baseState as never, 'someone-elses-venue')).toBe(false);
  });

  it('is invalid once the token has expired', () => {
    expect(
      isKdsDeviceTokenValid({ ...baseState, expiresAt: Date.now() - 1000 } as never, 'venue-1'),
    ).toBe(false);
  });
});
