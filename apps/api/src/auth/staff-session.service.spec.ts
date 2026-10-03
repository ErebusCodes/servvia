import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { EXPIRED_SESSION_RETENTION_MS, StaffSessionService } from './staff-session.service';

describe('StaffSessionService (Story 2.8)', () => {
  const prisma = {
    staffSession: {
      create: jest.fn(),
      count: jest.fn(),
      updateMany: jest.fn(),
      deleteMany: jest.fn(),
    },
  };
  const config = { get: jest.fn((key: string, def: string) => def) };
  const service = new StaffSessionService(
    prisma as unknown as PrismaService,
    config as unknown as ConfigService,
  );
  const now = new Date('2026-10-03T00:00:00Z');

  beforeEach(() => jest.clearAllMocks());

  it('starts a session that expires with the refresh token lifetime', async () => {
    prisma.staffSession.create.mockResolvedValue({ id: 'session-1' });
    await expect(service.start('staff-1', now)).resolves.toBe('session-1');
    expect(prisma.staffSession.create).toHaveBeenCalledWith({
      data: { staffId: 'staff-1', expiresAt: new Date(now.getTime() + 7 * 24 * 3600 * 1000) },
      select: { id: true },
    });
  });

  it('a session is live only for its own staff member, unrevoked and unexpired', async () => {
    prisma.staffSession.count.mockResolvedValueOnce(1).mockResolvedValueOnce(0);
    await expect(service.isLive('session-1', 'staff-1', now)).resolves.toBe(true);
    await expect(service.isLive('session-1', 'staff-2', now)).resolves.toBe(false);
    expect(prisma.staffSession.count).toHaveBeenCalledWith({
      where: { id: 'session-1', staffId: 'staff-1', revokedAt: null, expiresAt: { gt: now } },
    });
  });

  it('revocation is idempotent: only an unrevoked row is changed', async () => {
    prisma.staffSession.updateMany.mockResolvedValue({ count: 0 });
    await service.revoke('session-1', 'staff-1', 'logout');
    expect(prisma.staffSession.updateMany).toHaveBeenCalledWith({
      where: { id: 'session-1', staffId: 'staff-1', revokedAt: null },
      data: { revokedAt: expect.any(Date), revokedReason: 'logout' },
    });
  });

  it('revokes every live session of a staff member', async () => {
    prisma.staffSession.updateMany.mockResolvedValue({ count: 3 });
    await expect(service.revokeAllForStaff('staff-1', 'credential_reset')).resolves.toBe(3);
    expect(prisma.staffSession.updateMany).toHaveBeenCalledWith({
      where: { staffId: 'staff-1', revokedAt: null },
      data: { revokedAt: expect.any(Date), revokedReason: 'credential_reset' },
    });
  });

  it('deletes only sessions expired longer than the retention margin', async () => {
    prisma.staffSession.deleteMany.mockResolvedValue({ count: 2 });
    await expect(service.deleteExpired(now)).resolves.toBe(2);
    expect(prisma.staffSession.deleteMany).toHaveBeenCalledWith({
      where: { expiresAt: { lt: new Date(now.getTime() - EXPIRED_SESSION_RETENTION_MS) } },
    });
  });

  it('propagates database errors so callers fail closed', async () => {
    prisma.staffSession.count.mockRejectedValue(new Error('connection refused'));
    await expect(service.isLive('session-1', 'staff-1')).rejects.toThrow('connection refused');
  });
});
