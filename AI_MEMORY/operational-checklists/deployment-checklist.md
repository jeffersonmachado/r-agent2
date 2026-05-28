# Deployment Checklist

- Deploy from approved artifact only.
- Confirm `npm run system:release` is green.
- Confirm release manifest has `audit=passed` and `goNoGo=GO`.
- Use `npm run system:deploy`; real deploy requires `SYSTEM_DEPLOY_EXECUTE=1`.
- Keep runtime paths outside release payload.
- Confirm rollback/drill evidence where required.

