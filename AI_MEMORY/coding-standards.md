# Coding Standards

## Canonical sources

- `CLAUDE.md`
- `PROJECT_RULES.md`
- `CURSOR_RULES.md`
- `docs/architecture-modernization-plan.md`
- `docs/architecture-modernization-backlog.md`

## Required conventions

- Backend uses CommonJS.
- Frontend uses ES modules.
- Express route composition stays under `api/modules/*`, `api/composition/*`, `api/app/registerRoutes.js` and `api/app/routeRegistry.js`.
- Frontend routes are resolved in `frontend/src/main.jsx`; menu origin is `frontend/src/navigation/menu.js`.
- Shared frontend utilities live under `frontend/src/shared/` when established by the current architecture.
- Do not introduce memory fallbacks where persistence is required.
- Use existing logger/config utilities instead of new ad hoc logging/config.
- For browser tests, reuse `tests/helpers/playwrightAuth.js`.

