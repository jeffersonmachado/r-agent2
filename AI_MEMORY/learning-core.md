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

## Ciclo-alvo (fases futuras)

OBSERVAR → ENTENDER → MEDIR → ENSINAR → SIMULAR → VALIDAR → CERTIFICAR →
OBSERVAR NOVAMENTE. Nunca termina.

Plano de fases aprovado: F0 telemetria (entregue) → F1 Competency Engine
(perfil de competências por observação) → F2 Journey Trainer + Simulation
Engine (replay → anonimização → dados sintéticos → treinamento) → F3 Tutor/
Mentor Agents + RAP Academy (UX invisível, ajuda contextual em níveis 0–4) →
F4 Assessment + Certification + Adaptive Learning.

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
