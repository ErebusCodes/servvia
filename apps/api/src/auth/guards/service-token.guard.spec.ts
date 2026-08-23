import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { ServiceTokenGuard } from './service-token.guard';

const mockConfigService = {
  getOrThrow: jest.fn((key: string) => {
    if (key === 'INTERNAL_SERVICE_TOKEN') {
      return 'correct-test-token-32-characters-long';
    }
    return undefined;
  }),
};

describe('ServiceTokenGuard', () => {
  let guard: ServiceTokenGuard;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [ServiceTokenGuard, { provide: ConfigService, useValue: mockConfigService }],
    }).compile();

    guard = module.get<ServiceTokenGuard>(ServiceTokenGuard);
  });

  it('should be defined', () => {
    expect(guard).toBeDefined();
  });

  it('should allow access with valid token in Authorization header', () => {
    const mockRequest = {
      headers: {
        authorization: 'Bearer correct-test-token-32-characters-long',
      },
    };
    const mockContext = {
      switchToHttp: () => ({
        getRequest: () => mockRequest,
      }),
    } as unknown as ExecutionContext;

    expect(guard.canActivate(mockContext)).toBe(true);
  });

  it('should throw UnauthorizedException when Authorization header is missing', () => {
    const mockRequest = {
      headers: {},
    };
    const mockContext = {
      switchToHttp: () => ({
        getRequest: () => mockRequest,
      }),
    } as unknown as ExecutionContext;

    expect(() => guard.canActivate(mockContext)).toThrow(UnauthorizedException);
  });

  it('should throw UnauthorizedException when token does not match', () => {
    const mockRequest = {
      headers: {
        authorization: 'Bearer wrong-test-token-32-characters-long',
      },
    };
    const mockContext = {
      switchToHttp: () => ({
        getRequest: () => mockRequest,
      }),
    } as unknown as ExecutionContext;

    expect(() => guard.canActivate(mockContext)).toThrow(UnauthorizedException);
  });

  it('should throw UnauthorizedException when header format is invalid', () => {
    const mockRequest = {
      headers: {
        authorization: 'incorrect-format-token',
      },
    };
    const mockContext = {
      switchToHttp: () => ({
        getRequest: () => mockRequest,
      }),
    } as unknown as ExecutionContext;

    expect(() => guard.canActivate(mockContext)).toThrow(UnauthorizedException);
  });
});
