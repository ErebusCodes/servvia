import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const { LOCAL_ORG_SLUG, LOCAL_VENUE_SLUG } =
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('../../../shared/local-dev.mjs') as {
    LOCAL_ORG_SLUG: string;
    LOCAL_VENUE_SLUG: string;
  };

async function main() {
  const [venues, categories, menuItems, localVenue] = await Promise.all([
    prisma.venue.count(),
    prisma.category.count(),
    prisma.menuItem.count(),
    prisma.venue.findFirst({
      where: { slug: LOCAL_VENUE_SLUG, organization: { slug: LOCAL_ORG_SLUG } },
      select: { id: true },
    }),
  ]);
  console.log(JSON.stringify({ venues, categories, menuItems, localVenueId: localVenue?.id ?? null }));
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
