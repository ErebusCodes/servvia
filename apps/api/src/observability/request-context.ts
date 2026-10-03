import { Injectable, NestMiddleware } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomBytes } from 'node:crypto';
import { NextFunction, Request, Response } from 'express';

/**
 * Request and correlation IDs (Story 12.2), with the same rules as Go Core
 * (services/core-platform/internal/platform/httpx/middleware.go): a valid
 * inbound X-Request-Id (e.g. from the proxy) is kept, otherwise a new one is
 * made; X-Correlation-Id follows a business flow across services and
 * defaults to the request ID. Both are echoed on the response and attached to
 * every security event logged while the request runs.
 */
export const REQUEST_ID_HEADER = 'X-Request-Id';
export const CORRELATION_ID_HEADER = 'X-Correlation-Id';

// Caller-supplied IDs are accepted only when short and made of safe
// characters, so they can be logged and echoed without injection risk.
const SAFE_ID = /^[A-Za-z0-9._:-]{1,128}$/;

export interface RequestContext {
  requestId: string;
  correlationId: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

/** The IDs of the request being handled, if any (none in background work). */
export function currentRequestContext(): RequestContext | undefined {
  return storage.getStore();
}

export function newRequestId(): string {
  return randomBytes(16).toString('hex');
}

/** The IDs for a request with these inbound headers, by Core's rules. */
export function requestContextFor(
  inboundRequestId: unknown,
  inboundCorrelationId: unknown,
): RequestContext {
  const requestId =
    typeof inboundRequestId === 'string' && SAFE_ID.test(inboundRequestId)
      ? inboundRequestId
      : newRequestId();
  const correlationId =
    typeof inboundCorrelationId === 'string' && SAFE_ID.test(inboundCorrelationId)
      ? inboundCorrelationId
      : requestId;
  return { requestId, correlationId };
}

/** Runs fn with the given request context (also for tests and background work). */
export function runWithRequestContext<T>(context: RequestContext, fn: () => T): T {
  return storage.run(context, fn);
}

@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const context = requestContextFor(
      req.header(REQUEST_ID_HEADER),
      req.header(CORRELATION_ID_HEADER),
    );
    res.setHeader(REQUEST_ID_HEADER, context.requestId);
    res.setHeader(CORRELATION_ID_HEADER, context.correlationId);
    storage.run(context, () => next());
  }
}
