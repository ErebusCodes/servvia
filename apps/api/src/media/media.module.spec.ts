import { LocalStorageProvider } from './providers/local-storage.provider';
import { GcsStorageProvider } from './providers/gcs-storage.provider';
import { resolveProjectId, resolveStorageProvider } from './media.module';

// Regression coverage for a real defect found during Commit A's review: the
// GCS branch previously did `projectId as string, serviceAccountEmail as
// string` — a lying type assertion — so an incomplete GCS configuration
// silently constructed a GcsStorageProvider with `undefined` values instead
// of failing at boot. This locks in the fail-closed behavior instead.
//
// Extended for a second, related defect found later: GCS_MEDIA_BUCKET and
// GCS_MEDIA_PUBLIC_BUCKET were never validated here at all — a GCS-active
// process with either unset would boot, and MediaAssetsService's own
// `config.get(...) || <local-style default>` fallback would silently
// substitute a bucket name never reviewed by an operator, instead of
// failing closed like the project ID and service-account checks already
// did. This locks in the same fail-closed treatment for both bucket names.

const PROJECT_ID = 'proj';
const SERVICE_ACCOUNT_EMAIL = 'sa@proj.iam.gserviceaccount.com';
const MEDIA_BUCKET = 'verdura-media-originals';
const MEDIA_PUBLIC_BUCKET = 'verdura-media-public';

describe('resolveStorageProvider', () => {
  const local = Object.create(LocalStorageProvider.prototype) as LocalStorageProvider;

  it('returns the local provider whenever MEDIA_STORAGE_PROVIDER is not exactly "gcs", with no GCS variables set', () => {
    expect(
      resolveStorageProvider(undefined, undefined, undefined, undefined, undefined, local),
    ).toBe(local);
    expect(
      resolveStorageProvider('local', undefined, undefined, undefined, undefined, local),
    ).toBe(local);
  });

  it('never performs GCP credential lookup for the local provider (constructs no GcsStorageProvider)', () => {
    const provider = resolveStorageProvider(
      'local',
      undefined,
      undefined,
      undefined,
      undefined,
      local,
    );
    expect(provider).toBe(local);
    expect(provider).not.toBeInstanceOf(GcsStorageProvider);
  });

  it('treats an unknown/misspelled provider value ("GCS", "google-cloud-storage") the same as any other non-"gcs" value — falls back to local, never throws', () => {
    expect(
      resolveStorageProvider(
        'GCS',
        PROJECT_ID,
        SERVICE_ACCOUNT_EMAIL,
        MEDIA_BUCKET,
        MEDIA_PUBLIC_BUCKET,
        local,
      ),
    ).toBe(local);
    expect(
      resolveStorageProvider(
        'google-cloud-storage',
        PROJECT_ID,
        SERVICE_ACCOUNT_EMAIL,
        MEDIA_BUCKET,
        MEDIA_PUBLIC_BUCKET,
        local,
      ),
    ).toBe(local);
  });

  it('throws — never silently falls back to local — when gcs is selected but GCP_PROJECT_ID/GOOGLE_CLOUD_PROJECT is missing', () => {
    expect(() =>
      resolveStorageProvider(
        'gcs',
        undefined,
        SERVICE_ACCOUNT_EMAIL,
        MEDIA_BUCKET,
        MEDIA_PUBLIC_BUCKET,
        local,
      ),
    ).toThrow(/GCP_PROJECT_ID/);
  });

  it('throws when gcs is selected but neither GCP_PROJECT_ID nor GOOGLE_CLOUD_PROJECT is set', () => {
    expect(() =>
      resolveStorageProvider(
        'gcs',
        resolveProjectId(undefined, undefined),
        SERVICE_ACCOUNT_EMAIL,
        MEDIA_BUCKET,
        MEDIA_PUBLIC_BUCKET,
        local,
      ),
    ).toThrow(/GCP_PROJECT_ID/);
  });

  it('throws when gcs is selected but GCS_SERVICE_ACCOUNT_EMAIL is missing', () => {
    expect(() =>
      resolveStorageProvider(
        'gcs',
        PROJECT_ID,
        undefined,
        MEDIA_BUCKET,
        MEDIA_PUBLIC_BUCKET,
        local,
      ),
    ).toThrow(/GCS_SERVICE_ACCOUNT_EMAIL/);
  });

  it('rejects a missing GCS_MEDIA_BUCKET', () => {
    expect(() =>
      resolveStorageProvider(
        'gcs',
        PROJECT_ID,
        SERVICE_ACCOUNT_EMAIL,
        undefined,
        MEDIA_PUBLIC_BUCKET,
        local,
      ),
    ).toThrow(/GCS_MEDIA_BUCKET/);
  });

  it('rejects a blank (whitespace-only) GCS_MEDIA_BUCKET', () => {
    expect(() =>
      resolveStorageProvider(
        'gcs',
        PROJECT_ID,
        SERVICE_ACCOUNT_EMAIL,
        '   ',
        MEDIA_PUBLIC_BUCKET,
        local,
      ),
    ).toThrow(/GCS_MEDIA_BUCKET/);
  });

  it('rejects a missing GCS_MEDIA_PUBLIC_BUCKET', () => {
    expect(() =>
      resolveStorageProvider(
        'gcs',
        PROJECT_ID,
        SERVICE_ACCOUNT_EMAIL,
        MEDIA_BUCKET,
        undefined,
        local,
      ),
    ).toThrow(/GCS_MEDIA_PUBLIC_BUCKET/);
  });

  it('rejects a blank (whitespace-only) GCS_MEDIA_PUBLIC_BUCKET', () => {
    expect(() =>
      resolveStorageProvider('gcs', PROJECT_ID, SERVICE_ACCOUNT_EMAIL, MEDIA_BUCKET, '   ', local),
    ).toThrow(/GCS_MEDIA_PUBLIC_BUCKET/);
  });

  it('never substitutes a local-style default bucket name for a missing GCS bucket — the error names the variable, not a fallback value', () => {
    let caught: Error | undefined;
    try {
      resolveStorageProvider(
        'gcs',
        PROJECT_ID,
        SERVICE_ACCOUNT_EMAIL,
        undefined,
        MEDIA_PUBLIC_BUCKET,
        local,
      );
    } catch (error) {
      caught = error as Error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(caught?.message).not.toMatch(/local-dev-media/);
  });

  it('constructs a real GcsStorageProvider once project ID, service-account email, and both bucket names are all present and non-blank', () => {
    const provider = resolveStorageProvider(
      'gcs',
      PROJECT_ID,
      SERVICE_ACCOUNT_EMAIL,
      MEDIA_BUCKET,
      MEDIA_PUBLIC_BUCKET,
      local,
    );
    expect(provider).toBeInstanceOf(GcsStorageProvider);
  });
});

describe('resolveProjectId', () => {
  it('prefers GCP_PROJECT_ID when both variables are set', () => {
    expect(resolveProjectId('explicit-project', 'cloud-run-project')).toBe('explicit-project');
  });

  it('falls back to GOOGLE_CLOUD_PROJECT when GCP_PROJECT_ID is unset', () => {
    expect(resolveProjectId(undefined, 'cloud-run-project')).toBe('cloud-run-project');
  });

  it('returns undefined when neither variable is set', () => {
    expect(resolveProjectId(undefined, undefined)).toBeUndefined();
  });
});
