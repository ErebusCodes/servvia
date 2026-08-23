import { JwtRefreshGuard } from './jwt-refresh.guard';

describe('JwtRefreshGuard', () => {
  it('should be defined', () => {
    const guard = new JwtRefreshGuard();
    expect(guard).toBeDefined();
  });
});
