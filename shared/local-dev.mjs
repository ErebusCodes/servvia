// Single source of truth for Verdura's local-development seed identity.
//
// Local development only — production organizations/venues are always
// created with random UUIDs (Prisma's `@default(uuid())`); nothing in
// production ever reads these constants. They exist so the local dev
// venue has a fixed, predictable id that frontend .env files can point at
// without every developer having to look it up after seeding.
//
// Consumed by:
//   - backend/prisma/seed.ts — creates the venue with this id, and refuses
//     to silently continue if an existing "auckland" venue has a different one.
//   - scripts/dev.mjs — validates the *live database's* venue id against
//     frontend VITE_VENUE_ID config before starting any service.
//   - scripts/db-local-reset.mjs — verifies a reset actually produced this id.
export const LOCAL_VENUE_ID = '10000000-0000-4000-8000-000000000001';
export const LOCAL_ORG_SLUG = 'verdura';
export const LOCAL_VENUE_SLUG = 'auckland';
