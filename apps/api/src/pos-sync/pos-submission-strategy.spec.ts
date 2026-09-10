/**
 * The routing decision table, stated once, so a change to it is a change to
 * this file rather than an emergent property of a service.
 *
 * `route-exclusivity.spec.ts` proves the invariant end to end - real service,
 * real sweeps, real sockets. This proves the DECISION, cheaply and exhaustively,
 * including the branches that are awkward to reach through a running venue. The
 * two are complements: if this file passes and that one fails, the rule is right
 * and the wiring is wrong.
 */

import { PosSubmissionStrategy, ServiceMode } from '@prisma/client';

import { decidePosSubmissionStrategy, POS_STRATEGY_CONFIG_KEY } from './pos-submission-strategy';

const usable = { nativeWriterUsable: true } as const;
const unusable = {
  nativeWriterUsable: false,
  nativeWriterReasons: ['IDEALPOS_WAITERPAD_HOST is required'],
} as const;

describe('the configuration is not set - production, today', () => {
  it.each([undefined, null, '', '   '])('%p means webit, and is not an error', (value) => {
    const d = decidePosSubmissionStrategy({
      configuredValue: value,
      serviceMode: ServiceMode.dine_in,
      ...usable,
    });
    expect(d).toMatchObject({ decision: 'strategy', strategy: PosSubmissionStrategy.webit });
  });

  it('still means webit when the native writer is unusable - nothing to fail closed about', () => {
    const d = decidePosSubmissionStrategy({
      serviceMode: ServiceMode.dine_in,
      ...unusable,
    });
    // The critical negative: an unusable native writer must not break a venue
    // that never asked for native. Production has no native configuration at
    // all, and must keep creating orders exactly as it does today.
    expect(d).toMatchObject({ decision: 'strategy', strategy: PosSubmissionStrategy.webit });
  });
});

describe('the configuration selects a strategy explicitly', () => {
  it.each(['webit', 'WEBIT', ' Webit '])('%p selects webit', (value) => {
    expect(
      decidePosSubmissionStrategy({
        configuredValue: value,
        serviceMode: ServiceMode.dine_in,
        ...usable,
      }),
    ).toMatchObject({ strategy: PosSubmissionStrategy.webit });
  });

  it.each(['native_table_round', 'NATIVE_TABLE_ROUND', ' native_table_round '])(
    '%p selects native when the writer can send',
    (value) => {
      expect(
        decidePosSubmissionStrategy({
          configuredValue: value,
          serviceMode: ServiceMode.dine_in,
          ...usable,
        }),
      ).toMatchObject({ strategy: PosSubmissionStrategy.native_table_round });
    },
  );
});

describe('fail closed, never fail over', () => {
  it('refuses rather than falling back to webit when the native writer cannot send', () => {
    const d = decidePosSubmissionStrategy({
      configuredValue: 'native_table_round',
      serviceMode: ServiceMode.dine_in,
      ...unusable,
    });
    expect(d.decision).toBe('refuse');
    // The reason must name the real cause. "Unavailable" sends an operator
    // looking at the wrong system.
    expect(d.reason).toContain('IDEALPOS_WAITERPAD_HOST is required');
    // And it must never be mistakable for a route.
    expect(d).not.toHaveProperty('strategy');
  });

  it('refuses an unrecognised value rather than defaulting to either pipeline', () => {
    // The certification-killing typo: one letter, and every order silently
    // goes through the transport nobody is testing.
    const d = decidePosSubmissionStrategy({
      configuredValue: 'native_table_rouns',
      serviceMode: ServiceMode.dine_in,
      ...usable,
    });
    expect(d.decision).toBe('refuse');
    expect(d.reason).toContain(POS_STRATEGY_CONFIG_KEY);
    expect(d.reason).toContain('native_table_rouns');
  });

  it.each(['native', 'true', '1', 'order2', 'WEBIT_OR_NATIVE'])(
    'refuses the plausible-looking value %p',
    (value) => {
      expect(
        decidePosSubmissionStrategy({
          configuredValue: value,
          serviceMode: ServiceMode.dine_in,
          ...usable,
        }).decision,
      ).toBe('refuse');
    },
  );
});

describe('takeaway', () => {
  it('takes the Webit path it has always taken, even under the native strategy', () => {
    // Not a fallback. Order2 addresses a table and takeaway has none, so a
    // takeaway order was never eligible for the native route - routing it to
    // Webit adds no second transport to anything, and the dine-in exclusivity
    // invariant is untouched.
    const d = decidePosSubmissionStrategy({
      configuredValue: 'native_table_round',
      serviceMode: ServiceMode.takeaway,
      ...usable,
    });
    expect(d).toMatchObject({ decision: 'strategy', strategy: PosSubmissionStrategy.webit });
    expect(d.reason).toContain('takeaway');
  });

  it('is unaffected by an unusable native writer - it never needed one', () => {
    expect(
      decidePosSubmissionStrategy({
        configuredValue: 'native_table_round',
        serviceMode: ServiceMode.takeaway,
        ...unusable,
      }),
    ).toMatchObject({ decision: 'strategy', strategy: PosSubmissionStrategy.webit });
  });
});
