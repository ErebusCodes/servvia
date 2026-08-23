-- Story 9-1: add the `unsupported` POSSyncStatus value.
--
-- Split into its own migration (rather than combined with the data
-- correction that follows) because PostgreSQL forbids using a value added
-- by ALTER TYPE ... ADD VALUE within the same transaction that added it —
-- confirmed directly against this project's own Postgres 16 dev instance
-- before writing this file. The next migration's UPDATE statements depend
-- on this value already being committed.

ALTER TYPE "POSSyncStatus" ADD VALUE 'unsupported';
