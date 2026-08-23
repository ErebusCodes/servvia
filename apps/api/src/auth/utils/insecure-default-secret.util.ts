/**
 * The values checked into `.env.example` (`JWT_ACCESS_SECRET`/
 * `JWT_REFRESH_SECRET`) and `docker-compose.yml`'s own separate fallback
 * defaults for the same two variables — see this repository's standing
 * `INSECURE_DEFAULT_PIN` precedent (insecure-default-pin.util.ts) for the
 * identical reasoning applied there. A production deployment that boots
 * with either checked-in value lets anyone who has read this repository's
 * source forge a valid staff/device/manager JWT for any identity — a
 * strictly worse outcome than the guessable-PIN case that precedent
 * guards against, since a forged JWT bypasses every PIN check entirely.
 * Checked once, at process startup (see main.ts's bootstrap()), not
 * per-request — unlike the PIN checks, nothing about a JWT secret's use
 * varies per call, so there is no need to re-check it on every sign/verify.
 * This never fires in local development (`NODE_ENV !== 'production'`), so
 * it changes no existing dev/test behaviour — only a genuinely
 * misconfigured production deploy.
 */
const INSECURE_DEFAULT_SECRETS = new Set<string>([
  // apps/api/.env.example
  'verdura-local-dev-only-access-secret-32chars-min',
  'verdura-local-dev-only-refresh-secret-32chars-min',
  // docker-compose.yml's own separate fallback defaults
  'local-docker-access-secret-change-me',
  'local-docker-refresh-secret-change-me',
]);

export class InsecureDefaultSecretError extends Error {
  constructor(surface: string) {
    super(
      `${surface} is still configured with a checked-in default value — refusing to start in production until this is changed.`,
    );
    this.name = 'InsecureDefaultSecretError';
  }
}

export function assertSecretNotInsecureDefault(configuredSecret: string | undefined, surface: string): void {
  if (
    process.env.NODE_ENV === 'production' &&
    configuredSecret !== undefined &&
    INSECURE_DEFAULT_SECRETS.has(configuredSecret)
  ) {
    throw new InsecureDefaultSecretError(surface);
  }
}
