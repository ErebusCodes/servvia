// One-off production bootstrap: create the real DUNEDIN Organization/Venue.
// Run once against the real production DB. Address/operating-hours below
// are structurally-required placeholders (Verdura's own schema needs
// non-null JSON here) and must be corrected with the real trading
// address/hours by a human before this venue is publicly relied on —
// they are NOT derived from IdealPOS (which has no such fields) and are
// NOT guessed as fact, only as a valid placeholder shape.
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const org = await prisma.organization.upsert({
    where: { slug: 'verdura' },
    create: { name: 'Verdura', slug: 'verdura', billingEmail: 'admin@verdura.co.nz' },
    update: {},
  });

  const venue = await prisma.venue.upsert({
    where: { organizationId_slug: { organizationId: org.id, slug: 'dunedin' } },
    create: {
      organizationId: org.id,
      name: 'Verdura Dunedin',
      slug: 'dunedin',
      address: { street: 'CHANGE_ME_REAL_STREET_ADDRESS', city: 'Dunedin', country: 'New Zealand' },
      timezone: 'Pacific/Auckland',
      currency: 'NZD',
      locale: 'en-NZ',
      taxJurisdiction: 'NZ_GST',
      pricesIncludeTax: true,
      operatingHours: {
        monday: { open: 'CHANGE_ME', close: 'CHANGE_ME' },
        tuesday: { open: 'CHANGE_ME', close: 'CHANGE_ME' },
        wednesday: { open: 'CHANGE_ME', close: 'CHANGE_ME' },
        thursday: { open: 'CHANGE_ME', close: 'CHANGE_ME' },
        friday: { open: 'CHANGE_ME', close: 'CHANGE_ME' },
        saturday: { open: 'CHANGE_ME', close: 'CHANGE_ME' },
        sunday: { open: 'CHANGE_ME', close: 'CHANGE_ME' },
      },
      // Real, read-only-verified count from live IdealPOS TableMapSetups
      // (Code=1/Restaurant area, ItemType=3 seated tables, Seats>0): 18
      // tables, 170 total seats. Not guessed.
      seatingCapacity: 170,
      coversPerSlot: 40,
      reservationSlotMinutes: 30,
      posAdapterType: 'local_agent',
      posConfig: {},
      isActive: true,
    },
    update: {},
  });

  console.log(JSON.stringify({ organizationId: org.id, venueId: venue.id, venueName: venue.name }));
}

main().finally(() => prisma.$disconnect());
