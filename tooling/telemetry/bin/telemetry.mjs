#!/usr/bin/env node
// Servvia engineering-program telemetry (Story 20.3). See tooling/telemetry/README.md.
import { main } from '../lib/cli.mjs';

process.exitCode = main(process.argv.slice(2), process.env, (s) => process.stdout.write(s), (s) => process.stderr.write(s));
