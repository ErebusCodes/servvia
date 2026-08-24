/**
 * The values checked into `.env.example` (`JWT_ACCESS_SECRET`/
 * `JWT_REFRESH_SECRET`/`INTERNAL_SERVICE_TOKEN`/`SEED_OWNER_PASSWORD`) and
 * `docker-compose.yml`'s own separate fallback defaults for the same
 * variables — see this repository's standing `INSECURE_DEFAULT_PIN`
 * precedent (insecure-default-pin.util.ts) for the identical reasoning
 * applied there. A production deployment that boots with any checked-in
 * value lets anyone who has read this repository's source forge a valid
 * staff/device/manager JWT, call any internal-service-only endpoint, or log
 * in as the seeded owner account — strictly worse outcomes than the
 * guessable-PIN case that precedent guards against, since each one bypasses
 * PIN checks (or all auth) entirely. JWT/service-token secrets are checked
 * once, at process startup (see main.ts's bootstrap()); SEED_OWNER_PASSWORD
 * is checked once, at seed time (see prisma/seed.ts) — neither varies
 * per-request, so there's no need to re-check on every call the way PINs
 * are. This never fires in local development (`NODE_ENV !== 'production'`),
 * so it changes no existing dev/test/seed behaviour — only a genuinely
 * misconfigured production deploy or seed run.
 */
const INSECURE_DEFAULT_SECRETS = new Set<string>([
  // apps/api/.env.example
  'verdura-local-dev-only-access-secret-32chars-min',
  'verdura-local-dev-only-refresh-secret-32chars-min',
  // docker-compose.yml's own separate fallback defaults
  'local-docker-access-secret-change-me',
  'local-docker-refresh-secret-change-me',
  'local-docker-service-token-change-me',
  'change-me-in-production',
  'change-me-internal-service-token-32chars',
]);

export class InsecureDefaultSecretError extends Error {
  constructor(surface: string) {
    super(
      `${surface} is still configured with a checked-in default value — refusing to start in production until this is changed.`,
    );
    this.name = 'InsecureDefaultSecretError';
  }
}

export function assertSecretNotInsecureDefault(
  configuredSecret: string | undefined,
  surface: string,
): void {
  if (
    process.env.NODE_ENV === 'production' &&
    configuredSecret !== undefined &&
    INSECURE_DEFAULT_SECRETS.has(configuredSecret)
  ) {
    throw new InsecureDefaultSecretError(surface);
  }
}
