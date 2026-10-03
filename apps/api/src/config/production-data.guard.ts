import { PrinterConnectionType } from '@prisma/client';
import { isProductionRuntime } from './runtime-environment';

/** The part of PrismaService this check reads. */
export interface PrinterCounter {
  printer: {
    count(args: {
      where: { connectionType: PrinterConnectionType; isActive: boolean };
    }): Promise<number>;
  };
}

/**
 * Production startup checks that need the database (Story 1.5). A simulated
 * printer is a development fixture: in production it would make a ticket look
 * dispatched while nothing printed. Production refuses to start while one is
 * active, instead of failing every job at runtime. Returns one message per
 * problem, never including secret values; empty outside production.
 */
export async function productionDataViolations(
  prisma: PrinterCounter,
  ...env: [nodeEnv?: string]
): Promise<string[]> {
  if (!isProductionRuntime(...env)) return [];
  const violations: string[] = [];
  const simulated = await prisma.printer.count({
    where: { connectionType: PrinterConnectionType.simulated, isActive: true },
  });
  if (simulated > 0) {
    violations.push(
      `${simulated} active printer(s) use the development-only "simulated" connection type`,
    );
  }
  return violations;
}
