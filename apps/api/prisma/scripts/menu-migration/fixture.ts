/**
 * Non-production, local-only fixture loader for the authoritative menu
 * migration's integration tests. Builds a production-SHAPED dataset (same
 * category names/counts, same 895 MenuItem titles/legacy posProductCode
 * values, same 9-trusted/219-approved-staging/606-residual-staging split)
 * under a dedicated fixture Organization — never touches the shared local
 * dev seed's own organization/venue, so it is safe to run repeatedly
 * alongside normal `npm run db:seed` without collision.
 *
 * Source: `fixture-production-shape.json`, derived from a one-time,
 * read-only, SELECT-only production Postgres inventory (see the 2026-08-30
 * Phase-A session). It contains only menu item titles/categories/legacy
 * posProductCode values and prices already visible on the live public
 * menu/POS terminal — no credentials, no customer data, no order history
 * (production has zero OrderItems system-wide, independently confirmed).
 *
 * This file is test-only infrastructure. It is never imported by
 * `migrate-authoritative-menu.ts` itself or by any runtime application
 * code — only by `migrate-authoritative-menu.integration-spec.ts`.
 *
 * Usage: `npx ts-node -r dotenv/config -r tsconfig-paths/register
 * prisma/scripts/menu-migration/fixture.ts` (run from apps/api/), or import
 * `loadFixture(prisma)` directly from a test.
 */
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import shape from './fixture-production-shape.json';

export const FIXTURE_ORG_SLUG = 'verdura-menu-migration-fixture';
export const STAGING_CATEGORY_NAME = 'Imported from IdealPOS (pending review)';

export interface FixtureHandles {
  organizationId: string;
  venueId: string;
  staffId: string;
  categoryIdByName: Map<string, string>;
}

/**
 * Idempotent: re-running finds the existing fixture org (by slug) and its
 * existing categories/items (by name/code) rather than duplicating them.
 * Safe to call at the top of every integration test's `beforeAll`.
 */
export async function loadFixture(prisma: PrismaClient): Promise<FixtureHandles> {
  const org = await prisma.organization.upsert({
    where: { slug: FIXTURE_ORG_SLUG },
    create: {
      name: 'Verdura Menu Migration Fixture',
      slug: FIXTURE_ORG_SLUG,
      billingEmail: 'fixture-only@example.invalid',
    },
    update: {},
  });

  const ownerEmail = 'fixture-owner@example.invalid';
  const passwordHash = await argon2.hash('fixture-only-not-a-real-password', {
    type: argon2.argon2id,
  });
  const staff = await prisma.staff.upsert({
    where: { email: ownerEmail },
    create: {
      organizationId: org.id,
      email: ownerEmail,
      name: 'Fixture Owner',
      passwordHash,
      role: 'owner',
    },
    update: {},
  });

  const venue = await prisma.venue.upsert({
    where: { organizationId_slug: { organizationId: org.id, slug: 'fixture-venue' } },
    create: {
      organizationId: org.id,
      name: 'Verdura Migration Fixture Venue',
      slug: 'fixture-venue',
      address: { street: '1 Test Street', city: 'Dunedin', country: 'New Zealand' },
      timezone: 'Pacific/Auckland',
      currency: 'NZD',
      locale: 'en-NZ',
      taxJurisdiction: 'NZ_GST',
      pricesIncludeTax: true,
      operatingHours: {
        monday: { open: '11:00', close: '22:00' },
        tuesday: { open: '11:00', close: '22:00' },
        wednesday: { open: '11:00', close: '22:00' },
        thursday: { open: '11:00', close: '22:00' },
        friday: { open: '11:00', close: '23:00' },
        saturday: { open: '11:00', close: '23:00' },
        sunday: { open: '11:00', close: '22:00' },
      },
      seatingCapacity: 60,
      coversPerSlot: 60,
      reservationSlotMinutes: 30,
      posAdapterType: 'none',
      posConfig: {},
      isActive: true,
    },
    update: {},
  });

  const categoryIdByName = new Map<string, string>();
  for (const c of shape.categoryNames) {
    // Category has no @@unique([organizationId, name]) in the schema, so
    // idempotency here is explicit find-then-create rather than a DB-level
    // upsert.
    const existing = await prisma.category.findFirst({
      where: { organizationId: org.id, name: c.name },
    });
    const cat =
      existing ??
      (await prisma.category.create({
        data: {
          organizationId: org.id,
          name: c.name,
          sortOrder: c.sortOrder,
          createdById: staff.id,
        },
      }));
    categoryIdByName.set(c.name, cat.id);
  }

  // Idempotency for coded items keys on posProductCode alone (it already
  // has a DB-level @@unique([organizationId, posProductCode]) constraint,
  // and a successful migration run legitimately moves a promoted item to
  // a new category, so categoryId can't be part of this key without
  // causing a false "doesn't exist yet" match that then collides with the
  // constraint). Null-code items have no such global identifier, so
  // title+categoryId is used instead — and since production genuinely has
  // a few real duplicate (title, category, null-code) row pairs, a plain
  // findFirst-per-item would wrongly treat the second occurrence as
  // "already exists" and silently drop it on the very first load. Instead,
  // consume a pre-fetched multiset of existing rows: only skip creating
  // an item once as many matching rows already exist in the DB as have
  // been seen so far in this loop.
  const existingNullCodeRows = await prisma.menuItem.findMany({
    where: { organizationId: org.id, posProductCode: null },
    select: { title: true, categoryId: true },
  });
  const existingNullCodeCounts = new Map<string, number>();
  for (const r of existingNullCodeRows) {
    const key = `${r.title} ${r.categoryId}`;
    existingNullCodeCounts.set(key, (existingNullCodeCounts.get(key) ?? 0) + 1);
  }
  const existingCodedCodes = new Set(
    (
      await prisma.menuItem.findMany({
        where: { organizationId: org.id, posProductCode: { not: null } },
        select: { posProductCode: true },
      })
    ).map((r) => r.posProductCode as string),
  );

  for (const item of shape.items) {
    const categoryId = categoryIdByName.get(item.categoryName);
    if (!categoryId) throw new Error(`Fixture category not found: ${item.categoryName}`);

    if (item.posProductCode !== null) {
      if (existingCodedCodes.has(item.posProductCode)) continue;
    } else {
      const key = `${item.title} ${categoryId}`;
      const remaining = existingNullCodeCounts.get(key) ?? 0;
      if (remaining > 0) {
        existingNullCodeCounts.set(key, remaining - 1);
        continue;
      }
    }

    await prisma.menuItem.create({
      data: {
        organizationId: org.id,
        categoryId,
        title: item.title,
        description: '',
        priceCents: item.priceCents,
        nutritionalDetails: {},
        isAvailable: item.isAvailable,
        posProductCode: item.posProductCode,
        createdById: staff.id,
      },
    });
  }

  return { organizationId: org.id, venueId: venue.id, staffId: staff.id, categoryIdByName };
}

/**
 * Test-only teardown: removes everything created under the fixture
 * organization (PosProductIdentity -> MenuItem -> Category -> Staff ->
 * Venue -> Organization, respecting FKs). Never touches any other
 * organization. Not called by default — tests opt in explicitly if a full
 * reset between runs is needed; `loadFixture` itself is idempotent so most
 * tests don't need this.
 */
export async function teardownFixture(prisma: PrismaClient): Promise<void> {
  const org = await prisma.organization.findUnique({ where: { slug: FIXTURE_ORG_SLUG } });
  if (!org) return;
  await prisma.posProductIdentity.deleteMany({ where: { organizationId: org.id } });
  await prisma.menuItem.deleteMany({ where: { organizationId: org.id } });
  await prisma.category.deleteMany({ where: { organizationId: org.id } });
  await prisma.staff.deleteMany({ where: { organizationId: org.id } });
  await prisma.venue.deleteMany({ where: { organizationId: org.id } });
  await prisma.organization.delete({ where: { id: org.id } });
}

if (require.main === module) {
  const prisma = new PrismaClient();
  loadFixture(prisma)
    .then((handles) => {
      console.log(`Fixture loaded. organizationId=${handles.organizationId}`);
    })
    .catch((e) => {
      console.error(e);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
