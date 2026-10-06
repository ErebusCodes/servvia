import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Staff, StaffRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../audit/audit.service';
import { StaffSessionService } from '../auth/staff-session.service';
import { CredentialSetupService, unusablePasswordHash } from './credential-setup.service';
import { liveActor, lockStaffRows } from './staff-locks';
import {
  assertMayAdministerStaff,
  assertMayAssign,
  assertMayManage,
  assertNotSelf,
} from './staff-admin.policy';

/** The administering staff member, from the verified staff session. */
export interface StaffActor {
  id: string;
  email: string;
  role: StaffRole;
  organizationId: string;
}

/** What the API returns about a staff member: never a hash, PIN or code. */
export interface StaffAccountView {
  id: string;
  name: string;
  email: string;
  role: StaffRole;
  isActive: boolean;
  hasTabletPin: boolean;
  /** Venues where the tablet PIN elevates a tablet (Story 8.3). */
  tabletPinVenueIds: string[];
  venueIds: string[];
  pendingCredentialSetup: boolean;
  lastLoginAt: Date | null;
}

/** A credential setup code, shown once to the issuing owner or admin. */
export interface IssuedCredentialSetup {
  code: string;
  expiresAt: Date;
}

/**
 * Synthetic, non-loginable system rows (kiosk, tablet-device and connector
 * actors of earlier stories, all @verdura.internal) are not staff and are
 * never listed or administered here.
 */
const NOT_SYSTEM_ACCOUNT = {
  NOT: { email: { endsWith: '@verdura.internal' } },
} satisfies Prisma.StaffWhereInput;

const staffWithAccess = {
  venueAccess: { select: { venueId: true, pinEnrolledAt: true } },
  credentialTokens: {
    where: { usedAt: null, revokedAt: null },
    select: { expiresAt: true },
  },
} satisfies Prisma.StaffInclude;

type StaffWithAccess = Prisma.StaffGetPayload<{ include: typeof staffWithAccess }>;

function view(staff: StaffWithAccess, now = new Date()): StaffAccountView {
  return {
    id: staff.id,
    name: staff.name,
    email: staff.email,
    role: staff.role,
    isActive: staff.isActive,
    hasTabletPin: !!staff.pinHash,
    tabletPinVenueIds: staff.pinHash
      ? staff.venueAccess
          .filter((a) => a.pinEnrolledAt)
          .map((a) => a.venueId)
          .sort()
      : [],
    venueIds: staff.venueAccess.map((a) => a.venueId).sort(),
    pendingCredentialSetup: staff.credentialTokens.some((t) => t.expiresAt > now),
    lastLoginAt: staff.lastLoginAt,
  };
}

/**
 * Staff account administration (Story 8.1, STF-1; the transitional Nest
 * administration path under O-2): create, update, deactivate, reactivate and
 * remove staff, grant and revoke venues, and reset credentials. Every change
 * is authorized (staff-admin.policy.ts), scoped to the actor's organization,
 * audited, and, where it removes authority, revokes the staff member's
 * sessions (Story 2.8). The change, the revocation and the audit record
 * commit in one transaction: none of them can happen without the others.
 *
 * Story 8.3: every decision is made inside that transaction, from the state
 * it protects: the actor's and the staff member's rows are locked and read
 * again (lockForChange), so a request authenticated before the actor was
 * demoted, deactivated or lost a venue, or a concurrent change to the same
 * staff member, cannot act on a stale picture.
 */
@Injectable()
export class StaffAdministrationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
    private readonly sessions: StaffSessionService,
    private readonly credentials: CredentialSetupService,
  ) {}

  async list(organizationId: string): Promise<StaffAccountView[]> {
    const staff = await this.prisma.staff.findMany({
      where: { organizationId, deletedAt: null, ...NOT_SYSTEM_ACCOUNT },
      include: staffWithAccess,
      orderBy: { name: 'asc' },
    });
    return staff.map((s) => view(s));
  }

  async create(
    actor: StaffActor,
    input: { name: string; email: string; role: StaffRole; venueIds: string[] },
  ): Promise<{ staff: StaffAccountView; credentialSetup: IssuedCredentialSetup }> {
    assertMayAdministerStaff(actor.role);
    assertMayAssign(actor.role, input.role);
    const venueIds = [...new Set(input.venueIds)];
    const passwordHash = await unusablePasswordHash();
    try {
      const { staff, setup } = await this.prisma.$transaction(async (tx) => {
        await lockStaffRows(tx, [actor.id]);
        const live = await this.liveAdministrator(tx, actor);
        assertMayAssign(live.role, input.role);
        await this.assertActorHoldsVenues(tx, live, venueIds);
        const created = await tx.staff.create({
          data: {
            organizationId: live.organizationId,
            email: input.email.trim().toLowerCase(),
            name: input.name.trim(),
            role: input.role,
            passwordHash,
          },
        });
        if (venueIds.length > 0) {
          await tx.venueAccess.createMany({
            data: venueIds.map((venueId) => ({
              staffId: created.id,
              venueId,
              grantedById: live.id,
            })),
          });
        }
        const issued = await this.credentials.issue(created.id, { staffId: live.id }, tx);
        const loaded = await this.load(live.organizationId, created.id, tx);
        await this.log(tx, live, 'STAFF_CREATED', created.id, undefined, {
          name: loaded.name,
          email: loaded.email,
          role: loaded.role,
          venueIds,
        });
        await this.log(tx, live, 'STAFF_CREDENTIAL_SETUP_ISSUED', created.id, undefined, {
          expiresAt: issued.expiresAt,
        });
        return { staff: loaded, setup: issued };
      });
      return { staff: view(staff), credentialSetup: setup };
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('This email address cannot be used for a new staff account');
      }
      throw err;
    }
  }

  async update(
    actor: StaffActor,
    staffId: string,
    input: { name?: string; role?: StaffRole },
  ): Promise<StaffAccountView> {
    assertMayAdministerStaff(actor.role);
    const updated = await this.prisma.$transaction(async (tx) => {
      const { live, target } = await this.lockForChange(tx, actor, staffId);
      const roleChanges = input.role !== undefined && input.role !== target.role;
      if (roleChanges) {
        assertNotSelf(live.id, target.id, 'change the role of');
        assertMayAssign(live.role, input.role!);
      }
      const data: Prisma.StaffUpdateInput = {};
      if (input.name !== undefined) data.name = input.name.trim();
      if (roleChanges) data.role = input.role;
      if (Object.keys(data).length === 0) return target;
      if (roleChanges && target.role === StaffRole.owner) {
        await this.assertAnotherActiveOwner(tx, target);
      }
      await tx.staff.update({ where: { id: target.id }, data });
      if (roleChanges) await this.sessions.revokeAllForStaff(target.id, 'role_changed', tx);
      const after = await this.load(live.organizationId, target.id, tx);
      await this.log(
        tx,
        live,
        'STAFF_UPDATED',
        target.id,
        { name: target.name, role: target.role },
        { name: after.name, role: after.role },
      );
      return after;
    });
    return view(updated);
  }

  async setActive(actor: StaffActor, staffId: string, active: boolean): Promise<StaffAccountView> {
    assertMayAdministerStaff(actor.role);
    const updated = await this.prisma.$transaction(async (tx) => {
      const { live, target } = await this.lockForChange(tx, actor, staffId);
      if (!active) assertNotSelf(live.id, target.id, 'deactivate');
      if (target.isActive === active) return target;
      if (!active && target.role === StaffRole.owner) {
        await this.assertAnotherActiveOwner(tx, target);
      }
      await tx.staff.update({ where: { id: target.id }, data: { isActive: active } });
      if (!active) await this.sessions.revokeAllForStaff(target.id, 'deactivated', tx);
      await this.log(
        tx,
        live,
        active ? 'STAFF_ACTIVATED' : 'STAFF_DEACTIVATED',
        target.id,
        { isActive: target.isActive },
        { isActive: active },
      );
      return this.load(live.organizationId, target.id, tx);
    });
    return view(updated);
  }

  /**
   * Removes a staff member: the row is kept (their history references it)
   * but marked deleted and inactive, with no PIN, no venue grants and no
   * usable setup code, and every session revoked.
   */
  async remove(actor: StaffActor, staffId: string): Promise<void> {
    assertMayAdministerStaff(actor.role);
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      const { live, target } = await this.lockForChange(tx, actor, staffId);
      assertNotSelf(live.id, target.id, 'remove');
      if (target.role === StaffRole.owner) await this.assertAnotherActiveOwner(tx, target);
      await tx.staff.update({
        where: { id: target.id },
        data: { deletedAt: now, isActive: false, pinHash: null, pinSetAt: null },
      });
      await tx.venueAccess.deleteMany({ where: { staffId: target.id } });
      await tx.staffCredentialToken.updateMany({
        where: { staffId: target.id, usedAt: null, revokedAt: null },
        data: { revokedAt: now },
      });
      await this.sessions.revokeAllForStaff(target.id, 'removed', tx);
      await this.log(
        tx,
        live,
        'STAFF_REMOVED',
        target.id,
        { role: target.role, venueIds: target.venueAccess.map((a) => a.venueId) },
        undefined,
      );
    });
  }

  /**
   * A new grant does not enrol the staff member's tablet PIN in the venue
   * (Story 8.3): the PIN was checked unique only where it was set, so it
   * elevates a tablet here once it is set again.
   */
  async grantVenue(actor: StaffActor, staffId: string, venueId: string): Promise<StaffAccountView> {
    assertMayAdministerStaff(actor.role);
    const updated = await this.prisma.$transaction(async (tx) => {
      const { live, target } = await this.lockForChange(tx, actor, staffId);
      await this.assertActorHoldsVenues(tx, live, [venueId]);
      if (target.venueAccess.some((a) => a.venueId === venueId)) return target;
      // A concurrent grant of the same venue is not an error: the grant exists.
      const created = await tx.venueAccess.createMany({
        data: [{ staffId: target.id, venueId, grantedById: live.id }],
        skipDuplicates: true,
      });
      if (created.count > 0) {
        await this.log(tx, live, 'STAFF_VENUE_GRANTED', target.id, undefined, { venueId }, venueId);
      }
      return this.load(live.organizationId, target.id, tx);
    });
    return view(updated);
  }

  async revokeVenue(
    actor: StaffActor,
    staffId: string,
    venueId: string,
  ): Promise<StaffAccountView> {
    assertMayAdministerStaff(actor.role);
    const updated = await this.prisma.$transaction(async (tx) => {
      const { live, target } = await this.lockForChange(tx, actor, staffId);
      await this.assertActorHoldsVenues(tx, live, [venueId]);
      const removed = await tx.venueAccess.deleteMany({
        where: { staffId: target.id, venueId },
      });
      if (removed.count > 0) {
        // Venue access is checked live on every request (Core, and the Nest
        // API since Story 2.10), so no session needs revoking: the next
        // request at that venue is refused.
        await this.log(tx, live, 'STAFF_VENUE_REVOKED', target.id, { venueId }, undefined, venueId);
      }
      return this.load(live.organizationId, target.id, tx);
    });
    return view(updated);
  }

  /**
   * Resets a staff member's credential: their password stops working at
   * once, every session is revoked, and a new setup code is issued.
   */
  async resetCredential(actor: StaffActor, staffId: string): Promise<IssuedCredentialSetup> {
    assertMayAdministerStaff(actor.role);
    const passwordHash = await unusablePasswordHash();
    return this.prisma.$transaction(async (tx) => {
      const { live, target } = await this.lockForChange(tx, actor, staffId);
      assertNotSelf(live.id, target.id, 'reset the credential of');
      await tx.staff.update({ where: { id: target.id }, data: { passwordHash } });
      const setup = await this.credentials.issue(target.id, { staffId: live.id }, tx);
      await this.sessions.revokeAllForStaff(target.id, 'credential_reset', tx);
      await this.log(tx, live, 'STAFF_CREDENTIAL_RESET', target.id, undefined, {
        expiresAt: setup.expiresAt,
      });
      return setup;
    });
  }

  // ── helpers ──────────────────────────────────────────────────────────

  private async load(
    organizationId: string,
    staffId: string,
    tx: Prisma.TransactionClient = this.prisma,
  ): Promise<StaffWithAccess> {
    const staff = await tx.staff.findFirst({
      where: { id: staffId, organizationId, deletedAt: null, ...NOT_SYSTEM_ACCOUNT },
      include: staffWithAccess,
    });
    if (!staff) throw new NotFoundException('Staff member not found in your organization');
    return staff;
  }

  /** The actor, re-read under its row lock, as an administrator of staff. */
  private async liveAdministrator(
    tx: Prisma.TransactionClient,
    actor: StaffActor,
  ): Promise<StaffActor> {
    const live = await liveActor(tx, actor);
    assertMayAdministerStaff(live.role);
    return { id: live.id, email: live.email, role: live.role, organizationId: live.organizationId };
  }

  /**
   * Locks the actor's and the staff member's rows, then reads both again:
   * every decision of the change is made from this state (Story 8.3).
   */
  private async lockForChange(
    tx: Prisma.TransactionClient,
    actor: StaffActor,
    staffId: string,
  ): Promise<{ live: StaffActor; target: StaffWithAccess }> {
    await lockStaffRows(tx, [actor.id, staffId]);
    const live = await this.liveAdministrator(tx, actor);
    const target = await this.load(live.organizationId, staffId, tx);
    assertMayManage(live.role, target.role);
    return { live, target };
  }

  /**
   * Venue access applies to every role, owner included (Story 2.2): an actor
   * grants, revokes or assigns only venues of their organization that they
   * hold themselves. Read inside the change's transaction, under the actor's
   * row lock, which a change to the actor's own grants also takes.
   */
  private async assertActorHoldsVenues(
    tx: Prisma.TransactionClient,
    actor: StaffActor,
    venueIds: string[],
  ): Promise<void> {
    if (venueIds.length === 0) return;
    const held = await tx.venueAccess.findMany({
      where: {
        staffId: actor.id,
        venueId: { in: venueIds },
        venue: { organizationId: actor.organizationId },
      },
      select: { venueId: true },
    });
    if (held.length !== venueIds.length) {
      throw new ForbiddenException('You may only assign venues you have been granted');
    }
  }

  /**
   * An organization always keeps at least one active owner. Runs inside the
   * transaction that demotes, deactivates or removes the owner, after taking
   * a per-organization lock, so two such changes cannot each see the other
   * owner still active and together leave none.
   */
  private async assertAnotherActiveOwner(
    tx: Prisma.TransactionClient,
    target: Staff,
  ): Promise<void> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`staff-owner-guard:${target.organizationId}`}, 0))`;
    const others = await tx.staff.count({
      where: {
        organizationId: target.organizationId,
        role: StaffRole.owner,
        isActive: true,
        deletedAt: null,
        id: { not: target.id },
        ...NOT_SYSTEM_ACCOUNT,
      },
    });
    if (others === 0) {
      throw new ConflictException('The organization must keep at least one active owner');
    }
  }

  private log(
    tx: Prisma.TransactionClient,
    actor: StaffActor,
    action: string,
    staffId: string,
    before: Record<string, unknown> | undefined,
    after: Record<string, unknown> | undefined,
    venueId?: string,
  ) {
    return this.audit.logAuthEvent(
      {
        organizationId: actor.organizationId,
        venueId,
        actorId: actor.id,
        actorEmail: actor.email,
        actorRole: actor.role,
        action,
        resource: 'staff',
        resourceId: staffId,
        before,
        after,
      },
      tx,
    );
  }
}
