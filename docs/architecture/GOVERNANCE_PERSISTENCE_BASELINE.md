# Governance Persistence Baseline

> Snapshot de rastreabilidade da fase GP-00. Este documento descreve o estado observado antes da implementação do Governance Persistence & Certification Control Plane. Ele não é prova de certificação e não substitui gates executáveis, migrations ou evidência de runtime.

## Identificação do snapshot

- Data: 2026-08-21 (America/Sao_Paulo)
- Repositório: `r-agent2` / RAP
- Branch: `main`, um commit à frente de `origin/main`
- HEAD: `b8d10edbfa23b1b19afa13143efacbbe74ae0d77`
- Commit: `fix(governance): CLAUDE-001..004 — self-proving release genuíno sem síntese`
- Source fingerprint observado após a preservação das frentes em andamento: `540f057d03469de495648165c2aa3a6f28f53e7251113f22dd615f74559271a7`
- Run legado exportado em `governance/.current-run.json`: `rap-release-20260820-160006-0f281472`
- Source fingerprint congelado no run legado: `0f2814727cb9ae1ea615267c7501bb3386e98ab4135e92262718649be103c1fe`
- Resultado: o run legado já está em source drift e não pode ser reutilizado como certificação corrente.

## Preservação do trabalho em andamento

No instante do snapshot havia 102 entradas no worktree: 82 arquivos modificados, 20 arquivos novos e nenhuma exclusão. As mudanças pertencem à missão RAP 10/10 em curso e foram preservadas. Elas abrangem:

- instrumentação causal no Cognitive Core, Event Ledger e inbound boundary;
- correções model-driven e relational seeds;
- hardening de run context, artifact lineage, final governance e final consistency;
- correções de packaging/two-pass release;
- novos testes adversariais e de regressão;
- artifacts de governança já regenerados por execuções anteriores.

Arquivos novos preservados no snapshot:

```text
api/db/migrations/20260821090000-add-event-causal-lineage.js
api/services/qa/causChainValidator.js
docs/architecture/RAP_10_OF_10_PROGRESS.md
governance/final-governance-report.json.deadlock-bak
governance/master-scorecard-docs.js
governance/master-scorecard-engine.js
governance/master-scorecard-registry.js
governance/package-manifest-builder.js
governance/revalidate-master-scorecard.js
governance/shared/artifact-lineage.js
governance/shared/certification-authority.js
governance/shared/run-context.js
scripts/smoke/rebind-scheduled-smoke.js
tests/unit/governance/certificationPathIntegrity.test.js
tests/unit/governance/criticalCausalTraceValidation.test.js
tests/unit/governance/finalConsistencyAuthority.test.js
tests/unit/governance/modelDrivenCandidateLifecycle.test.js
tests/unit/governance/packageManifestBuilder.test.js
tests/unit/governance/relationalSeedProvisioning.test.js
tests/unit/governance/runContextAuthority.test.js
```

O inventário completo dos 82 arquivos modificados permanece consultável por `git status --short`; nenhum deles foi revertido para iniciar GP-00.

## Master Scorecard observado

`governance/rap-master-scorecard.json` ainda é um artifact passivo/legado e está ignorado pela regra `governance/*.json`:

| Métrica | Valor observado |
|---|---:|
| Run ID | `null` |
| Dimensões | 60 |
| Dimensões em 10 | 0 |
| Dimensões abaixo de 10 | 60 |
| Gaps declarados dentro das dimensões | 63 |
| Requisitos estruturados persistidos | 0 |
| Faixa de scores manuais | 5–9 |

O registry novo preservado pela missão anterior contém 75 definições, mas ainda não é backend canônico persistente. RAP-076 está livre para `Governance Persistence & Certification Data Model` e deve iniciar com score derivado do estado real.

Blockers observados antes da persistência:

- scorecard sem `runId`, sem source lineage por dimensão e sem requisitos/resultados persistidos;
- final governance/final consistency/delivered verifier historicamente liam JSONs independentes e admitiam estados ausentes ou contraditórios;
- self-proof e tamper reports podiam estar `FAIL`/`NO_GO` enquanto relatórios finais diziam `AUTONOMOUS_READY_GO`;
- run legado continuou após source drift;
- critical journey e model-driven possuíam falsos positivos por mistura de runs, proxies globais e causalidade inferida;
- pacote mais recente não era verificável após extração limpa;
- não existe histórico consultável ou isolamento relacional de runs no estado de certificação atual.

## Testes e gates no baseline

Comando dirigido às frentes já preservadas:

```text
npx jest \
  tests/unit/governance/runContextAuthority.test.js \
  tests/unit/governance/finalConsistencyAuthority.test.js \
  tests/unit/finalGovernanceGates.test.js \
  tests/unit/governance/certificationPathIntegrity.test.js \
  tests/unit/governance/packageManifestBuilder.test.js \
  tests/unit/governance/criticalCausalTraceValidation.test.js \
  tests/unit/governance/modelDrivenCandidateLifecycle.test.js \
  tests/unit/governance/relationalSeedProvisioning.test.js \
  --runInBand
```

Resultado: 8 suites, 92 testes, 92 PASS.

`tests/unit/governance/verifyDeliveredRelease.test.js`: 16 FAIL. O harness usa `spawnSync` e recebeu `EPERM` sob Jest nesta execução; além disso, o hardening correspondente do verifier ainda não havia sido concluído quando a frente anterior foi interrompida.

Verifier real executado no workspace:

```text
node governance/verify-delivered-release.js --root . --strict
```

Resultado: exit code 1, `DELIVERED_RELEASE_NO_GO`; falhas `source_fingerprint` e `fingerprint_chain` por source/manifest/proof divergentes. Esse resultado é bloqueante.

## ORM, banco e migrations

- ORM canônico: Sequelize 6, CommonJS.
- Migration runner: Umzug + `SequelizeStorage`, metadados em `SequelizeMeta`.
- Banco principal de aplicação em desenvolvimento, teste e produção: PostgreSQL; `api/db/sequelize.js` fixa `dialect: 'postgres'`.
- `mysql2`/MariaDB existe para integrações legadas/PBX, não é o backend do control plane.
- `getDatabaseUrl` prioriza `TEST_DATABASE_URL`, depois a configuração local e só então `DATABASE_URL`. Testes de persistência devem exigir uma URL de teste explicitamente isolada para não atingir o banco configurado por acidente.
- `sequelize.sync()` é desabilitado em produção, mas ainda há usos/fallbacks fora de produção e um uso de `TicketMedia.sync()` em serviço. Eles não podem substituir migrations do control plane.
- O runner declara em comentário que cada migration roda em transação, porém o resolver atual apenas chama `migration.up/down`; não há transaction nem advisory lock global no runner.
- Os helpers de migration usam padrões check-then-create e alguns caminhos engolem erro. A migration do control plane deve ser transacional, fail-closed e testada sem depender desse comportamento.
- APIs concorrentes executam migrations no startup sem lock distribuído explícito.

Status lido por `npm run db:migrate:status`:

| Estado | Quantidade |
|---|---:|
| Executadas | 111 |
| Pendentes | 1 |

A única migration pendente no baseline é `20260821090000-add-event-causal-lineage.js`.

Não havia suite governada que comprovasse, de ponta a ponta, os quatro caminhos exigidos para GP: banco vazio, banco existente/upgrade, `up` e `down`. CI aplica migrations em banco efêmero, mas os testes locais de migration são majoritariamente estáticos ou mockados.

## Models e serviços candidatos à convergência

Foram encontrados 158 arquivos de model. O registry importa 157; `TicketMedia` fica fora do registry e seu serviço chama `sync()` em runtime.

| Componente existente | Semântica atual | Direção GP |
|---|---|---|
| `RuntimeArtifact` | Conteúdo/metadata por `tenant_key + kind + ref_id`, com JSON/TEXT ou blob externo | Evoluir para lineage governada; manter compatibilidade do artifact store; não criar `RuntimeArtifact2` |
| `CoverageEvidence` | Evidence append-only em JSONB com hash chain | Evoluir com referências de run/journey/scenario/step/inventory/evidence/status |
| `Evidence` | Evidência operacional multi-tenant | Reutilizar como referência de evidência de runtime, sem transformá-la em estado de certificação |
| `AuditEvent` | Audit trail genérico, tenant nullable | Reutilizar para eventos GP obrigatórios, com escrita transacional/fail-closed no serviço GP |
| `AuditReport` | Conteúdo de relatórios de auditoria | Manter como relatório/export; não usar como estado final canônico |
| `AiGovernanceRecord` | Governança de agentes/IA por tenant | Manter domínio próprio; não conflar com certification run |
| `AutoCorrectionRun` | Lifecycle de autocorreção | Referenciar quando aplicável; não reutilizar como GovernanceRun |
| `EventLedger` | Ledger append-only de eventos operacionais | Evoluir como armazenamento do equivalente a ExecutionTraceEvent, ligado a um novo ExecutionTrace; runtime, não validator, produz causalidade |

Conceitos sem equivalente semântico existente e que precisam de models próprios: GovernanceRun, definições/requisitos/avaliações/resultados do scorecard, GovernanceGap, GovernanceGateResult, ExecutionTrace, GovernanceFinalDecision e ReleaseManifestRecord.

## Estado atual de artifact storage

`lib/artifactStore.js` possui backends filesystem e PostgreSQL. O backend PostgreSQL usa `runtime_artifacts`; binários podem ir ao blob store e o banco guarda `storage_key`, tamanho e SHA-256. Isso atende à separação entre state e large immutable content, mas o contrato legado faz `upsert` por `tenant_key/kind/ref_id` e portanto é mutável. A camada GP precisa:

- registrar `run_id`, source fingerprint, tipo/versão, producer, status e metadata;
- impedir update/delete de artifact marcado immutable;
- criar nova identidade/versão em vez de sobrescrever;
- exigir PostgreSQL em certification mode;
- continuar permitindo o contrato legado durante a migração interna, sem aceitá-lo como autoridade final.

## JSONs que hoje representam estado

Principais arquivos lidos como estado ou autoridade por scripts atuais:

```text
governance/.current-run.json
governance/rap-master-scorecard.json
governance/final-proof-report.json
governance/final-readiness-report.json
governance/final-governance-report.json
governance/final-consistency-gate-report.json
governance/final-consistency-report.json
governance/replay-consistency-report.json
governance/replay-hardening-report.json
governance/evidence-manifest.json
governance/package-validation-report.json
governance/package-integrity-report.json
governance/self-proving-report.json
governance/tamper-detection-report.json
governance/governance-chain.json
governance/proof-signature.json
qa-mesh/go-no-go-report.json
reports/coverage-gate-report.json
```

Há dois artifacts de consistency com semântica diferente:

- `final-consistency-gate-report.json` é produzido pelo gate atual;
- `final-consistency-report.json` é legado, consumido por chain/package/self-proof/tamper e pode ser materializado com `pass:true`/score 100 por `clean-governance.js` antes de receber binding posterior.

Também há um ciclo de dependências: final governance consome self-proof/tamper; esses consomem consistency legado; o novo final consistency consome final governance/self-proof/tamper. A persistência deve separar prerequisite gate results de final attestation e manter uma única decisão transacional.

## Consumidores e compatibilidade

- `governance/shared/run-id.js` e `governance/shared/run-context.js` leem/escrevem `.current-run.json`; não havia caller produtivo que criasse um run canônico persistente.
- final proof/readiness/governance/consistency, governance chain, package validator, self-proof, tamper e delivered verifier leem combinações de JSONs.
- shell scripts de release geram/copiam manifests próprios; `package-manifest-builder.js` preservado ainda não tinha caller fora dos testes.
- `rap-master-scorecard.json` e o Markdown de progresso eram fontes manuais/passivas e divergiam.
- artifacts continuam necessários para export, auditoria, package e verificação offline, mas devem passar a ser projeções imutáveis derivadas do banco.

Compatibilidade planejada:

1. migrations aditivas e nullable para linhas legadas;
2. serviços GP DB-first e fail-closed;
3. exporters geram os JSONs nos paths legados;
4. consumidores internos migram para serviços/queries;
5. certification mode exige DB e proíbe fallback;
6. package recebe snapshot imutável derivado do banco;
7. verifier offline usa snapshot + manifest + source/artifacts, sem depender de DB remoto.

## Critérios de saída do baseline

GP-00 registra o estado, mas não o corrige. No momento deste snapshot:

- o filesystem ainda é a fonte primária de certification state;
- não existe GovernanceRun persistido;
- não existe final decision transacional persistida;
- lineage de artifacts, scorecard, gaps, gates, traces e release ainda não converge em um run relacional;
- RAP-076 deve iniciar abaixo de 10;
- a release permanece `NO_GO`.

Esses itens são entradas obrigatórias para GP-01 e não podem ser reclassificados por documentação.
