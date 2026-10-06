import { Injectable, NestMiddleware, ForbiddenException } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import * as crypto from 'crypto';
import { isNonProductionRuntime, isProductionRuntime } from '../../config/runtime-environment';

@Injectable()
export class CsrfMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    const safeMethods = ['GET', 'HEAD', 'OPTIONS'];

    // 1. Ensure cookies is parsed
    const cookies = (req.cookies as Record<string, string> | undefined) || {};
    let csrfToken = cookies['csrf_token'];

    if (!csrfToken) {
      csrfToken = crypto.randomBytes(32).toString('hex');
      res.cookie('csrf_token', csrfToken, {
        httpOnly: false, // Must be readable by client JS to send in custom header
        secure: isProductionRuntime(),
        sameSite: 'strict',
        path: '/',
      });
    }

    // 2. Validate token for state-mutating requests
    if (!safeMethods.includes(req.method)) {
      // Bypass CSRF for authentication endpoints. Matches both the
      // /api/auth/* family (a path segment followed by more path, e.g.
      // /api/auth/login) AND terminal endpoints that simply end in "auth"
      // with nothing after it — /api/kiosk/kds/auth and (story 15-1,
      // DL-081) /api/tablet/enroll. Story 15-1's root-cause fix: the
      // previous `path.includes('/auth/')` check required a trailing
      // slash after "auth", so it silently never matched
      // /api/kiosk/kds/auth (no trailing slash) — every standalone
      // KDS/Order-Tablet PIN exchange from a fresh session (no CSRF cookie
      // yet) was rejected with 403 "Invalid or missing CSRF token", not a
      // wrong-PIN error. Reproduced directly against a running API before
      // this fix; see the story's Dev Agent Record.
      // /api/connector/enroll is the Venue Connector's device-facing
      // bootstrap-token redemption — same class as /api/tablet/enroll
      // (DL-081's precedent): a fresh device has no session and therefore
      // no CSRF cookie/token yet, so the same bypass applies for the same
      // reason. Without this, no real Connector could ever complete
      // enrollment in production (reproduced directly: a real device-side
      // POST with no prior session, exactly as a real Connector process
      // performs it, was rejected 403 here before this fix).
      const path = req.path || req.url || '';
      if (
        path.includes('/auth/') ||
        path.endsWith('/auth') ||
        path === '/api/tablet/enroll' ||
        path === '/api/connector/enroll'
      ) {
        return next();
      }

      // Bypass CSRF for internal services that authenticate via Bearer token
      const authHeader = req.headers.authorization;
      if (authHeader && authHeader.startsWith('Bearer ')) {
        return next();
      }

      // Bypass CSRF for the local-provider signed-upload emulation
      // (LocalMediaUploadController). A real GCS V4 signed URL is a
      // different origin entirely and never carries this app's session
      // cookie or CSRF token — the object key's own unguessable UUID is
      // the capability, exactly as MediaAssetsService.requestUpload
      // designs it. The local stand-in must behave the same way, or the
      // upload step of the MediaAsset pipeline can never work against the
      // local provider from a real browser. The controller itself is
      // additionally NODE_ENV-gated (rejects in production) — see
      // LocalMediaUploadController.
      // Exact prefix, and only where the route exists at all (Story 2.3).
      if (
        path.startsWith('/api/admin/media-assets/local-dev-upload/') &&
        isNonProductionRuntime()
      ) {
        return next();
      }

      const headerToken = req.headers['x-csrf-token'];
      if (!headerToken || headerToken !== csrfToken) {
        throw new ForbiddenException('Invalid or missing CSRF token');
      }
    }

    next();
  }
}
