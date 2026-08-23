import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import cookieParser from 'cookie-parser';
import { static as expressStatic } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { AppModule } from './app.module';
import { PrismaService } from './prisma/prisma.service';
import { resolveMediaStoragePath } from './media/media-storage.util';
import { assertSecretNotInsecureDefault } from './auth/utils/insecure-default-secret.util';

interface CorsRequest {
  headers: { origin?: string };
  path?: string;
  url?: string;
}

async function bootstrap() {
  const envPath = path.join(process.cwd(), '.env');
  const envExists = fs.existsSync(envPath);
  const requiredEnvVars = [
    'DATABASE_URL',
    'JWT_ACCESS_SECRET',
    'JWT_REFRESH_SECRET',
    'INTERNAL_SERVICE_TOKEN',
  ];
  const missingVars = requiredEnvVars.filter((v) => !process.env[v]);

  if (!envExists && missingVars.length > 0) {
    console.error('========================================================================');
    console.error(
      'FATAL ERROR: Startup failed because the .env file is missing and the following required environment variables are not defined:',
    );
    missingVars.forEach((v) => console.error(`  - ${v}`));
    console.error(
      '\nPlease create a .env file based on .env.example or define them in the environment.',
    );
    console.error('========================================================================');
    process.exit(1);
  }

  // Production must never boot with the checked-in dummy JWT secrets — same
  // fail-closed discipline already applied per-request to KDS_VENUE_PINS/
  // ADMIN_CONSOLE_PIN (insecure-default-pin.util.ts), extended here to the
  // strictly higher-value target a forgeable JWT secret represents.
  try {
    assertSecretNotInsecureDefault(process.env.JWT_ACCESS_SECRET, 'JWT_ACCESS_SECRET');
    assertSecretNotInsecureDefault(process.env.JWT_REFRESH_SECRET, 'JWT_REFRESH_SECRET');
  } catch (error) {
    console.error('========================================================================');
    console.error(`FATAL ERROR: ${error instanceof Error ? error.message : String(error)}`);
    console.error('========================================================================');
    process.exit(1);
  }

  const app = await NestFactory.create(AppModule);

  // Serves uploaded media directly off disk at /media/*, deliberately
  // outside the /api prefix (set below) — images are public reads with no
  // auth requirement, unlike every other route in this app. Narrow-cast
  // (matching the trust-proxy cast below) rather than typing `app` as
  // NestExpressApplication, which would change enableCors's generic
  // inference for the CORS delegate further down this file.
  const mediaRoot = resolveMediaStoragePath(app.get(ConfigService));
  fs.mkdirSync(mediaRoot, { recursive: true });
  const staticAssetApp = app.getHttpAdapter().getInstance() as unknown as {
    use: (path: string, handler: unknown) => void;
  };
  staticAssetApp.use('/media', expressStatic(mediaRoot));

  // PrismaService.onModuleInit deliberately swallows a failed $connect() —
  // Test.createTestingModule(...).compile() + app.init() (used by e2e/unit
  // specs with an intentionally fake DATABASE_URL) needs AppModule to
  // resolve without a live database. That same tolerance previously let a
  // real `node dist/main` boot fully, bind its port, and serve every
  // Prisma-backed route as a misleading generic 500 while looking "up" — the
  // menu API included. Verify connectivity here, only on the real server
  // startup path (bootstrap() is never invoked by the test module compiler),
  // and refuse to bind the port if the database isn't reachable.
  try {
    await app.get(PrismaService).$queryRaw`SELECT 1`;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('========================================================================');
    console.error('FATAL ERROR: Startup failed because the database is unreachable:');
    console.error(`  ${msg}`);
    console.error(
      '\nStart it with `npm run db:local:start` (local dev), then retry — or verify DATABASE_URL.',
    );
    console.error('========================================================================');
    await app.close();
    process.exit(1);
  }

  // Local-host mode exposes the API directly, so do not trust caller-supplied
  // forwarding headers by default. Deployments behind a known reverse proxy
  // can explicitly opt in with TRUST_PROXY_HOPS.
  const expressApp = app.getHttpAdapter().getInstance() as unknown as {
    set?: (name: string, value: number) => void;
  };
  if (typeof expressApp.set === 'function') {
    expressApp.set('trust proxy', Number(process.env.TRUST_PROXY_HOPS ?? 0));
  }

  app.use(cookieParser());
  app.enableCors(
    (
      req: CorsRequest,
      callback: (err: Error | null, options?: { origin: boolean; credentials?: boolean }) => void,
    ) => {
      const origin = req.headers.origin;
      const allowedOrigins = [
        'https://verdura.co.nz',
        'https://admin.verdura.co.nz',
        'https://kiosk.verdura.co.nz',
      ];
      if (process.env.NODE_ENV !== 'production') {
        allowedOrigins.push(
          'http://localhost:5173',
          'http://localhost:5174',
          'http://localhost:5175',
          'http://localhost:5176',
          'http://localhost:5177',
        );
      }

      let corsOptions;
      if (!origin || allowedOrigins.includes(origin)) {
        corsOptions = { origin: true, credentials: true };
      } else {
        corsOptions = { origin: false };
      }
      callback(null, corsOptions);
    },
  );
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.setGlobalPrefix('api');

  const rawPort = process.env.PORT ?? '3000';
  const port = parseInt(rawPort, 10);
  if (isNaN(port) || port < 0 || port > 65535) {
    throw new Error(`Invalid PORT environment variable: ${rawPort}`);
  }

  await app.listen(port, '0.0.0.0');
}
void bootstrap();
