// One-off production bootstrap: create real Verdura Table rows for DUNEDIN,
// using real, verified data from live IdealPOS (IPSTransaction.TableMapSetups,
// Code=1/"Restaurant" area, Type=3 = real seated tables). posTableCode is set
// to the exact real Caption value the Bridge already matches against
// (IdealposReadRepository.GetTables()/FindTableByCaption) - not guessed.
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

// Real Caption + Seats pairs, read-only-verified against IPSTransaction.dbo.TableMapSetups
// WHERE Code=1 AND Type=3, 2026-08-26.
const REAL_TABLES = [
  { caption: '1', seats: 4 }, { caption: '2', seats: 12 }, { caption: '3', seats: 23 },
  { caption: '4', seats: 50 }, { caption: '5', seats: 4 }, { caption: '6', seats: 4 },
  { caption: '7', seats: 4 }, { caption: '8', seats: 23 }, { caption: '9', seats: 6 },
  { caption: '10', seats: 0 }, { caption: '11', seats: 4 }, { caption: '12', seats: 4 },
  { caption: '13', seats: 4 }, { caption: '14', seats: 4 }, { caption: '15', seats: 8 },
  { caption: '16', seats: 4 }, { caption: '17', seats: 4 }, { caption: '18', seats: 4 },
  { caption: '19', seats: 4 },
];

async function main() {
  const venue = await prisma.venue.findFirstOrThrow({ where: { slug: 'dunedin' } });
  const results = [];
  for (const t of REAL_TABLES) {
    // Table 10 has 0 seats in IdealPOS - not a real seatable dine-in table
    // (likely a takeaway/bar-tab placeholder slot). Skip it rather than
    // create a nonsensical zero-capacity dine-in table; document, don't guess.
    if (t.seats === 0) continue;
    const table = await prisma.table.upsert({
      where: { venueId_tableNumber: { venueId: venue.id, tableNumber: t.caption } },
      create: {
        venueId: venue.id,
        tableNumber: t.caption,
        capacity: t.seats,
        posTableCode: t.caption,
        sortOrder: parseInt(t.caption, 10),
      },
      update: { posTableCode: t.caption },
    });
    results.push({ tableNumber: table.tableNumber, capacity: table.capacity, posTableCode: table.posTableCode });
  }
  console.log(JSON.stringify({ venueId: venue.id, createdOrUpdated: results.length, tables: results }, null, 2));
}
main().finally(() => prisma.$disconnect());
