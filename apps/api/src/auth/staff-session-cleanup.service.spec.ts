import { ConfigService } from '@nestjs/config';
import {
  STAFF_SESSION_CLEANUP_INTERVAL_MS,
  StaffSessionCleanupService,
} from './staff-session-cleanup.service';
import { StaffSessionService } from './staff-session.service';

describe('StaffSessionCleanupService (Story 2.8)', () => {
  const sessions = { deleteExpired: jest.fn() };
  const make = (nodeEnv: string) =>
    new StaffSessionCleanupService(
      sessions as unknown as StaffSessionService,
      { get: jest.fn(() => nodeEnv) } as unknown as ConfigService,
    );

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });
  afterEach(() => jest.useRealTimers());

  it('deletes expired sessions on its interval outside tests', async () => {
    sessions.deleteExpired.mockResolvedValue(1);
    const cleanup = make('production');
    cleanup.onModuleInit();
    await jest.advanceTimersByTimeAsync(STAFF_SESSION_CLEANUP_INTERVAL_MS);
    expect(sessions.deleteExpired).toHaveBeenCalledTimes(1);
    cleanup.onModuleDestroy();
    await jest.advanceTimersByTimeAsync(STAFF_SESSION_CLEANUP_INTERVAL_MS * 2);
    expect(sessions.deleteExpired).toHaveBeenCalledTimes(1);
  });

  it('runs no timer under NODE_ENV=test', async () => {
    make('test').onModuleInit();
    await jest.advanceTimersByTimeAsync(STAFF_SESSION_CLEANUP_INTERVAL_MS * 2);
    expect(sessions.deleteExpired).not.toHaveBeenCalled();
  });

  it('a failed cleanup is logged, never thrown', async () => {
    sessions.deleteExpired.mockRejectedValue(new Error('connection refused'));
    await expect(make('production').runOnce()).resolves.toBe(0);
  });
});
