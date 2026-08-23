import { PrismaClient, StaffRole } from '@prisma/client';
import tableConfig from '../../../shared/table-config.json';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();

const { LOCAL_VENUE_ID, LOCAL_ORG_SLUG, LOCAL_VENUE_SLUG } =
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('../../../shared/local-dev.mjs') as {
    LOCAL_VENUE_ID: string;
    LOCAL_ORG_SLUG: string;
    LOCAL_VENUE_SLUG: string;
  };

async function main() {
  const seedPassword = process.env.SEED_OWNER_PASSWORD;
  if (!seedPassword) throw new Error('SEED_OWNER_PASSWORD env var is required');

  const billingEmail = process.env.SEED_BILLING_EMAIL ?? 'admin@verdura.co.nz';
  const ownerEmail = (process.env.SEED_OWNER_EMAIL ?? 'owner@verdura.co.nz').toLowerCase();

  const org = await prisma.organization.upsert({
    where: { slug: LOCAL_ORG_SLUG },
    create: { name: 'Verdura', slug: LOCAL_ORG_SLUG, billingEmail },
    update: {},
  });

  const passwordHash = await argon2.hash(seedPassword, { type: argon2.argon2id });

  await prisma.staff.upsert({
    where: { email: ownerEmail },
    create: {
      organizationId: org.id,
      email: ownerEmail,
      name: 'Owner',
      passwordHash,
      role: StaffRole.owner,
    },
    update: { passwordHash, deletedAt: null },
  });

  const venue = await prisma.venue.upsert({
    where: {
      organizationId_slug: {
        organizationId: org.id,
        slug: LOCAL_VENUE_SLUG,
      },
    },
    create: {
      // Deterministic only for a newly-created local venue. Existing venues
      // are found by organization+slug above and retain their primary key so
      // tables, orders, reservations and overrides are never re-keyed.
      id: LOCAL_VENUE_ID,
      organizationId: org.id,
      name: 'Verdura Auckland',
      slug: LOCAL_VENUE_SLUG,
      address: {
        street: '12 Wyndham Street',
        city: 'Auckland',
        country: 'New Zealand',
      },
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
      seatingCapacity: 82,
      coversPerSlot: 82,
      reservationSlotMinutes: 30,
      posAdapterType: 'none',
      posConfig: {},
      isActive: true,
    },
    update: {
      seatingCapacity: 82,
      coversPerSlot: 82,
    },
  });

  // The upsert above matches by organization+slug, not id, so an existing
  // venue keeps whatever primary key it already had (see the comment in
  // `create` above — this is intentional, to never re-key a real venue's
  // tables/orders/reservations/overrides out from under it). But every
  // local-dev frontend .env is pre-configured to call LOCAL_VENUE_ID
  // specifically. If this database's "auckland" venue predates that
  // convention (or was created some other way, e.g. through the admin venue
  // API) its id will silently diverge and every menu/order request will
  // 404 forever, no matter how many times this script reruns. Fail loudly
  // instead of seeding menu data against a venue nothing is configured to
  // call. Scoped to non-production only — this script is local-dev-only,
  // but the guard is explicit in case that ever changes.
  if (process.env.NODE_ENV !== 'production' && venue.id !== LOCAL_VENUE_ID) {
    throw new Error(
      `Existing local venue ID does not match LOCAL_VENUE_ID. Reset database.\n` +
        `  Found:    ${venue.id}\n` +
        `  Expected: ${LOCAL_VENUE_ID}\n` +
        `Fix: npm run db:local:reset`,
    );
  }

  const tablesData = tableConfig;

  // Delete any tables not in the seeded range to ensure only T1-T18 exist
  const seededTableNumbers = tablesData.map(t => t.tableNumber);
  await prisma.table.deleteMany({
    where: {
      venueId: venue.id,
      tableNumber: {
        notIn: seededTableNumbers,
      },
    },
  });

  for (const t of tablesData) {
    await prisma.table.upsert({
      where: {
        venueId_tableNumber: {
          venueId: venue.id,
          tableNumber: t.tableNumber,
        },
      },
      create: {
        venueId: venue.id,
        tableNumber: t.tableNumber,
        name: `Table ${t.tableNumber}`,
        capacity: t.capacity,
        sortOrder: t.sortOrder,
        isActive: true,
      },
      update: {
        capacity: t.capacity,
        sortOrder: t.sortOrder,
      },
    });
  }

  console.log(`Seeded org "${org.name}", owner account "${ownerEmail}", venue "${venue.name}", and ${tablesData.length} tables.`);

  // ── Menu seed ──────────────────────────────────────────────────────────────
  // The database is seeded from shared/menu/menuData.mjs — the single
  // canonical menu source (transcribed from VERDURA_Final_Menu.docx: 10
  // categories, 70 items) — rather than a separately hand-maintained list.
  // This keeps the seed from drifting out of sync with the docx the way the
  // old hardcoded 4-category/~88-item seed data had. Loaded via a runtime
  // require() of the .mjs module (Node's require(esm) support) so this
  // stays a single source of truth instead of a duplicated TS copy.
  const owner = await prisma.staff.findFirstOrThrow({ where: { organizationId: org.id } });

  type SharedCategory = {
    id: string;
    name: string;
    description: string | null;
    sortOrder: number;
    isActive: boolean;
  };
  type SharedMenuItem = {
    categoryId: string;
    subCategory: string | null;
    title: string;
    description: string;
    imageUrl: string | null;
    price: string;
    nutritionalDetails: { tags: string[]; isFeatured: boolean };
    isSpicy: boolean;
    isAvailable: boolean;
    sortOrder: number;
  };

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const menuData = require('../../../shared/menu/menuData.mjs') as {
    SEED_CATEGORIES: SharedCategory[];
    SEED_ITEMS: SharedMenuItem[];
    CANONICAL_MENU_ITEM_COUNT: number;
  };
  const { SEED_CATEGORIES, SEED_ITEMS, CANONICAL_MENU_ITEM_COUNT } = menuData;

  // Parse price string → cents: take first number
  const toCents = (p: string | number): number => {
    const n = parseFloat(String(p).replace(/[^0-9.]/g, ''));
    return Math.round((isNaN(n) ? 0 : n) * 100);
  };

  const catMap: Record<string, string> = {};
  for (const def of SEED_CATEGORIES) {
    const existing = await prisma.category.findFirst({
      where: { organizationId: org.id, name: def.name },
    });
    const cat = existing
      ? await prisma.category.update({
          where: { id: existing.id },
          data: { description: def.description, sortOrder: def.sortOrder, isActive: def.isActive },
        })
      : await prisma.category.create({
          data: {
            organizationId: org.id,
            name: def.name,
            description: def.description,
            sortOrder: def.sortOrder,
            isActive: def.isActive,
            createdById: owner.id,
          },
        });
    catMap[def.id] = cat.id;
  }

  let created = 0;
  let updated = 0;
  for (const item of SEED_ITEMS) {
    const categoryId = catMap[item.categoryId];
    if (!categoryId) {
      throw new Error(`Seed item "${item.title}" references unknown category "${item.categoryId}"`);
    }

    // Titles are not globally unique (e.g. "Tabbouleh" appears both as a
    // Salad and as a Side) so items are matched within their own category.
    const existing = await prisma.menuItem.findFirst({
      where: { organizationId: org.id, categoryId, title: item.title, subCategory: item.subCategory ?? null, deletedAt: null },
    });

    const data = {
      organizationId: org.id,
      categoryId,
      subCategory: item.subCategory ?? undefined,
      title: item.title,
      description: item.description || item.title,
      imageUrl: item.imageUrl ?? undefined,
      priceCents: toCents(item.price),
      isAvailable: item.isAvailable,
      isSpicy: item.isSpicy,
      sortOrder: item.sortOrder,
      nutritionalDetails: {
        tags: item.nutritionalDetails.tags,
        isFeatured: item.nutritionalDetails.isFeatured,
        allergens: [],
        ingredients: [],
      },
    };

    if (existing) {
      await prisma.menuItem.update({ where: { id: existing.id }, data });
      updated++;
    } else {
      await prisma.menuItem.create({ data: { ...data, createdById: owner.id } });
      created++;
    }
  }

  const finalCount = await prisma.menuItem.count({ where: { organizationId: org.id, deletedAt: null } });
  console.log(
    `Menu: ${SEED_CATEGORIES.length} categories, ${created} items created, ${updated} items updated ` +
    `(${SEED_ITEMS.length} defined, canonical count ${CANONICAL_MENU_ITEM_COUNT}, ${finalCount} now in DB for this org).`,
  );
  if (finalCount !== CANONICAL_MENU_ITEM_COUNT) {
    console.warn(
      `WARNING: DB menu item count (${finalCount}) does not match the canonical count ` +
      `(${CANONICAL_MENU_ITEM_COUNT}) — likely leftover items from a prior, non-canonical seed. ` +
      `Investigate with a Category/MenuItem query before assuming the menu is correct.`,
    );
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
