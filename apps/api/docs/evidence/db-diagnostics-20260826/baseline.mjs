import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
const safe = (k, v) => typeof v === 'bigint' ? v.toString() : v;
async function main() {
  const o = await prisma.$queryRawUnsafe('SELECT COUNT(*) FROM "Order"');
  const p = await prisma.$queryRawUnsafe('SELECT COUNT(*) FROM "POSSyncRecord"');
  const c = await prisma.$queryRawUnsafe('SELECT COUNT(*) FROM "ConnectorCommand"');
  const k = await prisma.$queryRawUnsafe('SELECT COUNT(*) FROM "KdsDeliveryRecord"');
  console.log('BASELINE', JSON.stringify({ order: o, posSyncRecord: p, connectorCommand: c, kdsDeliveryRecord: k }, safe));
  console.log('DB NOW', JSON.stringify(await prisma.$queryRawUnsafe('SELECT NOW()'), safe));
  await prisma.$disconnect();
}
main().catch(async e => { console.error(e); await prisma.$disconnect(); process.exit(1); });

