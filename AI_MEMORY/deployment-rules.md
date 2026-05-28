# Deployment Rules

## Canonical deployment path

- Build/validate with `npm run system:release`.
- Deploy only from approved release artifact through `npm run system:deploy`.
- For pre-deploy gate use `npm run deploy:gate:official`.
- Real deploy requires explicit `SYSTEM_DEPLOY_EXECUTE=1`.

## Sources

- `docs/release-contract.md`
- `docs/DEPLOY_PRODUCAO.md`
- `docs/DEPLOY_DOCKER_COMPOSE.md`
- `docs/DOCKER_DEPLOY.md`
- `docs/operations/README_DEPLOY.md`
- `scripts/deploy-gate.sh`
- `tools/system/deploy.js`

## Rule

No deployment may bypass package validation, runtime governance, release gate and approved artifact manifest.

