# Release Process

## Official commands

- `npm run system:bootstrap`
- `npm run system:validate`
- `npm run zip:release`
- `npm run system:release`
- `npm run system:deploy`

`npm run zip:release` is mandatory for release packaging. Prefer `npm run zip:release:clean` when workspace runtime residue may exist.

## Canonical sources

- `README.md`
- `docs/official-path.md`
- `docs/release-contract.md`
- `docs/release-checklist.md`
- `docs/runtime-governance.md`
- `docs/runtime-paths.md`
- `docs/governance/PRODUCTION_READINESS.md`
- `tools/system/release.js`
- `tools/system/release-gate.js`
- `tools/system/go-no-go.js`
- `scripts/release-package.sh`

## Acceptance chain

Release is acceptable only when validation, package validation, replay integrity, runtime governance, release gate, governance chain and self-proving reports are coherent and green.

Never deploy from a live workspace when the approved artifact contract is required.

## dist/ cleanliness contract (2026-07-23)

`npm run zip:release` (`scripts/release-package.sh` → `generate-zip.sh`) writes the audited ZIP + sidecar manifest (`r-agent2-YYYYMMDD-HHMMSS.zip` / `.manifest.json`) at the **root of `dist/` by design**. AGENTS.md allows this: "dist/ deve permanecer limpo, exceto ZIPs/manifestos de release aprovados". `scripts/check-dist-clean.sh` step 5 whitelists exactly that naming pattern; the governed envelope flow (`scripts/two-pass-release.sh`) lives in `dist/release/` and is verified separately. Custom `--name` ZIPs are NOT whitelisted. Reconciled after `validate:dist` failed on a legitimately produced release ZIP (contradiction between packaging and the cleanliness gate).

