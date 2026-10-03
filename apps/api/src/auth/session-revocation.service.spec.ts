import { REVOKED_SESSION_KEY_PREFIX, SessionRevocationService } from './session-revocation.service';
import Redis from 'ioredis';

describe('SessionRevocationService', () => {
  const redis = { set: jest.fn(), exists: jest.fn() };
  const service = new SessionRevocationService(redis as unknown as Redis);

  beforeEach(() => jest.clearAllMocks());

  it('uses the key prefix the Go Core reads (identity.RevokedSessionKeyPrefix)', () => {
    expect(REVOKED_SESSION_KEY_PREFIX).toBe('auth:revoked-session:');
  });

  it('revoke writes the key with an expiry of at least one second', async () => {
    await service.revoke('session-uuid', 604800);
    expect(redis.set).toHaveBeenCalledWith('auth:revoked-session:session-uuid', '1', 'EX', 604800);
    await service.revoke('session-uuid', 0.2);
    expect(redis.set).toHaveBeenLastCalledWith('auth:revoked-session:session-uuid', '1', 'EX', 1);
  });

  it('isRevoked reports whether the key exists', async () => {
    redis.exists.mockResolvedValueOnce(1).mockResolvedValueOnce(0);
    await expect(service.isRevoked('a')).resolves.toBe(true);
    await expect(service.isRevoked('b')).resolves.toBe(false);
    expect(redis.exists).toHaveBeenCalledWith('auth:revoked-session:a');
  });

  it('propagates Redis errors so callers fail closed', async () => {
    redis.exists.mockRejectedValueOnce(new Error('Command timed out'));
    await expect(service.isRevoked('a')).rejects.toThrow('Command timed out');
  });
});
