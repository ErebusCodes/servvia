export const QUEUE_NAMES = {
  PRINT_JOBS: 'print-jobs',
  POS_SYNC: 'pos-sync',
  EMAILS: 'emails',
  CALENDAR: 'calendar',
} as const;

/**
 * Story 12.14: the Redis key prefix of every BullMQ queue and worker.
 * Unset in production, so BullMQ's own default ('bull') applies and the
 * deployed queue keys are unchanged. The integration-test harness sets a
 * unique prefix per spec file, so a stale or concurrent process (which uses
 * the default or another run's prefix) can never consume that run's jobs.
 */
export const QUEUE_PREFIX_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export function queuePrefix(configured: string | undefined): string | undefined {
  const value = configured?.trim();
  return value ? value : undefined;
}
