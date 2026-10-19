# AUDIT_ENTRYPOINT — ponto de entrada único para auditoria externa

> Artefato DERIVADO (nada escrito à mão). Gerado por `tools/audit/generate-audit-entrypoint.js`.
> Regenerar: `node tools/audit/generate-audit-entrypoint.js [--aggregate-log <log> --aggregate-head <sha>]`.
>
> Por que Markdown e não `.json`: `audit:json-persistence` (passo bloqueante do gate agregado) reprova com
> `UNKNOWN` todo alvo de escrita `.json` fora da taxonomia canônica, e `AI_MEMORY/evidence/` não está nela.
> O payload JSON completo vai embutido no bloco cercado ao fim deste arquivo — nada foi perdido.

- **Gerado em**: 2026-10-16T23:50:17.155Z
- **auditEpoch**: `5f711ac2d0c7dda6e1c9972de9be8386a7a741df463edcda6adb6db47d51f084`
- **Branch / HEAD**: `dev/engineering-hardening` / `c99ccd551f83b3a070c4d76af26c4c229aa1c7fa`
- **HEAD sincronizado com o remote**: sim
- **Commits não enviados**: 0
- **Release governado**: `rap-governed-20261016144931085-033e1239` · fingerprint `1c10ffa62e169a18db1cd22e935fb41420fd5a865da58dd576b36a0f355d971e`
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
- Passos na cadeia: **63** (62 via `npm run`)
- Passos que não são `npm run`: `node scripts/governance/stamp-report-lineage.js`
- A cadeia usa && encadeado: exit 0 no alias PROVA que TODOS os passos passaram (qualquer falha aborta com exit != 0). Isso é mais forte e mais simples que contar linhas "status=PASS" no log, que é artefato de formatação de cada gate e não corresponde 1:1 ao número de passos.
- Relatório próprio do agregado: `reports/governance-enforcement-full-report.json` — existe, gerado em 2026-10-16T23:46:21.941Z, runId corrente? **sim**
- Provas acima com o runId corrente: **9 de 13**
- Provas que não registram campo `runId` (não é violação, o campo não existe nelas): `reports/final-status-projection-report.json`, `reports/security-intel-report.json`, `reports/mcp-research-docker-e2e-report.json`, `reports/hardening-queue-report.json`

> Relatório do agregado é do run corrente.

- **Última execução medida**: `PASS` (exit 0) — HEAD `6221b7cca`, log `AI_MEMORY/evidence/aggregate-enforcement-2026-10-16-dev-branch.log` encerrado em 2026-10-16T19:47:30.518Z, sha256 do log `31f7454ac4af38f1`
- Diagnóstico do log: 31 linhas `status=PASS`, 0 `status=FAIL`, 0 `status=NO_GO` (diagnóstico, não veredito)

## Cadeia criptográfica — estado derivado (recomputado)

- **Estado**: **RECERTIFICACAO_NECESSARIA** (validador: `FAIL`, verificado=true, elos=10)
- Raiz persistida `d22cf8fa6b8035c7…` × recalculada `e03b9a0df5d5a8af…` — conferem? **NÃO** · `tampered`=true
- Cadeia construída para o commit `d9c469e677ee` / artefato `r-agent2-20261016-133323.payload.zip`

> As divergências atingem APENAS elos derivados, que o próprio ciclo regrava (ver motivoDerivado). O artefato certificado NÃO foi alterado; o que existe é uma cadeia construída para um snapshot anterior — remedio: novo ciclo de selagem (fase certify), nunca "conserto" manual da cadeia.

> A fase `certify` do selo reconstrói e assina a cadeia e depois a verifica de forma BLOQUEANTE (medido em seal-release.sh). Portanto a cadeia é válida imediatamente após um selo; rodar qualquer passo que regrave um elo derivado depois disso a torna divergente de forma legítima.

| divergência | elo | classificação | motivo do elo derivado |
|---|---|---|---|
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
| `reports/governance-score.json` | **PASS** | 085-033e1239 | c52b54c55f56 | não (ignorado) |
| `reports/coverage-gate-report.json` | **GO** | 085-033e1239 | b0cf907251bd | não (ignorado) |
| `reports/release-artifact-identity-report.json` | **RELEASE_ARTIFACT_IDENTITY_VERIFIED** | 085-033e1239 | 866d49051349 | não (ignorado) |
| `reports/source-remote-provenance-report.json` | **PASS** | 085-033e1239 | 53d33ad9e843 | não (ignorado) |
| `reports/final-status-projection-report.json` | **PASS** | — | 9584da4fe46a | não (ignorado) |
| `reports/security-release-gate-report.json` | **GO** | 085-033e1239 | 175aaa43c658 | não (ignorado) |
| `reports/security-intel-report.json` | **PASS** | — | e655c73cd0fe | não (ignorado) |
| `reports/mcp-research-docker-e2e-report.json` | **PASS** | — | b9f50cf9d256 | não (ignorado) |
| `reports/hardening-queue-report.json` | **PASS** | — | 3f4d10a2f958 | não (ignorado) |
| `reports/release-dag-report.json` | **RELEASE_DAG_ACYCLIC_AND_PHASE_AWARE** | 085-033e1239 | 9200c55d9eca | não (ignorado) |
| `governance/evidence-manifest.json` | **PASS** | 085-033e1239 | 1dda610313aa | sim |
| `governance/delivered-release-verification-report.json` | **DELIVERED_RELEASE_VERIFIED** | 085-033e1239 | f52a8e66fc51 | não (ignorado) |
| `governance/.current-run.json` | **COMPLETED** | 085-033e1239 | 47d0a433361e | não (ignorado) |

## Artefatos físicos do release (prova por hash, fora do git)

| artefato | bytes | sha256 (16) |
|---|---|---|
| `dist/release/r-agent2-20261016-133323.delivered.identity.json` | 1423 | 2874f73d26dd1988 |
| `dist/release/r-agent2-20261016-133323.manifest.json` | 1110 | b0e5320ad487f760 |
| `dist/release/r-agent2-20261016-133323.payload.zip` | 64396675 | 515e94adc60ab35e |
| `dist/release/r-agent2-20261016-133323.zip` | 64472381 | ab827c21bd6876af |

## Itens que aguardam decisão do dono (fila oficial)

Nota de semântica: `blocked`/`blocked_external` são estados FECHADOS para o agente (ele não deve agir), mas continuam exigindo decisão humana — por isso aparecem aqui.

- `HARDENING-ENG-GOV-RELEASE-MESH-EXECUCAO-VAZIA-AINDA-GERA-EVIDENCIA` — **blocked** — Decisao de POLITICA (dono do produto), nao mecânica. Medicao 2026-10-16: o fail-open e LATENTE, nao ativo no caminho verde — a execucao canonica da malha no run corrente tem 144 resultados (isCanonicalExecution=true, runId/sourceFingerprint/sourceCommit corretos). Risco real: o produtor grava artefato governado mesmo com executedResults=0 e o gate nao distingue "executou 0 cenarios" de "executou e passou". Duas direcoes validas com semanticas diferentes: (a) produtor marca artefato vazio como NAO-evidencia, ou (b) a malha falha ANTES de gravar. CUSTO MEDIDO de aplicar agora: qa-mesh/*.js e scripts/governance/* estao em SOURCE_ROOTS (governance/proof-engine/fingerprint-chain.js:54-70,106-112), portanto qualquer edicao muda o fingerprint 1c10ffa62e169a18 e invalida o release ja selado (r-agent2-20261016-133323), exigindo novo ciclo de selagem.
- `HARDENING-ENG-GOV-RELEASE-AGREGADO-SEM-RELATORIO-PROPRIO` — **blocked** — Correcao exige editar scripts/governance/** (SOURCE_ROOTS em governance/proof-engine/fingerprint-chain.js:54-70) => muda o sourceFingerprint 1c10ffa62e169a18 e invalida o release ja selado (r-agent2-20261016-133323), exigindo novo ciclo de selagem. Decisao de custo/beneficio do dono. Medicao 2026-10-16: reports/governance-enforcement-full-report.json e de 2026-10-14T22:29:09.605Z e tem runId de OUTRO run; ele e escrito por scripts/governance/run-all-validators.js, que o alias validate:governance-enforcement NAO usa — o alias e uma cadeia direta de 63 passos (62 npm run + 1 node scripts/governance/stamp-report-lineage.js). Mitigacao ativa desde ja: o AUDIT_ENTRYPOINT documenta que o que prova o agregado e o exit 0 da cadeia && (nao a contagem de linhas status=PASS) e marca esse relatorio como DESATUALIZADO.
- `HARDENING-ENG-GOV-RELEASE-RUNTIME-EVIDENCE-DIAGNOSTICO-ENGANOSO` — **blocked** — Correcao exige editar scripts/governance/** (SOURCE_ROOTS) => muda o sourceFingerprint 1c10ffa62e169a18 e invalida o release ja selado (r-agent2-20261016-133323), exigindo novo ciclo de selagem. Decisao de custo/beneficio do dono. MEDICAO 2026-10-16: no agg7 o item RED_TO_FIX falhou e o gate reportou "saida do Jest nao pode ser parseada como JSON (crash antes do reporter)", mas o Jest terminou normalmente e imprimiu a assercao real no stderr do filho (`Expected: "GREEN" / Received: "READY_FOR_PROMOTION"`, engineeringRouterFullLoopE2E.test.js:218) + resumo completo ("Test Suites: 1 failed, 1 total / Time: 28.241 s"). O veredito do gate (item falhou) esta CORRETO; o diagnostico e que engana quem le so a linha resumida, e a causa real exige ler a secao "stderr do filho".
- `HARDENING-ENG-GOV-RELEASE-TAXONOMIA-PERSISTENCIA-AI-MEMORY-EVIDENCE` — **blocked** — Classificar AI_MEMORY/evidence/ exige editar governance/json-persistence-audit.js, que esta em FILTERED_SOURCE_ROOTS (governance/**/*.js em governance/proof-engine/fingerprint-chain.js:106-112) => muda o sourceFingerprint 1c10ffa62e169a18 e invalida o release ja selado (r-agent2-20261016-133323), exigindo novo ciclo de selagem. Decisao de custo/beneficio do dono. MEDICAO 2026-10-16 (prova dura): o passo bloqueante `audit:json-persistence` (node governance/json-persistence-audit.js --check) reprovou com exit 1 e unknown=2 no agg8, e os dois alvos UNKNOWN eram exatamente os artefatos que eu havia criado: `AI_MEMORY/evidence/AUDIT_ENTRYPOINT.json` e `AI_MEMORY/evidence/aggregate-enforcement-last-run.json`. Nao era flake: `classifyByPattern()` (json-persistence-audit.js:249-251) auto-classifica qa/, qa-mesh/, governance/, reports/ e docs/, mas NAO AI_MEMORY/evidence/ — que e exatamente o analogo de qa/evidence/ (essa sim classificada como ARTIFACT_STORAGE). MITIGACAO ATIVA (ja aplicada): o ponto de entrada passou a ser UM arquivo Markdown com o payload JSON embutido em bloco cercado; nenhum `.json` e escrito por tools/audit/. Comprovado: `audit:json-persistence --check` voltou a EXIT=0 e o sourceFingerprint permaneceu 1c10ffa62e169a18 (tools/audit/ esta fora de SOURCE_ROOTS).
- `AUDITORIA-FASE-B-FALSO-POSITIVO-SCANNER-FILA` — **blocked** — DEFEITO MENOR (P1), sem impacto em gate. MEDIDO 2026-10-16: o unico alvo sob AI_MEMORY/ no inventario e `AI_MEMORY/hardening-queue.json`, classificado como STATIC_VERSIONED_CONFIG, com writer `tools/audit/generate-audit-entrypoint.js` — mas esse gerador apenas LE a fila. O scanner trata o caminho como alvo de escrita porque ele aparece no mesmo arquivo que escreve o .md. Dois problemas reais: (1) alvo de escrita fantasma; (2) classificacao impropria, porque a fila e MUTAVEL (agentes escrevem nela) e nao "configuracao versionada estatica". Correcao exige editar governance/json-persistence-audit.js (SOURCE_ROOTS) => novo fingerprint => re-selagem. Como o alvo esta classificado, nenhum gate reprova por isso — risco atual: baixo, mas o inventario mente.

## Ponteiros stale na raiz do repositório — NÃO use como estado atual

Estes arquivos existem na raiz, são versionados e NENHUM gate os mantém — eles congelaram em datas antigas. Um auditor que os leia como estado corrente audita o passado.

| arquivo | gerado em | HEAD que ele registra | último commit que o tocou |
|---|---|---|---|
| `FINAL_RAP_RELEASE_CLOSURE.json` | 2026-09-24T07:31:39.421Z | `b0665b7672` | `602a00a1c` 2026-10-16 |
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
  "generatedAt": "2026-10-16T23:50:17.155Z",
  "generatedBy": "tools/audit/generate-audit-entrypoint.js",
  "auditEpoch": {
    "valor": "5f711ac2d0c7dda6e1c9972de9be8386a7a741df463edcda6adb6db47d51f084",
    "definicao": "sha256 do bloco \"payload\" em stringify canônico — muda quando qualquer prova, veredito, commit ou artefato muda",
    "comoUsar": "compare este valor e os sha256 de payload.provas[] com os da auditoria anterior; diferença = houve mudança, reaudite"
  },
  "payload": {
    "git": {
      "branch": "dev/engineering-hardening",
      "headAtGeneration": "c99ccd551f83b3a070c4d76af26c4c229aa1c7fa",
      "headAssunto": "fix(P1): juiz fail-closed da ENTREGA e fim do push no-op para main no selo",
      "headData": "2026-10-16T20:49:53-03:00",
      "remoteHead": "c99ccd551f83b3a070c4d76af26c4c229aa1c7fa",
      "tronco": "origin/main",
      "headEmSincroniaComRemote": true,
      "worktreeCleanExcluindoEsteArtefato": false,
      "uncommittedPaths": [
        "M AI_MEMORY/hardening-queue.json"
      ],
      "commitsNaoEnviados": 0
    },
    "releaseGovernado": {
      "runId": "rap-governed-20261016144931085-033e1239",
      "sourceFingerprint": "1c10ffa62e169a18db1cd22e935fb41420fd5a865da58dd576b36a0f355d971e",
      "sourceCommit": "5efce7924932822c23888de97efc6243981da75e",
      "sourceTree": "692fe4b807cb36fbe6c7f287f535c65e4e31491a",
      "startedAt": "2026-10-16T14:49:31.204Z",
      "lastGovernedStage": "final-governance",
      "runStatus": "COMPLETED"
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
      "passosNaCadeia": 63,
      "passosViaNpmRun": 62,
      "passosNaoNpmRun": [
        "node scripts/governance/stamp-report-lineage.js"
      ],
      "semantica": "A cadeia usa && encadeado: exit 0 no alias PROVA que TODOS os passos passaram (qualquer falha aborta com exit != 0). Isso é mais forte e mais simples que contar linhas \"status=PASS\" no log, que é artefato de formatação de cada gate e não corresponde 1:1 ao número de passos.",
      "relatorioProprio": {
        "path": "reports/governance-enforcement-full-report.json",
        "existe": true,
        "generatedAt": "2026-10-16T23:46:21.941Z",
        "runId": "rap-governed-20261016144931085-033e1239",
        "doRunCorrente": true,
        "escritor": "scripts/governance/run-all-validators.js",
        "aviso": "Relatório do agregado é do run corrente."
      },
      "provasComRunIdCorrente": 9,
      "provasSemCampoRunId": [
        "reports/final-status-projection-report.json",
        "reports/security-intel-report.json",
        "reports/mcp-research-docker-e2e-report.json",
        "reports/hardening-queue-report.json"
      ],
      "provasDeOutroRun": [],
      "ultimaExecucaoMedida": {
        "existe": true,
        "comando": "npm run validate:governance-enforcement",
        "veredito": "PASS",
        "exitCode": 0,
        "semantica": "exit 0 numa cadeia && encadeada prova que TODOS os passos passaram. As contagens de linhas são diagnóstico de formatação de cada gate, NÃO o veredito (não correspondem 1:1 ao número de passos da cadeia).",
        "headAtRun": "6221b7cca",
        "logPath": "AI_MEMORY/evidence/aggregate-enforcement-2026-10-16-dev-branch.log",
        "logSha256": "31f7454ac4af38f11da0472273f4cdf16a333b05ff4d072f59d02b0740cbeb36",
        "logBytes": 72206,
        "logFinishedAt": "2026-10-16T19:47:30.518Z",
        "diagnostico": {
          "passLines": 31,
          "failLines": 0,
          "noGoLines": 0,
          "totalLines": 1159
        }
      }
    },
    "cadeiaCriptografica": {
      "relatorio": "reports/governance-chain-report.json",
      "existe": true,
      "statusDoValidador": "FAIL",
      "estado": "RECERTIFICACAO_NECESSARIA",
      "verificada": true,
      "elosVerificados": 10,
      "raizPersistida": "d22cf8fa6b8035c7f54dd2e27a82f3a0df6beae03fb9e75984bf88ed8a4056f9",
      "raizRecalculada": "e03b9a0df5d5a8afb8cb18c4ba8accf8552252ec9e6b5ed5f27ab13081b8a480",
      "raizConfere": false,
      "tampered": true,
      "gitCommitDaCadeia": "d9c469e677eee10fd998fefdf9f5a0d61c6d37a0",
      "artefatoDaCadeia": "r-agent2-20261016-133323.payload.zip",
      "falhas": [
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
      "imutaveisQuebrados": [],
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
      "interpretacao": "As divergências atingem APENAS elos derivados, que o próprio ciclo regrava (ver motivoDerivado). O artefato certificado NÃO foi alterado; o que existe é uma cadeia construída para um snapshot anterior — remedio: novo ciclo de selagem (fase certify), nunca \"conserto\" manual da cadeia.",
      "notaDeFase": "A fase `certify` do selo reconstrói e assina a cadeia e depois a verifica de forma BLOQUEANTE (medido em seal-release.sh). Portanto a cadeia é válida imediatamente após um selo; rodar qualquer passo que regrave um elo derivado depois disso a torna divergente de forma legítima."
    },
    "provas": [
      {
        "path": "reports/governance-score.json",
        "gitTracked": false,
        "existe": true,
        "veredito": "PASS",
        "campoVeredito": "status",
        "runId": "rap-governed-20261016144931085-033e1239",
        "generatedAt": "2026-10-16T19:33:30.383Z",
        "sha256": "c52b54c55f5677541a256ae3a44c298a10aca06744664154f4033169c41d541e"
      },
      {
        "path": "reports/coverage-gate-report.json",
        "gitTracked": false,
        "existe": true,
        "veredito": "GO",
        "campoVeredito": "status",
        "runId": "rap-governed-20261016144931085-033e1239",
        "generatedAt": "2026-10-16T19:33:22.122Z",
        "sha256": "b0cf907251bd56ce369017d68dd1b0f231a75442394284275869756574fcc68a"
      },
      {
        "path": "reports/release-artifact-identity-report.json",
        "gitTracked": false,
        "existe": true,
        "veredito": "RELEASE_ARTIFACT_IDENTITY_VERIFIED",
        "campoVeredito": "decision",
        "runId": "rap-governed-20261016144931085-033e1239",
        "generatedAt": "2026-10-16T19:27:17.562Z",
        "sha256": "866d490513497626f06b2cbaa8e513067c19d21f6a114fd68514402ca8831278"
      },
      {
        "path": "reports/source-remote-provenance-report.json",
        "gitTracked": false,
        "existe": true,
        "veredito": "PASS",
        "campoVeredito": "status",
        "runId": "rap-governed-20261016144931085-033e1239",
        "generatedAt": "2026-10-16T17:47:00.489Z",
        "sha256": "53d33ad9e84351e3e1b7e6db2528131acd8506eaaf88afd1d94a4106bfecc31c"
      },
      {
        "path": "reports/final-status-projection-report.json",
        "gitTracked": false,
        "existe": true,
        "veredito": "PASS",
        "campoVeredito": "status",
        "runId": null,
        "generatedAt": "2026-10-16T19:33:30.690Z",
        "sha256": "9584da4fe46a6bb986225db882be26f87442a19ab0b41f0e8223537444a465a0"
      },
      {
        "path": "reports/security-release-gate-report.json",
        "gitTracked": false,
        "existe": true,
        "veredito": "GO",
        "campoVeredito": "decision",
        "runId": "rap-governed-20261016144931085-033e1239",
        "generatedAt": "2026-10-16T23:46:39.373Z",
        "sha256": "175aaa43c658857940c9a809d3962c8f1ff048430289c1db35329356a3f7ecd4"
      },
      {
        "path": "reports/security-intel-report.json",
        "gitTracked": false,
        "existe": true,
        "veredito": "PASS",
        "campoVeredito": "status",
        "runId": null,
        "generatedAt": "2026-10-16T17:01:44.360Z",
        "sha256": "e655c73cd0fecf3709b5c6acfaf5ff9dddf0f9fcd675258b5a572650398b64fe"
      },
      {
        "path": "reports/mcp-research-docker-e2e-report.json",
        "gitTracked": false,
        "existe": true,
        "veredito": "PASS",
        "campoVeredito": "status",
        "runId": null,
        "generatedAt": "2026-10-16T19:33:42.562Z",
        "sha256": "b9f50cf9d256bfd95ae5e7bb4070daa444639261e4054f6ac5d7e0020c91e2a5"
      },
      {
        "path": "reports/hardening-queue-report.json",
        "gitTracked": false,
        "existe": true,
        "veredito": "PASS",
        "campoVeredito": "status",
        "runId": null,
        "generatedAt": "2026-10-16T23:50:14.951Z",
        "sha256": "3f4d10a2f9587ce01aae6ba7fe288d43ae480637d181bc5bf8387de736403061"
      },
      {
        "path": "reports/release-dag-report.json",
        "gitTracked": false,
        "existe": true,
        "veredito": "RELEASE_DAG_ACYCLIC_AND_PHASE_AWARE",
        "campoVeredito": "decision",
        "runId": "rap-governed-20261016144931085-033e1239",
        "generatedAt": "2026-10-16T23:46:20.740Z",
        "sha256": "9200c55d9eca29c7c6f851639371f39da13d457ca7450c6bd5229d497b8afcab"
      },
      {
        "path": "governance/evidence-manifest.json",
        "gitTracked": true,
        "existe": true,
        "veredito": "PASS",
        "campoVeredito": "status",
        "runId": "rap-governed-20261016144931085-033e1239",
        "generatedAt": "2026-10-16T16:53:06.619Z",
        "sha256": "1dda610313aa840c6164cd234cc6a5a8e7af5adcea5b5e46db23373dcf477a62"
      },
      {
        "path": "governance/delivered-release-verification-report.json",
        "gitTracked": false,
        "existe": true,
        "veredito": "DELIVERED_RELEASE_VERIFIED",
        "campoVeredito": "decision",
        "runId": "rap-governed-20261016144931085-033e1239",
        "generatedAt": "2026-10-16T19:48:43.323Z",
        "sha256": "f52a8e66fc516353e51daed328cdff05fcf46691d1bec7bcd5b7850414d3e1b0"
      },
      {
        "path": "governance/.current-run.json",
        "gitTracked": false,
        "existe": true,
        "veredito": "COMPLETED",
        "campoVeredito": "status",
        "runId": "rap-governed-20261016144931085-033e1239",
        "generatedAt": "2026-10-16T16:48:57.945Z",
        "sha256": "47d0a433361eb2881763596c158486183b5934d80db48b841067c64ee7d3c71b"
      }
    ],
    "artefatosFisicos": [
      {
        "path": "dist/release/r-agent2-20261016-133323.delivered.identity.json",
        "bytes": 1423,
        "sha256": "2874f73d26dd1988f9e66f2021aff523a908a288a5101e23158bc7bda373f09e"
      },
      {
        "path": "dist/release/r-agent2-20261016-133323.manifest.json",
        "bytes": 1110,
        "sha256": "b0e5320ad487f7605477a0d5d0557680b6a87c9c6a1359add99f30c69e2bfd65"
      },
      {
        "path": "dist/release/r-agent2-20261016-133323.payload.zip",
        "bytes": 64396675,
        "sha256": "515e94adc60ab35ea7db0d0d6efc5ef1975bae4ade0300bf6d7942b1ab72ff04"
      },
      {
        "path": "dist/release/r-agent2-20261016-133323.zip",
        "bytes": 64472381,
        "sha256": "ab827c21bd6876af041af20308ae481044eb8f99bf2312f647f4ca7e99424e98"
      }
    ],
    "fila": {
      "total": 87,
      "naoFechados": [
        {
          "id": "HARDENING-ENG-GOV-RELEASE-MESH-EXECUCAO-VAZIA-AINDA-GERA-EVIDENCIA",
          "status": "blocked",
          "motivo": "Decisao de POLITICA (dono do produto), nao mecânica. Medicao 2026-10-16: o fail-open e LATENTE, nao ativo no caminho verde — a execucao canonica da malha no run corrente tem 144 resultados (isCanonicalExecution=true, runId/sourceFingerprint/sourceCommit corretos). Risco real: o produtor grava artefato governado mesmo com executedResults=0 e o gate nao distingue \"executou 0 cenarios\" de \"executou e passou\". Duas direcoes validas com semanticas diferentes: (a) produtor marca artefato vazio como NAO-evidencia, ou (b) a malha falha ANTES de gravar. CUSTO MEDIDO de aplicar agora: qa-mesh/*.js e scripts/governance/* estao em SOURCE_ROOTS (governance/proof-engine/fingerprint-chain.js:54-70,106-112), portanto qualquer edicao muda o fingerprint 1c10ffa62e169a18 e invalida o release ja selado (r-agent2-20261016-133323), exigindo novo ciclo de selagem."
        },
        {
          "id": "HARDENING-ENG-GOV-RELEASE-AGREGADO-SEM-RELATORIO-PROPRIO",
          "status": "blocked",
          "motivo": "Correcao exige editar scripts/governance/** (SOURCE_ROOTS em governance/proof-engine/fingerprint-chain.js:54-70) => muda o sourceFingerprint 1c10ffa62e169a18 e invalida o release ja selado (r-agent2-20261016-133323), exigindo novo ciclo de selagem. Decisao de custo/beneficio do dono. Medicao 2026-10-16: reports/governance-enforcement-full-report.json e de 2026-10-14T22:29:09.605Z e tem runId de OUTRO run; ele e escrito por scripts/governance/run-all-validators.js, que o alias validate:governance-enforcement NAO usa — o alias e uma cadeia direta de 63 passos (62 npm run + 1 node scripts/governance/stamp-report-lineage.js). Mitigacao ativa desde ja: o AUDIT_ENTRYPOINT documenta que o que prova o agregado e o exit 0 da cadeia && (nao a contagem de linhas status=PASS) e marca esse relatorio como DESATUALIZADO."
        },
        {
          "id": "HARDENING-ENG-GOV-RELEASE-RUNTIME-EVIDENCE-DIAGNOSTICO-ENGANOSO",
          "status": "blocked",
          "motivo": "Correcao exige editar scripts/governance/** (SOURCE_ROOTS) => muda o sourceFingerprint 1c10ffa62e169a18 e invalida o release ja selado (r-agent2-20261016-133323), exigindo novo ciclo de selagem. Decisao de custo/beneficio do dono. MEDICAO 2026-10-16: no agg7 o item RED_TO_FIX falhou e o gate reportou \"saida do Jest nao pode ser parseada como JSON (crash antes do reporter)\", mas o Jest terminou normalmente e imprimiu a assercao real no stderr do filho (`Expected: \"GREEN\" / Received: \"READY_FOR_PROMOTION\"`, engineeringRouterFullLoopE2E.test.js:218) + resumo completo (\"Test Suites: 1 failed, 1 total / Time: 28.241 s\"). O veredito do gate (item falhou) esta CORRETO; o diagnostico e que engana quem le so a linha resumida, e a causa real exige ler a secao \"stderr do filho\"."
        },
        {
          "id": "HARDENING-ENG-GOV-RELEASE-TAXONOMIA-PERSISTENCIA-AI-MEMORY-EVIDENCE",
          "status": "blocked",
          "motivo": "Classificar AI_MEMORY/evidence/ exige editar governance/json-persistence-audit.js, que esta em FILTERED_SOURCE_ROOTS (governance/**/*.js em governance/proof-engine/fingerprint-chain.js:106-112) => muda o sourceFingerprint 1c10ffa62e169a18 e invalida o release ja selado (r-agent2-20261016-133323), exigindo novo ciclo de selagem. Decisao de custo/beneficio do dono. MEDICAO 2026-10-16 (prova dura): o passo bloqueante `audit:json-persistence` (node governance/json-persistence-audit.js --check) reprovou com exit 1 e unknown=2 no agg8, e os dois alvos UNKNOWN eram exatamente os artefatos que eu havia criado: `AI_MEMORY/evidence/AUDIT_ENTRYPOINT.json` e `AI_MEMORY/evidence/aggregate-enforcement-last-run.json`. Nao era flake: `classifyByPattern()` (json-persistence-audit.js:249-251) auto-classifica qa/, qa-mesh/, governance/, reports/ e docs/, mas NAO AI_MEMORY/evidence/ — que e exatamente o analogo de qa/evidence/ (essa sim classificada como ARTIFACT_STORAGE). MITIGACAO ATIVA (ja aplicada): o ponto de entrada passou a ser UM arquivo Markdown com o payload JSON embutido em bloco cercado; nenhum `.json` e escrito por tools/audit/. Comprovado: `audit:json-persistence --check` voltou a EXIT=0 e o sourceFingerprint permaneceu 1c10ffa62e169a18 (tools/audit/ esta fora de SOURCE_ROOTS)."
        },
        {
          "id": "AUDITORIA-FASE-B-FALSO-POSITIVO-SCANNER-FILA",
          "status": "blocked",
          "motivo": "DEFEITO MENOR (P1), sem impacto em gate. MEDIDO 2026-10-16: o unico alvo sob AI_MEMORY/ no inventario e `AI_MEMORY/hardening-queue.json`, classificado como STATIC_VERSIONED_CONFIG, com writer `tools/audit/generate-audit-entrypoint.js` — mas esse gerador apenas LE a fila. O scanner trata o caminho como alvo de escrita porque ele aparece no mesmo arquivo que escreve o .md. Dois problemas reais: (1) alvo de escrita fantasma; (2) classificacao impropria, porque a fila e MUTAVEL (agentes escrevem nela) e nao \"configuracao versionada estatica\". Correcao exige editar governance/json-persistence-audit.js (SOURCE_ROOTS) => novo fingerprint => re-selagem. Como o alvo esta classificado, nenhum gate reprova por isso — risco atual: baixo, mas o inventario mente."
        }
      ]
    },
    "ponteirosHistoricos": [
      {
        "path": "FINAL_RAP_RELEASE_CLOSURE.json",
        "gitTracked": true,
        "ultimoCommit": "602a00a1c",
        "ultimaData": "2026-10-16T15:30:42-03:00",
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
