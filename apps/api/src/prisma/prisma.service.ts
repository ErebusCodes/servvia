import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
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
