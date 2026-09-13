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

## Release state machine + DAG (2026-09-13)

Canonical model: `governance/release-state-machine.js` (fases, transições,
`requiredPhase`, `PENDING_PHASE`) and `governance/release-dag.js` (grafo
gate→gate, gate→artefato, artefato→produtor, detecção de ciclo). Enforcement:
`npm run validate:release-dag` (ciclo ⇒ `RELEASE_DEPENDENCY_CYCLE` antes de
qualquer mutação de pacote) e `npm run validate:release-artifact-identity`
(bytes reais + lineage candidato→payload + isolamento de run). Ambos entram no
gate agregado.

Fases (ordem única de comparação — nunca comparar strings): `SOURCE_VALIDATED`
→ `PRE_PACKAGE` → `CANDIDATE_BUILT` → `CANDIDATE_VALIDATED` → `SEALED` →
`DELIVERED` → `FINAL_GOVERNANCE` → `PUBLISHED_VERIFIED`.

Regras estruturais:

- Um gate declara `requiredPhase`. Antes da fase, o status é `PENDING_PHASE`
  (nunca PASS, nunca FAIL). PENDING vencido (fase alcançada e output nunca
  produzido) vira FAIL.
- O score da fase corrente não mistura dimensões ainda não mensuráveis;
  `FINAL_RELEASE_SCORE` é `NOT_YET_MEASURABLE` até as fases finais.
- **Candidato** é artefato de primeira classe: `dist/candidate/<release>.candidate.zip`
  + `<release>.candidate.manifest.json` (`artifactType=CANDIDATE`,
  `releasePhase=CANDIDATE_BUILT|CANDIDATE_VALIDATED`). Nunca rotulado
  DELIVERED/PUBLISHED/FINAL, nunca reescrito depois de validado.
- **Payload entregue**: `dist/release/<release>.payload.zip` + identidade
  EXTERNA `dist/release/<release>.delivered.identity.json`
  (`artifactType=DELIVERED_PAYLOAD`, `parentCandidateHash`, `finalPayloadHash`,
  `governanceRunId`, lineage). O hash do payload vive fora dos bytes que cobre —
  paradoxo do auto-hash evitado.
- Retenção: o release publicado anterior é preservado em
  `dist/archive/<release>/` (5 mais recentes) — o run novo não destrói o último
  release bom.
- `npm run zip:release` é AUTO-SUFICIENTE: provisiona o governance run do source
  atual (`scripts/governance/ensure-governed-run.js`), grava package-validation
  honesta (DEFERRED quando o candidato ainda não existe) e converge a governança
  (`converge-governance.sh`) — a sequência que antes era manual e não
  documentada. `RAP_SKIP_PRE_PACKAGE_PROVISION=1` desliga (release NÃO
  reproduzível).

## dist/ cleanliness contract (2026-07-23)

`npm run zip:release` (`scripts/release-package.sh` → `generate-zip.sh`) writes the audited ZIP + sidecar manifest (`r-agent2-YYYYMMDD-HHMMSS.zip` / `.manifest.json`) at the **root of `dist/` by design**. AGENTS.md allows this: "dist/ deve permanecer limpo, exceto ZIPs/manifestos de release aprovados". `scripts/check-dist-clean.sh` step 5 whitelists exactly that naming pattern; the governed envelope flow (`scripts/two-pass-release.sh`) lives in `dist/release/` and is verified separately. Custom `--name` ZIPs are NOT whitelisted. Reconciled after `validate:dist` failed on a legitimately produced release ZIP (contradiction between packaging and the cleanliness gate).

