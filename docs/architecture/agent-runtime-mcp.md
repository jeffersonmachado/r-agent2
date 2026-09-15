# RAP Agent Runtime — Specialist Agents + MCP

> Status: implementado em 2026-08-09. Documento arquitetural canônico da
> evolução do Agent Runtime sobre o Cognitive Core.

## 1. AS-IS → TARGET

### AS-IS (confirmado no inventário)

- Cognitive Core existente e saudável: pipeline `INPUT → CONTEXT → INTENT →
  PLAN → EXECUTE → VALIDATE → LEARN` em `src/core/cognitive/`, exposto em
  `POST /api/cognitive/process` (`api/modules/cognitive/routes.js`).
- `api/modules/agent-os/routes/agent-orchestrator.js` declarava "nunca
  retorna resposta simulada" mas continha `catch (_)` com fallback sintético
  (`{ data: { capability, action, context } }` e `note: 'capability executed'`)
  — **fake success** quando o serviço falhava ou não existia (`crmService`,
  `ticketService`, `workspaceService` nem existiam). `CAPABILITY_REGISTRY`
  era uma segunda fonte de execução independente.
- `CorporateAgent.lifecycle` (modelo + CHECK do Postgres) não aceitava
  `validated`, mas `agent-factory.js` e `agent-hardening-service.js` já
  gravavam esse estado.
- `scripts/populate-agent-os.js` enviava `qaWaveResult: 'GO'` — bypass que o
  Agent Factory já proibia (bootstrap quebrava ou burlava, dependendo da versão).
- Cognitive Orchestrator aplicava `actor || { permissions: ['*'] }` — wildcard
  implícito.
- `corporate_agents.slug` era globalmente `UNIQUE` — impedia o mesmo slug em
  tenants distintos.
- Catálogo do marketplace misturava classificações: `support-agent`
  (atendimento ao cliente) como nome ambíguo; `qa-agent` SUPPORT com tools de
  QA Waves/Mesh (engenharia DEVELOPMENT).

### TARGET (implementado)

```text
CHANNELS (WhatsApp/Inbox/Voice/Workspace/API)
   ↓
EVENT FABRIC (eventModelV1 + eventLedgerService)
   ↓
COGNITIVE ENTRY POLICY (DETERMINISTIC_FLOW | COGNITIVE | DURABLE_PROCESS | HUMAN)
   ↓
COGNITIVE CORE
   ↓ CONTEXT → INTENT
   ↓
AGENT SUPERVISOR (src/core/cognitive/agent-supervisor)
   ↓
SPECIALIST AGENT PROFILE (corporate_agents + config JSONB)
   ↓
ACTION PLANNER (restrito ao escopo do especialista)
   ↓
EXECUTION ROUTER (src/core/cognitive/execution-router)
   ├──────────────┬──────────────┐
   ↓ ATOMIC                     ↓ DURABLE
TOOL REGISTRY            PROCESS RUNTIME (api/core/process-runtime)
   └──────┬──────────────────────┘
          ↓
 CAPABILITY KERNEL (Tool Registry evoluído)
          ↓
  CANONICAL TOOLS (namespaced)
   ├──────┼──────────┐
 Native  MCP Server  External MCP (Client Hub)
   ↓      ↓          ↓
        DOMAIN SERVICES
```

Princípio: **Agent decide/coordena · Service executa · Tool Registry controla ·
Process Runtime mantém estado durável · MCP interoperabiliza · Policy autoriza ·
Audit/Evidence prova.**

## 2. Componentes

### 2.1 Principal (`src/core/cognitive/principal.js`)

Identidade explícita de toda execução: `principalId, principalType
(user|agent|service|anonymous), tenantId, userId, agentId, serviceId,
classification, capabilities, permissions, channel, sessionId, correlationId`.

- Sem `actor` explícito, o orchestrator usa `defaultRestrictedPrincipal` —
  fail closed, **sem wildcard**.
- Service principals com privilégio amplo exigem lista explícita de permissões
  (`buildServicePrincipal` rejeita `'*'`).

### 2.2 Agent Supervisor (`src/core/cognitive/agent-supervisor/`)

Posicionado entre Intent e Planning. Descobre CorporateAgents ativos do
tenant, elimina proibidos e seleciona o especialista:

- Elegibilidade: tenant, `lifecycle=active`, classificação (via
  `experience-segregation.validateAgentVisibility` — PRODUCTION nunca vê
  SUPPORT/DEVELOPMENT), compatibilidade de vertical (`config.verticals`) e de
  canal (`config.channels`).
- Match por capabilities canônicas do intent (Canonical Capability Registry).
- Envelope interno (nunca exposto): `{ status, agentId, agentSlug,
  classification, reason, confidence, capabilities, allowedTools,
  knowledgeScope }`. `knowledgeScope` é derivado do RAG Domain Router a partir
  da classificação — nunca do prompt.
- Diretório indisponível → `directory_unavailable` explícito (sem fake routing).
- **Delegação**: `supervisor.delegate({ fromAgent, intent, chain, ... })` com
  `maxDelegationDepth` (default 2), cycle detection, `delegation.allowed` do
  profile, tenant boundary e classification boundary (PRODUCTION nunca delega
  para DEVELOPMENT; SUPPORT não usa delegação como bypass).

### 2.3 Specialist Agent Profiles

`corporate_agents` cumpre o papel de Specialist Agent Profile — sem tabela
paralela. Especialização declarativa no JSONB `config` (preenchido a partir de
`profile` no catálogo do marketplace):

```yaml
profile:
  goal: manage_customer_appointments
  knowledge: { domain: OPERATIONAL }      # RAG scope por policy
  autonomy: { schedule.createAppointment: autonomous, schedule.cancelAppointment: policy_based }
  delegation: { allowed: [crm-agent, customer-service-agent] }
  channels: [whatsapp, inbox]
  verticals: { inherited: true }          # vertical = policy pack, não agente novo
```

Taxonomia final (`api/modules/agent-marketplace/service.js`):

- **PRODUCTION**: sdr-agent, crm-agent, customer-service-agent,
  scheduling-agent, collection-agent, campaign-agent, voice-agent,
  operations-agent, operational-knowledge-agent.
- **SUPPORT**: incident-diagnostic-agent, audit-replay-agent.
- **DEVELOPMENT**: qa-engineering-agent, platform-knowledge-agent, dev-agent,
  discovery-agent.

Aliases de slugs legados: `support-agent → customer-service-agent`,
`knowledge-agent → operational-knowledge-agent`,
`qa-agent → qa-engineering-agent` (classificação corrigida para DEVELOPMENT;
SUPPORT não ganha QA Waves indiretamente).

Verticais **não** duplicam agentes: especialista genérico + Vertical Policy
Pack (`config.verticals`) + configuração do tenant + RAG operacional.

### 2.4 Canonical Capability Registry (`config/canonical-capabilities.json` + `src/core/cognitive/capability-registry/`)

Fonte canônica de capabilities de **negócio** (`crm.read`, `crm.write`,
`crm.opportunity`, `schedule.read`, `schedule.manage`, `messaging.send`,
`ticket.manage`, `campaign.manage`, `voice.call`, `workspace.insight`,
`knowledge.operational`) com técnicas claramente separadas em
`technicalCapabilities` (`knowledge.system`, `support.diagnose`,
`audit.replay`, `qa.waves`, `qa.mesh`).

Cada capability declara `tools`, `permissions`, `visibility`, `intents`.
Aliases temporários mapeiam nomes legados (`appointment_booking` →
`schedule.manage`, `customer_lookup` → `crm.read`, `agenda.book` →
`schedule.manage`, `qa.wave.execute` → `qa.waves`, ...). Os arquivos legados
(`capabilities.json`, `config/capabilities.json`,
`config/capabilities-registry.json`) **não foram apagados** — coexistem como
fontes dos seus consumidores atuais; o registry canônico é a fonte para
agentes, orchestrator, supervisor e MCP.

### 2.5 Capability Kernel (Tool Registry evoluído)

`src/core/cognitive/tool-registry/index.js` — contrato backward compatible:

- ids canônicos namespacados (`crm.searchCustomer`,
  `schedule.createAppointment`, `messaging.sendWhatsAppMessage`, ...) com
  `aliases` para nomes legados (executáveis, com log de deprecation; nunca
  listados).
- Campos novos opcionais: `capability`, `inputSchema`, `outputSchema`,
  `riskLevel`, `sideEffects`, `confirmationPolicy`, `idempotencyPolicy`,
  `retryPolicy`, `timeoutPolicy`, `auditPolicy`, `redactionPolicy`, `version`,
  `executionMode`.
- Validação AJV (dependência já existente): input inválido falha **antes** do
  serviço (`cognitive_tool_input_invalid`); output inválido é detectado
  (`cognitive_tool_output_invalid`).
- Side effects com `idempotencyPolicy: 'required'` exigem `idempotencyKey`
  propagado (evento → execução → plano → tool: `${executionId}:${stepId}`).

### 2.6 Execution Router (`src/core/cognitive/execution-router/`)

Decisão auditável `ATOMIC | DURABLE`:

- ATOMIC → Execution Engine → Tool Registry (não cria processo).
- DURABLE → Process Runtime existente (`api/core/process-runtime`), via
  definição canônica gerada do plano (`start → task.service(toolId) → end`).
  O `serviceExecutor` do runtime continua executando **via Tool Registry**
  (governança preservada no caminho durável).
- Critérios durable: flag explícita (`plan.durable`/`payload.durable`), waiting/
  timer/human task no passo, `waitForEvent`/`waitTimerMs`, tool com
  `executionMode: 'durable'`.
- Runtime indisponível → `process_runtime_unavailable` explícito.

### 2.7 Integração operacional (messageProcessor)

`api/services/cognitive/cognitiveEntryPolicy.js` decide o path de entrada;
`api/services/cognitive/inboundCognitiveHandler.js` executa o Cognitive Core
com **service principal restrito** (permissões de
`cognitive.channelPermissions` — default fail-closed) e responde ao canal
apenas outcome de negócio ("Agendamento realizado"). Config por tenant:
`cognitive: { enabled, mode: 'fallback'|'preferred' }` — default desabilitado
(fluxos determinísticos intactos).

### 2.8 MCP (`src/core/mcp/`)

SDK oficial `@modelcontextprotocol/sdk` (v1.30, CJS).

- **Server Adapter** (`server-adapter.js`): deriva tools do Canonical Tool
  Registry — não existe `mcp-tools.json`. Um `Server` por sessão autenticada:
  `tools/list` filtrada pelo principal e `tools/call` executa pelo mesmo
  registry (segurança na execução, não só na ocultação).
- **Authorization** (`auth.js`): tenant vem do contexto autenticado;
  `tenantId` no input é rejeitado (`mcp_tenant_override_forbidden`);
  fail closed sem principal completo.
- **Client Hub** (`client-hub.js`): conexões externas **registradas**
  (`tenant, name, endpoint, authType, authRef|credentialRef, enabled,
  classification, allowedCapabilities, allowedTools, toolCapabilityMap,
  delegatedCapabilities, toolPolicies, endpointPolicy, timeout, retry`).
  Sem conexão: `no_configured_mcp_connection`. `authRef`/`credentialRef` são
  referências — segredos em claro (`token`, `apiKey`, ...) são recusados na
  configuração. `setConnectionEnabled` aplica enable/disable **em memória**
  (sem restart); a persistência segue autoridade.
- **External Tool Adapter** (`external-tool-adapter.js`): tools externas
  viram proxies governados `mcp.t<tenantToken>.<connection>.<tool>` **dentro**
  do Tool Registry — o agente nunca chama MCP externo diretamente.
  `revokeExternalMcpConnection` desabilita a conexão no hub e **remove os
  proxies do registry** (`deregister`), então `resolveProvider` deixa de
  selecioná-los na hora; a rota `enable/disable` chama esse caminho (via
  `api/runtime/mcpRuntimeHandles`) além de persistir.
- **Connection Delegation** (`connection-delegation.js`): o escopo da conexão
  (`mcp.t<tenantToken>.<connection>`) pode ser **delegado** — via config
  persistida `delegated_capabilities` (coluna `mcp_connections`) — a
  portadores de capabilities canônicas nominalmente declaradas. É o que
  permite a um consumidor capability-neutral (ex.: research principal)
  alcançar o provider externo sem wildcard `mcp.*` (proibido e recusado na
  configuração) e sem conhecer o nome da conexão. O resolver vive no registry
  (`addDelegationResolver`), ignora conexões desabilitadas e nunca concede `*`.

### 2.8.1 MCP Control Plane

Implementado em 2026-09-11. O Control Plane é a camada que transforma "conexão
MCP configurada" em "capability interoperável, governada e observável". Ele é
aplicado em cadeia, sempre antes da rede:

```text
endpoint-policy (SSRF · TLS · DNS rebinding · redirect)
   → credencial por REFERÊNCIA (Bearer/API key/OAuth2/mTLS/no_auth opt-in)
   → descoberta de tools + fingerprint de schema
   → tool-lifecycle (discovered → validated → enabled ⇄ disabled
                     ↘ degraded / schema_changed / unavailable)
   → tool-policy POR TOOL (risco, side effect, confirmação, idempotência,
                           timeout, retry, redaction)
   → circuit breaker + health + timeout
   → redaction de output + auditoria/métricas
```

- **`endpoint-policy.js`** — módulo PURO. `evaluateEndpoint` recusa protocolo
  não-https em PRODUCTION, credenciais na URL, hostname proibido
  (`localhost`, `*.internal`, `*.local`) e IP literal em faixa restrita.
  `169.254.0.0/16` (metadata de cloud) é bloqueado **sempre** — nem com
  `allowPrivateNetwork`. `evaluateResolvedAddresses` revalida o IP resolvido a
  cada conexão (DNS rebinding) e `resolveTlsOptions` nunca devolve
  `rejectUnauthorized: false` em PRODUCTION.
- **`tool-lifecycle.js`** — `computeSchemaFingerprint` (SHA-256 de input+output
  com serialização determinística): uma mudança de schema remoto entra como
  `schema_changed` e a tool fica **não executável** até `validateTool` explícito.
  `getToolAvailability` deriva disponibilidade de lifecycle + fingerprint +
  saúde + circuit breaker — "existia no startup" nunca é disponibilidade.
- **`tool-policy.js`** — política por tool com precedência declarada >
  heurística por nome (tokenização camelCase/snake/dot; o PRIMEIRO token é o
  verbo). `payments.refund` → `high` + `confirmation_required` + retry 1;
  `calendar.listEvents` → `low` + `autonomous`. Sinal remoto
  (`destructiveHint`/`readOnlyHint`) é DADO: pode elevar risco, **nunca
  reduzir** o que foi declarado. `sanitizeRemoteDescription` marca a descrição
  remota como `trusted: false` e remove trechos instrucionais;
  `redactToolOutput` remove credenciais e PAN antes de devolver ao agente.
- **`capability-resolution.js`** — resolução provider-neutral: quem consome
  pede **capability** (`crm.read`, `research.search`), nunca provider. Seleção
  determinística (nativo primeiro; fallback externo só sem side effect;
  todos com side effect ⇒ `side_effect_provider_fallback_not_safe`).
  **Binding de tenant**: um proxy de MCP externo (`metadata.source =
  'external_mcp'`) só é elegível para atores do tenant da conexão
  (`metadata.tenantId`) — ator de outro tenant ou sem tenant nunca o resolve
  (fail closed; cross-tenant exigiria delegação persistida explícita, que não
  existe).
- **`observability.js`** — 9 métricas (`mcp_connections`,
  `mcp_connection_failures`, `mcp_tool_discoveries`, `mcp_tool_calls`,
  `mcp_tool_failures`, `mcp_tool_denials`, `mcp_schema_changes`,
  `mcp_circuit_open`, `mcp_latency`) + audit sink. Nunca carrega segredo.
- **`service-principal.js` + `api/runtime/mcpServicePrincipalAuth.js`** —
  identidade machine-to-machine (M31/M32): opt-in explícito (`meta.mcp.enabled`),
  escopos de capability, teto de classificação (default = menor privilégio),
  expiração, revogação e identidade de auditoria. O teto nunca é elevado pelo
  chamador e `*` é proibido. Habilitado por `MCP_SERVICE_PRINCIPAL_AUTH` ou
  injeção do resolver; falha de auth devolve **um único** código
  (`mcp_authentication_required`) — sem oráculo distinguindo sessão humana de
  credencial de integração.
- **Process Runtime** — o bridge `createToolBridgeServiceExecutor` faz o nó
  durável executar pelo Tool Registry com `idempotencyKey` determinística
  (`executionId:nodeId`), de modo que retry não duplica operação ambígua.

Enforcement: `npm run validate:mcp-control-plane` (20 invariantes executáveis,
incluso em `validate:governance-enforcement`) → `reports/mcp-control-plane-report.json`.


### 2.9 Event Fabric

Novos tipos em `api/events/eventModelV1.js`: `agent.routing.completed`,
`agent.execution.started|completed|failed`, `agent.delegation.requested|
completed`, `tool.execution.started|completed|failed`, `process.delegated` —
sempre com tenant, correlationId, executionId, principal, capability,
outcome. O orchestrator emite best-effort via `eventLedgerService`.

## 3. Segurança e segregação

- Nenhum actor ganha wildcard implicitamente (orchestrator, facade do
  agent-orchestrator, canal inbound, MCP).
- PRODUCTION não descobre nem executa tools/agents/capabilities
  SUPPORT/DEVELOPMENT — testado no registry, no supervisor e via protocolo MCP.
- RAG: `knowledge.operational` (PRODUCTION) e `knowledge.system` (SUPPORT+)
  são tools/agentes distintos; o Domain Router calcula o escopo — o input
  nunca escolhe domínio.
- RPA permanece invisível: não há RPA Agent no catálogo, nenhuma tool
  operacional menciona RPA/QA/Replay (`OPERATIONAL_FORBIDDEN_PATTERN` no
  registry) e as mensagens de canal são outcomes de negócio.
- QA Waves/Mesh permanecem DEVELOPMENT; replay diagnóstico SUPPORT
  (`audit.listReplays`).

## 4. Migration strategy

- `api/db/migrations/20260809000001-corporate-agent-lifecycle-tenant-slug.js`
  (Umzug, incremental, idempotente): lifecycle CHECK passa a incluir
  `validated`; drop do UNIQUE global de `slug`; UNIQUE composto
  `(tenant_id, slug)`. DDL histórica `migrations/agent-os-2026-06-11.sql`
  atualizada para instalações novas.
- Compatibilidade: aliases de tools e capabilities, slugs legados no
  marketplace, rotas antigas do agent-orchestrator mantidas como facade
  (intents/capabilities derivados do registry canônico).
- Bootstrap `scripts/populate-agent-os.js`: cria → configura → valida (QA Wave
  real) → aprova somente se GO → publica. Sem override manual.

## 5. Fluxo cognitivo de ponta a ponta (exemplo)

1. WhatsApp inbound → `messageProcessor` → Entry Policy → `COGNITIVE`.
2. Context Engine monta contexto do tenant; Intent Engine classifica
   (`agendar`).
3. Supervisor seleciona `scheduling-agent` (tenant, active, PRODUCTION,
   capabilities do intent) → envelope com `allowedTools`.
4. Action Planner gera plano restrito ao escopo do especialista.
5. Execution Router: plano atômico → tools via registry (idempotencyKey
   propagada); plano durable → Process Runtime (sobrevive restart/deploy).
6. Validation Engine verifica pós-condições; Learning Engine registra.
7. Canal recebe "Agendamento realizado." — eventos `agent.*` no ledger ligam
   evento → decisão → agente → plano → execução → outcome.
