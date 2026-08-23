import { ExecutionContext, UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { StaffRole } from '@prisma/client';
import { RolesGuard } from './roles.guard';

describe('RolesGuard', () => {
  let guard: RolesGuard;
  let getAllAndOverrideMock: jest.Mock;

  beforeEach(async () => {
    const mockReflector = {
      getAllAndOverride: jest.fn(),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RolesGuard,
        {
          provide: Reflector,
          useValue: mockReflector,
        },
      ],
    }).compile();

    guard = module.get<RolesGuard>(RolesGuard);
    getAllAndOverrideMock = mockReflector.getAllAndOverride;
  });

  const createMockContext = (
    user?: { role: StaffRole | null | undefined },
    contextType: string = 'http',
    hasRequest: boolean = true,
  ): ExecutionContext => {
    const request = hasRequest ? { user } : undefined;
    return {
      getType: () => contextType,
      getHandler: () => 'handler',
      getClass: () => 'class',
      switchToHttp: () => ({
        getRequest: () => request,
      }),
    } as unknown as ExecutionContext;
  };

  it('allows access when context type is not HTTP', () => {
    const context = createMockContext(undefined, 'ws');
    expect(guard.canActivate(context)).toBe(true);
    expect(getAllAndOverrideMock).not.toHaveBeenCalled();
  });

  it('allows access when no roles are defined', () => {
    getAllAndOverrideMock.mockReturnValue(undefined);
    const context = createMockContext();
    expect(guard.canActivate(context)).toBe(true);
    expect(getAllAndOverrideMock).toHaveBeenCalledWith('roles', ['handler', 'class']);
  });

  it('allows access when metadata roles is not an array', () => {
    getAllAndOverrideMock.mockReturnValue('admin'); // malformed
    const context = createMockContext();
    expect(guard.canActivate(context)).toBe(true);
  });

  it('allows access when required roles matches user role', () => {
    getAllAndOverrideMock.mockReturnValue([StaffRole.admin]);
    const context = createMockContext({ role: StaffRole.admin });
    expect(guard.canActivate(context)).toBe(true);
    expect(getAllAndOverrideMock).toHaveBeenCalledWith('roles', ['handler', 'class']);
  });

  it('allows access for owner even if they do not explicitly match required roles', () => {
    getAllAndOverrideMock.mockReturnValue([StaffRole.admin]);
    const context = createMockContext({ role: StaffRole.owner });
    expect(guard.canActivate(context)).toBe(true);
  });

  it('throws UnauthorizedException when request object is missing', () => {
    getAllAndOverrideMock.mockReturnValue([StaffRole.admin]);
    const context = createMockContext(undefined, 'http', false);
    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });

  it('throws UnauthorizedException when req.user is missing', () => {
    getAllAndOverrideMock.mockReturnValue([StaffRole.admin]);
    const context = createMockContext(undefined);
    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });

  it('throws UnauthorizedException when user.role is missing or malformed', () => {
    getAllAndOverrideMock.mockReturnValue([StaffRole.admin]);
    const context = createMockContext({ role: undefined });
    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });

  it('throws ForbiddenException when user role does not match required roles', () => {
    getAllAndOverrideMock.mockReturnValue([StaffRole.admin]);
    const context = createMockContext({ role: StaffRole.cashier });
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });
});
