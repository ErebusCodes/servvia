import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
const safe = (k, v) => typeof v === 'bigint' ? v.toString() : v;
async function main() {
  const c = await prisma.$queryRawUnsafe('SELECT COUNT(*) FROM "Order"');
  console.log('RAW Order COUNT', JSON.stringify(c, safe));
  const recent = await prisma.$queryRawUnsafe('SELECT id, "venueId", "tableId", status, "posSyncStatus", "totalCents", "createdAt" FROM "Order" ORDER BY "createdAt" DESC LIMIT 5');
  console.log('RAW recent', JSON.stringify(recent, safe));
  await prisma.$disconnect();
}
main().catch(async e => { console.error(e); await prisma.$disconnect(); process.exit(1); });

