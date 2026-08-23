import { Test, TestingModule } from '@nestjs/testing';
import { Response } from 'express';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

interface MockResponse extends Partial<Response> {
  status: jest.Mock;
  json: jest.Mock;
}

const mockRes = (): MockResponse => {
  const res = {} as MockResponse;
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

describe('HealthController', () => {
  let controller: HealthController;
  let healthService: { check: jest.Mock };

  beforeEach(async () => {
    healthService = {
      check: jest.fn().mockResolvedValue({ status: 'ok', db: 'ok', redis: 'ok' }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [{ provide: HealthService, useValue: healthService }],
    }).compile();

    controller = module.get<HealthController>(HealthController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('returns HTTP 200 and full body when both db and redis are ok', async () => {
    const res = mockRes();
    healthService.check.mockResolvedValue({ status: 'ok', db: 'ok', redis: 'ok' });

    await controller.check(res as unknown as Response);

    expect(healthService.check).toHaveBeenCalledTimes(1);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ status: 'ok', db: 'ok', redis: 'ok' });
  });

  it('returns HTTP 503 when db is error', async () => {
    const res = mockRes();
    healthService.check.mockResolvedValue({ status: 'degraded', db: 'error', redis: 'ok' });

    await controller.check(res as unknown as Response);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith({ status: 'degraded', db: 'error', redis: 'ok' });
  });

  it('returns HTTP 503 when redis is error', async () => {
    const res = mockRes();
    healthService.check.mockResolvedValue({ status: 'degraded', db: 'ok', redis: 'error' });

    await controller.check(res as unknown as Response);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith({ status: 'degraded', db: 'ok', redis: 'error' });
  });

  it('returns HTTP 503 when both db and redis are error', async () => {
    const res = mockRes();
    healthService.check.mockResolvedValue({ status: 'degraded', db: 'error', redis: 'error' });

    await controller.check(res as unknown as Response);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith({ status: 'degraded', db: 'error', redis: 'error' });
  });
});
