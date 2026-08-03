# Agent Operating System (Agent OS)

Implementado e populado em 2026-06-11. O RAP agora é um Sistema Operacional de Agentes Corporativos com Knowledge Graph populado.

## Arquitetura

```
Workspace
  +
Agent Operating System
  ├── Agent Registry       (api/modules/agent-registry/)
  ├── Agent Factory        (api/modules/agent-os/routes/agent-factory.js)
  ├── Knowledge Graph      (api/modules/knowledge-graph/)
  ├── Journey Registry     (api/modules/journey-registry/)
  ├── RAP Learn            (api/modules/rap-learn/)
  ├── AI Governance        (api/modules/ai-governance/)
  ├── Agent Marketplace    (api/modules/agent-marketplace/)
  ├── Agent Orchestrator   (api/modules/agent-os/routes/agent-orchestrator.js)
  └── Vertical Templates   (api/modules/vertical-templates/)
  +
Knowledge Graph
  +
Journey Registry
  +
AI Governance
  +
Replay
  +
QA Waves
  +
RAP Learn
```

## Modelos (7 novas tabelas)

| Tabela | Modelo | Descrição |
|---|---|---|
| `corporate_agents` | `CorporateAgent.js` | Agentes de IA corporativos com classificação PRODUCTION/SUPPORT/DEVELOPMENT |
| `kg_nodes` | `KnowledgeGraphNode.js` | Nós do grafo de conhecimento (18 tipos de entidade) |
| `kg_edges` | `KnowledgeGraphEdge.js` | Arestas do grafo com relacionamentos ponderados |
| `journey_registry` | `JourneyRegistry.js` | Jornadas de negócio como entidades de primeira classe |
| `learning_records` | `LearningRecord.js` | Pipeline de aprendizado contínuo |
| `ai_governance_records` | `AiGovernanceRecord.js` | Audit trail, decision log e compliance |
| `vertical_templates` | `VerticalTemplate.js` | Templates por vertical de negócio |

## Classificação de Agentes

- **PRODUCTION**: Visível para usuários operacionais. Executa tarefas de negócio.
- **SUPPORT**: Visível para suporte. Diagnóstico, replay e evidência.
- **DEVELOPMENT**: Restrito à engenharia (super_admin). QA, teste e desenvolvimento.

## Rotas API

| Rota | Método | Descrição |
|---|---|---|
| `/api/agent-registry` | GET/POST | Listar/Criar agentes corporativos |
| `/api/agent-registry/:id` | GET/PUT/DELETE | CRUD individual |
| `/api/agent-factory/create` | POST | Iniciar criação de agente |
| `/api/agent-factory/configure` | POST | Configurar capabilities/tools/knowledge |
| `/api/agent-factory/validate` | POST | Submeter a QA Wave |
| `/api/agent-factory/approve` | POST | Aprovar governance |
| `/api/agent-factory/publish` | POST | Publicar em produção |
| `/api/knowledge-graph` | GET | Consultar grafo |
| `/api/knowledge-graph/node` | POST | Upsert node |
| `/api/knowledge-graph/edge` | POST | Criar aresta |
| `/api/knowledge-graph/node/:id/related` | GET | Nós relacionados |
| `/api/journey-registry` | GET/POST | Listar/Criar jornadas |
| `/api/journey-registry/seed` | POST | Seed de jornadas padrão |
| `/api/rap-learn/records` | GET | Listar registros de aprendizado |
| `/api/rap-learn/regressions` | GET | Detectar regressões |
| `/api/rap-learn/failure` | POST | Registrar falha |
| `/api/rap-learn/classify/:id` | POST | Classificar falha |
| `/api/rap-learn/suggest/:id` | POST | Gerar sugestão |
| `/api/rap-learn/validate/:id` | POST | Validar sugestão |
| `/api/rap-learn/promote/:id` | POST | Promover correção |

## Learning Routine (2026-07-22)

Rotina agregadora de aprendizado — automatiza o trecho não-humano do pipeline RAP Learn:

- `api/services/learningRoutineService.js` → `runLearningRoutine()`: `detectRegressions` (janela 24h default) → agrupa falhas `detected` por `source::classification` (armazenada ou inferida) → grupos ≥ 3 ocorrências são classificados por regras determinísticas (`CLASSIFICATION_RULES`: timeout, intent, canal, provider IA, persistência, auth) e o registro representativo recebe sugestão (IA via `generateAiResponse` quando disponível; fallback determinístico explícito quando não).
- **Governança (atualizada 2026-07-22, decisão explícita do usuário):** a rotina base NUNCA valida nem promove. Existe estágio opcional de **auto-promoção** (`api/services/learningAutoPromotionService.js`), DESLIGADO por padrão e ativado só via `LEARN_AUTOPROMOTE=1`. Regras não negociáveis: só sugestões geradas por IA com `confidence >= LEARN_MIN_CONFIDENCE` (default 0.8) são elegíveis — sugestões determinísticas exigem humano sempre; o gate de QA executável (default `node scripts/governance/validate-qa-governance.js`, configurável via `LEARN_AUTOPROMOTE_QA_CMD`) deve sair 0, senão NO_GO → `rejected`; toda decisão grava `validationResult` (checks + qaGate), `promotedBy='learning-routine:auto'` e evento no ledger — nada é silencioso.
- `npm run learning:routine` → `scripts/learning-routine.js` (roda uma vez e sai; agendar via cron/systemd timer — nunca setInterval). Vars: `LEARN_TENANT_ID`, `LEARN_WINDOW_HOURS`, `LEARN_MIN_GROUP`, `LEARN_DRY_RUN=1`, `LEARN_NO_AI=1`, `LEARN_AUTOPROMOTE=1`, `LEARN_MIN_CONFIDENCE`, `LEARN_AUTOPROMOTE_QA_CMD`. Relatório: `reports/learning-routine-latest.json`.
- Encerramento registra `LearningRoutineCompleted` no event ledger (tipo adicionado em `api/events/eventModelV1.js`).
- Testes: `tests/unit/learningRoutineService.test.js` (13) + `tests/unit/learningAutoPromotionService.test.js` (11).
| `/api/ai-governance/audit-trail` | GET | Trilha de auditoria |
| `/api/ai-governance/decision-log` | GET | Log de decisões |
| `/api/ai-governance/compliance-report` | GET | Relatório de compliance |
| `/api/ai-governance/event` | POST | Registrar evento |
| `/api/agent-marketplace/catalog` | GET | Catálogo de agentes |
| `/api/agent-marketplace/catalog/:slug` | GET | Detalhe do agente |
| `/api/agent-marketplace/install` | POST | Instalar agente |
| `/api/agent-orchestrator/execute` | POST | Executar orquestração |
| `/api/agent-orchestrator/intents` | GET | Listar intents |
| `/api/vertical-templates` | GET/POST | Listar/Criar templates |
| `/api/vertical-templates/seed` | POST | Seed de templates padrão |

## Frontend

- Rota: `/admin/agents`
- Componente: `AgentOsHubPage.jsx`
- Menu: Plataforma > Super Admin > Agent OS
- Visibilidade: apenas `super_admin`

## Segregação de Experiência

- Validador: `api/modules/agent-os/experience-segregation.js`
- Política: PRODUCTION / SUPPORT / DEVELOPMENT
- Rotas de Replay, QA Waves, Seeds, RPA permanecem ocultas para usuários operacionais
- Modelo: segregação **in-app** (mesma SPA/API) — não existe app separado para suporte/dev. A rota `/dev` existe por design (Central Dev) e está classificada DEVELOPMENT.
- Guards: itens `/dev*` no menu exigem `roles: ['super_admin']` (`frontend/src/navigation/menu.js`); guard de rota `PROTECTED_PATH_PREFIXES` (`/dev`, `/qa`, `/qa-mesh`, `/rpa*`) em `frontend/src/utils/menuPermissions.js` bloqueia acesso direto por URL para não super_admin; backend usa `requireClassification('DEVELOPMENT')` (ex.: `/dev/qa-waves/*`) e `isSuperAdmin` (ex.: `/dev/files*`).
- Gate bloqueante: `npm run validate:visibility-policy` (PASS em 2026-08-03, 0 violações).
- Apps standalone em `dev/` (fora do pacote operacional e do pipeline de release): `dev/qa-waves-ui/` (protótipo legado, ver `AI_MEMORY/qa-waves.md`) e `dev/work-management/` (Gestão de Trabalho extraída da SPA em 2026-07-28; roda isolado na porta 5177).

## Migration

- Arquivo: `migrations/agent-os-2026-06-11.sql`
- Executar: `psql -U <user> -d <db> -f migrations/agent-os-2026-06-11.sql`

## População de Dados

Script: `scripts/populate-agent-os.js`
- Instala e publica 10 agentes do Marketplace
- Cria 19 nós no Knowledge Graph (10 agentes + 7 jornadas + 1 customer + 1 conversation)
- Cria 25+ arestas (Agent→Journey, Customer→Conversation, etc.)
- Registra 10 eventos de governança

Estado atual do banco (2026-06-11):
| Entidade | Quantidade |
|---|---|
| corporate_agents | 11 (1 test + 10 marketplace) |
| journey_registry | 7 |
| vertical_templates | 7 |
| kg_nodes | 19 |
| kg_edges | 25 |
| ai_governance_records | 10 |

## Agentes Padrão (Marketplace)

1. SDR Agent — Pré-vendas e qualificação de leads
2. CRM Agent — Gestão de relacionamento
3. Support Agent — Suporte e atendimento
4. Scheduling Agent — Agendamento de compromissos
5. Collection Agent — Cobrança e negociação
6. Campaign Agent — Campanhas de marketing
7. Knowledge Agent — Gestão de conhecimento
8. QA Agent — Garantia de qualidade
9. Discovery Agent — Descoberta de padrões
10. Dev Agent — Suporte a desenvolvimento

## Jornadas Padrão

1. Lead Conversion (sales, high)
2. Appointment Scheduling (service, high)
3. Fitness Check-in (fitness, medium)
4. Customer Support (support, high)
5. Billing (finance, critical)
6. Collection (finance, medium)
7. Retention (success, high)

## Templates de Vertical

Beauty, Fitness, Food, Clinic, Bakery, Services, Retail — cada um com journeys, agents, kpis e automations pré-configurados.
