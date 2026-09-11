/**
 * WHAT A RESTART DOES TO A ROUND THAT WAS IN FLIGHT WHEN THE PROCESS DIED.
 *
 * THE HOLE THIS CLOSES. `submitting` occupies a table's single in-flight slot,
 * so while one stands `openRound` refuses every further round on that table.
 * Nothing swept it. The reconciler's candidate set is
 * `[awaiting_native_confirmation, unresolved]`; `sendRound` will only touch a
 * `drafting` round; manual resolution will only touch an `unresolved` one. So a
 * round left `submitting` by a crash, a deploy, or a Windows update was
 * reachable by no route and no sweeper, held its lines forever, and killed its
 * table permanently. The tablet showed nothing alarming, because `submitting`
 * reports `requiresReconciliation: false` - the waiter learned about it by
 * pressing Send and getting a 409 that would never stop happening.
 *
 * THIS SERVICE IS NOT THE RECONCILER, AND MUST NOT BECOME IT. The reconciler
 * asks "what does the till say happened?" and needs an evidence reader to
 * answer. This asks a narrower question that needs nothing but our own
 * database: "did the writer reach the send boundary before we died?" Those are
 * different questions with different evidence, which is why adding these states
 * to `RECONCILABLE` would have been the wrong shape - it would have handed
 * rounds to a predicate built to reason about a till's token row, about rounds
 * that may never have reached a socket.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THE DECISION TABLE. Every branch is driven by a DURABLE row, never by a
 * guess, and the asymmetry is deliberate: releasing a round that might have
 * been sent duplicates a customer's food, while stranding one that was not
 * costs a waiter a re-key. So the burden of proof is entirely on release.
 *
 *   drafting, no attempt        The crash landed between `openRound`
 *                               committing and `sendRound` writing
 *                               `submitting`. The writer is not reached until
 *                               after that write, so nothing can have been
 *                               sent. -> RELEASE.
 *
 *   submitting, no attempt      `recordSendInitiated` is awaited to durability
 *                               BEFORE the socket opens. No attempt row means
 *                               the writer never crossed that boundary.
 *                               -> RELEASE.
 *
 *   attempt, bytesLeftHost      Proven nothing was written - a connect failure
 *   = false                     or a pre-write timeout. -> RELEASE.
 *
 *   attempt, bytesLeftHost      Bytes went out. What became of them is exactly
 *   = true                      the question this process cannot answer.
 *                               -> UNRESOLVED.
 *
 *   attempt, outcome never      The crash landed between the socket opening
 *   recorded (NULL)             and the outcome being written, which is the
 *                               widest and most dangerous window: the packet
 *                               may be in the receiver's buffer, on the tab,
 *                               or in the kitchen. -> UNRESOLVED.
 *
 * A ROUND WHOSE OUTCOME WAS RECORDED AS `bytesLeftHost: true` GOES TO
 * `unresolved` EVEN WHEN THE RESPONSE IS KNOWN. It is tempting to reconstruct
 * the decision from `outcomeKind` and `responseNote` - a recorded LOCK, after
 * all, proves non-acceptance and would license a release. That is refused on
 * purpose: `responseNote` is documented as a sanitised diagnostic string, not
 * an authoritative input, and rebuilding a safety decision out of a truncated
 * log field is how a release ends up being granted by a substring. The cost of
 * refusing is one extra manual resolution on a table; the cost of getting it
 * wrong is a second docket.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * IT CANNOT SEND. No writer, no transport, no import of either - the same
 * structural guarantee the reconciler has, and for the same reason: this code
 * runs precisely when a round MAY ALREADY BE ON THE TAB.
 *
 * IT IS IDEMPOTENT AND RACE-SAFE. Every write is a compare-and-set naming the
 * state the sweep read, so two API processes starting together settle each
 * round exactly once and the loser changes nothing.
 */

import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NativeRoundState } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';

/** The states no other sweeper and no route can reach. */
const ORPHANABLE: NativeRoundState[] = [NativeRoundState.drafting, NativeRoundState.submitting];

/** What recovery decided about one round. */
export type RecoveryVerdict =
  /** Provably never sent. Lines released, round settled as `abandoned`. */
  | { readonly kind: 'released'; readonly basis: string }
  /** May have reached the till. Lines kept, round escalated to `unresolved`. */
  | { readonly kind: 'unresolved'; readonly basis: string }
  /** Too young to judge - an HTTP request is probably still holding it. */
  | { readonly kind: 'stillInFlight'; readonly basis: string };

export interface RecoverySweepResult {
  readonly examined: number;
  readonly released: number;
  readonly unresolved: number;
  readonly stillInFlight: number;
  readonly errored: number;
}

/** The durable facts a verdict is allowed to depend on. Nothing else. */
export interface RecoveryEvidence {
  readonly state: NativeRoundState;
  readonly ageMs: number;
  readonly hasAttempt: boolean;
  /** Null when the transport never got to record an outcome. */
  readonly bytesLeftHost: boolean | null;
}

/**
 * THE WHOLE DECISION, as a pure function.
 *
 * Separated from the writes so it can be exhaustively tested against every
 * crash boundary without a database, and so that a reader can check the
 * asymmetry - release requires proof, everything else does not - by reading one
 * screen rather than by following control flow through a transaction.
 */
export function decideRecovery(evidence: RecoveryEvidence, minimumAgeMs: number): RecoveryVerdict {
  // A round younger than the longest a send can legitimately take is almost
  // certainly held by a live HTTP request right now. Recovering it would race
  // the very writer it is trying to clean up after - and could release the
  // lines of a round whose socket is open this instant.
  if (evidence.ageMs < minimumAgeMs) {
    return {
      kind: 'stillInFlight',
      basis: `only ${Math.round(evidence.ageMs / 1000)}s old; a send may still be running`,
    };
  }

  if (!evidence.hasAttempt) {
    // `recordSendInitiated` is awaited to durability before the socket opens.
    // No attempt row is therefore positive evidence that no byte was written -
    // the single strongest thing this service can know, and the only shape of
    // evidence that licenses giving the lines back.
    return {
      kind: 'released',
      basis:
        `left ${evidence.state} with no send attempt recorded; the writer never reached the ` +
        'send boundary, so nothing can have left this host',
    };
  }

  if (evidence.bytesLeftHost === false) {
    return {
      kind: 'released',
      basis: 'the attempt durably records bytesLeftHost=false; nothing was written to the socket',
    };
  }

  if (evidence.bytesLeftHost === null) {
    return {
      kind: 'unresolved',
      basis:
        'an attempt was recorded but its outcome never was; the process died between opening ' +
        'the socket and learning what happened, so the packet may be on the tab',
    };
  }

  return {
    kind: 'unresolved',
    basis: 'the attempt durably records bytesLeftHost=true; the packet may be on the tab',
  };
}

@Injectable()
export class NativeRoundRecoveryService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NativeRoundRecoveryService.name);
  private timer: NodeJS.Timeout | null = null;

  private readonly enabled: boolean;
  private readonly sweepIntervalMs: number;
  private readonly batchSize: number;
  private readonly minimumAgeMs: number;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(ConfigService) config: ConfigService,
  ) {
    // ONE SWITCH WITH THE RECONCILER, deliberately. The dangerous configuration
    // is reconciliation running without recovery: rounds would escalate and be
    // settled while orphaned ones silently accumulated on dead tables. Tying
    // them together means an operator cannot produce that combination by
    // setting one variable and forgetting the other.
    this.enabled = config.get<string>('IDEALPOS_NATIVE_RECONCILE_ENABLED') === 'true';
    this.sweepIntervalMs = Number(
      config.get<string>('IDEALPOS_NATIVE_RECOVERY_INTERVAL_MS') ?? 60_000,
    );
    this.batchSize = Number(config.get<string>('IDEALPOS_NATIVE_RECOVERY_BATCH_SIZE') ?? 50);
    // MUST EXCEED THE LONGEST A SEND CAN LEGITIMATELY TAKE, or recovery races
    // live requests. The transport's three phases are each bounded at 60s by
    // `TIMEOUT_BOUNDS.max`, so 180s is the ceiling a correctly-configured send
    // can reach; 5 minutes leaves room above it without leaving a table dead
    // for a whole service.
    this.minimumAgeMs = Number(
      config.get<string>('IDEALPOS_NATIVE_RECOVERY_MIN_AGE_MS') ?? 5 * 60_000,
    );
  }

  /**
   * RECOVERY RUNS AT STARTUP, which is the point of it.
   *
   * A crash is not a state a process enters - it is a process ending and
   * another starting over the same rows. The interval afterwards is for the
   * case where THIS instance is the one that dies mid-send while others keep
   * serving; the startup pass is for the case where every instance went down
   * together, which on a single-box restaurant deployment is the usual one.
   */
  onModuleInit(): void {
    // Same rule as the reconciler: the unattended timer never runs under the
    // test suite, where it would mutate another spec's fixture rows. Tests
    // call sweep() directly, which is the whole of the behaviour anyway.
    if (process.env.NODE_ENV === 'test') return;
    if (!this.enabled) {
      this.logger.log(
        'Native round recovery is off (IDEALPOS_NATIVE_RECONCILE_ENABLED is not "true").',
      );
      return;
    }

    // Deliberately not awaited and deliberately not blocking startup: a
    // database hiccup during recovery must not stop the API serving orders.
    void this.sweep().catch((err: unknown) => {
      this.logger.error(
        `Startup recovery pass failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    });

    this.timer = setInterval(() => {
      this.sweep().catch((err: unknown) => {
        this.logger.error(
          `Recovery tick failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
    }, this.sweepIntervalMs);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /**
   * THE CLOCK THE AGE GATE IS MEASURED ON, and it must be the database's.
   *
   * `NativeTableRound.updatedAt` is written by POSTGRES, not by this process -
   * so comparing it against `new Date()` compares two clocks, and the
   * difference between them lands directly in `ageMs`. That was found by this
   * service's own PostgreSQL integration spec failing intermittently: with the
   * gate at 0 and the database a few milliseconds ahead, `ageMs` came out
   * NEGATIVE and every orphan was judged `stillInFlight`.
   *
   * At the shipped 5-minute gate a few milliseconds are nothing, and this is
   * not a bug anybody would have seen. THE DIRECTION THAT MATTERS IS THE OTHER
   * ONE: if the database's clock ever lags this process's by more than the
   * configured age - a VM resumed with a stale clock, a database host whose
   * NTP has drifted, a container on a laptop that slept - then `ageMs` is
   * inflated by exactly that lag, the gate is defeated, and this sweep judges
   * a round that a LIVE request is still sending. Releasing its lines is the
   * one outcome this service exists to make impossible.
   *
   * So the age is measured end to end on one clock: both `now` and `updatedAt`
   * come from the database, and no skew can enter the subtraction.
   *
   * A CALLER MAY STILL PASS ITS OWN `now`, which is how tests drive the gate
   * to a chosen age; that path is unchanged. And if the query fails, this
   * falls back to the process clock - which is exactly the behaviour that
   * shipped before, and is still bounded by a generous gate.
   */
  private async databaseNow(): Promise<Date> {
    try {
      const rows = await this.prisma.$queryRaw<{ now: Date }[]>`SELECT now() AS now`;
      const value = rows?.[0]?.now;
      if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
    } catch (err) {
      this.logger.warn(
        'Could not read the database clock for the recovery age gate; falling back to this ' +
          "process's clock, which is only safe while the gate stays generous: " +
          (err instanceof Error ? err.message : 'unknown error'),
      );
    }
    return new Date();
  }

  /**
   * One bounded pass over the rounds nothing else can reach.
   *
   * EVERY FACT IT USES COMES FROM THE DATABASE. There is no in-process memory
   * of what was in flight, which is what makes this correct after a restart:
   * a brand new instance over the same rows reaches the same verdicts, because
   * the rows are all there ever was. That now includes the CLOCK - see
   * `databaseNow`.
   */
  async sweep(explicitNow?: Date): Promise<RecoverySweepResult> {
    const now = explicitNow ?? (await this.databaseNow());
    const rounds = await this.prisma.nativeTableRound.findMany({
      where: { state: { in: ORPHANABLE } },
      orderBy: { createdAt: 'asc' },
      take: this.batchSize,
      include: {
        // Newest first: a round has at most one attempt today, but if a future
        // change ever mints a second, the one that decides safety is the most
        // recent - it is the one that may still be in flight.
        attempts: { orderBy: { sendInitiatedAt: 'desc' }, take: 1 },
      },
    });

    const result: RecoverySweepResult = {
      examined: rounds.length,
      released: 0,
      unresolved: 0,
      stillInFlight: 0,
      errored: 0,
    };
    const tally = result as {
      released: number;
      unresolved: number;
      stillInFlight: number;
      errored: number;
    };

    for (const round of rounds) {
      try {
        const attempt = round.attempts[0] ?? null;
        // `updatedAt` rather than `createdAt`: the age that matters is how long
        // the round has been SITTING in this state, and a round that moved
        // drafting -> submitting a moment ago is live however old the order is.
        const ageMs = now.getTime() - round.updatedAt.getTime();

        const verdict = decideRecovery(
          {
            state: round.state,
            ageMs,
            hasAttempt: attempt !== null,
            bytesLeftHost: attempt ? attempt.bytesLeftHost : null,
          },
          this.minimumAgeMs,
        );

        if (verdict.kind === 'stillInFlight') {
          tally.stillInFlight += 1;
          continue;
        }

        const won =
          verdict.kind === 'released'
            ? await this.releaseOrphan(round.id, round.state)
            : await this.escalateOrphan(round.id, round.state);

        if (!won) {
          // Another worker, or a live request finishing its own send, moved
          // this row first. Theirs is the newer information.
          this.logger.log(
            `Round ${round.id} moved on while recovery was reading it; leaving it alone.`,
          );
          tally.stillInFlight += 1;
          continue;
        }

        if (verdict.kind === 'released') {
          tally.released += 1;
          this.logger.warn(
            `RECOVERED round ${round.id}: ${verdict.basis}. Its lines are back on the order ` +
              'and the next send will carry them.',
          );
        } else {
          tally.unresolved += 1;
          this.logger.warn(
            `Round ${round.id} is UNRESOLVED after a restart: ${verdict.basis}. Its lines stay ` +
              'claimed, it will NOT be sent again, and a human must check the table on the till.',
          );
        }
      } catch (err) {
        tally.errored += 1;
        this.logger.error(
          `Recovering round ${round.id} failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    return result;
  }

  /**
   * Provably never sent: settle it and give the lines back, atomically.
   *
   * `abandoned` rather than a new state - this is exactly what `abandoned`
   * already means everywhere else in this module: Verdura did not send it, and
   * nothing was created.
   */
  private async releaseOrphan(roundId: string, expected: NativeRoundState): Promise<boolean> {
    return await this.prisma.$transaction(async (tx) => {
      // STATE FIRST AND CONDITIONALLY. If anybody moved this row since the
      // read, the update matches nothing and the lines are never touched -
      // which matters most here, because this is the branch that could put a
      // round's food onto a later bill if it fired against a live send.
      const { count } = await tx.nativeTableRound.updateMany({
        where: { id: roundId, state: expected },
        data: { state: NativeRoundState.abandoned, payloadFrozenAt: null },
      });
      if (count === 0) return false;
      await tx.orderItem.updateMany({
        where: { nativeRoundId: roundId },
        data: { nativeRoundId: null },
      });
      return true;
    });
  }

  /**
   * May have reached the till: say so, and change nothing else.
   *
   * The lines stay claimed - that is what stops them reaching a later round -
   * and `unresolved` is where a human can settle it. This is the branch that
   * turns a permanently dead table into one a manager can clear.
   */
  private async escalateOrphan(roundId: string, expected: NativeRoundState): Promise<boolean> {
    const { count } = await this.prisma.nativeTableRound.updateMany({
      where: { id: roundId, state: expected },
      data: { state: NativeRoundState.unresolved },
    });
    return count > 0;
  }
}
