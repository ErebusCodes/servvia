# Servvia tooling

- **Status:** Target area; existing tooling not yet moved.
- **Target technology:** repository tooling (currently Node.js scripts).
- **Target responsibility:** developer, CI and deployment tooling.
- **Current implementation/source:**
  - `scripts/`: current tooling source; future migration toward `tooling/scripts/`;
  - `find_css_rules.py`: future `tooling/scripts/` candidate;
  - `shared/local-dev.mjs`: classified later by actual ownership.
- **Stage 2 state:** Structural scaffold only. Product implementation has not started. Nothing has been copied or moved.
- **Next implementation trigger:** an approved Stage 3 tooling move.

**Root build entry (`Makefile`):** deliberately not created in Stage 2. There is no stable multi-language build yet, so it would invent commands for applications that do not exist. Root `package.json` scripts remain the current entry point; the `Makefile` is added in Stage 3.

Structure and ownership: [fileRestructure.md](../fileRestructure.md).
