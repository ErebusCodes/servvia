/**
 * RETIRED (Story 8.3). This one-off script (2026-08-31) created an
 * operational staff account with an operator-generated login password and
 * tablet PIN, written straight to the database: no venue grant, no audit,
 * and no check that the PIN was unique in the venue. Its original body, and
 * the account of why it was needed, are in git history.
 *
 * Staff accounts are now created from the Admin Console Staff page (Story
 * 8.1): the staff member sets their own password with a single-use setup
 * code, venue grants are explicit, and a tablet PIN is set through
 * POST /api/admin/staff/:id/tablet-pin, which checks it unique in each venue
 * where it will elevate a tablet. A real installation with no owner who can
 * sign in starts with `npm run staff:bootstrap-owner` (Story 2.11) or
 * `npm run staff:issue-setup-code` (Story 2.4).
 */
console.error(
  'create-venue-staff-account.ts is retired: create staff from the Admin Console Staff page ' +
    '(npm run staff:bootstrap-owner if no owner can sign in).',
);
process.exit(1);
