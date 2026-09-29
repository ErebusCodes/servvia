import { ConflictException } from '@nestjs/common';
import { TableSessionStatus } from '@prisma/client';

/**
 * TEMPORARY occupancy bridge (Phase D3, docs/migration/README.md).
 *
 * Servvia Core (Go) owns table sessions. While this NestJS order path still
 * creates table orders, it must not seat a second party at a table whose
 * visit Servvia Core has opened: that table is occupied, even though no
 * legacy order is on it. The opposite direction is already guarded in Go
 * (a session cannot be opened on a table with an active legacy order).
 *
 * This path REFUSES rather than attaching to the session: attaching would
 * make Nest a second writer of canonical session orders.
 *
 * Race safety: persistOrder calls this inside its transaction after locking
 * the Table row FOR UPDATE; Servvia Core opens a session holding the same row
 * FOR SHARE. The two cannot interleave.
 *
 * DELETE WHEN: table order creation has switched from this path to Servvia
 * Core (the end of the Phase D3 cutover). Tests:
 * table-session-occupancy.spec.ts and test/orders.integration-spec.ts.
 */
export async function assertTableHasNoOpenSession(
  db: {
    tableSession: {
      findFirst(args: {
        where: { tableId: string; status: TableSessionStatus };
        select: { id: true };
      }): Promise<{ id: string } | null>;
    };
  },
  table: { id: string; tableNumber: string | null },
): Promise<void> {
  const open = await db.tableSession.findFirst({
    where: { tableId: table.id, status: TableSessionStatus.open },
    select: { id: true },
  });
  if (open) {
    throw new ConflictException(
      `Table ${table.tableNumber ?? table.id} has an open table session in Servvia Core`,
    );
  }
}
