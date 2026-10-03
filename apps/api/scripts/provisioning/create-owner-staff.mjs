// RETIRED (Story 2.11). This one-off script created the Dunedin owner in
// August 2026 with a password chosen by the operator (SEED_OWNER_PASSWORD).
// It is kept, disarmed, as the record of how that account was made; its
// original body is in git history.
//
// A real installation's first owner is created with the governed bootstrap,
// which refuses while the organization has an active owner, gives the
// account no usable password, and prints a single-use setup code so the
// owner sets their own:
//
//   npm run staff:bootstrap-owner --workspace=apps/api -- <organization-slug> <email> "<name>"
//
// An owner who cannot sign in is recovered with:
//
//   npm run staff:issue-setup-code --workspace=apps/api -- <email>
console.error(
  'create-owner-staff.mjs is retired: it set an operator-chosen password. ' +
    'Use npm run staff:bootstrap-owner (first owner) or npm run staff:issue-setup-code (recovery).',
);
process.exit(1);
