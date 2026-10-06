import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

const UTC_SESSION_OPTION = '-c TimeZone=UTC';

/**
 * Prisma stores DateTime as `timestamp without time zone` holding UTC, and
 * the API's SQL compares such columns with now() (connector leases, command
 * expiry, rate limits, native-round recovery). That is right only in a UTC
 * session, so every connection is pinned to UTC through libpq's `options`
 * parameter, whatever the server's or host's TimeZone. Go Core pins its pool
 * the same way (services/core-platform/internal/platform/postgres/pool.go).
 * An explicit TimeZone already in the URL's options is left alone.
 */
export function withUtcSession(url: string | undefined): string | undefined {
  if (!url) return url;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  const existing = parsed.searchParams.get('options');
  if (existing && /timezone\s*=/i.test(existing)) return url;
  const value = existing ? `${existing} ${UTC_SESSION_OPTION}` : UTC_SESSION_OPTION;
  parsed.searchParams.delete('options');
  const base = parsed.toString();
  return `${base}${parsed.search ? '&' : '?'}options=${encodeURIComponent(value)}`;
}

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    const url = withUtcSession(process.env.DATABASE_URL);
    super(url ? { datasources: { db: { url } } } : undefined);
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.$connect();
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      // Deliberately not rethrown: Test.createTestingModule(...).compile() +
      // app.init() (e2e/unit specs using an intentionally fake DATABASE_URL)
      // needs AppModule to resolve without a live database. The real server
      // boot path (main.ts bootstrap()) performs its own connectivity check
      // right after this and refuses to start if the database is unreachable
      // — see main.ts for the fail-fast behavior this doesn't provide here.
      console.warn('Database connection failed during PrismaService initialization:', msg);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
