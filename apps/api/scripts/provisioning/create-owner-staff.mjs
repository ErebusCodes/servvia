import { PrismaClient, StaffRole } from '@prisma/client';
import * as argon2 from 'argon2';
const prisma = new PrismaClient();

async function main() {
  const org = await prisma.organization.findUniqueOrThrow({ where: { slug: 'verdura' } });
  const seedPassword = process.env.SEED_OWNER_PASSWORD;
  if (!seedPassword) throw new Error('SEED_OWNER_PASSWORD env var is required');
  const email = (process.env.SEED_OWNER_EMAIL ?? 'owner@verdura.co.nz').toLowerCase();
  const passwordHash = await argon2.hash(seedPassword, { type: argon2.argon2id });

  const staff = await prisma.staff.upsert({
    where: { email },
    create: { organizationId: org.id, email, name: 'Owner', passwordHash, role: StaffRole.owner },
    update: {},
  });

  const venue = await prisma.venue.findFirstOrThrow({ where: { organizationId: org.id, slug: 'dunedin' } });
  await prisma.venueAccess.upsert({
    where: { staffId_venueId: { staffId: staff.id, venueId: venue.id } },
    create: { staffId: staff.id, venueId: venue.id, grantedById: staff.id },
    update: {},
  });

  console.log(JSON.stringify({ staffId: staff.id, email: staff.email, venueId: venue.id }));
}
main().finally(() => prisma.$disconnect());
