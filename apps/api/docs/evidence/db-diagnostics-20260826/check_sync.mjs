import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
const safe = (k, v) => typeof v === 'bigint' ? v.toString() : v;
async function main() {
  const psr = await prisma.$queryRawUnsafe('SELECT COUNT(*) FROM "POSSyncRecord"');
  console.log('POSSyncRecord count', JSON.stringify(psr, safe));
  const cc = await prisma.$queryRawUnsafe('SELECT COUNT(*) FROM "ConnectorCommand"');
  console.log('ConnectorCommand count', JSON.stringify(cc, safe));
  const recentCc = await prisma.$queryRawUnsafe('SELECT id, "commandType", status, "createdAt", "sourceRecordId" FROM "ConnectorCommand" ORDER BY "createdAt" DESC LIMIT 5');
  console.log('recent ConnectorCommand', JSON.stringify(recentCc, safe));
  await prisma.$disconnect();
}
main().catch(async e => { console.error(e); await prisma.$disconnect(); process.exit(1); });

