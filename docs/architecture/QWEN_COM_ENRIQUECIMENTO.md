# Qwen com Enriquecimento

Transformação do Engineer Router do RAP em um **ciclo autônomo de engenharia com missão
enriquecida**: o usuário descreve a intenção em linguagem natural, o sistema compila a missão,
inspeciona o contexto real, mostra exatamente o que acrescentou (com fonte e motivo), obtém
aprovação (humana ou por política) e só então executa — com Qwen integrado como provider de
primeira classe do AI Control Plane.

Status desta entrega: **implementado e provado por execução real**. Governança de release da
plataforma permanece **NO_GO pelos motivos pré-existentes** listados em "Limites medidos" — esta
entrega não altera nem mascara esse estado.

- Evidência legível por máquina: `reports/qwen-com-enriquecimento-report.json`
- Evidência de browser: `AI_MEMORY/evidence/2026-09-24-engineering-missions-browser.json`
- Jornada documentada: `AI_MEMORY/runtime-navigation.md`
- Arquitetura do Router (base reaproveitada): `docs/architecture/ENGINEERING_MODEL_ROUTER_ARCHITECTURE.md`

---

## 1. O que mudou no modelo operacional

Antes: `prompt técnico → implementação → ZIP → auditoria externa → novo prompt → correção → novo ZIP`.

Agora:

```
MISSÃO EM LINGUAGEM NATURAL
  → ENGINEERING MISSION COMPILER   (intenção + fatos reais de contexto)
  → ENRICHMENT                     (requisitos derivados por política, determinístico)
  → PREVIEW                        (ADDED / MODIFIED / INFERRED / POLICY_REQUIRED + provenance)
  → APROVAÇÃO                      (humana, ou autoaprovada por política — sempre auditada)
  → ENGINEER ROUTER                (CODER → TESTE → REVIEWER → REGRESSION → GOVERNANCE)
  → GREEN                          (somente por gates determinísticos)
  → RELEASE ARTIFACT / CHECKPOINT  (ZIP deixa de ser o mecanismo de iteração)
```

O ZIP passa a ser apenas artefato de release/checkpoint; a iteração acontece dentro da
plataforma, com versão de MissionSpec, hash, aprovação registrada e diff de enriquecimento
persistidos.

---

## 2. Qwen como provider de primeira classe

Qwen **não** foi implementado como integração paralela nem exclusiva do Router. Ele entra pela
mesma arquitetura usada por OpenAI/Anthropic/DeepSeek/Kimi:

| Camada | Ponto único reutilizado |
|---|---|
| Catálogo de providers | `engine/aiProviderRegistry.js` (entrada `qwen`, `kind: openai-compatible`, endpoint OpenAI-compatible do Model Studio) |
| Registro em runtime | `api/services/aiProviderService.initializeAiProviders` (mesmo laço para todos os built-ins) |
| Catálogo governado em banco | `api/services/aiProviderRegistryService.ensureBuiltinProviders` → linha real em `ai_providers` (verificado: `key=qwen`, `is_builtin=true`, `enabled=true`) |
| Credencial | `tenantAIService.getDecryptedAPIKey(tenantId, 'qwen')` — mesma resolução por tenant, nenhum segredo em código/fixture |
| Circuit breaker / timeout | `aiControlPlaneStatus.wrapProviderGenerate` (herdado, não reimplementado) |
| Elegibilidade por capability | `engine/engineeringRouter/modelCapabilities.js` (papéis CODER/REVIEWER/ENRICHER) |
| Seleção/fallback | `engine/engineeringRouter/modelSelector.js` (capability + health + credencial + custo + independência) |
| Invocação | `api/services/engineeringRouter/engineeringAiInvoker.js` (mesmo caminho, com classificação de falha para reroute) |

Nenhum nome de modelo Qwen aparece em código de decisão (`modelSelector`, `routingPolicy`,
`taskClassifier`, `modelCatalogPolicy`) — verificado por teste. A escolha é sempre por
capability + política.

**Família, não modelo único**: o catálogo expõe `qwen3-max`, `qwen3-coder-plus`,
`qwen3-coder-flash`, `qwen-max`, `qwen-plus`, `qwen-turbo`. Listar no catálogo **não** torna um
modelo roteável: só a allowlist de capability torna, e a disponibilidade real continua sendo
resolvida por credencial/health/discovery.

Ausência de credencial é **estado explícito**, não erro estrutural: o provider permanece
registrado, `AI_PROVIDER_NOT_CONFIGURED` é retornado na primeira invocação real, o health
reporta a causa e o Router segue operando com os demais providers.

---

## 3. Motor determinístico do enriquecimento (núcleo puro)

`engine/engineeringMission/` (sem I/O):

| Arquivo | Papel |
|---|---|
| `constants.js` | vocabulário fechado: tipos de missão, estados, materialidade, modos de aprovação, motivos de bloqueio, códigos de falha |
| `missionSpec.js` | MissionSpec versionada: `originalMission` imutável, hash canônico SHA-256, diff campo a campo, `assertExecutableVersion` |
| `enrichmentBuilder.js` | 12 regras declarativas (tenancy, schema, segredos, RBAC, visibilidade, release, deploy, performance, destrutividade, memória) → requisitos derivados + provenance + risco + confiança |
| `autoApprovalPolicy.js` | MANUAL / SAFE_ONLY / POLICY_BASED; bloqueios invariantes por política |
| `materiality.js` | NON_MATERIAL / MATERIAL / CRITICAL (inclui remoção de critério de aceite e adulteração da intenção) |
| `missionPreview.js` | preview com categorias e provenance objetiva (nunca raciocínio interno de modelo) |
| `missionStatus.js` | status exibido derivado (inclui tradução missão → `TASK_TYPES` canônicos) |

A intenção original é imutável de forma **enforçada**: tentar alterá-la lança
`ORIGINAL_MISSION_MUTATED` (nunca é ignorado silenciosamente).

---

## 4. Persistência durável e concorrência

Migration `api/db/migrations/20260924120000-create-engineering-missions.js`:

| Tabela | Papel | Unicidades que são contrato |
|---|---|---|
| `engineering_missions` | estado fase-a-fase, resume metadata, preview e enrichment persistidos | `idempotency_key` |
| `engineering_mission_versions` | histórico imutável de MissionSpec | `(mission_id, version)`, `(mission_id, spec_hash)` |
| `engineering_mission_approvals` | decisão vigente por versão, com histórico append-only | `(mission_id, spec_version)`, `idempotency_key` |
| `engineering_mission_settings` | política de autoaprovação da instalação | singleton `default` |
| `engineering_mission_reviews` | pareceres Meta/Adversarial persistidos por missão+versão+hash | `(mission_id, mission_version, spec_hash, kind)`, `idempotency_key` |

Migration adicional: `api/db/migrations/20260924140000-create-engineering-mission-reviews.js`.

- Sem fallback em memória (`persistence_required` em falha de DB).
- Lock atômico por missão (UPDATE condicional) com **detecção real de worker morto** por PID:
  crash não espera o stale timeout nem trava indefinidamente.
- Retomada (`resumeInterruptedMissions`) é idempotente e descobre trabalho por query no banco —
  crash, `kill -9`, restart de container ou de worker não reiniciam a missão do zero.

---

## 5. Interface (DEVELOPMENT)

Rotas `requireAuth` + `requireClassification('DEVELOPMENT')` em `/engineering/missions*`:
`overview`, listagem, `POST /` (compilar), `:id`, `:id/preview`, `:id/versions`,
`:id/approvals`, `:id/enrich`, `:id/approve`, `:id/reject`, `:id/edit`, `:id/execute`,
`:id/report`, `policy` (GET/PUT), `resume-interrupted`, `self-assessment`,
`:id/review` (POST/GET).

Registradas nos três pontos obrigatórios (composition → `registerRoutes` → `routeRegistry`) e
verificadas por `validate:route-mounts`.

No frontend, `/dev/engineering/missions` e `/dev/engineering/missions/:id` (menu
"Engineering → Missions / Enriquecimento", classificação DEVELOPMENT): campo de missão, botão de
enriquecer, preview com diff e provenance, contrato de execução editável, Aprovar/Rejeitar/
Reenriquecer/Executar, painel e toggle de política de autoaprovação, histórico de versões e de
decisões, execução real, relatório de auditoria, painel de Meta Review/Adversarial e cartão de
autoavaliação contínua.

---

## 6. Fechamento do ciclo — Meta Reviewer (§23) e revisão adversarial (§24)

O enriquecimento determinístico não fecha sozinho o ciclo do §23: uma missão só é **GREEN** se o
resultado passar por revisão independente do próprio código que o produziu. Isso foi implementado
como mecanismo executável, não como checklist textual.

**Meta Reviewer** (`engine/engineeringMission/metaReview.js`) — 22 checks objetivos:

- Checks concretos (MR-01..MR-19) operam sobre o **bundle real**: diff unificado parseado,
  registros persistidos de `engineering_test_runs` / `engineering_reviews` /
  `engineering_regression_runs` e conteúdo dos arquivos realmente tocados lidos do disco.
- Checks que exigem julgamento semântico (mocks substituindo função real, código morto,
  dependência desnecessária, heurísticas textuais) são **`NOT_VERIFIABLE`**, com o mecanismo de
  verificação ausente declarado em `{notVerifiable: {detail, mechanism}}`.
- `status` é `INCOMPLETE` quando existe `NOT_VERIFIABLE` e nada bloqueia. **Nunca `PASS` cego.**
- `REQUIRED_GATES_FOR_GREEN = ['unit','integration','review','regression','governance']` — cada
  gate é *derivado* de evidência persistida, com `evidence.source` declarado; gate sem evidência
  é `MISSING` e bloqueia GREEN.
- Detecta duplicação proibida (registry de providers paralelo, máquina de estado paralela,
  evidence store paralelo, task store paralelo) — o mesmo veto que rege esta entrega.

**Revisão adversarial** (`engine/engineeringMission/adversarialReview.js`) — catálogo de 20
ataques (ADV-01..ADV-20), cada um com defesa e **teste permanente** declarados. A cobertura é
medida contra os testes que existem de fato no repositório; ataque de severidade
`BLOCKER`/`REGRESSION` sem teste permanente correspondente **bloqueia GREEN**. ADV-NI-01
(consistência de branch) e ADV-NI-02 (corrupção de evidência) estão declarados como **não
automatáveis** — aparecem como `notAutomatable`, não como cobertos.

**Enforcement de GREEN no runtime** (`missionOrchestratorService.refreshMissionState`): quando o
estado calculado é GREEN, o serviço consulta a revisão bloqueante da **versão corrente**. Se ela
existir, a missão vira `BLOCKED` com
`failure = { code: 'META_REVIEW_BLOCKED', reviewId, reviewKind, findings, at, note }`. A revisão de
uma versão antiga nunca bloqueia nem libera a versão atual (§27).

O veto vale **independentemente da ordem**: `runReviews` recalcula o estado da missão depois de
persistir o parecer, de modo que uma revisão rodada *depois* de um GREEN já concedido também o
derruba. Sem esse recalculo, o fluxo natural “executar → revisar” deixava a missão GREEN com um
parecer bloqueante gravado — bypass do §23, encontrado e fechado com teste de regressão.

Rotas novas: `POST /engineering/missions/:id/review` (body `{kinds:['META','ADVERSARIAL']}`) e
`GET /engineering/missions/:id/review`. Persistência: migration
`api/db/migrations/20260924140000-create-engineering-mission-reviews.js` (tabela
`engineering_mission_reviews`, `idempotency_key` única, unicidade por missão/versão/hash/kind).

Na interface, o painel **Meta Review / Adversarial** em `/dev/engineering/missions/:id` mostra
status, contadores, findings não-`PASS` com id `MR-*`, o mecanismo ausente de cada
`NOT_VERIFIABLE`, a cobertura do catálogo adversarial e os casos não cobertos; quando algo
bloqueia, exibe o aviso **“GREEN recusado”** com o motivo.

---

## 7. Autoavaliação contínua (§45)

`GET /engineering/missions/self-assessment` (rota estática, deliberadamente registrada **acima**
de `/:id`) mede o ciclo a partir de dados persistidos, não de estimativa:

- enriquecimento: missões analisadas, versões por missão, taxa de re-enriquecimento,
  confiança média, distribuição por risco/materialidade e por tipo inferido;
- aprovação: taxa de aprovação humana vs. automática, tempo até decisão, blockers mais frequentes;
- execução: taxa de GREEN, `META_REVIEW_BLOCKED`, iterações por missão;
- modelos: uso e resultado por provider/modelo por papel (`CODER`/`REVIEWER`/`ENRICHER`);
- revisões: status do Meta Review e cobertura adversarial;
- regressões e custo agregado.

Regra de honestidade estatística: **métrica sem denominador é `null`, nunca `0`** — a UI exibe
“—”. Zero inventaria desempenho que não foi medido. O resultado é persistido em
`reports/engineering-mission-self-assessment.json` e exibido no cartão “Autoavaliação contínua”
na lista de missões.

---

## 8. Provas executadas (medidas nesta entrega)

| Prova | Comando | Resultado |
|---|---|---|
| Qwen como provider de primeira classe | `npx jest tests/unit/engineeringRouterQwenProvider.test.js` | 23/23 PASS |
| Núcleo do Mission Compiler (TEST 31–42, 45, 46) | `npx jest tests/unit/engineeringMissionCompiler.test.js` | 25/25 PASS |
| E2E missão → enriquecimento → aprovação → Router → GREEN (§41, TEST 48) | `npx jest tests/integration/engineeringMissionFullE2E.test.js` | 8/8 PASS |
| Crash/restart em cada fase + idempotência (§17, §18, TEST 43, 44) | `npx jest tests/integration/engineeringMissionDurableResume.test.js` | 6/6 PASS |
| Concorrência, bypass, adulteração, anti-greenwashing (§33, TEST 40, 45, 46, §10–§12, §26/§27) | `npx jest tests/integration/engineeringMissionGovernanceAndConcurrency.test.js` | 9/9 PASS |
| Regressão unit canônica | `npm run test:unit -- --bail=0` | 6645 PASS / 1 FAIL pré-existente (856 suítes PASS) |
| Suítes de missão (9 arquivos) | `npx jest tests/unit/engineeringMission tests/integration/engineeringMission` | 104/104 PASS |
| Orçamento de contexto e truncamento (ADV-12) | `npx jest tests/unit/engineeringMissionContextBudget.test.js` | 6/6 PASS |
| Rotas: classificação, 201 real, 409 com causa exata, 422, ordem de rota | `npx jest tests/unit/engineeringMissionRoutes.test.js` | 16/16 PASS |
| Meta Reviewer e catálogo adversarial (ambos os sentidos) | `npx jest tests/unit/engineeringMissionReviewEngines.test.js` | 23/23 PASS |
| Degradação do enriquecimento (ADV-10, 11, 14, 15) | `npx jest tests/integration/engineeringMissionEnrichmentDegradation.test.js` | 5/5 PASS |
| Enforcement: revisão bloqueante recusa GREEN e marca a missão | `npx jest tests/integration/engineeringMissionReviewEnforcement.test.js` | 6/6 PASS |
| Fechamento do bypass “revisar depois do GREEN” | `npx jest tests/integration/engineeringMissionReviewEnforcement.test.js` | 6/6 PASS (GREEN → BLOCKED) |
| Jornada real de usuário no browser | `node tests/smoke/engineering-missions-browser.js` | 18/18 PASS |
| Gate do Engineering Router V1 (estrutural + runtime) | `npm run validate:engineering-router-v1:runtime` | PASS, 209 checks, 0 falhas (25 itens de runtime, `RUNTIME_PASS`) |
| Montagem de rotas | `npm run validate:route-mounts` | PASS (61/61) |
| Segregação de visibilidade e de experiência | `npm run validate:visibility-policy`, `npm run validate:experience-segregation` | PASS, 0 violações |
| Runtime de rotas (API + frontend vivos) | `npm run validate:runtime` | PASS (exit 0) |
| Memória operacional, evidência de browser, replay, adesão do agente | `npm run validate:ai-memory`, `validate:browser-evidence`, `validate:replay-governance`, `validate:agent-adherence` | PASS |

O único teste falhando em `tests/unit` (`readinessCertificationSeparation`) é pré-existente e
verifica os artefatos canônicos de readiness, que estão em `CORE_NOT_GO` — não é afetado por
esta entrega.

---

## 9. Defeitos reais encontrados e corrigidos

Todos foram descobertos por execução real (não por inspeção) e cada um tem teste de regressão:

1. **Mutação silenciosa da intenção original.** `createNextVersion` ignorava um patch que tentava
   alterar `originalMission`. Agora falha alto com `ORIGINAL_MISSION_MUTATED`.
2. **Duas aprovações por versão quebravam ao virar `SUPERSEDED`.** A unicidade por
   `(mission, versão, estado)` permitia `PENDING` + `APPROVED` para a mesma versão e a
   transição estourava. Modelo corrigido para uma decisão por versão com histórico append-only.
3. **`snake_case` × `camelCase` na fronteira de aprovação.** O motor puro recebia
   `spec_version`/`mission_id` ausentes e tratava aprovação válida como inexistente
   (`MISSION_APPROVAL_NOT_FOUND` logo após aprovar).
4. **Autoaprovação inalcançável.** `mission.approval_mode` (default `MANUAL`) sobrescrevia a
   política da instalação, de modo que `POLICY_BASED` nunca era aplicado. Precedência corrigida
   para override explícito da missão > política da instalação.
5. **Idempotência concorrente do Router.** `engineeringTaskService.createTask` detectava corrida
   por regex na mensagem (`"unique"`), mas `SequelizeUniqueConstraintError` tem
   `message === "Validation error"` — duas execuções concorrentes duplicavam/estouravam em vez de
   convergir para a mesma task.
6. **Status exibido colapsava autoaprovação em aprovação humana.** O status derivado lia
   `approvalState` (camelCase) de uma linha em `snake_case`, mostrando `APPROVED` para missão
   autoaprovada — exatamente a distinção que o §42 proíbe.

7. **Envelope do parser estruturado aceitava lixo como intenção válida.** Texto não parseável
   produzia um intent “vazio, porém válido”, sem registrar degradação — exatamente a falha
   silenciosa que o §8 proíbe. Agora exige `{ok:true}` **e** campo reconhecido; caso contrário
   registra `MALFORMED_MODEL_RESPONSE:<erro>`.
8. **Varredura de contexto omitia `tests/` e descartava tokens de domínio de 3 caracteres**
   (`EVO`, `IVR`, `CRM`, `RBAC`) — o enriquecimento perdia justamente o vocabulário do domínio.
   Corrigido com `tests/` como raiz, comprimento mínimo de token 3 e STOPWORDS ampliadas. O
   orçamento (`40000` arquivos) foi calibrado por **medição real da árvore** (25.544 arquivos), e
   o truncamento é declarado no resultado.
9. **`GET /engineering/missions/self-assessment` era inalcançável.** A rota estática estava
   registrada depois de `/:id`, que a capturava — o handler correto nunca era chamado. Rota movida
   para cima de `/:id`, com **teste de regressão de ordem de rota**.
10. **Lock de missão travado por worker morto** só era liberado no timeout de staleness. Agora há
    liveness real por PID (`process.kill(pid, 0)`) com takeover por CAS; o teste de crash durante
    `ENRICHING` usa um PID morto de verdade e prova que a retomada não espera o timeout.
11. **Bypass do §23: revisão depois do GREEN.** O veto do GREEN era consultado apenas quando o
    estado da missão era recalculado (fim de execução). No fluxo real “executar → revisar”, a
    missão chegava a `GREEN`, a revisão rodava depois e encontrava finding bloqueante — e a missão
    **continuava GREEN** com o parecer bloqueante persistido. `runReviews` passou a recalcular o
    estado após persistir (quando há bloqueio **ou** quando a missão já está GREEN), então o
    orquestrador a rebaixa para `BLOCKED` com `META_REVIEW_BLOCKED`. O teste de regressão executa
    antes de revisar e prova a transição `GREEN → BLOCKED`.

Além deles, passou a haver detecção de **adulteração da MissionSpec** por recomputo de hash.

---

## 10. Limites medidos (nada aqui foi mascarado)

- **Credencial Qwen não configurada neste ambiente.** Logo, o *smoke test real* de rede contra o
  endpoint Qwen não foi executado; o que está provado é: registro no catálogo governado, request
  real montado (endpoint, Bearer, modelId do Router) validado com `fetch` interceptado, e o
  comportamento correto na ausência de credencial. Configurar a credencial e repetir o smoke é o
  próximo passo para fechar essa prova.
- **Sem provider de IA com credencial**, o enriquecimento opera com fatos + regras e registra a
  degradação explicitamente (`modelSelection.selected = null`,
  `NO_ENRICHER_CANDIDATE`) — nunca finge interpretação de modelo. A missão segue para aprovação
  humana.
- **Checks do Meta Reviewer que exigem julgamento semântico são `NOT_VERIFIABLE`.** Mocks
  substituindo função real, código morto, dependência desnecessária e heurísticas textuais
  aparecem com o mecanismo de verificação ausente, e o status do parecer fica `INCOMPLETE`
  quando nada bloqueia. Não foram convertidos em `PASS` para produzir um resultado mais bonito.
- **ADV-NI-01 e ADV-NI-02 não são automatáveis** e estão declarados como tal no catálogo
  adversarial; não entram na conta de cobertura.
- **`validate:dist` FAIL**: `dist/` está no estado residual do ciclo de release anterior
  (`STALE_VERIFIER_RESULT`, sem `PAYLOAD` em `dist/release/*.payload.zip`). Pré-existente; esta
  entrega não escreveu em `dist/`.
- **`validate:release-governance` FAIL / `validate:qa-governance` FAIL**: decisão canônica de
  readiness é `NO_GO` (QA Mesh `NO_GO` com 4 falhas e 7 erros de infra, QA Waves fora do GO,
  evidência de smoke expirada, scorecard com blockers abertos). **Não é declaração de release
  verde** e não foi tratado como tal.
- **A pasta completa `tests/integration` em paralelo produz 4 falhas por contenção**
  (`ticketLifecycleHandoverWhatsapp`, `whatsappWebhookIdempotencyGate`,
  `whatsappWebhookUnknownPhoneNumberId`, `engineeringRouterReviewerRejectionRecodeE2E`): estado
  compartilhado de tenant/webhook e timeouts de suítes longas. As quatro passam em execução
  isolada (verificado) — o mesmo vale para `engineeringRouterDurableResumeE2E`, que falha por
  timeout sob carga e passa 5/5 sozinho em 209s. Isso é declarado em vez de escondido atrás de um
  número agregado.

---

## 11. Reprodução

```bash
npm run db:migrate                                   # cria as tabelas de missão
npx jest tests/unit/engineeringRouterQwenProvider.test.js tests/unit/engineeringMissionCompiler.test.js
npx jest tests/integration/engineeringMissionFullE2E.test.js
npx jest tests/integration/engineeringMissionDurableResume.test.js
npx jest tests/integration/engineeringMissionGovernanceAndConcurrency.test.js
npx jest tests/integration/engineeringMissionEnrichmentDegradation.test.js
npx jest tests/integration/engineeringMissionReviewEnforcement.test.js
npx jest tests/unit/engineeringMissionReviewEngines.test.js tests/unit/engineeringMissionRoutes.test.js
npx jest tests/unit/engineeringMissionContextBudget.test.js
node tests/smoke/engineering-missions-browser.js     # jornada real (API + Vite no ar)
npm run validate:engineering-router-v1
npm run validate:route-mounts
npm run validate:visibility-policy
npm run validate:experience-segregation
npm run validate:runtime
```
