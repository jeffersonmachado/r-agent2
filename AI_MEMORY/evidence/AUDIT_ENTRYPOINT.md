# AUDIT_ENTRYPOINT — ponto de entrada único para auditoria externa

> Artefato DERIVADO (nada escrito à mão). Gerado por `tools/audit/generate-audit-entrypoint.js`.
> Regenerar: `node tools/audit/generate-audit-entrypoint.js`.

- **Gerado em**: 2026-10-16T18:30:12.698Z
- **auditEpoch**: `8b2f8df77d84580d733d76b1c1d23f1b0bb992eaa0aceabd7f64764845225e87`
- **Branch / HEAD**: `hardening/p0-certificacao` / `36cd7fc06c72fef84543e60c300e43ac2618a494`
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

## Provas canônicas (hash do arquivo em disco)

| prova | veredito | runId | sha256 (12) | no git |
|---|---|---|---|---|
| `reports/governance-score.json` | **PASS** | 085-033e1239 | 496ac724821f | não (ignorado) |
| `reports/coverage-gate-report.json` | **GO** | 085-033e1239 | d7bec9ae4de3 | não (ignorado) |
| `reports/release-artifact-identity-report.json` | **RELEASE_ARTIFACT_IDENTITY_VERIFIED** | 085-033e1239 | 100830d85c0a | não (ignorado) |
| `reports/source-remote-provenance-report.json` | **PASS** | 085-033e1239 | 53d33ad9e843 | não (ignorado) |
| `reports/final-status-projection-report.json` | **PASS** | — | e9d7a6913abb | não (ignorado) |
| `reports/security-release-gate-report.json` | **GO** | 085-033e1239 | af759c681d62 | não (ignorado) |
| `reports/security-intel-report.json` | **PASS** | — | e655c73cd0fe | não (ignorado) |
| `reports/mcp-research-docker-e2e-report.json` | **PASS** | — | 1bf3ac59e6f1 | não (ignorado) |
| `reports/hardening-queue-report.json` | **PASS** | — | c54cd24b823c | não (ignorado) |
| `reports/release-dag-report.json` | **RELEASE_DAG_ACYCLIC_AND_PHASE_AWARE** | 085-033e1239 | 41e2084c75ed | não (ignorado) |
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

## Itens abertos na fila oficial

- `HARDENING-ENG-GOV-RELEASE-MESH-EXECUCAO-VAZIA-AINDA-GERA-EVIDENCIA` — **blocked** — Decisao de POLITICA (dono do produto), nao mecânica. Medicao 2026-10-16: o fail-open e LATENTE, nao ativo no caminho verde — a execucao canonica da malha no run corrente tem 144 resultados (isCanonicalExecution=true, runId/sourceFingerprint/sourceCommit corretos). Risco real: o produtor grava artefato governado mesmo com executedResults=0 e o gate nao distingue "executou 0 cenarios" de "executou e passou". Duas direcoes validas com semanticas diferentes: (a) produtor marca artefato vazio como NAO-evidencia, ou (b) a malha falha ANTES de gravar. CUSTO MEDIDO de aplicar agora: qa-mesh/*.js e scripts/governance/* estao em SOURCE_ROOTS (governance/proof-engine/fingerprint-chain.js:54-70,106-112), portanto qualquer edicao muda o fingerprint 1c10ffa62e169a18 e invalida o release ja selado (r-agent2-20261016-133323), exigindo novo ciclo de selagem.

## Ponteiros stale na raiz do repositório — NÃO use como estado atual

Estes arquivos existem na raiz, são versionados e NENHUM gate os mantém — eles congelaram em datas antigas. Um auditor que os leia como estado corrente audita o passado.

| arquivo | gerado em | HEAD que ele registra | último commit que o tocou |
|---|---|---|---|
| `FINAL_RAP_RELEASE_CLOSURE.json` | 2026-09-24T07:31:39.421Z | `b0665b7672` | `570bbd0c4` 2026-09-24 |
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
