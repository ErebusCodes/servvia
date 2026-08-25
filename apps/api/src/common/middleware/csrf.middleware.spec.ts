import { ForbiddenException } from '@nestjs/common';
import { Request, Response } from 'express';
import { CsrfMiddleware } from './csrf.middleware';

function makeReq(overrides: Partial<Request> = {}): Request {
  return {
    method: 'PUT',
    path: '/api/admin/media-assets/local-dev-upload/venues%2Fv1%2Fx.jpg',
    cookies: {},
    headers: {},
    ...overrides,
  } as unknown as Request;
}

function makeRes(): Response {
  return { cookie: jest.fn() } as unknown as Response;
}

describe('CsrfMiddleware', () => {
  let middleware: CsrfMiddleware;

  beforeEach(() => {
    middleware = new CsrfMiddleware();
  });

  it('bypasses CSRF for the local-provider signed-upload emulation route (no session cookie, no CSRF token present)', () => {
    const next = jest.fn();
    middleware.use(makeReq(), makeRes(), next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('bypasses CSRF for the Venue Connector device enrollment endpoint (fresh device, no session yet)', () => {
    const next = jest.fn();
    middleware.use(makeReq({ path: '/api/connector/enroll' }), makeRes(), next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('bypasses CSRF for the Order Tablet device enrollment endpoint (fresh device, no session yet)', () => {
    const next = jest.fn();
    middleware.use(makeReq({ path: '/api/tablet/enroll' }), makeRes(), next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('still enforces CSRF for a normal cookie-authenticated mutating request without a token', () => {
    const next = jest.fn();
    expect(() =>
      middleware.use(
        makeReq({ path: '/api/admin/menu/items', cookies: { csrf_token: 'real-token' } }),
        makeRes(),
        next,
      ),
    ).toThrow(ForbiddenException);
    expect(next).not.toHaveBeenCalled();
  });

  it('still bypasses CSRF for Bearer-authenticated requests, matching the pre-existing internal-service exemption', () => {
    const next = jest.fn();
    middleware.use(
      makeReq({ path: '/api/admin/menu/items', headers: { authorization: 'Bearer abc' } }),
      makeRes(),
      next,
    );
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('allows a matching CSRF header/cookie pair through on a normal mutating request', () => {
    const next = jest.fn();
    middleware.use(
      makeReq({
        path: '/api/admin/menu/items',
        cookies: { csrf_token: 'match-me' },
        headers: { 'x-csrf-token': 'match-me' },
      }),
      makeRes(),
      next,
    );
    expect(next).toHaveBeenCalledTimes(1);
  });
});
