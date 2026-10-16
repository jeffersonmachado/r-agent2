# AUDIT_ENTRYPOINT — ponto de entrada único para auditoria externa

> Artefato DERIVADO (nada escrito à mão). Gerado por `tools/audit/generate-audit-entrypoint.js`.
> Regenerar: `node tools/audit/generate-audit-entrypoint.js`.

- **Gerado em**: 2026-10-16T18:41:02.767Z
- **auditEpoch**: `16aa68bbd6458101a18722c1a293877ebdbecb5c463089392b0af106bbd7d42e`
- **Branch / HEAD**: `hardening/p0-certificacao` / `afb5e1eafa54c228dc6ec071ce7f0ac0ead16bc3`
- **HEAD sincronizado com o remote**: sim
- **Commits não enviados**: 0
- **Release governado**: `rap-governed-20261016144931085-033e1239` · fingerprint `1c10ffa62e169a18db1cd22e935fb41420fd5a865da58dd576b36a0f355d971e`
- **Publicado**: NÃO (sem tag, sem promoção)

## Como detectar que algo mudou no git

```bash
git log --oneline -20
git log -1 --format=%H -- AI_MEMORY/evidence/AUDIT_ENTRYPOINT.json   # commit que gerou o epoch atual
auditEpoch.valor != epoch da auditoria anterior  =>  houve mudança
payload.provas[].sha256 != hash registrado       =>  prova alterada em disco (possível adulteração)
```

## Como reauditar

```bash
npm run validate:governance-enforcement      # gate agregado bloqueante (31 validadores)
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
- Provas acima com o runId corrente: **9 de 13**
- Provas que não registram campo `runId` (não é violação, o campo não existe nelas): `reports/final-status-projection-report.json`, `reports/security-intel-report.json`, `reports/mcp-research-docker-e2e-report.json`, `reports/hardening-queue-report.json`

> DESATUALIZADO: existe, mas NÃO é do run corrente — o alias `validate:governance-enforcement` não usa run-all-validators.js, logo não o regrava. Não use este arquivo como veredito do agregado; use o exit code da cadeia + as provas canônicas abaixo.

- **Última execução medida**: não gravada — use `node tools/audit/record-aggregate-run.js --log <log> --head <sha>` após rodar o agregado

## Provas canônicas (hash do arquivo em disco)

| prova | veredito | runId | sha256 (12) | no git |
|---|---|---|---|---|
| `reports/governance-score.json` | **PASS** | 085-033e1239 | 496ac724821f | não (ignorado) |
| `reports/coverage-gate-report.json` | **GO** | 085-033e1239 | d7bec9ae4de3 | não (ignorado) |
| `reports/release-artifact-identity-report.json` | **RELEASE_ARTIFACT_IDENTITY_VERIFIED** | 085-033e1239 | 988284492afc | não (ignorado) |
| `reports/source-remote-provenance-report.json` | **PASS** | 085-033e1239 | 53d33ad9e843 | não (ignorado) |
| `reports/final-status-projection-report.json` | **PASS** | — | e9d7a6913abb | não (ignorado) |
| `reports/security-release-gate-report.json` | **GO** | 085-033e1239 | af759c681d62 | não (ignorado) |
| `reports/security-intel-report.json` | **PASS** | — | e655c73cd0fe | não (ignorado) |
| `reports/mcp-research-docker-e2e-report.json` | **PASS** | — | 1bf3ac59e6f1 | não (ignorado) |
| `reports/hardening-queue-report.json` | **PASS** | — | 1535acf8277f | não (ignorado) |
| `reports/release-dag-report.json` | **RELEASE_DAG_ACYCLIC_AND_PHASE_AWARE** | 085-033e1239 | 78aeb8597332 | não (ignorado) |
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

## Ponteiros stale na raiz do repositório — NÃO use como estado atual

Estes arquivos existem na raiz, são versionados e NENHUM gate os mantém — eles congelaram em datas antigas. Um auditor que os leia como estado corrente audita o passado.

| arquivo | gerado em | HEAD que ele registra | último commit que o tocou |
|---|---|---|---|
| `FINAL_RAP_RELEASE_CLOSURE.json` | 2026-09-24T07:31:39.421Z | `b0665b7672` | `602a00a1c` 2026-10-16 |
| `FINAL_RELEASE_CLOSURE.md` | — | — | `570bbd0c4` 2026-09-24 |
| `ENGINEERING_ROUTER_V1_SEAL_REPORT.json` | 2026-09-23T16:46:58.938Z | — | `0a69bdaed` 2026-09-23 |
| `ENGINEERING_ROUTER_V1_FINAL_SEAL.md` | — | — | `330478f54` 2026-09-22 |

O estado atual está NESTE arquivo (`AUDIT_ENTRYPOINT.json`) e nas projeções canônicas listadas abaixo.

## Fontes canônicas

- AI_MEMORY/hardening-queue.json            (fila oficial de pendências)
- AI_MEMORY/evidence/missao-hardening-eng-gov-release-2026-10-16.md  (relatório da missão)
- docs/governance/_platform-status-source.json  (decisão canônica de release)
- docs/governance/PLATFORM_STATUS.md e docs/architecture/RAP_MASTER_SCORECARD.md  (projeções)
- reports/*.json e governance/*.json        (prova em disco; ignorados pelo git por política)
