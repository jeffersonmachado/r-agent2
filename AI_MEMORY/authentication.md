# Authentication

## Discovered credentials and bootstrap

- Test username: `systemadmin`
- Test password: `***`
- Default tenant for browser validation: `system`
- Official helper: `tests/helpers/playwrightAuth.js`
- Login API: `POST /auth/login`
- RPA login API: `POST /auth/rpa/login`
- Bootstrap/config: `env.example`, `api/data/config.example.json`, `api/data/config.json`, `npm run system:bootstrap`

## Browser-validated flow

On 2026-05-16, Playwright opened `http://127.0.0.1:5173/workspace`, used `loginWithTenantSelection`, selected tenant `system`, and confirmed:

- `auth_token` present in localStorage
- `auth_agent.username=systemadmin`
- `auth_agent.role=super_admin`
- `auth_effective_tenant_id=system`
- protected route `/support` returns to login after local auth state is cleared

## Session model observed

Frontend stores `auth_token`, `auth_agent` and `auth_effective_tenant_id` in localStorage. Super-admin tenant selection is normalized by the shared helper.

## Guards and protected routes

Frontend auth/route guards live in `frontend/src/main.jsx`. RBAC path access is enforced via `canAccessPath(agent, currentPath)` with super-admin bypass for existing frontend routes. Menu permissions live in `frontend/src/navigation/menu.js`.

## Agent rule

Never reimplement blind login in browser tests. Use `loginWithTenantSelection(...)`, pass `TEST_TENANT_ID=system` unless a test requires another tenant, and navigate back to the target route after tenant selection.

