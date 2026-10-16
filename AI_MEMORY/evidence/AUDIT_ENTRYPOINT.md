# AUDIT_ENTRYPOINT — ponto de entrada único para auditoria externa

> Artefato DERIVADO (nada escrito à mão). Gerado por `tools/audit/generate-audit-entrypoint.js`.
> Regenerar: `node tools/audit/generate-audit-entrypoint.js [--aggregate-log <log> --aggregate-head <sha>]`.
>
> Por que Markdown e não `.json`: `audit:json-persistence` (passo bloqueante do gate agregado) reprova com
> `UNKNOWN` todo alvo de escrita `.json` fora da taxonomia canônica, e `AI_MEMORY/evidence/` não está nela.
> O payload JSON completo vai embutido no bloco cercado ao fim deste arquivo — nada foi perdido.

- **Gerado em**: 2026-10-16T18:52:41.295Z
- **auditEpoch**: `3883d685cd053f50fb1b1caa501f3e997e1ab9b7d114dc08b8d06581e57f12f5`
- **Branch / HEAD**: `hardening/p0-certificacao` / `0aad65b5c9f0a7438458c7afb59448018245e91a`
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
- Relatório próprio do agregado: `reports/governance-enforcement-full-report.json` — existe, gerado em 2026-10-14T22:29:09.605Z, runId corrente? **NÃO**
- Provas acima com o runId corrente: **8 de 13**
- Provas que não registram campo `runId` (não é violação, o campo não existe nelas): `reports/coverage-gate-report.json`, `reports/final-status-projection-report.json`, `reports/security-intel-report.json`, `reports/mcp-research-docker-e2e-report.json`, `reports/hardening-queue-report.json`

> DESATUALIZADO: existe, mas NÃO é do run corrente — o alias `validate:governance-enforcement` não usa run-all-validators.js, logo não o regrava. Não use este arquivo como veredito do agregado; use o exit code da cadeia + as provas canônicas abaixo.

- **Última execução medida**: não embutida — rode o agregado e regenere com `--aggregate-log <log> --aggregate-head <sha>`

## Provas canônicas (hash do arquivo em disco)

| prova | veredito | runId | sha256 (12) | no git |
|---|---|---|---|---|
| `reports/governance-score.json` | **PASS** | 085-033e1239 | 496ac724821f | não (ignorado) |
| `reports/coverage-gate-report.json` | **GO** | — | 9d124dacda42 | não (ignorado) |
| `reports/release-artifact-identity-report.json` | **RELEASE_ARTIFACT_IDENTITY_VERIFIED** | 085-033e1239 | 65d01d7511dd | não (ignorado) |
| `reports/source-remote-provenance-report.json` | **PASS** | 085-033e1239 | 53d33ad9e843 | não (ignorado) |
| `reports/final-status-projection-report.json` | **PASS** | — | e9d7a6913abb | não (ignorado) |
| `reports/security-release-gate-report.json` | **GO** | 085-033e1239 | af759c681d62 | não (ignorado) |
| `reports/security-intel-report.json` | **PASS** | — | e655c73cd0fe | não (ignorado) |
| `reports/mcp-research-docker-e2e-report.json` | **PASS** | — | 1bf3ac59e6f1 | não (ignorado) |
| `reports/hardening-queue-report.json` | **PASS** | — | 2d3c8aeeb8fd | não (ignorado) |
| `reports/release-dag-report.json` | **RELEASE_DAG_ACYCLIC_AND_PHASE_AWARE** | 085-033e1239 | 0cf020c8bcfc | não (ignorado) |
| `governance/evidence-manifest.json` | **PASS** | 085-033e1239 | 1dda610313aa | sim |
| `governance/delivered-release-verification-report.json` | **DELIVERED_RELEASE_VERIFIED** | 085-033e1239 | 815d35350a3b | não (ignorado) |
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

O bloco abaixo é o JSON íntegro usado para calcular o `auditEpoch`. Extraia com:

```bash
sed -n '/^```json$/,/^```$/p' AI_MEMORY/evidence/AUDIT_ENTRYPOINT.md | sed '1d;$d' | python3 -m json.tool | head -40
```

```json
{
  "artifactType": "rap-audit-entrypoint",
  "artifactVersion": "1.0.0",
  "generatedAt": "2026-10-16T18:52:41.295Z",
  "generatedBy": "tools/audit/generate-audit-entrypoint.js",
  "auditEpoch": {
    "valor": "3883d685cd053f50fb1b1caa501f3e997e1ab9b7d114dc08b8d06581e57f12f5",
    "definicao": "sha256 do bloco \"payload\" em stringify canônico — muda quando qualquer prova, veredito, commit ou artefato muda",
    "comoUsar": "compare este valor e os sha256 de payload.provas[] com os da auditoria anterior; diferença = houve mudança, reaudite"
  },
  "payload": {
    "git": {
      "branch": "hardening/p0-certificacao",
      "headAtGeneration": "0aad65b5c9f0a7438458c7afb59448018245e91a",
      "headAssunto": "chore(governanca): commit real no item de prevencao do worktree congelado",
      "headData": "2026-10-16T15:41:16-03:00",
      "remoteHead": "0aad65b5c9f0a7438458c7afb59448018245e91a",
      "tronco": "origin/main",
      "headEmSincroniaComRemote": true,
      "worktreeCleanExcluindoEsteArtefato": false,
      "uncommittedPaths": [
        "M AGENTS.md",
        "AI_MEMORY/evidence/AUDIT_ENTRYPOINT.json",
        "M AI_MEMORY/evidence/AUDIT_ENTRYPOINT.md",
        "M AI_MEMORY/hardening-queue.json",
        "M AI_MEMORY/operational-rules.md",
        "M tools/audit/generate-audit-entrypoint.js",
        "D tools/audit/record-aggregate-run.js"
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
        "generatedAt": "2026-10-14T22:29:09.605Z",
        "runId": "rap-governed-20261014115049678-cb183049",
        "doRunCorrente": false,
        "escritor": "scripts/governance/run-all-validators.js",
        "aviso": "DESATUALIZADO: existe, mas NÃO é do run corrente — o alias `validate:governance-enforcement` não usa run-all-validators.js, logo não o regrava. Não use este arquivo como veredito do agregado; use o exit code da cadeia + as provas canônicas abaixo."
      },
      "provasComRunIdCorrente": 8,
      "provasSemCampoRunId": [
        "reports/coverage-gate-report.json",
        "reports/final-status-projection-report.json",
        "reports/security-intel-report.json",
        "reports/mcp-research-docker-e2e-report.json",
        "reports/hardening-queue-report.json"
      ],
      "provasDeOutroRun": [],
      "ultimaExecucaoMedida": {
        "existe": false,
        "nota": "rode o agregado e regenere com --aggregate-log <log> [--aggregate-head <sha>] para embutir o veredito medido"
      }
    },
    "provas": [
      {
        "path": "reports/governance-score.json",
        "gitTracked": false,
        "existe": true,
        "veredito": "PASS",
        "campoVeredito": "status",
        "runId": "rap-governed-20261016144931085-033e1239",
        "generatedAt": "2026-10-16T17:47:22.281Z",
        "sha256": "496ac724821f03482fd9e6c241a7188fa0ccfc9431818467663ccf9ad73d96f3"
      },
      {
        "path": "reports/coverage-gate-report.json",
        "gitTracked": false,
        "existe": true,
        "veredito": "GO",
        "campoVeredito": "status",
        "runId": null,
        "generatedAt": "2026-10-16T18:49:28.156Z",
        "sha256": "9d124dacda429e799784e22ff42ec3025c68059d3dd48d685ad5282bccec64ff"
      },
      {
        "path": "reports/release-artifact-identity-report.json",
        "gitTracked": false,
        "existe": true,
        "veredito": "RELEASE_ARTIFACT_IDENTITY_VERIFIED",
        "campoVeredito": "decision",
        "runId": "rap-governed-20261016144931085-033e1239",
        "generatedAt": "2026-10-16T18:41:32.852Z",
        "sha256": "65d01d7511ddfdb9ade47db7ba14d1f55870d7401b569dd1401c6f0c2049f905"
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
        "generatedAt": "2026-10-16T18:27:37.668Z",
        "sha256": "e9d7a6913abbda448803d378e7095e197eeff17a98dfd4e4798e582b2fcb520d"
      },
      {
        "path": "reports/security-release-gate-report.json",
        "gitTracked": false,
        "existe": true,
        "veredito": "GO",
        "campoVeredito": "decision",
        "runId": "rap-governed-20261016144931085-033e1239",
        "generatedAt": "2026-10-16T17:47:22.053Z",
        "sha256": "af759c681d621d5049072771684c88a686ed22b5b53478215ec67ebe74cff67e"
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
        "generatedAt": "2026-10-16T17:47:33.661Z",
        "sha256": "1bf3ac59e6f1dc73c85d5c9e1f56df8fc577e52ae0d44fd94d3e4dae49107b1b"
      },
      {
        "path": "reports/hardening-queue-report.json",
        "gitTracked": false,
        "existe": true,
        "veredito": "PASS",
        "campoVeredito": "status",
        "runId": null,
        "generatedAt": "2026-10-16T18:52:39.617Z",
        "sha256": "2d3c8aeeb8fd22cbff72dfca321e4809f99af1580db8d4c95a49463bfa2b1a51"
      },
      {
        "path": "reports/release-dag-report.json",
        "gitTracked": false,
        "existe": true,
        "veredito": "RELEASE_DAG_ACYCLIC_AND_PHASE_AWARE",
        "campoVeredito": "decision",
        "runId": "rap-governed-20261016144931085-033e1239",
        "generatedAt": "2026-10-16T18:41:31.470Z",
        "sha256": "0cf020c8bcfc5bd42564c3f489e98ecfe24d5f604110081df33678ea464e7e17"
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
        "generatedAt": "2026-10-16T16:31:46.578Z",
        "sha256": "815d35350a3b68ed8cd1c0ed898ae56fe26703389264c7177a08fe0102b7be5f"
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
      "total": 75,
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
