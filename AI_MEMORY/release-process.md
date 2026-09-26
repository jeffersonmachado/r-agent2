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

## Aprovação de deploy do artefato selado (2026-09-26)

**Passo obrigatório depois de qualquer selagem** — sem ele o deploy documentado
(`npm run system:deploy`) fica bloqueado, mesmo com o release selado, publicado e
verificado.

```bash
npm run system:go-no-go           # emite a decisão (qa/go-no-go-report.json)
npm run system:release-manifest   # escreve <release>.approval.json em dist/release/
npm run system:deploy             # dry-run (SYSTEM_DEPLOY_EXECUTE=1 para valer)
```

**Por que existe um sidecar separado.** Metadados de aprovação (goNoGo,
releaseGate, approvedForDeploy) **não podem** ser gravados no manifest do payload:
o hash desse manifest é selado no self-proving-report e o verifier rígido exige
igualdade. A aprovação vive em `<release>.approval.json`
(`tools/system/lib/release-artifact.js` — `updateArtifactManifest`), e
`listArtifacts` faz o merge na leitura.

**Sintoma quando falta** (verificado 2026-09-26):

```
[system:deploy] FAIL: artifact_missing:no_zip_with_audit_passed_and_go_no_go_go
```

`system:deploy` procura um ZIP cujo manifest (ou sidecar de aprovação) tenha
`audit === 'passed'` **e** `goNoGo === 'GO'`. O release publicado
`r-agent2-20260926-114417` não tinha sidecar porque **o fluxo canônico de
selagem (`release:seal`/`two-pass-release.sh`) não executa
`system:release-manifest`** — um selo bem-sucedido não aprovava o artefato para
deploy. O `qa/release-manifest.json` vigente ainda apontava para
`r-agent2-20260908-105354.zip`.

**Gap de processo em aberto:** `scripts/governance/seal-release.sh` deveria rodar
`system:go-no-go` + `system:release-manifest` na fase `consolidate`. Enquanto isso
não for uma mudança governada (exige ciclo de selagem completo para validar),
trate os dois comandos como passos obrigatórios pós-selo. Efeito colateral
esperado: eles regeneram artefatos derivados (`governance/final-*`,
`qa-waves/journey-coverage/*`, projeções de status) — commit depois, e confira que
as decisões continuam `AUTONOMOUS_READY_GO` + `validate:final-status-projection`
PASS. O sidecar em si é gitignored (`dist/`).


