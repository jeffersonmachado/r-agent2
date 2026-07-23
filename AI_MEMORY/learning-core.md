# Learning Core — Memória Operacional

Domínio novo da plataforma (2026-07-23), equivalente em importância ao Cognitive Core.
Responsável por **aprendizado de USUÁRIO**: observar como usuários usam o sistema,
descobrir competências, detectar dificuldades e (fases futuras) ensinar, simular,
avaliar e certificar — sem interromper o trabalho.

## Separação de domínios (não confundir)

- **RAP Learn** (`rap-learn`, learning-engine do Cognitive Core): aprendizado de
  MÁQUINA — a plataforma aprende com as próprias execuções.
- **Learning Core**: aprendizado de USUÁRIO — o sujeito observado é o humano
  operando a UI. Convenções espelhadas (event ledger, tenant, idempotência),
  dados nunca misturados.

## Fase 0 — entregue (2026-07-23)

Telemetria de interação de usuário, fundação de dados para as fases seguintes.

- **Tipos de evento**: `learning.interaction.{navigation,click,api_call,
  flow_completed,flow_abandoned,error}` em `api/events/eventModelV1.js`.
  Fix associado: `cognitive.execution.{completed,failed}` adicionados ao
  `EVENT_TYPES_V1` (o learning-engine do Cognitive Core já os emitia e o append
  falhava silenciosamente).
- **Ingest API**: `POST /api/learning/interactions` (módulo
  `api/modules/learning-core/`, composition `api/composition/learning-core/`,
  montado em `api/app/routeRegistry.js`). Lote máx. 50 eventos; actor sempre da
  sessão autenticada (nunca do body); tenant da sessão.
- **Sanitização por whitelist**: apenas `route`, `target` (testid/aria/tag),
  `durationMs`, `status`, `errorCode`, `flowId`, `metadata` ≤ 2KB. Nenhum valor
  de campo, texto digitado ou payload trafega — privacidade por desenho.
- **Persistência**: event ledger canônico (`source: 'learning-core'`,
  `correlationId = sessionId`, `idempotencyKey = sessionId:clientEventId`).
  Agregado derivado `user_interaction_sessions` (model
  `api/db/models/UserInteractionSession.js`, migration
  `20260723120000-create-learning-core-sessions.js`) — reconstruível a partir
  do ledger; falha do agregado é logada explicitamente, não derruba a ingestão;
  falha do ledger propaga.
- **Frontend**: `frontend/src/core/interactionTracker.js` — singleton iniciado
  na shell (`main.jsx`, `AppWithAuth`) quando autenticado. Captura navegação
  (rota + tempo por tela), cliques em alvos identificáveis e chamadas `/api/*`
  com erro (≥400 ou network_error). Envio em batch (10s ou 20 eventos) +
  flush em `visibilitychange`.
- **Feature flag**: `learningCoreEnabled` (featuresConfig) — **default OFF**.
  Ligar por tenant/usuário via config de features.
- **Testes**: `tests/unit/learningCoreIngest.test.js` (9 testes),
  `frontend/src/core/interactionTracker.test.js` (7 testes).

## Fase 1 — entregue (2026-07-23)

Skill Graph + Competency Engine (núcleo).

- **Skill graph builder**: `scripts/learning/build-skill-graph.js`
  (`npm run learning:skill-graph:build`). Deriva skills de metadados —
  resources do menu (`frontend/src/navigation/menu.js#getRouteCatalog`),
  canais `omnichannel_*` e mapa estático `CAPABILITY_SKILL_MAP` — gera o
  artefato `config/learning/skill-graph.json` (skills, journeys,
  routeSkillMap) e faz upsert idempotente no knowledge-graph (tenant
  `system`, nós `learning-skill`/`learning-journey`/`learning-capability`,
  edges `requires_capability`/`belongs_to_skill`).
- **Models**: `UserCompetency` (score + components + evidenceRefs por skill),
  `UserLearningProfile` (perfil agregado), `LearningRouteSkillMap`
  (classificações rota→skill, source static/ai). Migration
  `20260723130000-create-learning-core-competencies.js`.
- **Competency Engine**: núcleo puro em `src/core/learning/competency-engine/`
  (zero I/O). Componentes 0..1: precision, coverage, tempo (mediana vs
  baseline do próprio usuário), autonomia (flows), consistencia; score =
  média ponderada renormalizada (0.35/0.25/0.2/0.1/0.1); evidenceRefs = ids
  `evt-*` do ledger (erros primeiro, máx 20).
- **Orquestração**: `api/modules/learning-core/competencyService.js` — lê 90
  dias de eventos do ledger, resolve rota→skill (artefato + overrides do
  tenant), classifica rotas desconhecidas **via IA** (`generateAiResponse`,
  lote máx 20; IA indisponível → `unclassifiedRoutes` explícito, NUNCA
  heurística), persiste upsert em competências/perfil.
- **Rotas**: `GET /api/learning/competencies/me`,
  `GET /api/learning/competencies/:userId` (owner/admin/super_admin),
  `POST /api/learning/competencies/recompute`,
  `GET /api/learning/skill-graph` (404 explícito se artefato não gerado).
- **Testes**: `tests/unit/learningCompetencyEngine.test.js`,
  `learningCompetencyRoutes.test.js`, `learningSkillGraphBuilder.test.js`
  (25 testes).

## Fase 2 — entregue (2026-07-23)

RAP Academy (UI read-only) + Tutor níveis 0-1.

- **RAP Academy**: `frontend/src/pages/AcademyPage.jsx` (+ `.css`), rota
  `/academy`, item "Minha Evolução" no menu (Painel, permission
  `workspace:read`), client `frontend/src/api/academy.js`. Read-only:
  competências por skill (score, componentes, evidenceRefs do ledger),
  perfil (domina/em desenvolvimento), recálculo sob demanda.
  ATENÇÃO: rotas novas de página exigem 4 registros no `main.jsx` — import,
  `isRoute`, branch do `pageContent`, array `allRoutes` do guard de redirect
  (+ deps) — e entrada em `protectedRoutes`; sem isso a rota cai no redirect
  para `/workspace`.
- **Tutor nível 0-1**: `api/modules/learning-core/tutorService.js`.
  Nível 0 (detector determinístico): ≥2 eventos de erro na mesma rota no
  lote ingerido (api_call ≥400/errorCode, error, flow_abandoned).
  Nível 1: dica via RAG (`queryRag`) emitida por WebSocket `tutor.hint`
  somente para o agente (`emitEvent(..., { agentId })`). Cooldown 15min por
  (tenant, agente, rota) consultado na tabela `learning_tutor_hints`
  (nunca em memória); reuso de dica por rota em 24h (`rag_cache`);
  RAG indisponível → nenhum hint, log explícito `ai_unavailable`
  (sem heurística). Todo hint persistido (auditoria). Hook best-effort no
  final do `ingestInteractionBatch` — falha do tutor nunca derruba ingest.
- **TutorDock**: `frontend/src/components/TutorDock.jsx` montado na shell —
  cartão discreto (não modal), auto-dismiss 60s, link para /academy.
- **Perfil do ator**: `GET /api/learning/profile/me` (profile + metadados
  do tutor para a UI adaptar a experiência).
- **Testes**: `tests/unit/learningTutor.test.js` (9),
  `frontend/src/pages/AcademyPage.test.jsx` (4),
  `frontend/src/components/TutorDock.test.jsx` (5).
- **Validação browser real**: /academy renderiza sem erros de console;
  e2e do tutor validado com WS autenticado real (ingest de 2 erros →
  `tutor.hint` recebido via WebSocket, sem polling).

## Fase 3 — entregue (2026-07-23)

Journey Trainer + Simulation Engine (replay → anonimização → roteiro → RAG → missão).

- **Anonymizer**: núcleo puro `src/core/learning/anonymizer/` (zero I/O).
  `SENSITIVE_KEYS` (senha, token, cpf, email...) + `PATTERNS` ordenados do
  mais específico ao mais genérico (cpf, cnpj, cartão, email, telefone, data,
  número longo) para evitar sobreposição; `classifyFormField` determinístico
  (nome/id/placeholder do campo → classe sensível) — fills de replay RPA são
  SEMPRE mascarados, mesmo valores aparentemente inócuos.
- **Journey Trainer**: `api/modules/learning-core/journeyTrainerService.js` —
  carrega replay de `resolveRuntimePath('rpa','replay')` (regex anti-traversal
  `^[\w.-]{1,120}$`), anonimiza, gera markdown (passo a passo das telas e
  preenchimentos), indexa no RAG com id estável `training:<replayId>`
  (re-geração sobrescreve) e faz findOrCreate da missão coletiva.
- **Simulation Engine**: núcleo puro `src/core/learning/simulation-engine/` —
  10 seed types (happy_path, edge_case, erro, exceção, stress, integração,
  permissão, timeout, cliente VIP, inadimplente, falha externa) e 4 personas
  sintéticas (docs `000.000.000-00`, emails `.invalid`); enriquecimento via IA
  opcional — se IA falha, `aiEnrichment: null` + log explícito (nunca dados
  reais).
- **Missões**: `missionService.js` — lista missões coletivas + próprias;
  completar missão coletiva cria cópia por usuário (auditoria individual).
  Models `LearningMission`/`LearningSimulation`, migration
  `20260723150000-create-learning-core-missions-simulations.js`.
- **Rotas**: `GET /api/learning/replays` (admin),
  `POST /api/learning/training/from-replay` (admin),
  `GET /api/learning/missions/me`, `POST /api/learning/missions/:id/complete`,
  `POST /api/learning/simulations/generate` (admin),
  `GET /api/learning/simulations`.
- **Academy**: 3 tabs (Competências / Missões / Simulações).
- **Config**: `nodemon.json` passou a vigiar `src/` (além de `api/` e
  `engine/`) — sem isso mudanças em `src/core/learning/*` não reiniciam a API
  em dev.
- **Testes**: `tests/unit/learningAnonymizer.test.js` (7),
  `learningSimulation.test.js` (5), `learningJourneyTrainer.test.js` (5),
  AcademyPage 6/6. Suíte unit completa 353 suites / 1760 testes verde.
- **Validação e2e**: `from-replay` real (replay `login-flow-*` → doc RAG
  `training:*` indexado, 538 campos mascarados); verificação SQL de PII
  residual nos chunks `training:%` = 0.

## Ciclo-alvo (fases futuras)

OBSERVAR → ENTENDER → MEDIR → ENSINAR → SIMULAR → VALIDAR → CERTIFICAR →
OBSERVAR NOVAMENTE. Nunca termina.

Plano de fases aprovado: F0 telemetria (entregue) → F1 Competency Engine
(entregue) → F2 RAP Academy + Tutor 0-1 (entregue) → F3 Journey Trainer +
Simulation Engine (entregue) → F4 Assessment + Certification + Mentor +
Adaptive Learning.

## Invariantes

- Aprendizado incorporado ao runtime — nunca LMS tradicional, cursos, vídeos
  ou área isolada.
- Descoberta de competência por OBSERVAÇÃO, nunca por questionário.
- Certificação por competência comprovada, nunca por tempo/presença.
- Simulações nunca usam dados reais — sempre sintéticos/anonimizados.
- Nenhum código específico por vertical — tudo por metadados.
- Telemetria nunca quebra a aplicação; perdas são explícitas (log), não
  silenciosas.
- tenant_id em toda persistência; sem fallback em memória; inferência via IA
  (sem heurística fallback — ver princípio AI-native do repo).
