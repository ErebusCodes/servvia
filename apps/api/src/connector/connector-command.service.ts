import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes, randomUUID } from 'crypto';
import * as argon2 from 'argon2';
import { ConnectorCommand, ConnectorCommandStatus, Prisma, Staff, StaffRole } from '@prisma/client';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../audit/audit.service';
import { ConnectorIdentity } from './connector.service';
import { ConnectorCommandReportDto } from './dto/connector-command-report.dto';

/** The only command type this story implements. Synthetic, side-effect-free. */
export const SELF_TEST_COMMAND_TYPE = 'connector.self_test.v1';
export const SELF_TEST_REQUIRED_CAPABILITY = 'connector.self_test.v1';
const SELF_TEST_SCHEMA_VERSION = 1;

const MAX_PAYLOAD_BYTES = 4096;
const COMMAND_TTL_MS = 60 * 60 * 1000; // 1 hour: a command not accepted by then is never offered again
const CLAIM_LEASE_MS = 2 * 60 * 1000; // 2 minutes: a claim not accepted within this window is reclaimable
const TERMINAL_REPORT_WINDOW_MS = 5 * 60 * 1000; // 5 minutes after acceptance before an unresolved command is `unknown`
const MAX_POLL_BATCH = 5; // commands returned per poll call
const MAX_OUTSTANDING_PER_INSTALLATION = 20; // claimed+accepted rows a single installation may hold at once
const SWEEP_BATCH_LIMIT = 200; // rows touched per sweep tick, per transition kind

export interface ConnectorCommandView {
  id: string;
  commandType: string;
  schemaVersion: number;
  payload: unknown;
  requiredCapability: string | null;
  correlationId: string | null;
  causationId: string | null;
  leaseExpiresAt: Date | null;
}

export interface ConnectorCommandStatusView {
  id: string;
  commandType: string;
  status: ConnectorCommandStatus;
  claimedByInstallationId: string | null;
  createdAt: Date;
  acceptedAt: Date | null;
  reportedAt: Date | null;
  resultType: string | null;
  failureReason: string | null;
}

/**
 * Story 2-10: the durable command envelope + state machine that an
 * authenticated Story 2-9 connector identity claims work against.
 *
 * `CONNECTOR_ACCEPTED` (this service's `accepted` status) means only that
 * the authenticated connector durably persisted responsibility for the
 * command. It is never evidence that Idealpos, EFTPOS, KDS, or a printer
 * were contacted or that any external operation succeeded — no method here
 * may be read otherwise, and the only command type this story implements
 * (`connector.self_test.v1`) has no real-world side effect at all.
 */
@Injectable()
export class ConnectorCommandService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogService: AuditLogService,
  ) {}

  /**
   * Takes a lazy factory, not a pre-built event object: the durable effect
   * this is called after has already committed, so building the event
   * (which, for connector-triggered actions, includes resolving the
   * synthetic system actor — itself a DB write) must happen INSIDE this
   * method's own try/catch too. An earlier version of this method took a
   * pre-built object, which meant `await this.systemAuditEvent(...)` was
   * evaluated as a call argument BEFORE this method's try/catch even
   * started — so a transient failure resolving the system actor would
   * throw uncaught, turning an already-successful accept/report/sweep
   * transition into a client-visible 500 exactly like the bug this pattern
   * exists to prevent (found in this story's own independent review;
   * mirrors story 2-9's identical `logAuditEventSafely` fix).
   */
  private async logAuditEventSafely(
    buildEvent: () => Promise<Parameters<AuditLogService['logAuthEvent']>[0]>,
    actionForLogging: string,
  ): Promise<void> {
    try {
      const event = await buildEvent();
      await this.auditLogService.logAuthEvent(event);
    } catch (auditError) {
      console.error(
        '[ConnectorCommandService] audit log write failed (non-fatal):',
        actionForLogging,
        auditError,
      );
    }
  }

  /** Mirrors ConnectorService#resolveConnectorSystemActor — see that method's doc comment. */
  private async resolveCommandSystemActor(organizationId: string): Promise<Staff> {
    const email = `connector-command-system+${organizationId}@verdura.internal`;
    return this.prisma.staff.upsert({
      where: { email },
      create: {
        organizationId,
        email,
        name: 'Connector Command System',
        passwordHash: await argon2.hash(randomBytes(32).toString('base64url'), {
          type: argon2.argon2id,
        }),
        role: StaffRole.viewer,
        isActive: false,
      },
      update: {},
    });
  }

  /**
   * Creates this story's one tracer command type for a venue. Idempotent on
   * (organizationId, venueId, idempotencyKey): a repeated call with the same
   * key returns the original command rather than creating a second one.
   */
  async createTracerCommand(
    organizationId: string,
    venueId: string,
    createdByStaffId: string,
    createdByStaffEmail: string,
    createdByStaffRole: StaffRole,
    idempotencyKey?: string,
  ): Promise<ConnectorCommandStatusView> {
    const venue = await this.prisma.venue.findFirst({ where: { id: venueId, organizationId } });
    if (!venue) {
      throw new NotFoundException('Venue not found in your organization');
    }

    const key = idempotencyKey ?? randomUUID();
    const view = await this.createCommand({
      organizationId,
      venueId,
      commandType: SELF_TEST_COMMAND_TYPE,
      schemaVersion: SELF_TEST_SCHEMA_VERSION,
      idempotencyKey: key,
      requiredCapability: SELF_TEST_REQUIRED_CAPABILITY,
      payload: { echoNonce: randomBytes(16).toString('base64url'), createdForTracer: true },
      createdByStaffId,
    });

    await this.logAuditEventSafely(
      () =>
        Promise.resolve({
          organizationId,
          venueId,
          actorId: createdByStaffId,
          actorEmail: createdByStaffEmail,
          actorRole: createdByStaffRole,
          action: 'CONNECTOR_COMMAND_CREATED',
          resource: 'connector_command',
          resourceId: view.id,
          after: { commandType: view.commandType, idempotencyKey: key },
        }),
      'CONNECTOR_COMMAND_CREATED',
    );

    return view;
  }

  /**
   * Generic, reusable idempotent command creation — the primitive every
   * real command-producing service (this file's own tracer command, and
   * any future durable-record dispatcher such as an IdealPOS order-submit
   * producer) should call rather than re-implementing the P2002-safe
   * idempotent-creation dance itself. Idempotent on
   * (organizationId, venueId, idempotencyKey): a repeated call with the
   * same key returns the original command rather than creating a second
   * one — this is the actual duplicate-submission guarantee for any
   * caller that derives idempotencyKey from a stable durable-record id
   * (e.g. an Order's own id), not merely a convenience.
   *
   * Does not audit-log itself: a real staff-triggered caller (like
   * createTracerCommand above) has a meaningful actor to attribute the
   * event to; a system/dispatcher-triggered caller does not, and should
   * log its own domain-appropriate event (or none) rather than this
   * method inventing a synthetic actor for every command type.
   */
  async createCommand(params: {
    organizationId: string;
    venueId: string;
    commandType: string;
    schemaVersion: number;
    payload: unknown;
    idempotencyKey: string;
    requiredCapability?: string;
    sourceAggregateType?: string;
    sourceRecordId?: string;
    correlationId?: string;
    causationId?: string;
    createdByStaffId?: string;
  }): Promise<ConnectorCommandStatusView> {
    const payloadBytes = Buffer.byteLength(JSON.stringify(params.payload), 'utf8');
    if (payloadBytes > MAX_PAYLOAD_BYTES) {
      throw new BadRequestException('Command payload exceeds the maximum allowed size');
    }

    let command: ConnectorCommand;
    try {
      command = await this.prisma.connectorCommand.create({
        data: {
          organizationId: params.organizationId,
          venueId: params.venueId,
          commandType: params.commandType,
          schemaVersion: params.schemaVersion,
          idempotencyKey: params.idempotencyKey,
          requiredCapability: params.requiredCapability ?? null,
          payload: params.payload as Prisma.InputJsonValue,
          expiresAt: new Date(Date.now() + COMMAND_TTL_MS),
          createdByStaffId: params.createdByStaffId ?? null,
          sourceAggregateType: params.sourceAggregateType ?? null,
          sourceRecordId: params.sourceRecordId ?? null,
          correlationId: params.correlationId ?? null,
          causationId: params.causationId ?? null,
        },
      });
    } catch (error) {
      if (error instanceof PrismaClientKnownRequestError && error.code === 'P2002') {
        const existing = await this.prisma.connectorCommand.findUnique({
          where: {
            organizationId_venueId_idempotencyKey: {
              organizationId: params.organizationId,
              venueId: params.venueId,
              idempotencyKey: params.idempotencyKey,
            },
          },
        });
        if (existing) return this.toStatusView(existing);
      }
      throw error;
    }

    return this.toStatusView(command);
  }

  /**
   * Claims up to a bounded batch of eligible commands for the authenticated
   * connector's own venue. Never returns a command belonging to another
   * venue or organization — identity is resolved from the authenticated
   * credential (ConnectorAuthGuard), never a caller-supplied venue id.
   */
  async poll(identity: ConnectorIdentity): Promise<ConnectorCommandView[]> {
    const installation = await this.prisma.connectorInstallation.findUnique({
      where: { id: identity.installationId },
      select: { reportedCapabilities: true },
    });
    const capabilities = this.parseCapabilities(installation?.reportedCapabilities);

    const outstanding = await this.prisma.connectorCommand.count({
      where: {
        claimedByInstallationId: identity.installationId,
        status: { in: [ConnectorCommandStatus.claimed, ConnectorCommandStatus.accepted] },
      },
    });
    if (outstanding >= MAX_OUTSTANDING_PER_INSTALLATION) return [];

    const now = new Date();
    const candidates = await this.prisma.connectorCommand.findMany({
      where: {
        organizationId: identity.organizationId,
        venueId: identity.venueId,
        expiresAt: { gt: now },
        OR: [
          { status: ConnectorCommandStatus.pending },
          { status: ConnectorCommandStatus.claimed, leaseExpiresAt: { lt: now } },
        ],
      },
      orderBy: { createdAt: 'asc' },
      take: MAX_POLL_BATCH * 3, // over-fetch: some candidates may lose their claim race or be capability-mismatched
    });

    const claimed: ConnectorCommandView[] = [];
    for (const candidate of candidates) {
      if (
        claimed.length >= Math.min(MAX_POLL_BATCH, MAX_OUTSTANDING_PER_INSTALLATION - outstanding)
      )
        break;
      if (candidate.requiredCapability && !capabilities.has(candidate.requiredCapability)) continue;

      if (candidate.status === ConnectorCommandStatus.claimed) {
        // Stale lease. Exhausted its redelivery budget -> terminal `expired`,
        // never offered again. Otherwise, reclaim it (see below).
        if (candidate.claimAttemptCount >= candidate.maxClaimAttempts) {
          await this.prisma.connectorCommand.updateMany({
            where: {
              id: candidate.id,
              status: ConnectorCommandStatus.claimed,
              leaseExpiresAt: { lt: now },
            },
            data: { status: ConnectorCommandStatus.expired },
          });
          continue;
        }
      }

      const result = await this.prisma.connectorCommand.updateMany({
        where: {
          id: candidate.id,
          expiresAt: { gt: new Date() },
          OR: [
            { status: ConnectorCommandStatus.pending },
            { status: ConnectorCommandStatus.claimed, leaseExpiresAt: { lt: new Date() } },
          ],
        },
        data: {
          status: ConnectorCommandStatus.claimed,
          claimedByInstallationId: identity.installationId,
          claimedAt: new Date(),
          leaseExpiresAt: new Date(Date.now() + CLAIM_LEASE_MS),
          claimAttemptCount: { increment: 1 },
        },
      });
      if (result.count !== 1) continue; // lost the race to another poll — move on, never error

      claimed.push({
        id: candidate.id,
        commandType: candidate.commandType,
        schemaVersion: candidate.schemaVersion,
        payload: candidate.payload,
        requiredCapability: candidate.requiredCapability,
        correlationId: candidate.correlationId,
        causationId: candidate.causationId,
        leaseExpiresAt: new Date(Date.now() + CLAIM_LEASE_MS),
      });
    }

    return claimed;
  }

  /**
   * `reported` is whatever the connector last self-reported via Story 2-9's
   * heartbeat (`ConnectorHeartbeatDto.capabilities`), stored verbatim as
   * `ConnectorInstallation.reportedCapabilities`. Accepts either an array of
   * capability-name strings or an object whose own keys are capability
   * names (either is a reasonable shape for a self-reported JSON blob).
   */
  private parseCapabilities(reported: unknown): Set<string> {
    if (Array.isArray(reported)) {
      return new Set(reported.filter((v): v is string => typeof v === 'string'));
    }
    if (reported && typeof reported === 'object') {
      return new Set(Object.keys(reported));
    }
    return new Set();
  }

  /**
   * CONNECTOR_ACCEPTED. May only be called by the installation that
   * currently holds the claim. Idempotent: a repeated accept call from the
   * same installation for an already-`accepted` command succeeds silently.
   */
  async accept(commandId: string, identity: ConnectorIdentity): Promise<void> {
    const result = await this.prisma.connectorCommand.updateMany({
      where: {
        id: commandId,
        organizationId: identity.organizationId,
        venueId: identity.venueId,
        status: ConnectorCommandStatus.claimed,
        claimedByInstallationId: identity.installationId,
      },
      data: {
        status: ConnectorCommandStatus.accepted,
        acceptedAt: new Date(),
        terminalReportDeadline: new Date(Date.now() + TERMINAL_REPORT_WINDOW_MS),
      },
    });

    if (result.count === 1) {
      await this.logAuditEventSafely(
        () => this.systemAuditEvent(identity, commandId, 'CONNECTOR_COMMAND_ACCEPTED'),
        'CONNECTOR_COMMAND_ACCEPTED',
      );
      return;
    }

    const existing = await this.prisma.connectorCommand.findFirst({
      where: { id: commandId, organizationId: identity.organizationId, venueId: identity.venueId },
    });
    if (!existing) throw new NotFoundException('Command not found for this venue');
    if (
      existing.status === ConnectorCommandStatus.accepted &&
      existing.claimedByInstallationId === identity.installationId
    ) {
      return; // idempotent: already accepted by this same installation
    }
    throw new ConflictException(
      'Command is not currently claimed by this connector installation, or is no longer claimable',
    );
  }

  /**
   * Truthful terminal report. May only be called by the installation that
   * accepted the command. Idempotent for a byte-identical repeat (same
   * idempotencyKey); a conflicting outcome/resultType for an already-
   * terminal command is rejected and audited, never silently overwritten.
   */
  async report(
    commandId: string,
    identity: ConnectorIdentity,
    dto: ConnectorCommandReportDto,
  ): Promise<void> {
    const targetStatus =
      dto.outcome === 'succeeded'
        ? ConnectorCommandStatus.succeeded
        : ConnectorCommandStatus.failed;

    const result = await this.prisma.connectorCommand.updateMany({
      where: {
        id: commandId,
        organizationId: identity.organizationId,
        venueId: identity.venueId,
        status: ConnectorCommandStatus.accepted,
        claimedByInstallationId: identity.installationId,
      },
      data: {
        status: targetStatus,
        resultType: dto.resultType,
        resultPayload: dto.resultPayload as Prisma.InputJsonValue | undefined,
        failureReason: dto.outcome === 'failed' ? (dto.failureReason ?? null) : null,
        reportedAt: new Date(),
        reportIdempotencyKey: dto.idempotencyKey,
      },
    });

    if (result.count === 1) {
      const auditAction =
        dto.outcome === 'succeeded' ? 'CONNECTOR_COMMAND_SUCCEEDED' : 'CONNECTOR_COMMAND_FAILED';
      await this.logAuditEventSafely(
        () =>
          this.systemAuditEvent(identity, commandId, auditAction, { resultType: dto.resultType }),
        auditAction,
      );
      return;
    }

    const existing = await this.prisma.connectorCommand.findFirst({
      where: { id: commandId, organizationId: identity.organizationId, venueId: identity.venueId },
    });
    if (!existing) throw new NotFoundException('Command not found for this venue');

    const isSameInstallation = existing.claimedByInstallationId === identity.installationId;
    const isAlreadyTerminal =
      existing.status === ConnectorCommandStatus.succeeded ||
      existing.status === ConnectorCommandStatus.failed;

    if (isSameInstallation && isAlreadyTerminal) {
      const isIdenticalRepeat =
        existing.reportIdempotencyKey === dto.idempotencyKey &&
        existing.status === targetStatus &&
        existing.resultType === dto.resultType;
      if (isIdenticalRepeat) return; // idempotent: same report, already recorded

      // Conflicting terminal report for an already-terminal command — reject
      // and audit; never overwrite the original recorded outcome.
      await this.logAuditEventSafely(
        () =>
          this.systemAuditEvent(identity, commandId, 'CONNECTOR_COMMAND_CONFLICTING_REPORT', {
            existingStatus: existing.status,
            existingResultType: existing.resultType,
            attemptedStatus: targetStatus,
            attemptedResultType: dto.resultType,
          }),
        'CONNECTOR_COMMAND_CONFLICTING_REPORT',
      );
      throw new ConflictException(
        'A different terminal outcome was already recorded for this command',
      );
    }

    if (existing.status === ConnectorCommandStatus.unknown) {
      // DL-093: the command already left `accepted` via the reconciliation
      // sweep before this report arrived. Never resurrected — `unknown`
      // stays terminal in this generic layer (a domain-specific owner that
      // knows a given command type's downstream idempotency guarantee, e.g.
      // IdealposOrderDispatcherService, may independently decide to create
      // a NEW command; this method itself never reopens the old one). This
      // report is otherwise silent today (a bare 409, no durable trace) —
      // audit it non-mutatingly so a late true outcome is never lost from
      // an operator's view, even though it cannot be applied here. Scoped
      // to org/venue/installation identity already, by the `existing`
      // lookup above.
      await this.logAuditEventSafely(
        () =>
          this.systemAuditEvent(
            identity,
            commandId,
            'CONNECTOR_COMMAND_LATE_REPORT_AFTER_UNKNOWN',
            {
              attemptedOutcome: dto.outcome,
              attemptedResultType: dto.resultType,
              attemptedFailureReason: dto.failureReason ?? null,
              reportingInstallationId: identity.installationId,
              sameInstallationAsAccepted: isSameInstallation,
            },
          ),
        'CONNECTOR_COMMAND_LATE_REPORT_AFTER_UNKNOWN',
      );
      throw new ConflictException(
        'Command already transitioned to unknown (reconciliation-required) before this report arrived — the report was recorded in the audit log but the command was not mutated',
      );
    }

    throw new ConflictException(
      'Command is not currently accepted by this connector installation, or is no longer reportable',
    );
  }

  async cancel(
    commandId: string,
    organizationId: string,
    venueId: string,
    cancelledByStaffId: string,
    cancelledByStaffEmail: string,
    cancelledByStaffRole: StaffRole,
  ): Promise<void> {
    const result = await this.prisma.connectorCommand.updateMany({
      where: {
        id: commandId,
        organizationId,
        venueId,
        status: { in: [ConnectorCommandStatus.pending, ConnectorCommandStatus.claimed] },
      },
      data: {
        status: ConnectorCommandStatus.cancelled,
        cancelledAt: new Date(),
        cancelledByStaffId,
      },
    });
    if (result.count !== 1) {
      throw new NotFoundException(
        'No pending or claimed command with this id was found for this venue — it may already be accepted or terminal',
      );
    }

    await this.logAuditEventSafely(
      () =>
        Promise.resolve({
          organizationId,
          venueId,
          actorId: cancelledByStaffId,
          actorEmail: cancelledByStaffEmail,
          actorRole: cancelledByStaffRole,
          action: 'CONNECTOR_COMMAND_CANCELLED',
          resource: 'connector_command',
          resourceId: commandId,
        }),
      'CONNECTOR_COMMAND_CANCELLED',
    );
  }

  async getStatus(organizationId: string, venueId: string): Promise<ConnectorCommandStatusView[]> {
    const commands = await this.prisma.connectorCommand.findMany({
      where: { organizationId, venueId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return commands.map((c) => this.toStatusView(c));
  }

  /**
   * Periodic reconciliation sweep — mirrors PosSyncDispatcherService's
   * (story 9-3) claim/staleness pattern. Bounded per tick (SWEEP_BATCH_LIMIT
   * per transition kind). Never writes a truthful terminal outcome itself —
   * only `expired` (nothing was ever accepted) and `unknown`
   * (reconciliation-required, accepted but never resolved).
   */
  async sweep(): Promise<{
    expiredNeverClaimed: number;
    expiredStaleLease: number;
    markedUnknown: number;
  }> {
    const now = new Date();

    const expiredNeverClaimed = await this.prisma.connectorCommand.updateMany({
      where: {
        status: ConnectorCommandStatus.pending,
        expiresAt: { lt: now },
        id: {
          in: await this.idsForSweep(ConnectorCommandStatus.pending, { expiresAt: { lt: now } }),
        },
      },
      data: { status: ConnectorCommandStatus.expired },
    });

    const staleLeaseIds = await this.idsForSweep(ConnectorCommandStatus.claimed, {
      leaseExpiresAt: { lt: now },
    });
    let expiredStaleLease = 0;
    for (const id of staleLeaseIds) {
      const row = await this.prisma.connectorCommand.findUnique({ where: { id } });
      if (!row) continue;
      if (row.claimAttemptCount >= row.maxClaimAttempts) {
        const r = await this.prisma.connectorCommand.updateMany({
          where: { id, status: ConnectorCommandStatus.claimed, leaseExpiresAt: { lt: new Date() } },
          data: { status: ConnectorCommandStatus.expired },
        });
        expiredStaleLease += r.count;
      }
      // Below the attempt budget: left as-is (status stays `claimed`, lease
      // expired) — the next poll() call from the venue's active installation
      // will reclaim it. The sweep only finalizes exhausted rows; poll() is
      // the actual redelivery mechanism, matching story 9-3's precedent of
      // separating claim-eligibility (query-time) from claim-finalization.
    }

    const unknownIds = await this.idsForSweep(ConnectorCommandStatus.accepted, {
      terminalReportDeadline: { lt: now },
    });
    let markedUnknown = 0;
    for (const id of unknownIds) {
      const r = await this.prisma.connectorCommand.updateMany({
        where: {
          id,
          status: ConnectorCommandStatus.accepted,
          terminalReportDeadline: { lt: new Date() },
        },
        data: { status: ConnectorCommandStatus.unknown },
      });
      if (r.count === 1) {
        const row = await this.prisma.connectorCommand.findUnique({ where: { id } });
        if (row) {
          await this.logAuditEventSafely(
            () =>
              this.systemAuditEventForVenue(
                row.organizationId,
                row.venueId,
                id,
                'CONNECTOR_COMMAND_MARKED_UNKNOWN',
              ),
            'CONNECTOR_COMMAND_MARKED_UNKNOWN',
          );
        }
        markedUnknown += r.count;
      }
    }

    return { expiredNeverClaimed: expiredNeverClaimed.count, expiredStaleLease, markedUnknown };
  }

  private async idsForSweep(
    status: ConnectorCommandStatus,
    extra: Prisma.ConnectorCommandWhereInput,
  ): Promise<string[]> {
    const rows = await this.prisma.connectorCommand.findMany({
      where: { status, ...extra },
      select: { id: true },
      take: SWEEP_BATCH_LIMIT,
    });
    return rows.map((r) => r.id);
  }

  private toStatusView(c: ConnectorCommand): ConnectorCommandStatusView {
    return {
      id: c.id,
      commandType: c.commandType,
      status: c.status,
      claimedByInstallationId: c.claimedByInstallationId,
      createdAt: c.createdAt,
      acceptedAt: c.acceptedAt,
      reportedAt: c.reportedAt,
      resultType: c.resultType,
      failureReason: c.failureReason,
    };
  }

  private async systemAuditEvent(
    identity: ConnectorIdentity,
    commandId: string,
    action: string,
    after?: Record<string, unknown>,
  ) {
    return this.systemAuditEventForVenue(
      identity.organizationId,
      identity.venueId,
      commandId,
      action,
      after,
    );
  }

  private async systemAuditEventForVenue(
    organizationId: string,
    venueId: string,
    commandId: string,
    action: string,
    after?: Record<string, unknown>,
  ) {
    const systemActor = await this.resolveCommandSystemActor(organizationId);
    return {
      organizationId,
      venueId,
      actorId: systemActor.id,
      actorEmail: systemActor.email,
      actorRole: StaffRole.viewer,
      action,
      resource: 'connector_command',
      resourceId: commandId,
      after,
    };
  }
}
