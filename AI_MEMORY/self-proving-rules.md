# Self-Proving Rules

## GO_FINAL_HARDENED criteria

A release may be called `GO_FINAL_HARDENED` only when all are true:

- `system:validate` passed.
- `zip:release` produced approved ZIP and manifest.
- release gate is `GO`.
- QA Mesh canonical decision is `GO`.
- QA Waves required scope is green.
- replay integrity and tamper detection are green.
- package validation and contamination checks are green.
- runtime governance is `REAL_OK` when real runtime is required.
- final readiness/self-proving reports agree.
- `dist/` contains only approved release artifacts.

## Evidence required

- command logs/results
- browser validation summary
- route/runtime map
- QA Mesh report
- replay integrity report
- package validation report
- governance chain/signature
- release manifest
- cleanup/dist check

## Current status

Current canonical docs report `NO_GO`; therefore this workspace must not be labelled `GO_FINAL_HARDENED` until mesh blockers are resolved and validations rerun.

## Lineage de evidência: RUNTIME_EVIDENCE vs DERIVED_REPORT (2026-09-19)

Defeito real encontrado e corrigido (P0): `qa-mesh/go-no-go-report.json` foi
produzido em `2026-09-18T10:46:59.739Z` e recebeu, via
`scripts/governance/stamp-report-lineage.js`, o `runId`
`rap-governed-20260918201837632-be6d7695` — run criado ~9h32 DEPOIS. O
`generatedAt` original foi preservado, então o relatório passou a afirmar ter
sido produzido por um run posterior à sua criação. Nenhum status foi alterado;
por isso o defeito era silencioso e **pior que a ausência de lineage**: elimina
a dúvida (o artefato parece pertencer ao run) sem criar a prova (nada rodou nele).

Classificação canônica: `config/runtime-evidence-artifacts.json`
(módulo puro `scripts/governance/lib/runtime-evidence-artifacts.js`).

- **RUNTIME_EVIDENCE** (mesh, smoke, replay, `qa/enterprise/*`): resultado de
  EXECUÇÃO. Exige lineage **NA ORIGEM** — o produtor recebe
  `runId`/`sourceFingerprint` ANTES de executar. NUNCA pode ser estampado depois.
- **DERIVED_REPORT** (coverage, visibility, release-dag, route-mount…):
  recomputável pelo source atual por validador determinístico; o stamp é legítimo.

Enforcement:

- `npm run validate:qa-evidence-same-run` (gate `QA_EVIDENCE_SAME_RUN`): reprova
  `QA_EVIDENCE_LINEAGE_MISSING`, `QA_EVIDENCE_RUN_UNKNOWN`,
  `QA_EVIDENCE_SAME_RUN_VIOLATION` (`generatedAt < run.started_at` ou
  `> completed_at`), `QA_EVIDENCE_SOURCE_MISMATCH`,
  `QA_EVIDENCE_NO_TIMESTAMP`/`_INVALID`. Relatório em
  `reports/qa-evidence-same-run-report.json`. Integrado ao gate agregado.
- `scripts/governance/stamp-report-lineage.js` RECUSA artefatos de
  RUNTIME_EVIDENCE (fail-closed: `runtime_evidence_requires_origin_lineage`).
- Origem: `qa-mesh/meshRunner.js` grava `runId`/`sourceFingerprint` no momento
  em que o relatório NASCE, a partir de
  `scripts/governance/lib/resolve-run-lineage.js` (env `GOVERNANCE_RUN_ID` ou
  `governance/.current-run.json`), injetado por `pipeline/entrypoints/runQaMesh.js`.
  Sem run governado o lineage é `null` explícito — nunca inventado.

Regressões: `tests/unit/governance/runtimeEvidenceLineage.test.js` (o produtor
recusa runtime evidence E continua estampando derivados — "recusar tudo" não
passaria) e `tests/unit/governance/resolveRunLineage.test.js`.

Regra: um relatório de QA só é prova do run que o EXECUTOU. Estar no disco
durante um run não o torna evidência desse run.

