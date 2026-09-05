import {
  DINE_IN_ROUTE_CONFIG_KEY,
  DineInPosRoute,
  IDEALPOS_NATIVE_TABLE_ROUND_COMMAND_TYPE,
  commandTypeForRoute,
  resolveDineInRoute,
  routeOfCommandType,
} from './dine-in-route';

/**
 * The pure half of the routing seam. Everything here is a decision made
 * without I/O, which is why it can be stated exhaustively.
 */
describe('resolveDineInRoute', () => {
  describe('the production default', () => {
    it.each([undefined, null, '', '   '])(
      'defaults to WEBIT when the route is not configured (%p)',
      (configuredValue) => {
        const decision = resolveDineInRoute({ configuredValue });

        expect(decision).toMatchObject({ decision: 'route', route: DineInPosRoute.WEBIT, sticky: false });
      },
    );

    it('never selects NATIVE without an explicit, valid configuration value', () => {
      // The whole point of the seam being inert: no absence, blank or
      // whitespace can be read as an invitation to use the uncertified route.
      for (const configuredValue of [undefined, null, '', ' ', '\t']) {
        const decision = resolveDineInRoute({ configuredValue });
        expect(decision.decision === 'route' && decision.route).not.toBe(
          DineInPosRoute.NATIVE_IDEALPOS_TABLE,
        );
      }
    });
  });

  describe('explicit configuration', () => {
    it('selects WEBIT when configured to WEBIT', () => {
      expect(resolveDineInRoute({ configuredValue: 'WEBIT' })).toMatchObject({
        decision: 'route',
        route: DineInPosRoute.WEBIT,
      });
    });

    it('selects NATIVE_IDEALPOS_TABLE when configured to it', () => {
      expect(resolveDineInRoute({ configuredValue: 'NATIVE_IDEALPOS_TABLE' })).toMatchObject({
        decision: 'route',
        route: DineInPosRoute.NATIVE_IDEALPOS_TABLE,
      });
    });

    it('is tolerant of casing and surrounding whitespace, and of nothing else', () => {
      expect(resolveDineInRoute({ configuredValue: '  native_idealpos_table  ' })).toMatchObject({
        route: DineInPosRoute.NATIVE_IDEALPOS_TABLE,
      });
    });

    it.each(['NATIVE', 'native-idealpos-table', 'NATIVE_IDEALPOS_TABEL', 'both', 'WEBIT,NATIVE_IDEALPOS_TABLE'])(
      'REFUSES an unrecognized value (%s) rather than defaulting',
      (configuredValue) => {
        // Defaulting here would be the worst outcome during certification: an
        // operator who mistyped the native route would believe they were
        // exercising it while every order quietly went through Webit.
        const decision = resolveDineInRoute({ configuredValue });

        expect(decision.decision).toBe('refuse');
        expect(decision.reason).toContain(DINE_IN_ROUTE_CONFIG_KEY);
      },
    );

    it('a refusal is never a route, so a misconfiguration cannot dispatch anything at all', () => {
      const decision = resolveDineInRoute({ configuredValue: 'garbage' });

      expect(decision).not.toHaveProperty('route');
    });
  });

  describe('stickiness — durable state outranks configuration', () => {
    it('keeps an order on WEBIT even when configuration now says NATIVE', () => {
      const decision = resolveDineInRoute({
        configuredValue: 'NATIVE_IDEALPOS_TABLE',
        existingCommandType: 'idealpos.submit_order.v1',
      });

      expect(decision).toMatchObject({ decision: 'route', route: DineInPosRoute.WEBIT, sticky: true });
    });

    it('keeps an order on NATIVE even when configuration now says WEBIT', () => {
      // This is the one that matters most: an in-flight native round may
      // already have crossed the send boundary. A flag flip must not be able
      // to send the same order down Webit as well.
      const decision = resolveDineInRoute({
        configuredValue: 'WEBIT',
        existingCommandType: IDEALPOS_NATIVE_TABLE_ROUND_COMMAND_TYPE,
      });

      expect(decision).toMatchObject({
        decision: 'route',
        route: DineInPosRoute.NATIVE_IDEALPOS_TABLE,
        sticky: true,
      });
    });

    it('keeps an order on NATIVE even when configuration has become invalid', () => {
      const decision = resolveDineInRoute({
        configuredValue: 'nonsense',
        existingCommandType: IDEALPOS_NATIVE_TABLE_ROUND_COMMAND_TYPE,
      });

      expect(decision).toMatchObject({ route: DineInPosRoute.NATIVE_IDEALPOS_TABLE, sticky: true });
    });

    it('refuses when the existing command belongs to neither route', () => {
      // Something else owns this record. Choosing a route now could add a
      // second transport to an order that already has one.
      const decision = resolveDineInRoute({
        configuredValue: 'WEBIT',
        existingCommandType: 'connector.self_test.v1',
      });

      expect(decision.decision).toBe('refuse');
    });

    it('is a pure function of its inputs, so a restart cannot change the answer', () => {
      const inputs = {
        configuredValue: 'WEBIT',
        existingCommandType: IDEALPOS_NATIVE_TABLE_ROUND_COMMAND_TYPE,
      };

      expect(resolveDineInRoute(inputs)).toEqual(resolveDineInRoute(inputs));
    });
  });

  describe('route ↔ command type', () => {
    it('round-trips every route through its command type', () => {
      for (const route of Object.values(DineInPosRoute)) {
        expect(routeOfCommandType(commandTypeForRoute(route))).toBe(route);
      }
    });

    it('maps the two routes to DIFFERENT command types, so one command is never both', () => {
      expect(commandTypeForRoute(DineInPosRoute.WEBIT)).not.toBe(
        commandTypeForRoute(DineInPosRoute.NATIVE_IDEALPOS_TABLE),
      );
    });

    it.each([null, undefined, '', 'connector.self_test.v1', 'idealpos.order_status.v1'])(
      'returns null for a command type that is not a dine-in route (%p)',
      (commandType) => {
        expect(routeOfCommandType(commandType)).toBeNull();
      },
    );
  });
});
