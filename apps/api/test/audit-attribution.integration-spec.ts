// Integration test against a REAL local Postgres — no mocking.
// Story 12.15: the AuditLog actor shape and immutability are enforced by the
// database itself (migration 20261010000000_audit_actor_types), not only by
// the application writer.
//
// Run with: npm run test:integration --workspace=backend
// Requires: npm run db:local:start && npm run db:migrate && npm run db:seed
import { PrismaClient, StaffRole } from '@prisma/client';

describe('AuditLog actor attribution (integration, real Postgres)', () => {
  const prisma = new PrismaClient();
  let organizationId: string;
  let venueId: string;
  let staff: { id: string; email: string; role: StaffRole };
  const created: string[] = [];

  beforeAll(async () => {
    const venue = await prisma.venue.findFirstOrThrow({ where: { slug: 'auckland' } });
    organizationId = venue.organizationId;
    venueId = venue.id;
    staff = await prisma.staff.findFirstOrThrow({
      where: { organizationId, role: StaffRole.owner, isActive: true },
      select: { id: true, email: true, role: true },
    });
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { id: { in: created } } });
    await prisma.$disconnect();
  });

  const base = () => ({ organizationId, venueId, action: 'TEST_ACTION', resource: 'test' });
  const insert = async (data: Parameters<typeof prisma.auditLog.create>[0]['data']) => {
    const row = await prisma.auditLog.create({ data });
    created.push(row.id);
    return row;
  };

  it('accepts each actor type in its own shape', async () => {
    await expect(
      insert({ ...base(), actorId: staff.id, actorEmail: staff.email, actorRole: staff.role }),
    ).resolves.toMatchObject({ actorType: 'staff' });
    await expect(
      insert({
        ...base(),
        actorId: staff.id,
        actorEmail: staff.email,
        actorRole: staff.role,
        deviceKind: 'tablet_device',
        deviceId: 'device-1',
      }),
    ).resolves.toMatchObject({ actorType: 'staff', deviceKind: 'tablet_device' });
    await expect(
      insert({
        ...base(),
        actorType: 'device',
        deviceKind: 'kds_device',
        actorRole: StaffRole.kitchen,
      }),
    ).resolves.toMatchObject({ actorType: 'device', actorId: null });
    await expect(
      insert({ ...base(), actorType: 'system', systemActor: 'connector-command-sweep' }),
    ).resolves.toMatchObject({ actorType: 'system' });
  });

  it.each([
    ['a staff row without a staff actor', { deviceKind: 'kds_device' }],
    [
      'a device row naming a staff member',
      {
        actorType: 'device',
        deviceKind: 'kds_device',
        actorId: 'STAFF',
        actorEmail: 'x@example.test',
      },
    ],
    ['a device row without a device kind', { actorType: 'device' }],
    ['a system row without a name', { actorType: 'system' }],
    [
      'a system row with a device',
      { actorType: 'system', systemActor: 'sweep', deviceKind: 'kds_device' },
    ],
  ] as const)('rejects %s', async (_label, shape) => {
    const data = { ...base(), ...shape } as Record<string, unknown>;
    if (data.actorId === 'STAFF') data.actorId = staff.id;
    await expect(
      prisma.auditLog.create({
        data: data as Parameters<typeof prisma.auditLog.create>[0]['data'],
      }),
    ).rejects.toThrow(/AuditLog_actor_shape_check/);
  });

  it('keeps the Staff foreign key: a device ID cannot pose as a staff actor', async () => {
    await expect(
      prisma.auditLog.create({
        data: {
          ...base(),
          actorId: `kds-device:${venueId}`,
          actorEmail: `kds-device+${venueId}@verdura.internal`,
          actorRole: StaffRole.kitchen,
        },
      }),
    ).rejects.toThrow(/AuditLog_actorId_fkey/);
  });

  it('rejects any update: audit rows are immutable', async () => {
    const row = await insert({
      ...base(),
      actorType: 'device',
      deviceKind: 'kds_device',
    });
    await expect(
      prisma.auditLog.update({ where: { id: row.id }, data: { action: 'TAMPERED' } }),
    ).rejects.toThrow(/AuditLog rows are immutable/);
    await expect(
      prisma.$executeRaw`UPDATE "AuditLog" SET "deviceKind" = 'other' WHERE id = ${row.id}`,
    ).rejects.toThrow(/AuditLog rows are immutable/);
    expect((await prisma.auditLog.findUniqueOrThrow({ where: { id: row.id } })).action).toBe(
      'TEST_ACTION',
    );
  });
});
