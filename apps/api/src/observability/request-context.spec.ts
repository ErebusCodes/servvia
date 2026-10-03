import { Request, Response } from 'express';
import {
  CORRELATION_ID_HEADER,
  REQUEST_ID_HEADER,
  RequestContextMiddleware,
  currentRequestContext,
  requestContextFor,
} from './request-context';

describe('request and correlation IDs (Story 12.2, Core’s rules)', () => {
  it('keeps a safe inbound request ID and defaults the correlation ID to it', () => {
    expect(requestContextFor('proxy-abc.123:4', undefined)).toEqual({
      requestId: 'proxy-abc.123:4',
      correlationId: 'proxy-abc.123:4',
    });
    expect(requestContextFor('req-1', 'flow-9')).toEqual({
      requestId: 'req-1',
      correlationId: 'flow-9',
    });
  });

  it('replaces an unsafe or oversized inbound ID with a new one', () => {
    for (const unsafe of ['has space', 'new\nline', 'x'.repeat(129), '', ['a', 'b'], 7]) {
      const { requestId, correlationId } = requestContextFor(unsafe, unsafe);
      expect(requestId).toMatch(/^[0-9a-f]{32}$/);
      expect(correlationId).toBe(requestId);
    }
  });

  it('echoes both IDs and makes them current for the rest of the request', () => {
    const headers: Record<string, string> = {};
    const req = {
      header: (name: string) => (name === REQUEST_ID_HEADER ? 'req-42' : undefined),
    } as unknown as Request;
    const res = {
      setHeader: (name: string, value: string) => (headers[name] = value),
    } as unknown as Response;
    let seen: ReturnType<typeof currentRequestContext>;
    new RequestContextMiddleware().use(req, res, () => {
      seen = currentRequestContext();
    });
    expect(headers).toEqual({ [REQUEST_ID_HEADER]: 'req-42', [CORRELATION_ID_HEADER]: 'req-42' });
    expect(seen!).toEqual({ requestId: 'req-42', correlationId: 'req-42' });
    expect(currentRequestContext()).toBeUndefined();
  });
});
