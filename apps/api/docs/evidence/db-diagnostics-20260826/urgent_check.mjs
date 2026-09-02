import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
const safe = (k, v) => typeof v === 'bigint' ? v.toString() : v;
async function main() {
  const o = await prisma.$queryRawUnsafe('SELECT COUNT(*) FROM "Order"');
  const p = await prisma.$queryRawUnsafe('SELECT COUNT(*) FROM "POSSyncRecord"');
  const c = await prisma.$queryRawUnsafe('SELECT COUNT(*) FROM "ConnectorCommand"');
  console.log('COUNTS', JSON.stringify({ order: o, posSyncRecord: p, connectorCommand: c }, safe));
  const orders = await prisma.$queryRawUnsafe('SELECT id, "venueId", "tableId", "tableNumber", status, "posSyncStatus", "totalCents", "createdAt" FROM "Order" ORDER BY "createdAt" DESC LIMIT 5');
  console.log('RECENT ORDERS', JSON.stringify(orders, safe));
  const seq = await prisma.$queryRawUnsafe('SELECT last_value, is_called FROM "Order_ORD6_seq"');
  console.log('SEQUENCE', JSON.stringify(seq, safe));
  await prisma.$disconnect();
}
main().catch(async e => { console.error(e); await prisma.$disconnect(); process.exit(1); });

