# Release Checklist

- Read `AI_MEMORY/release-process.md`.
- Confirm current `docs/governance/PLATFORM_STATUS.md`.
- Run `npm run system:validate`.
- Run `npm run zip:release`.
- Run `npm run system:release-gate`.
- Confirm package validation, replay integrity, tamper detection and governance chain.
- Confirm `dist/` contains only approved artifacts.
- Do not declare `GO_FINAL_HARDENED` while canonical mesh is `NO_GO`.

