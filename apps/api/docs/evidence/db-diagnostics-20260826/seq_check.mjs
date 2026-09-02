import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
const safe = (k, v) => typeof v === 'bigint' ? v.toString() : v;
async function main() {
  const seq = await prisma.$queryRawUnsafe('SELECT last_value, is_called FROM "Order_ORD6_seq"');
  console.log('SEQUENCE CURRENT STATE', JSON.stringify(seq, safe));
  const o = await prisma.$queryRawUnsafe('SELECT COUNT(*) FROM "Order"');
  console.log('Order count (fresh)', JSON.stringify(o, safe));
  console.log('DB NOW', JSON.stringify(await prisma.$queryRawUnsafe('SELECT NOW()'), safe));
  await prisma.$disconnect();
}
main().catch(async e => { console.error(e); await prisma.$disconnect(); process.exit(1); });

