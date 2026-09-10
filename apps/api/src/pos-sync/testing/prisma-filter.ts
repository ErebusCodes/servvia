/**
 * The Prisma filter semantics the in-memory test doubles share.
 *
 * WHY THIS IS ITS OWN MODULE. Two hand-written stores stand in for Prisma in
 * this tree - `native-order-harness.ts`, which carries whole services across a
 * service, and the smaller store inside `native-round-reconciliation.spec.ts`,
 * which drives the sweep in isolation. Both evaluate `where` clauses, and both
 * are only worth anything if they evaluate them the SAME way. When they each
 * owned a copy, one of them gained `updateMany` and the other did not, and the
 * production code that started calling it failed nine tests in a store that had
 * simply never heard of the method.
 *
 * THE RULE THAT MAKES THESE DOUBLES WORTH HAVING. `matches` genuinely evaluates
 * the filter, and an operator it does not model THROWS rather than being
 * ignored. A store that silently dropped an unmodelled operator would return
 * every row for a query the production code wrote to return one - which is not
 * a weak test, it is an inverted one: it would pass hardest exactly when the
 * guard under test had been deleted.
 *
 * WHAT IT IS NOT. It is not a Prisma emulator. It has no transactions, no
 * isolation, and no concurrency - see `native-round-recovery.integration-spec.ts`
 * for the load-bearing claims that are proven against real PostgreSQL instead,
 * because those are precisely the claims an in-memory object cannot make.
 */

export type Row = Record<string, unknown>;

/**
 * One field's condition.
 *
 * The operator subset is deliberately small and deliberately loud: it covers
 * exactly what the sweeps and the round service actually issue, and anything
 * else is a hard error at the point of use.
 */
export function matchesLeaf(value: unknown, condition: unknown): boolean {
  if (condition === null) return value === null || value === undefined;
  if (typeof condition !== 'object' || condition instanceof Date || Array.isArray(condition)) {
    return value === condition;
  }

  for (const [op, operand] of Object.entries(condition as Row)) {
    switch (op) {
      case 'not':
        if (matchesLeaf(value, operand)) return false;
        break;
      case 'in':
        if (!(operand as unknown[]).includes(value)) return false;
        break;
      case 'notIn':
        if ((operand as unknown[]).includes(value)) return false;
        break;
      case 'lt':
        if (!(value != null && (value as number) < (operand as number))) return false;
        break;
      case 'lte':
        if (!(value != null && (value as number) <= (operand as number))) return false;
        break;
      case 'gt':
        if (!(value != null && (value as number) > (operand as number))) return false;
        break;
      case 'gte':
        if (!(value != null && (value as number) >= (operand as number))) return false;
        break;
      default:
        // Deliberately loud. A filter operator this double does not model
        // would otherwise be quietly ignored, and a test that ignores a filter
        // is a test that cannot fail for the reason it exists.
        throw new Error(`the in-memory Prisma double does not model operator '${op}'`);
    }
  }
  return true;
}

/** A whole `where` clause, including the `AND`/`OR` combinators Prisma allows. */
export function matches(row: Row, where: Row | undefined): boolean {
  if (!where) return true;
  for (const [key, condition] of Object.entries(where)) {
    if (key === 'OR') {
      if (!(condition as Row[]).some((c) => matches(row, c))) return false;
      continue;
    }
    if (key === 'AND') {
      if (!(condition as Row[]).every((c) => matches(row, c))) return false;
      continue;
    }
    if (!matchesLeaf(row[key], condition)) return false;
  }
  return true;
}

/**
 * `updateMany`, modelled for what the production code relies on.
 *
 * THIS IS A COMPARE-AND-SET, AND THAT IS THE WHOLE POINT. Every caller in the
 * native round path issues `updateMany` with the CURRENT STATE in the `where`
 * clause - `{ id, state: 'unresolved' }`, `{ id, state: { in: RECONCILABLE } }`
 * - precisely so that a row somebody else has already moved matches nothing and
 * is left alone. The count is the return value that carries that decision: 0
 * means "you lost the race, change nothing", and a double that always answered
 * 1 would assert the opposite of the safety property.
 *
 * So: filter first, mutate only what matched, and report how many. Rows that do
 * not match are not touched, which is the behaviour the losing writer depends
 * on.
 */
export function applyUpdateMany(rows: Row[], where: Row | undefined, data: Row): { count: number } {
  let count = 0;
  for (const row of rows) {
    if (!matches(row, where)) continue;
    Object.assign(row, data);
    count += 1;
  }
  return { count };
}
