import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { StaffSessionOnlyGuard } from './staff-session-only.guard';

function contextWithUser(user: unknown): ExecutionContext {
  return { switchToHttp: () => ({ getRequest: () => ({ user }) }) } as unknown as ExecutionContext;
}

describe('StaffSessionOnlyGuard', () => {
  const guard = new StaffSessionOnlyGuard();

  it('accepts a genuine staff session (kind undefined)', () => {
    expect(guard.canActivate(contextWithUser({ id: 's1', kind: undefined }))).toBe(true);
  });

  it('accepts kind "staff" explicitly', () => {
    expect(guard.canActivate(contextWithUser({ id: 's1', kind: 'staff' }))).toBe(true);
  });

  it.each(['kds_device', 'tablet_device', 'tablet_staff', 'tablet_manager'] as const)(
    'rejects a %s token even if its role would otherwise satisfy RolesGuard',
    (kind) => {
      expect(() => guard.canActivate(contextWithUser({ id: 'x', kind, role: 'admin' }))).toThrow(
        ForbiddenException,
      );
    },
  );
});
