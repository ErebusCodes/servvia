import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { KdsAuthService } from './kds-auth.service';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';

const VENUE_ID = '11111111-1111-1111-1111-111111111111';

const mockConfigService = {
  get: jest.fn(),
};

const mockPrismaService = {
  venue: {
    findUnique: jest.fn(),
  },
};

const mockAuthService = {
  signKdsDeviceToken: jest.fn(),
};

describe('KdsAuthService', () => {
  let service: KdsAuthService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        KdsAuthService,
        { provide: ConfigService, useValue: mockConfigService },
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: AuthService, useValue: mockAuthService },
      ],
    }).compile();
    service = module.get<KdsAuthService>(KdsAuthService);
  });

  it('fails closed when KDS_VENUE_PINS is not configured at all', async () => {
    mockConfigService.get.mockImplementation((key: string) =>
      key === 'KDS_VENUE_PINS' ? undefined : undefined,
    );
    await expect(service.authenticate(VENUE_ID, 'any-pin')).rejects.toThrow(UnauthorizedException);
    expect(mockAuthService.signKdsDeviceToken).not.toHaveBeenCalled();
  });

  it('fails closed when KDS_VENUE_PINS is malformed JSON', async () => {
    mockConfigService.get.mockImplementation((key: string) =>
      key === 'KDS_VENUE_PINS' ? '{not-json' : undefined,
    );
    await expect(service.authenticate(VENUE_ID, 'any-pin')).rejects.toThrow(UnauthorizedException);
  });

  it('fails closed when the venue has no configured PIN', async () => {
    mockConfigService.get.mockImplementation((key: string) =>
      key === 'KDS_VENUE_PINS' ? JSON.stringify({ 'other-venue': '1234' }) : undefined,
    );
    await expect(service.authenticate(VENUE_ID, '1234')).rejects.toThrow(UnauthorizedException);
  });

  it('rejects an incorrect PIN for a configured venue', async () => {
    mockConfigService.get.mockImplementation((key: string) =>
      key === 'KDS_VENUE_PINS' ? JSON.stringify({ [VENUE_ID]: '1234' }) : undefined,
    );
    await expect(service.authenticate(VENUE_ID, '9999')).rejects.toThrow(UnauthorizedException);
    expect(mockAuthService.signKdsDeviceToken).not.toHaveBeenCalled();
  });

  it('rejects a correct PIN if the venue does not exist', async () => {
    mockConfigService.get.mockImplementation((key: string) =>
      key === 'KDS_VENUE_PINS' ? JSON.stringify({ [VENUE_ID]: '1234' }) : undefined,
    );
    mockPrismaService.venue.findUnique.mockResolvedValue(null);
    await expect(service.authenticate(VENUE_ID, '1234')).rejects.toThrow(UnauthorizedException);
  });

  it('rejects a correct PIN if the venue is inactive', async () => {
    mockConfigService.get.mockImplementation((key: string) =>
      key === 'KDS_VENUE_PINS' ? JSON.stringify({ [VENUE_ID]: '1234' }) : undefined,
    );
    mockPrismaService.venue.findUnique.mockResolvedValue({
      id: VENUE_ID,
      organizationId: 'org-1',
      isActive: false,
    });
    await expect(service.authenticate(VENUE_ID, '1234')).rejects.toThrow(UnauthorizedException);
  });

  it('mints a device token for a correct PIN and active venue', async () => {
    mockConfigService.get.mockImplementation((key: string, fallback?: string) => {
      if (key === 'KDS_VENUE_PINS') return JSON.stringify({ [VENUE_ID]: '1234' });
      if (key === 'KDS_TOKEN_EXPIRY') return fallback ?? '12h';
      return fallback;
    });
    mockPrismaService.venue.findUnique.mockResolvedValue({
      id: VENUE_ID,
      organizationId: 'org-1',
      isActive: true,
    });
    mockAuthService.signKdsDeviceToken.mockReturnValue('signed-device-token');

    const result = await service.authenticate(VENUE_ID, '1234');

    expect(mockAuthService.signKdsDeviceToken).toHaveBeenCalledWith(VENUE_ID, 'org-1');
    expect(result).toEqual({ accessToken: 'signed-device-token', expiresIn: '12h' });
  });

  it('mints a device token for the repository-wide local-dev default PIN "108" — this service layer is PIN-length-agnostic, the 4-char production floor lives only in KdsAuthDto/TabletUnlockDto (see pin-length.validator.ts)', async () => {
    mockConfigService.get.mockImplementation((key: string, fallback?: string) => {
      if (key === 'KDS_VENUE_PINS') return JSON.stringify({ [VENUE_ID]: '108' });
      if (key === 'KDS_TOKEN_EXPIRY') return fallback ?? '12h';
      return fallback;
    });
    mockPrismaService.venue.findUnique.mockResolvedValue({
      id: VENUE_ID,
      organizationId: 'org-1',
      isActive: true,
    });
    mockAuthService.signKdsDeviceToken.mockReturnValue('signed-device-token');

    const result = await service.authenticate(VENUE_ID, '108');

    expect(mockAuthService.signKdsDeviceToken).toHaveBeenCalledWith(VENUE_ID, 'org-1');
    expect(result).toEqual({ accessToken: 'signed-device-token', expiresIn: '12h' });
  });
});
