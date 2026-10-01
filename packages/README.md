# Servvia packages

- **Status:** Target boundary created (CC-2). No shared packages exist yet.
- **Purpose:** reusable libraries and shared modules, as `packages/<scope>/<package>/`.

## Rules
- **Reusable code only.** A package is never deployed independently. Deployable clients live in `apps/<platform>/<application>/`; backends in `services/<service>/`.
- **Create a package only when multiple real consumers justify sharing.** Code with one consumer stays in that consumer.
- **No catch-all.** This is not a `shared/` dumping ground. The current root `shared/` is decomposed by ownership as its callers migrate; it is not moved here wholesale.
- **No speculative platform subtrees.** Directories such as `packages/web/`, `packages/android/`, `packages/dotnet/` or `packages/go/` are created only when a real shared package needs them.
- **Cross-language API, event and schema contracts** live in `contracts/`, not here.

Structure and ownership: [fileRestructure.md](../fileRestructure.md).
