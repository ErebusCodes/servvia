import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { KioskController } from '../kiosk/kiosk.controller';
import { KdsAuthController } from '../auth/kds-auth.controller';
import { KdsAuthService } from '../auth/kds-auth.service';
import { RateLimitGuard } from '../auth/guards/rate-limit.guard';
import { REDIS_CLIENT } from '../redis/redis.constants';
import { PrismaService } from '../prisma/prisma.service';
import { VenueAccessService } from '../auth/venue-access/venue-access.service';

// Story 12.5: in production the three public kiosk order and payment
// mutations answer 404, as for a route that does not exist, before rate
// limiting, body validation and the service. Development and test, the
// kiosk reads and the KDS PIN exchange are unchanged. These tests drive the
// real controllers, the real RateLimitGuard and the API's ValidationPipe over
// HTTP. CSRF middleware is out of scope: the 404 applies to a request that
// has already got past it.

const VENUE_ID = '11111111-1111-4111-8111-111111111111';
const MENU_ITEM_ID = '22222222-2222-4222-8222-222222222222';

const validOrderBody = {
  venueId: VENUE_ID,
  tableNumber: '4',
  items: [{ menuItemId: MENU_ITEM_ID, quantity: 1 }],
  stripePaymentIntentId: 'pi_123',
  idempotencyKey: 'kiosk-attempt-0000000001',
};

type Mutation = {
  path: string;
  validBody?: Record<string, unknown>;
  serviceMethod: 'create' | 'createConnectionToken' | 'createPaymentIntent';
};

const MUTATIONS: Mutation[] = [
  { path: '/api/kiosk/orders', validBody: validOrderBody, serviceMethod: 'create' },
  {
    path: '/api/kiosk/stripe/create-payment-intent',
    validBody: { amountCents: 5000 },
    serviceMethod: 'createPaymentIntent',
  },
  { path: '/api/kiosk/stripe/connection-token', serviceMethod: 'createConnectionToken' },
];

const config: { NODE_ENV: string | undefined } = { NODE_ENV: 'production' };
const configService = {
  get: jest.fn((key: string) => (key === 'NODE_ENV' ? config.NODE_ENV : undefined)),
};

const redis = { eval: jest.fn() };

const ordersService = {
  create: jest.fn(),
  createConnectionToken: jest.fn(),
  createPaymentIntent: jest.fn(),
};

const kdsAuthService = { authenticate: jest.fn() };

const venue = { id: VENUE_ID, organizationId: 'org-1', isActive: true };
const prisma = {
  venue: { findFirst: jest.fn() },
  table: { findMany: jest.fn() },
  category: { findMany: jest.fn() },
  menuItem: { findMany: jest.fn() },
  menuItemVenueOverride: { findMany: jest.fn() },
  tabletDevice: { findUnique: jest.fn() },
};

function allPrismaMocks(): jest.Mock[] {
  return Object.values(prisma).flatMap((model) => Object.values(model));
}

function allowedByRateLimit() {
  redis.eval.mockResolvedValue([0, 1]);
}

function expectPlainNotFound(res: request.Response) {
  expect(res.status).toBe(404);
  expect(res.body).toEqual({ statusCode: 404, message: 'Not Found' });
  expect(JSON.stringify(res.body)).not.toMatch(
    /kiosk|stripe|payment|config|environment|production|NODE_ENV|disabled/i,
  );
}

function expectNothingReached() {
  expect(redis.eval).not.toHaveBeenCalled();
  expect(ordersService.create).not.toHaveBeenCalled();
  expect(ordersService.createConnectionToken).not.toHaveBeenCalled();
  expect(ordersService.createPaymentIntent).not.toHaveBeenCalled();
  for (const mock of allPrismaMocks()) {
    expect(mock).not.toHaveBeenCalled();
  }
}

describe('Kiosk order and payment routes in production (Story 12.5)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [OrdersController, KioskController, KdsAuthController],
      providers: [
        RateLimitGuard,
        { provide: REDIS_CLIENT, useValue: redis },
        { provide: OrdersService, useValue: ordersService },
        { provide: KdsAuthService, useValue: kdsAuthService },
        { provide: PrismaService, useValue: prisma },
        { provide: VenueAccessService, useValue: { listableVenueIds: jest.fn() } },
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    // As in main.ts.
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.setGlobalPrefix('api');
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    config.NODE_ENV = 'production';
    redis.eval.mockReset();
    allowedByRateLimit();
    ordersService.create.mockResolvedValue({ id: 'ORD-1' });
    ordersService.createConnectionToken.mockResolvedValue({ secret: 'pst_test_secret' });
    ordersService.createPaymentIntent.mockResolvedValue({ clientSecret: 'pi_secret' });
    kdsAuthService.authenticate.mockResolvedValue({ accessToken: 'jwt', expiresIn: '12h' });
    prisma.venue.findFirst.mockResolvedValue(venue);
    prisma.table.findMany.mockResolvedValue([{ id: 't1', tableNumber: '4' }]);
    prisma.category.findMany.mockResolvedValue([{ id: 'c1' }]);
    prisma.menuItem.findMany.mockResolvedValue([
      { id: MENU_ITEM_ID, priceCents: 1000, isAvailable: true },
    ]);
    prisma.menuItemVenueOverride.findMany.mockResolvedValue([]);
  });

  function post(path: string, body?: Record<string, unknown>) {
    const req = request(app.getHttpServer()).post(path);
    return body === undefined ? req : req.send(body);
  }

  it('in production, POST /api/kiosk/orders answers 404 before rate limiting and the service', async () => {
    const res = await post('/api/kiosk/orders', validOrderBody);
    expectPlainNotFound(res);
    expectNothingReached();
  });

  it('in production, POST /api/kiosk/stripe/create-payment-intent answers 404 before rate limiting and the service', async () => {
    const res = await post('/api/kiosk/stripe/create-payment-intent', { amountCents: 5000 });
    expectPlainNotFound(res);
    expectNothingReached();
  });

  it('in production, POST /api/kiosk/stripe/connection-token answers 404 before rate limiting and the service', async () => {
    const res = await post('/api/kiosk/stripe/connection-token');
    expectPlainNotFound(res);
    expectNothingReached();
  });

  it('in production, an invalid body still answers 404', async () => {
    for (const { path } of MUTATIONS) {
      expectPlainNotFound(await post(path, {}));
      expectPlainNotFound(await post(path, { amountCents: 'lots', venueId: 'not-a-uuid' }));
      expectPlainNotFound(
        await request(app.getHttpServer())
          .post(path)
          .set('Content-Type', 'application/json')
          .send('[]'),
      );
    }
    expectNothingReached();
  });

  it('in production, an unavailable rate-limit store does not change the 404', async () => {
    // A store that is down, then one that would refuse as over the limit:
    // neither is consulted, so neither turns the 404 into a 503 or a 429.
    redis.eval.mockRejectedValue(new Error('Connection is closed.'));
    for (const { path, validBody } of MUTATIONS) {
      expectPlainNotFound(await post(path, validBody));
    }
    redis.eval.mockReset();
    redis.eval.mockResolvedValue([1, 30, Date.now()]);
    for (const { path, validBody } of MUTATIONS) {
      for (let i = 0; i < 35; i++) {
        expectPlainNotFound(await post(path, validBody));
      }
    }
    expectNothingReached();
  });

  it('an unset or unrecognised NODE_ENV is treated as production', async () => {
    for (const nodeEnv of [undefined, '', 'staging', 'prod', 'Development', 'TEST', ' test']) {
      config.NODE_ENV = nodeEnv;
      for (const { path, validBody } of MUTATIONS) {
        expectPlainNotFound(await post(path, validBody));
      }
    }
    expectNothingReached();
  });

  it('in development and test, the kiosk order and payment routes keep their behaviour', async () => {
    for (const nodeEnv of ['development', 'test']) {
      config.NODE_ENV = nodeEnv;

      // Rate limit consulted, then validation, then the service.
      jest.clearAllMocks();
      const order = await post('/api/kiosk/orders', validOrderBody);
      expect(order.status).toBe(201);
      expect(order.body).toEqual({ id: 'ORD-1' });
      expect(redis.eval).toHaveBeenCalledTimes(1);
      expect(ordersService.create).toHaveBeenCalledWith(expect.objectContaining(validOrderBody));

      jest.clearAllMocks();
      const intent = await post('/api/kiosk/stripe/create-payment-intent', { amountCents: 5000 });
      expect(intent.status).toBe(201);
      expect(intent.body).toEqual({ clientSecret: 'pi_secret' });
      expect(redis.eval).toHaveBeenCalledTimes(1);
      expect(ordersService.createPaymentIntent).toHaveBeenCalledWith(5000);

      jest.clearAllMocks();
      const token = await post('/api/kiosk/stripe/connection-token');
      expect(token.status).toBe(201);
      expect(token.body).toEqual({ secret: 'pst_test_secret' });
      expect(redis.eval).toHaveBeenCalledTimes(1);
      expect(ordersService.createConnectionToken).toHaveBeenCalledTimes(1);

      // An invalid body is a validation error after the rate limiter.
      jest.clearAllMocks();
      const badOrder = await post('/api/kiosk/orders', {});
      expect(badOrder.status).toBe(400);
      expect(redis.eval).toHaveBeenCalledTimes(1);
      expect(ordersService.create).not.toHaveBeenCalled();

      jest.clearAllMocks();
      const badIntent = await post('/api/kiosk/stripe/create-payment-intent', { amountCents: 1 });
      expect(badIntent.status).toBe(400);
      expect(redis.eval).toHaveBeenCalledTimes(1);
      expect(ordersService.createPaymentIntent).not.toHaveBeenCalled();

      // Over the limit is 429; a store that is down fails closed with 503.
      redis.eval.mockResolvedValue([1, 30, Date.now()]);
      for (const { path, validBody } of MUTATIONS) {
        expect((await post(path, validBody)).status).toBe(429);
      }
      redis.eval.mockRejectedValue(new Error('ERR unknown command'));
      for (const { path, validBody } of MUTATIONS) {
        expect((await post(path, validBody)).status).toBe(503);
      }
      expect(ordersService.create).not.toHaveBeenCalled();
      expect(ordersService.createPaymentIntent).not.toHaveBeenCalled();
      expect(ordersService.createConnectionToken).not.toHaveBeenCalled();
      redis.eval.mockReset();
      allowedByRateLimit();
    }
  });

  it('in production, kiosk menu and table reads and the KDS PIN exchange are unchanged', async () => {
    const server = app.getHttpServer();

    const tables = await request(server).get(`/api/kiosk/venues/${VENUE_ID}/tables`);
    expect(tables.status).toBe(200);
    expect(tables.body).toEqual([{ id: 't1', tableNumber: '4' }]);
    expect(prisma.table.findMany).toHaveBeenCalledTimes(1);

    const menu = await request(server).get(`/api/kiosk/venues/${VENUE_ID}/menu`);
    expect(menu.status).toBe(200);
    expect(menu.body).toEqual({
      categories: [{ id: 'c1' }],
      menuItems: [{ id: MENU_ITEM_ID, priceCents: 1000, isAvailable: true }],
    });

    const pin = await request(server)
      .post('/api/kiosk/kds/auth')
      .send({ venueId: VENUE_ID, pin: '482913' });
    expect(pin.status).toBe(200);
    expect(pin.body).toEqual({ accessToken: 'jwt', expiresIn: '12h' });
    expect(kdsAuthService.authenticate).toHaveBeenCalledWith(VENUE_ID, '482913');

    // Each still goes through its rate limiter, as on the baseline.
    expect(redis.eval).toHaveBeenCalledTimes(3);

    // And a missing venue is still the read's own 404.
    prisma.venue.findFirst.mockResolvedValue(null);
    const missing = await request(server).get(`/api/kiosk/venues/${VENUE_ID}/menu`);
    expect(missing.status).toBe(404);
    expect(missing.body).toMatchObject({ message: 'Venue not found' });
  });
});
