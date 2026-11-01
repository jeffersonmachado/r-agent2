# AUDIT_ENTRYPOINT — ponto de entrada único para auditoria externa

> Artefato DERIVADO (nada escrito à mão). Gerado por `tools/audit/generate-audit-entrypoint.js`.
> Regenerar: `node tools/audit/generate-audit-entrypoint.js [--aggregate-log <log> --aggregate-head <sha>]`.
>
> Por que Markdown e não `.json`: `audit:json-persistence` (passo bloqueante do gate agregado) reprova com
> `UNKNOWN` todo alvo de escrita `.json` fora da taxonomia canônica, e `AI_MEMORY/evidence/` não está nela.
> O payload JSON completo vai embutido no bloco cercado ao fim deste arquivo — nada foi perdido.

- **Gerado em**: 2026-11-01T15:07:53.786Z
- **auditEpoch**: `88b22571229a013470f4e36be52b74051c93a3e0b178e35856f39c181319c45d`
- **Branch / HEAD**: `fix/jest-ci-history` / `6466e3827146ef180fbaa570d5cf014efd4664cf`
- **HEAD sincronizado com o remote**: sim
- **Commits não enviados**: 0
- **Release governado**: `n/a` · fingerprint `n/a`
- **Publicado**: NÃO (sem tag, sem promoção)

## Como detectar que algo mudou no git

```bash
git log --oneline -20
git log -1 --format=%H -- AI_MEMORY/evidence/AUDIT_ENTRYPOINT.md   # commit que gerou o epoch atual
auditEpoch.valor != epoch da auditoria anterior  =>  houve mudança
payload.provas[].sha256 != hash registrado       =>  prova alterada em disco (possível adulteração)
```

## Como reauditar

```bash
npm run validate:governance-enforcement      # gate agregado bloqueante: cadeia de 63 passos com &&
node scripts/governance/validate-hardening-queue.js
npm run validate:release-artifact-identity
node scripts/governance/verify-remote-provenance.js --manifest dist/release/<release>.manifest.json
npm run validate:final-status-projection
```

### Gate agregado — como o veredito é derivado

- Comando: `npm run validate:governance-enforcement`
- Passos na cadeia: **1** (0 via `npm run`)
- Passos que não são `npm run`: `node scripts/governance/run-governance-enforcement.js`
- A cadeia usa && encadeado: exit 0 no alias PROVA que TODOS os passos passaram (qualquer falha aborta com exit != 0). Isso é mais forte e mais simples que contar linhas "status=PASS" no log, que é artefato de formatação de cada gate e não corresponde 1:1 ao número de passos.
- Relatório próprio do agregado: `reports/governance-enforcement-full-report.json` — existe, gerado em 2026-11-01T13:13:41.818Z, runId corrente? **NÃO**
- Provas acima com o runId corrente: **0 de 13**
- Provas que não registram campo `runId` (não é violação, o campo não existe nelas): `reports/governance-score.json`, `reports/coverage-gate-report.json`, `reports/release-artifact-identity-report.json`, `reports/source-remote-provenance-report.json`, `reports/final-status-projection-report.json`, `reports/security-release-gate-report.json`, `reports/security-intel-report.json`, `reports/mcp-research-docker-e2e-report.json`, `reports/hardening-queue-report.json`, `reports/release-dag-report.json`, `governance/delivered-release-verification-report.json`, `governance/.current-run.json`

> DESATUALIZADO: existe, mas NÃO é do run corrente — o alias `validate:governance-enforcement` não usa run-all-validators.js, logo não o regrava. Não use este arquivo como veredito do agregado; use o exit code da cadeia + as provas canônicas abaixo.

- **Última execução medida**: não embutida — rode o agregado e regenere com `--aggregate-log <log> --aggregate-head <sha>`

## Cadeia criptográfica — estado derivado (recomputado)

- **Estado**: **ARTEFATO_CERTIFICADO_ALTERADO** (validador: `FAIL`, verificado=true, elos=10)
- Raiz persistida `99e1de118ee4f399…` × recalculada `0b3ed5d5adf1efc7…` — conferem? **NÃO** · `tampered`=true
- Cadeia construída para o commit `8bfbb61bd92c` / artefato `r-agent2-20261017-040050.zip`

> DIVERGÊNCIA EM ELO IMUTÁVEL: o artefato certificado (ou sua assinatura) mudou depois da certificação. Isto é a classe grave — trate como adulteração até prova em contrário.

> A fase `certify` do selo reconstrói e assina a cadeia e depois a verifica de forma BLOQUEANTE (medido em seal-release.sh). Portanto a cadeia é válida imediatamente após um selo; rodar qualquer passo que regrave um elo derivado depois disso a torna divergente de forma legítima.

| divergência | elo | classificação | motivo do elo derivado |
|---|---|---|---|
| `package` canonical_path_unresolved | — | estrutural (consequência) | — |
| `sidecar_manifest` canonical_path_unresolved | — | estrutural (consequência) | — |
| `package` canonical_file_missing | — | estrutural (consequência) | — |
| `sidecar_manifest` canonical_file_missing | — | estrutural (consequência) | — |
| `evidence_manifest` hash_from_canonical_mismatch | — | estrutural (consequência) | — |
| `evidence_manifest` cumulative_from_canonical_mismatch | — | estrutural (consequência) | — |
| `final_proof_report` hash_from_canonical_mismatch | — | estrutural (consequência) | — |
| `final_proof_report` cumulative_from_canonical_mismatch | — | estrutural (consequência) | — |
| `final_readiness` hash_from_canonical_mismatch | — | estrutural (consequência) | — |
| `final_readiness` cumulative_from_canonical_mismatch | — | estrutural (consequência) | — |
| `consistency_report` cumulative_from_canonical_mismatch | — | estrutural (consequência) | — |
| `cross_report` cumulative_from_canonical_mismatch | — | estrutural (consequência) | — |
| `proof_signature` hash_from_canonical_mismatch | — | estrutural (consequência) | — |
| `proof_signature` cumulative_from_canonical_mismatch | — | estrutural (consequência) | — |
| `blocker_engine` cumulative_from_canonical_mismatch | — | estrutural (consequência) | — |
| `package_validation` hash_from_canonical_mismatch | — | estrutural (consequência) | — |
| `package_validation` cumulative_from_canonical_mismatch | — | estrutural (consequência) | — |
| `chain_root` chain_root_from_canonical_mismatch | — | estrutural (consequência) | — |
| `package` file_deleted | `dist/release/r-agent2-20261017-040050.zip` | **elo IMUTÁVEL** | — |
| `sidecar_manifest` file_deleted | `dist/release/r-agent2-20261017-040050.manifest.json` | **elo IMUTÁVEL** | — |
| `evidence_manifest` hash_mismatch | `governance/evidence-manifest.json` | elo DERIVADO | regravado por system:go-no-go (platform-readiness) dentro do ciclo |
| `final_proof_report` hash_mismatch | `governance/final-proof-report.json` | elo DERIVADO | regravado por system:go-no-go dentro do ciclo |
| `final_readiness` hash_mismatch | `governance/final-readiness-report.json` | elo DERIVADO | regravado por system:go-no-go dentro do ciclo |
| `consistency_report` cumulative_hash_broken | — | estrutural (consequência) | — |
| `cross_report` cumulative_hash_broken | — | estrutural (consequência) | — |
| `proof_signature` hash_mismatch | `governance/proof-signature.json` | elo DERIVADO | regravado por materialize-proof-artifacts dentro do ciclo |
| `blocker_engine` cumulative_hash_broken | — | estrutural (consequência) | — |
| `package_validation` hash_mismatch | `governance/package-validation-report.json` | elo DERIVADO | regravado por system:go-no-go dentro do ciclo |
| `chain_root` chain_root_mismatch | — | estrutural (consequência) | — |

## Provas canônicas (hash do arquivo em disco)

| prova | veredito | runId | sha256 (12) | no git |
|---|---|---|---|---|
| `reports/governance-score.json` | **FAIL** | — | 72de76818d4d | não (ignorado) |
| `reports/coverage-gate-report.json` | **NO_GO** | — | 2674b637f86b | não (ignorado) |
| `reports/release-artifact-identity-report.json` | AUSENTE | — | — | não (ignorado) |
| `reports/source-remote-provenance-report.json` | AUSENTE | — | — | não (ignorado) |
| `reports/final-status-projection-report.json` | **FAIL** | — | 2c0643cd3ba3 | não (ignorado) |
| `reports/security-release-gate-report.json` | **NO_GO** | — | b2e274d78d1d | não (ignorado) |
| `reports/security-intel-report.json` | AUSENTE | — | — | não (ignorado) |
| `reports/mcp-research-docker-e2e-report.json` | AUSENTE | — | — | não (ignorado) |
| `reports/hardening-queue-report.json` | **PASS** | — | d1ccb6ee790e | não (ignorado) |
| `reports/release-dag-report.json` | **RELEASE_DAG_ACYCLIC_AND_PHASE_AWARE** | — | 19ff7c883f8e | não (ignorado) |
| `governance/evidence-manifest.json` | **PASS** | 180-09a2168d | 40336fa0d09a | sim |
| `governance/delivered-release-verification-report.json` | AUSENTE | — | — | não (ignorado) |
| `governance/.current-run.json` | AUSENTE | — | — | não (ignorado) |

## Artefatos físicos do release (prova por hash, fora do git)

| artefato | bytes | sha256 (16) |
|---|---|---|

## Itens que aguardam decisão do dono (fila oficial)

Nota de semântica: `blocked`/`blocked_external` são estados FECHADOS para o agente (ele não deve agir), mas continuam exigindo decisão humana — por isso aparecem aqui.

Nenhum.

## Ponteiros stale na raiz do repositório — NÃO use como estado atual

Estes arquivos existem na raiz, são versionados e NENHUM gate os mantém — eles congelaram em datas antigas. Um auditor que os leia como estado corrente audita o passado.

| arquivo | gerado em | HEAD que ele registra | último commit que o tocou |
|---|---|---|---|
| `FINAL_RAP_RELEASE_CLOSURE.json` | 2026-09-24T07:31:39.421Z | `b0665b7672` | `9634e5c58` 2026-11-01 |
| `FINAL_RELEASE_CLOSURE.md` | — | — | `570bbd0c4` 2026-09-24 |
| `ENGINEERING_ROUTER_V1_SEAL_REPORT.json` | 2026-09-23T16:46:58.938Z | — | `0a69bdaed` 2026-09-23 |
| `ENGINEERING_ROUTER_V1_FINAL_SEAL.md` | — | — | `330478f54` 2026-09-22 |

O estado atual está NESTE arquivo (`AUDIT_ENTRYPOINT.md`) e nas projeções canônicas listadas abaixo.

## Fontes canônicas

- AI_MEMORY/hardening-queue.json            (fila oficial de pendências)
- AI_MEMORY/evidence/missao-hardening-eng-gov-release-2026-10-16.md  (relatório da missão)
- docs/governance/_platform-status-source.json  (decisão canônica de release)
- docs/governance/PLATFORM_STATUS.md e docs/architecture/RAP_MASTER_SCORECARD.md  (projeções)
- reports/*.json e governance/*.json        (prova em disco; ignorados pelo git por política)

## Payload completo (legível por máquina)

O **último** bloco cercado deste arquivo (marcado como `json`) é o payload íntegro usado para
calcular o `auditEpoch` — extraia-o e recalcule o sha256 do stringify canônico para conferir.

```json
{
  "artifactType": "rap-audit-entrypoint",
  "artifactVersion": "1.0.0",
  "generatedAt": "2026-11-01T15:07:53.786Z",
  "generatedBy": "tools/audit/generate-audit-entrypoint.js",
  "auditEpoch": {
    "valor": "88b22571229a013470f4e36be52b74051c93a3e0b178e35856f39c181319c45d",
    "definicao": "sha256 do bloco \"payload\" em stringify canônico — muda quando qualquer prova, veredito, commit ou artefato muda",
    "comoUsar": "compare este valor e os sha256 de payload.provas[] com os da auditoria anterior; diferença = houve mudança, reaudite"
  },
  "payload": {
    "git": {
      "branch": "fix/jest-ci-history",
      "headAtGeneration": "6466e3827146ef180fbaa570d5cf014efd4664cf",
      "headAssunto": "docs(governance): registra provisionamento dos segredos e a causa-raiz do gitignore logs/",
      "headData": "2026-11-01T12:02:49-03:00",
      "remoteHead": "6466e3827146ef180fbaa570d5cf014efd4664cf",
      "tronco": "origin/main",
      "headEmSincroniaComRemote": true,
      "worktreeCleanExcluindoEsteArtefato": true,
      "uncommittedPaths": [],
      "commitsNaoEnviados": 0
    },
    "releaseGovernado": {
      "runId": null,
      "sourceFingerprint": null,
      "sourceCommit": null,
      "sourceTree": null,
      "startedAt": null,
      "lastGovernedStage": null,
      "runStatus": null
    },
    "closureCommits": [
      {
        "sha": "36cd7fc06",
        "commit": "36cd7fc06c72fef84543e60c300e43ac2618a494",
        "assunto": "docs(governanca): fechamento da missao de hardening — release SELADO e agregado verde no HEAD final",
        "existe": true,
        "emAlgumRemote": true
      },
      {
        "sha": "77a8b826e",
        "commit": "77a8b826ed84b7c7962d9f75a78c16105d5f45fd",
        "assunto": "chore(governanca): SEAL_GO r-agent2-20261016-133323 + agregado verde (31 PASS) + SBOM do run + fila oficial com provas",
        "existe": true,
        "emAlgumRemote": true
      },
      {
        "sha": "d9c469e67",
        "commit": "d9c469e677eee10fd998fefdf9f5a0d61c6d37a0",
        "assunto": "chore(governanca): pos-verify do R3 — scorecard 78/78 below10=0, projecoes PASS, provas do manifest fechadas",
        "existe": true,
        "emAlgumRemote": true
      },
      {
        "sha": "e0ddb6beb",
        "commit": "e0ddb6beba36001598ba3dd61fdbb41d46f3f49c",
        "assunto": "chore(governanca): artefatos regenerados dentro do run R3 (selo V2 21/21, stamp 52/0, contaminacao 0)",
        "existe": true,
        "emAlgumRemote": true
      },
      {
        "sha": "a5449d15e",
        "commit": "a5449d15e284537971b005dfb675907fadecba69",
        "assunto": "fix(governanca): handshake do lease com marcador inequivoco (destrava o passo obrigatorio REAL_TASK_RECOVERY do selo V2)",
        "existe": true,
        "emAlgumRemote": true
      },
      {
        "sha": "5efce7924",
        "commit": "5efce7924932822c23888de97efc6243981da75e",
        "assunto": "chore(governanca): fila oficial com o defeito do handshake + evidencia qwen regerada pelo selo V2",
        "existe": true,
        "emAlgumRemote": true
      },
      {
        "sha": "c20433341",
        "commit": "c20433341ae024acc4150282fe6aaea70fa3ae58",
        "assunto": "feat(governanca): preflight fail-fast de waves same-run no selo (P1-11) + alias validate:wave-same-run",
        "existe": true,
        "emAlgumRemote": true
      }
    ],
    "agregado": {
      "comando": "npm run validate:governance-enforcement",
      "passosNaCadeia": 1,
      "passosViaNpmRun": 0,
      "passosNaoNpmRun": [
        "node scripts/governance/run-governance-enforcement.js"
      ],
      "semantica": "A cadeia usa && encadeado: exit 0 no alias PROVA que TODOS os passos passaram (qualquer falha aborta com exit != 0). Isso é mais forte e mais simples que contar linhas \"status=PASS\" no log, que é artefato de formatação de cada gate e não corresponde 1:1 ao número de passos.",
      "relatorioProprio": {
        "path": "reports/governance-enforcement-full-report.json",
        "existe": true,
        "generatedAt": "2026-11-01T13:13:41.818Z",
        "runId": null,
        "doRunCorrente": false,
        "escritor": "scripts/governance/run-all-validators.js",
        "aviso": "DESATUALIZADO: existe, mas NÃO é do run corrente — o alias `validate:governance-enforcement` não usa run-all-validators.js, logo não o regrava. Não use este arquivo como veredito do agregado; use o exit code da cadeia + as provas canônicas abaixo."
      },
      "provasComRunIdCorrente": 0,
      "provasSemCampoRunId": [
        "reports/governance-score.json",
        "reports/coverage-gate-report.json",
        "reports/release-artifact-identity-report.json",
        "reports/source-remote-provenance-report.json",
        "reports/final-status-projection-report.json",
        "reports/security-release-gate-report.json",
        "reports/security-intel-report.json",
        "reports/mcp-research-docker-e2e-report.json",
        "reports/hardening-queue-report.json",
        "reports/release-dag-report.json",
        "governance/delivered-release-verification-report.json",
        "governance/.current-run.json"
      ],
      "provasDeOutroRun": [],
      "ultimaExecucaoMedida": {
        "existe": false,
        "nota": "rode o agregado e regenere com --aggregate-log <log> [--aggregate-head <sha>] para embutir o veredito medido"
      }
    },
    "cadeiaCriptografica": {
      "relatorio": "reports/governance-chain-report.json",
      "existe": true,
      "statusDoValidador": "FAIL",
      "estado": "ARTEFATO_CERTIFICADO_ALTERADO",
      "verificada": true,
      "elosVerificados": 10,
      "raizPersistida": "99e1de118ee4f399b36a2fb0235e46bc509dad9e5ce385883476504739eb688f",
      "raizRecalculada": "0b3ed5d5adf1efc772da27e4d23e3bf32506b0a00f6047cf54bc0572562f3e91",
      "raizConfere": false,
      "tampered": true,
      "gitCommitDaCadeia": "8bfbb61bd92c1b871a5121f309dda6aad2cb6d9f",
      "artefatoDaCadeia": "r-agent2-20261017-040050.zip",
      "falhas": [
        {
          "id": "package",
          "reason": "canonical_path_unresolved",
          "path": null,
          "eloDerivado": null,
          "motivoDerivado": null
        },
        {
          "id": "sidecar_manifest",
          "reason": "canonical_path_unresolved",
          "path": null,
          "eloDerivado": null,
          "motivoDerivado": null
        },
        {
          "id": "package",
          "reason": "canonical_file_missing",
          "path": null,
          "eloDerivado": null,
          "motivoDerivado": null
        },
        {
          "id": "sidecar_manifest",
          "reason": "canonical_file_missing",
          "path": null,
          "eloDerivado": null,
          "motivoDerivado": null
        },
        {
          "id": "evidence_manifest",
          "reason": "hash_from_canonical_mismatch",
          "path": null,
          "eloDerivado": null,
          "motivoDerivado": null
        },
        {
          "id": "evidence_manifest",
          "reason": "cumulative_from_canonical_mismatch",
          "path": null,
          "eloDerivado": null,
          "motivoDerivado": null
        },
        {
          "id": "final_proof_report",
          "reason": "hash_from_canonical_mismatch",
          "path": null,
          "eloDerivado": null,
          "motivoDerivado": null
        },
        {
          "id": "final_proof_report",
          "reason": "cumulative_from_canonical_mismatch",
          "path": null,
          "eloDerivado": null,
          "motivoDerivado": null
        },
        {
          "id": "final_readiness",
          "reason": "hash_from_canonical_mismatch",
          "path": null,
          "eloDerivado": null,
          "motivoDerivado": null
        },
        {
          "id": "final_readiness",
          "reason": "cumulative_from_canonical_mismatch",
          "path": null,
          "eloDerivado": null,
          "motivoDerivado": null
        },
        {
          "id": "consistency_report",
          "reason": "cumulative_from_canonical_mismatch",
          "path": null,
          "eloDerivado": null,
          "motivoDerivado": null
        },
        {
          "id": "cross_report",
          "reason": "cumulative_from_canonical_mismatch",
          "path": null,
          "eloDerivado": null,
          "motivoDerivado": null
        },
        {
          "id": "proof_signature",
          "reason": "hash_from_canonical_mismatch",
          "path": null,
          "eloDerivado": null,
          "motivoDerivado": null
        },
        {
          "id": "proof_signature",
          "reason": "cumulative_from_canonical_mismatch",
          "path": null,
          "eloDerivado": null,
          "motivoDerivado": null
        },
        {
          "id": "blocker_engine",
          "reason": "cumulative_from_canonical_mismatch",
          "path": null,
          "eloDerivado": null,
          "motivoDerivado": null
        },
        {
          "id": "package_validation",
          "reason": "hash_from_canonical_mismatch",
          "path": null,
          "eloDerivado": null,
          "motivoDerivado": null
        },
        {
          "id": "package_validation",
          "reason": "cumulative_from_canonical_mismatch",
          "path": null,
          "eloDerivado": null,
          "motivoDerivado": null
        },
        {
          "id": "chain_root",
          "reason": "chain_root_from_canonical_mismatch",
          "path": null,
          "eloDerivado": null,
          "motivoDerivado": null
        },
        {
          "id": "package",
          "reason": "file_deleted",
          "path": "dist/release/r-agent2-20261017-040050.zip",
          "eloDerivado": false,
          "motivoDerivado": null
        },
        {
          "id": "sidecar_manifest",
          "reason": "file_deleted",
          "path": "dist/release/r-agent2-20261017-040050.manifest.json",
          "eloDerivado": false,
          "motivoDerivado": null
        },
        {
          "id": "evidence_manifest",
          "reason": "hash_mismatch",
          "path": "governance/evidence-manifest.json",
          "eloDerivado": true,
          "motivoDerivado": "regravado por system:go-no-go (platform-readiness) dentro do ciclo"
        },
        {
          "id": "final_proof_report",
          "reason": "hash_mismatch",
          "path": "governance/final-proof-report.json",
          "eloDerivado": true,
          "motivoDerivado": "regravado por system:go-no-go dentro do ciclo"
        },
        {
          "id": "final_readiness",
          "reason": "hash_mismatch",
          "path": "governance/final-readiness-report.json",
          "eloDerivado": true,
          "motivoDerivado": "regravado por system:go-no-go dentro do ciclo"
        },
        {
          "id": "consistency_report",
          "reason": "cumulative_hash_broken",
          "path": null,
          "eloDerivado": null,
          "motivoDerivado": null
        },
        {
          "id": "cross_report",
          "reason": "cumulative_hash_broken",
          "path": null,
          "eloDerivado": null,
          "motivoDerivado": null
        },
        {
          "id": "proof_signature",
          "reason": "hash_mismatch",
          "path": "governance/proof-signature.json",
          "eloDerivado": true,
          "motivoDerivado": "regravado por materialize-proof-artifacts dentro do ciclo"
        },
        {
          "id": "blocker_engine",
          "reason": "cumulative_hash_broken",
          "path": null,
          "eloDerivado": null,
          "motivoDerivado": null
        },
        {
          "id": "package_validation",
          "reason": "hash_mismatch",
          "path": "governance/package-validation-report.json",
          "eloDerivado": true,
          "motivoDerivado": "regravado por system:go-no-go dentro do ciclo"
        },
        {
          "id": "chain_root",
          "reason": "chain_root_mismatch",
          "path": null,
          "eloDerivado": null,
          "motivoDerivado": null
        }
      ],
      "imutaveisQuebrados": [
        {
          "id": "package",
          "reason": "file_deleted",
          "path": "dist/release/r-agent2-20261017-040050.zip",
          "eloDerivado": false,
          "motivoDerivado": null
        },
        {
          "id": "sidecar_manifest",
          "reason": "file_deleted",
          "path": "dist/release/r-agent2-20261017-040050.manifest.json",
          "eloDerivado": false,
          "motivoDerivado": null
        }
      ],
      "derivadosQuebrados": [
        {
          "id": "evidence_manifest",
          "reason": "hash_mismatch",
          "path": "governance/evidence-manifest.json",
          "eloDerivado": true,
          "motivoDerivado": "regravado por system:go-no-go (platform-readiness) dentro do ciclo"
        },
        {
          "id": "final_proof_report",
          "reason": "hash_mismatch",
          "path": "governance/final-proof-report.json",
          "eloDerivado": true,
          "motivoDerivado": "regravado por system:go-no-go dentro do ciclo"
        },
        {
          "id": "final_readiness",
          "reason": "hash_mismatch",
          "path": "governance/final-readiness-report.json",
          "eloDerivado": true,
          "motivoDerivado": "regravado por system:go-no-go dentro do ciclo"
        },
        {
          "id": "proof_signature",
          "reason": "hash_mismatch",
          "path": "governance/proof-signature.json",
          "eloDerivado": true,
          "motivoDerivado": "regravado por materialize-proof-artifacts dentro do ciclo"
        },
        {
          "id": "package_validation",
          "reason": "hash_mismatch",
          "path": "governance/package-validation-report.json",
          "eloDerivado": true,
          "motivoDerivado": "regravado por system:go-no-go dentro do ciclo"
        }
      ],
      "estruturais": [
        {
          "id": "package",
          "reason": "canonical_path_unresolved",
          "path": null,
          "eloDerivado": null,
          "motivoDerivado": null
        },
        {
          "id": "sidecar_manifest",
          "reason": "canonical_path_unresolved",
          "path": null,
          "eloDerivado": null,
          "motivoDerivado": null
        },
        {
          "id": "package",
          "reason": "canonical_file_missing",
          "path": null,
          "eloDerivado": null,
          "motivoDerivado": null
        },
        {
          "id": "sidecar_manifest",
          "reason": "canonical_file_missing",
          "path": null,
          "eloDerivado": null,
          "motivoDerivado": null
        },
        {
          "id": "evidence_manifest",
          "reason": "hash_from_canonical_mismatch",
          "path": null,
          "eloDerivado": null,
          "motivoDerivado": null
        },
        {
          "id": "evidence_manifest",
          "reason": "cumulative_from_canonical_mismatch",
          "path": null,
          "eloDerivado": null,
          "motivoDerivado": null
        },
        {
          "id": "final_proof_report",
          "reason": "hash_from_canonical_mismatch",
          "path": null,
          "eloDerivado": null,
          "motivoDerivado": null
        },
        {
          "id": "final_proof_report",
          "reason": "cumulative_from_canonical_mismatch",
          "path": null,
          "eloDerivado": null,
          "motivoDerivado": null
        },
        {
          "id": "final_readiness",
          "reason": "hash_from_canonical_mismatch",
          "path": null,
          "eloDerivado": null,
          "motivoDerivado": null
        },
        {
          "id": "final_readiness",
          "reason": "cumulative_from_canonical_mismatch",
          "path": null,
          "eloDerivado": null,
          "motivoDerivado": null
        },
        {
          "id": "consistency_report",
          "reason": "cumulative_from_canonical_mismatch",
          "path": null,
          "eloDerivado": null,
          "motivoDerivado": null
        },
        {
          "id": "cross_report",
          "reason": "cumulative_from_canonical_mismatch",
          "path": null,
          "eloDerivado": null,
          "motivoDerivado": null
        },
        {
          "id": "proof_signature",
          "reason": "hash_from_canonical_mismatch",
          "path": null,
          "eloDerivado": null,
          "motivoDerivado": null
        },
        {
          "id": "proof_signature",
          "reason": "cumulative_from_canonical_mismatch",
          "path": null,
          "eloDerivado": null,
          "motivoDerivado": null
        },
        {
          "id": "blocker_engine",
          "reason": "cumulative_from_canonical_mismatch",
          "path": null,
          "eloDerivado": null,
          "motivoDerivado": null
        },
        {
          "id": "package_validation",
          "reason": "hash_from_canonical_mismatch",
          "path": null,
          "eloDerivado": null,
          "motivoDerivado": null
        },
        {
          "id": "package_validation",
          "reason": "cumulative_from_canonical_mismatch",
          "path": null,
          "eloDerivado": null,
          "motivoDerivado": null
        },
        {
          "id": "chain_root",
          "reason": "chain_root_from_canonical_mismatch",
          "path": null,
          "eloDerivado": null,
          "motivoDerivado": null
        },
        {
          "id": "consistency_report",
          "reason": "cumulative_hash_broken",
          "path": null,
          "eloDerivado": null,
          "motivoDerivado": null
        },
        {
          "id": "cross_report",
          "reason": "cumulative_hash_broken",
          "path": null,
          "eloDerivado": null,
          "motivoDerivado": null
        },
        {
          "id": "blocker_engine",
          "reason": "cumulative_hash_broken",
          "path": null,
          "eloDerivado": null,
          "motivoDerivado": null
        },
        {
          "id": "chain_root",
          "reason": "chain_root_mismatch",
          "path": null,
          "eloDerivado": null,
          "motivoDerivado": null
        }
      ],
      "interpretacao": "DIVERGÊNCIA EM ELO IMUTÁVEL: o artefato certificado (ou sua assinatura) mudou depois da certificação. Isto é a classe grave — trate como adulteração até prova em contrário.",
      "notaDeFase": "A fase `certify` do selo reconstrói e assina a cadeia e depois a verifica de forma BLOQUEANTE (medido em seal-release.sh). Portanto a cadeia é válida imediatamente após um selo; rodar qualquer passo que regrave um elo derivado depois disso a torna divergente de forma legítima."
    },
    "provas": [
      {
        "path": "reports/governance-score.json",
        "gitTracked": false,
        "existe": true,
        "veredito": "FAIL",
        "campoVeredito": "status",
        "runId": null,
        "generatedAt": "2026-10-31T01:30:58.839Z",
        "sha256": "72de76818d4df34b301b35ac7cef59989d2ea28f1d0a2055fe1a7bcdfadbc351"
      },
      {
        "path": "reports/coverage-gate-report.json",
        "gitTracked": false,
        "existe": true,
        "veredito": "NO_GO",
        "campoVeredito": "status",
        "runId": null,
        "generatedAt": "2026-11-01T12:25:16.412Z",
        "sha256": "2674b637f86bf8af6e5916c9298dee2b3a8243fd624954dd8e0a0027f3c222b4"
      },
      {
        "path": "reports/release-artifact-identity-report.json",
        "gitTracked": false,
        "existe": false,
        "veredito": null,
        "campoVeredito": "decision",
        "runId": null,
        "generatedAt": null,
        "sha256": null
      },
      {
        "path": "reports/source-remote-provenance-report.json",
        "gitTracked": false,
        "existe": false,
        "veredito": null,
        "campoVeredito": "status",
        "runId": null,
        "generatedAt": null,
        "sha256": null
      },
      {
        "path": "reports/final-status-projection-report.json",
        "gitTracked": false,
        "existe": true,
        "veredito": "FAIL",
        "campoVeredito": "status",
        "runId": null,
        "generatedAt": "2026-11-01T15:07:45.699Z",
        "sha256": "2c0643cd3ba3a9be3bc0a6fdcfb55fcc0aee31ceeb32249152f518a11ea2e39a"
      },
      {
        "path": "reports/security-release-gate-report.json",
        "gitTracked": false,
        "existe": true,
        "veredito": "NO_GO",
        "campoVeredito": "decision",
        "runId": null,
        "generatedAt": "2026-11-01T13:14:00.296Z",
        "sha256": "b2e274d78d1d5271a70156823b1af6248f6e85836108e01657d521a876bb4642"
      },
      {
        "path": "reports/security-intel-report.json",
        "gitTracked": false,
        "existe": false,
        "veredito": null,
        "campoVeredito": "status",
        "runId": null,
        "generatedAt": null,
        "sha256": null
      },
      {
        "path": "reports/mcp-research-docker-e2e-report.json",
        "gitTracked": false,
        "existe": false,
        "veredito": null,
        "campoVeredito": "status",
        "runId": null,
        "generatedAt": null,
        "sha256": null
      },
      {
        "path": "reports/hardening-queue-report.json",
        "gitTracked": false,
        "existe": true,
        "veredito": "PASS",
        "campoVeredito": "status",
        "runId": null,
        "generatedAt": "2026-11-01T15:03:05.301Z",
        "sha256": "d1ccb6ee790e3eb500002b835916838dde9daa235f5722920ae834420a8a354b"
      },
      {
        "path": "reports/release-dag-report.json",
        "gitTracked": false,
        "existe": true,
        "veredito": "RELEASE_DAG_ACYCLIC_AND_PHASE_AWARE",
        "campoVeredito": "decision",
        "runId": null,
        "generatedAt": "2026-11-01T13:13:40.268Z",
        "sha256": "19ff7c883f8e9cfd17ba58137f653526dfccff0afb653536e133aaef494827a5"
      },
      {
        "path": "governance/evidence-manifest.json",
        "gitTracked": true,
        "existe": true,
        "veredito": "PASS",
        "campoVeredito": "status",
        "runId": "rap-governed-20261020150721180-09a2168d",
        "generatedAt": "2026-10-20T16:12:13.612Z",
        "sha256": "40336fa0d09a7a98293eaafd29db237fc6fd3ef132d295c76e043f8ff0bade15"
      },
      {
        "path": "governance/delivered-release-verification-report.json",
        "gitTracked": false,
        "existe": false,
        "veredito": null,
        "campoVeredito": "decision",
        "runId": null,
        "generatedAt": null,
        "sha256": null
      },
      {
        "path": "governance/.current-run.json",
        "gitTracked": false,
        "existe": false,
        "veredito": null,
        "campoVeredito": "status",
        "runId": null,
        "generatedAt": null,
        "sha256": null
      }
    ],
    "artefatosFisicos": [],
    "fila": {
      "total": 175,
      "naoFechados": []
    },
    "ponteirosHistoricos": [
      {
        "path": "FINAL_RAP_RELEASE_CLOSURE.json",
        "gitTracked": true,
        "ultimoCommit": "9634e5c58",
        "ultimaData": "2026-11-01T05:24:57-03:00",
        "geradoEm": "2026-09-24T07:31:39.421Z",
        "headRegistrado": "b0665b7672e9d8eeb4633c9210e3b53e834613f1",
        "statusRegistrado": "SUPERSEDED",
        "aviso": "HISTÓRICO/stale — NÃO representa o estado atual; use AI_MEMORY/evidence/AUDIT_ENTRYPOINT.json"
      },
      {
        "path": "FINAL_RELEASE_CLOSURE.md",
        "gitTracked": true,
        "ultimoCommit": "570bbd0c4",
        "ultimaData": "2026-09-24T04:32:06-03:00",
        "geradoEm": null,
        "headRegistrado": null,
        "statusRegistrado": null,
        "aviso": "HISTÓRICO/stale — NÃO representa o estado atual; use AI_MEMORY/evidence/AUDIT_ENTRYPOINT.json"
      },
      {
        "path": "ENGINEERING_ROUTER_V1_SEAL_REPORT.json",
        "gitTracked": true,
        "ultimoCommit": "0a69bdaed",
        "ultimaData": "2026-09-23T13:48:07-03:00",
        "geradoEm": "2026-09-23T16:46:58.938Z",
        "headRegistrado": null,
        "statusRegistrado": null,
        "aviso": "HISTÓRICO/stale — NÃO representa o estado atual; use AI_MEMORY/evidence/AUDIT_ENTRYPOINT.json"
      },
      {
        "path": "ENGINEERING_ROUTER_V1_FINAL_SEAL.md",
        "gitTracked": true,
        "ultimoCommit": "330478f54",
        "ultimaData": "2026-09-22T17:30:07-03:00",
        "geradoEm": null,
        "headRegistrado": null,
        "statusRegistrado": null,
        "aviso": "HISTÓRICO/stale — NÃO representa o estado atual; use AI_MEMORY/evidence/AUDIT_ENTRYPOINT.json"
      }
    ]
  },
  "comoDetectarMudanca": [
    "git log --oneline -20",
    "git log -1 --format=%H -- AI_MEMORY/evidence/AUDIT_ENTRYPOINT.md   # commit que gerou o epoch atual",
    "auditEpoch.valor != epoch da auditoria anterior  =>  houve mudança",
    "payload.provas[].sha256 != hash registrado       =>  prova alterada em disco (possível adulteração)"
  ],
  "comoReauditar": [
    "npm run validate:governance-enforcement      # gate agregado bloqueante: cadeia de 63 passos com &&",
    "node scripts/governance/validate-hardening-queue.js",
    "npm run validate:release-artifact-identity",
    "node scripts/governance/verify-remote-provenance.js --manifest dist/release/<release>.manifest.json",
    "npm run validate:final-status-projection"
  ],
  "fontesCanonicas": [
    "AI_MEMORY/hardening-queue.json            (fila oficial de pendências)",
    "AI_MEMORY/evidence/missao-hardening-eng-gov-release-2026-10-16.md  (relatório da missão)",
    "docs/governance/_platform-status-source.json  (decisão canônica de release)",
    "docs/governance/PLATFORM_STATUS.md e docs/architecture/RAP_MASTER_SCORECARD.md  (projeções)",
    "reports/*.json e governance/*.json        (prova em disco; ignorados pelo git por política)"
  ],
  "politica": {
    "publicado": false,
    "tagCriada": false,
    "observacao": "O release está SELADO e verificado, mas NÃO publicado: sem tag, sem promoção. Publicar é decisão explícita do operador (scripts/create-release-tag.sh + verify-remote-provenance --require-tag)."
  }
}
```
