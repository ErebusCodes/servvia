import { Test, TestingModule } from '@nestjs/testing';
import { HealthService } from './health.service';
import { PrismaService } from '../prisma/prisma.service';

describe('HealthService', () => {
  let service: HealthService;
  let prisma: { $queryRaw: jest.Mock };
  let redisPing: jest.Mock;

  beforeEach(async () => {
    prisma = { $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]) };
    redisPing = jest.fn().mockResolvedValue('PONG');

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HealthService,
        { provide: PrismaService, useValue: prisma },
        { provide: 'HEALTH_REDIS', useValue: { ping: redisPing } },
      ],
    }).compile();

    service = module.get<HealthService>(HealthService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('returns { status: "ok", db: "ok", redis: "ok" } when both probes succeed', async () => {
    const result = await service.check();

    expect(result).toEqual({ status: 'ok', db: 'ok', redis: 'ok' });
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(redisPing).toHaveBeenCalledTimes(1);
  });

  it('returns { status: "degraded", db: "error", redis: "ok" } when DB is down', async () => {
    prisma.$queryRaw.mockRejectedValue(new Error('connection refused'));

    const result = await service.check();

    expect(result).toEqual({ status: 'degraded', db: 'error', redis: 'ok' });
  });

  it('returns { status: "degraded", db: "ok", redis: "error" } when Redis is down', async () => {
    redisPing.mockRejectedValue(new Error('Redis connection failed'));

    const result = await service.check();

    expect(result).toEqual({ status: 'degraded', db: 'ok', redis: 'error' });
  });
});
