// Integration test against a REAL local Postgres and Redis — no mocking.
// Story 8.3: staff integrity under concurrency. Within every venue where a
// tablet PIN elevates a tablet, it identifies at most one staff member, under
// concurrent PIN changes and venue grants; and security-sensitive staff
// changes decide from the state their own transaction protects.
//
// Run with: npm run test:integration --workspace=apps/api
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import * as argon2 from 'argon2';
import { StaffRole } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { StaffService } from '../src/staff/staff.service';
import { StaffAdministrationService, StaffActor } from '../src/staff/staff-administration.service';
import { TabletAuthService, TabletDeviceIdentity } from '../src/tablet/tablet-auth.service';

const TAG = `story83-${Date.now()}`;

describe('Staff integrity under concurrency (integration, real Postgres)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let staffService: StaffService;
  let administration: StaffAdministrationService;
  let organizationId: string;
  let owner: StaffActor;
  let venue1: string;
  let venue2: string;
  let device1: TabletDeviceIdentity;
  const created: string[] = [];
  const createdVenues: string[] = [];
  let enrollmentId: string;

  async function staffMember(
    label: string,
    venues: string[],
    role: StaffRole = StaffRole.cashier,
  ): Promise<string> {
    const staff = await prisma.staff.create({
      data: {
        organizationId,
        email: `${TAG}-${label}@example.test`,
        name: label,
        role,
        passwordHash: await argon2.hash(`${TAG} password`, { type: argon2.argon2id }),
      },
    });
    created.push(staff.id);
    if (venues.length > 0) {
      await prisma.venueAccess.createMany({
        data: venues.map((venueId) => ({ staffId: staff.id, venueId, grantedById: owner.id })),
      });
    }
    return staff.id;
  }

  const setPin = (staffId: string, pin: string, actor: StaffActor = owner) =>
    staffService.setTabletPin(staffId, organizationId, pin, actor);

  /**
   * A staff member setting their own PIN. Two such changes share no staff
   * row lock (unlike two changes by the same administrator, which the
   * administrator's row serializes), so only the venue lock orders them.
   */
  const setOwnPin = (staffId: string, pin: string) =>
    setPin(staffId, pin, {
      id: staffId,
      email: `${staffId}@example.test`,
      role: StaffRole.cashier,
      organizationId,
    });

  /** How many people a tablet in `venueId` would recognise by `pin`. */
  async function holdersAt(venueId: string, pin: string): Promise<number> {
    const enrolled = await prisma.staff.findMany({
      where: {
        deletedAt: null,
        pinHash: { not: null },
        venueAccess: { some: { venueId, pinEnrolledAt: { not: null } } },
      },
      select: { pinHash: true },
    });
    let n = 0;
    for (const s of enrolled) if (await argon2.verify(s.pinHash!, pin)) n += 1;
    return n;
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.use(cookieParser());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);
    staffService = app.get(StaffService);
    administration = app.get(StaffAdministrationService);

    const seeded = await prisma.venue.findFirstOrThrow({ where: { slug: 'auckland' } });
    organizationId = seeded.organizationId;
    const ownerRow = await prisma.staff.findFirstOrThrow({
      where: { email: process.env.SEED_OWNER_EMAIL ?? 'owner@verdura.co.nz' },
    });
    owner = { id: ownerRow.id, email: ownerRow.email, role: ownerRow.role, organizationId };
    for (const label of ['one', 'two']) {
      const venue = await prisma.venue.create({
        data: {
          organizationId,
          name: `${TAG} ${label}`,
          slug: `${TAG}-${label}`,
          address: {},
          operatingHours: {},
          seatingCapacity: 10,
        },
      });
      createdVenues.push(venue.id);
      await prisma.venueAccess.create({
        data: { staffId: owner.id, venueId: venue.id, grantedById: owner.id },
      });
    }
    [venue1, venue2] = createdVenues;
    const enrollment = await prisma.tabletEnrollment.create({
      data: {
        organizationId,
        venueId: venue1,
        codeHash: 'not-a-real-code',
        createdByStaffId: owner.id,
        expiresAt: new Date(Date.now() + 60_000),
        usedAt: new Date(),
      },
    });
    enrollmentId = enrollment.id;
    const device = await prisma.tabletDevice.create({
      data: {
        organizationId,
        venueId: venue1,
        enrollmentId,
        label: `${TAG} tablet`,
        secretHash: 'not-a-real-secret',
      },
    });
    device1 = { deviceId: device.id, organizationId, venueId: venue1, label: device.label };
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({
      where: {
        OR: [
          { actorId: { in: created } },
          { resourceId: { in: created } },
          { venueId: { in: createdVenues } },
          { deviceId: device1.deviceId },
        ],
      },
    });
    await prisma.staffSession.deleteMany({ where: { staffId: { in: created } } });
    await prisma.staffCredentialToken.deleteMany({ where: { staffId: { in: created } } });
    await prisma.venueAccess.deleteMany({
      where: { OR: [{ staffId: { in: created } }, { venueId: { in: createdVenues } }] },
    });
    await prisma.staff.updateMany({
      where: { id: owner.id },
      data: { pinHash: null, pinSetAt: null },
    });
    await prisma.staff.deleteMany({ where: { id: { in: created } } });
    await prisma.tabletDevice.delete({ where: { id: device1.deviceId } });
    await prisma.tabletEnrollment.delete({ where: { id: enrollmentId } });
    await prisma.venue.deleteMany({ where: { id: { in: createdVenues } } });
    await app.close();
  });

  it('lets exactly one of two simultaneous assignments of the same PIN in a venue succeed', async () => {
    for (let round = 0; round < 5; round += 1) {
      const pin = `5${round}5${round}`;
      const a = await staffMember(`race-a-${round}`, [venue1]);
      const b = await staffMember(`race-b-${round}`, [venue1]);
      const results = await Promise.allSettled([setOwnPin(a, pin), setOwnPin(b, pin)]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(await holdersAt(venue1, pin)).toBe(1);
    }
  });

  it('never lets a venue grant create a collision: the PIN elevates there only once set again', async () => {
    const pin = '6161';
    const a = await staffMember('grant-a', [venue1]);
    const b = await staffMember('grant-b', [venue2]);
    await setPin(a, pin);
    await setPin(b, pin); // a different venue: allowed
    await administration.grantVenue(owner, b, venue1);

    expect(await holdersAt(venue1, pin)).toBe(1);
    const elevated = await app.get(TabletAuthService).elevateStaff(device1, pin);
    expect(elevated.staff.id).toBe(a);
    const view = (await administration.list(organizationId)).find((s) => s.id === b)!;
    expect(view.venueIds).toEqual([venue1, venue2].sort());
    expect(view.tabletPinVenueIds).toEqual([venue2]);

    // Setting the same PIN again now checks the new venue too, and is refused.
    await expect(setPin(b, pin)).rejects.toThrow('This PIN is not available');
    // Another PIN enrols in both venues.
    await setPin(b, '7272');
    const after = (await administration.list(organizationId)).find((s) => s.id === b)!;
    expect(after.tabletPinVenueIds).toEqual([venue1, venue2].sort());
  });

  it('keeps the invariant under concurrent grants and PIN changes', async () => {
    for (let round = 0; round < 5; round += 1) {
      const pin = `8${round}8${round}`;
      const holder = await staffMember(`mixed-holder-${round}`, [venue1]);
      await setPin(holder, pin);
      const mover = await staffMember(`mixed-mover-${round}`, [venue2]);
      await Promise.allSettled([
        administration.grantVenue(owner, mover, venue1),
        setOwnPin(mover, pin),
      ]);
      expect(await holdersAt(venue1, pin)).toBe(1);
    }
  });

  it('counts a deactivated colleague’s PIN, so reactivating them cannot collide', async () => {
    const pin = '9191';
    const a = await staffMember('inactive-a', [venue1]);
    const b = await staffMember('inactive-b', [venue1]);
    await setPin(a, pin);
    await administration.setActive(owner, a, false);
    await expect(setPin(b, pin)).rejects.toThrow('This PIN is not available');
    await administration.setActive(owner, a, true);
    expect(await holdersAt(venue1, pin)).toBe(1);
  });

  it('enrols someone else’s PIN only in the venues the actor holds', async () => {
    const manager = await staffMember('scoped-manager', [venue1], StaffRole.manager);
    const managerActor: StaffActor = {
      id: manager,
      email: `${TAG}-scoped-manager@example.test`,
      role: StaffRole.manager,
      organizationId,
    };
    const cashier = await staffMember('scoped-cashier', [venue1, venue2]);
    await setPin(cashier, '3434', managerActor);
    const view = (await administration.list(organizationId)).find((s) => s.id === cashier)!;
    expect(view.tabletPinVenueIds).toEqual([venue1]);

    const elsewhere = await staffMember('scoped-elsewhere', [venue2]);
    await expect(setPin(elsewhere, '3535', managerActor)).rejects.toThrow(
      'venues you have been granted',
    );
  });

  it('decides with the actor’s current state, not the state when the request was authenticated', async () => {
    const admin = await staffMember('stale-admin', [venue1], StaffRole.admin);
    const target = await staffMember('stale-target', [venue1]);
    const tokenActor: StaffActor = {
      id: admin,
      email: `${TAG}-stale-admin@example.test`,
      role: StaffRole.admin,
      organizationId,
    };

    // Demoted after authenticating: every change is refused, nothing changes.
    await administration.update(owner, admin, { role: StaffRole.viewer });
    await expect(administration.setActive(tokenActor, target, false)).rejects.toThrow();
    await expect(administration.resetCredential(tokenActor, target)).rejects.toThrow();
    await expect(administration.grantVenue(tokenActor, target, venue2)).rejects.toThrow();
    await expect(setPin(target, '4545', tokenActor)).rejects.toThrow();

    // Restored to admin but deactivated: still refused.
    await administration.update(owner, admin, { role: StaffRole.admin });
    await administration.setActive(owner, admin, false);
    await expect(administration.setActive(tokenActor, target, false)).rejects.toThrow(
      'can no longer make this change',
    );
    const unchanged = await prisma.staff.findUniqueOrThrow({
      where: { id: target },
      include: { venueAccess: true },
    });
    expect(unchanged.isActive).toBe(true);
    expect(unchanged.pinHash).toBeNull();
    expect(unchanged.venueAccess.map((g) => g.venueId)).toEqual([venue1]);
  });

  it('serializes changes to one staff member: a change made after a role change sees the new role', async () => {
    const admin = await staffMember('serial-admin', [venue1], StaffRole.admin);
    const adminActor: StaffActor = {
      id: admin,
      email: `${TAG}-serial-admin@example.test`,
      role: StaffRole.admin,
      organizationId,
    };
    for (let round = 0; round < 5; round += 1) {
      const target = await staffMember(`serial-target-${round}`, [venue1]);
      // The owner promotes the target to admin while the admin deactivates
      // them. An admin may not manage an admin: whichever commits second
      // must see the first.
      const [promote, deactivate] = await Promise.allSettled([
        administration.update(owner, target, { role: StaffRole.admin }),
        administration.setActive(adminActor, target, false),
      ]);
      const row = await prisma.staff.findUniqueOrThrow({ where: { id: target } });
      expect(promote.status).toBe('fulfilled');
      // Either serial order is legitimate: the admin deactivated a cashier
      // who was then promoted, or the promotion came first and the admin,
      // re-reading the target under its lock, was refused. Never both
      // halves of one and the other.
      if (deactivate.status === 'fulfilled') {
        expect(row.isActive).toBe(false);
      } else {
        expect(String(deactivate.reason)).toMatch(/Forbidden|may not/i);
        expect(row.isActive).toBe(true);
      }
      expect(row.role).toBe(StaffRole.admin);
    }
  });
});
