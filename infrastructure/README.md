# Servvia infrastructure

- **Status:** Target area; existing infrastructure not yet moved.
- **Target technology:** Docker / containers.
- **Target responsibility:** deployment and infrastructure definitions, and local development infrastructure.
- **Current implementation/source:**
  - `docker/` and `docker-compose.yml` (container images and compose);
  - `windows-deploy/` (current Windows host deployment);
  - `local-postgres/` (local PostgreSQL; future home `local-dev/`).
- **Stage 2 state:** Structural scaffold only. Product implementation has not started. Nothing has been copied or moved; the current locations remain in use.
- **Next implementation trigger:** an approved Stage 3 task that moves or adds infrastructure.

Kubernetes, Terraform, monitoring, dashboards and secrets directories are created only when real implementation requires them.

Structure and ownership: [PRD/product-requirements.md, Part C](../PRD/product-requirements.md).
