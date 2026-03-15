# Tenant Intelligence Core - Arquitetura

## 1. Proposito

O Tenant Intelligence Core e a camada estrategica multi-tenant do r-agent2.

Essa camada fica acima do operacional e organiza, por `tenant_key`, os seguintes elementos:

- pesquisa estrategica por tenant
- metas
- metricas
- insights
- evidencias
- recomendacoes

Objetivo da camada:

- transformar sinais operacionais existentes em leitura estrategica rastreavel
- permitir busca estrategica com resposta estruturada
- manter cada insight e recomendacao vinculados a evidencia e contexto real

## 2. Reuso do que ja existe

A implementacao reaproveita explicitamente componentes ja consolidados:

- `TenantContext` (contexto cognitivo por tenant)
- `ragService` (RAG por tenant, sem camada paralela)
- `event_ledger` (fonte operacional auditavel para metricas/eventos)
- `process-intelligence` (heuristicas de apoio arquitetural/processual)
- `ticketInsightService` apenas como peca operacional isolada (nao como core estrategico)

Diretriz:

- Tenant Intelligence Core nao substitui nem duplica os blocos acima
- Tenant Intelligence Core orquestra e compoe esses blocos

## 3. O que sera novo

### 3.1 Entidades novas

- `TenantGoal`
- `TenantMetricSnapshot`
- `TenantInsight`
- `TenantInsightEvidence`
- `TenantRecommendation`

Todas as entidades:

- possuem `tenant_key`
- usam persistencia PostgreSQL/Sequelize
- seguem `underscored: true`

### 3.2 Servicos novos

- `ContextResolver`
- `GoalEngine`
- `MetricEngine`
- `InsightEngine`
- `EvidenceEngine`
- `RecommendationEngine`
- `StrategicSearchService`
- `TenantOperationalStateEngine`
- `TenantIntelligenceService` (facade/orquestrador)

### 3.3 Fluxo de alto nivel (V1)

1. Resolver contexto estrategico do tenant (`ContextResolver`)
2. Ler metas ativas (`GoalEngine`)
3. Coletar snapshots/metricas confiaveis (`MetricEngine`)
4. Gerar insights simples e rastreaveis (`InsightEngine`)
5. Persistir evidencias vinculadas ao insight (`EvidenceEngine`)
6. Gerar recomendacoes vinculadas a goal/insight/metrica (`RecommendationEngine`)
7. Montar resposta estruturada e, quando necessario, complementar com `ragService` (`StrategicSearchService`)

Fluxo complementar (estado operacional vivo):

1. Resolver contexto do tenant
2. Ler metas/snapshots/insights/recomendacoes abertas
3. Calcular health score com regras simples
4. Expor estado consolidado via `POST /api/intelligence/operational-state`

## 4. O que nao deve acontecer

Regras obrigatorias para evitar arquitetura paralela:

- nao recriar `TenantContext`
- nao criar RAG paralelo ao `ragService`
- nao criar novo ledger generico paralelo ao `event_ledger`
- nao usar heuristica opaca sem evidencia persistida
- nao inferir causalidade forte sem suporte de dados

Regras de rastreabilidade:

- insight precisa de evidencia (`TenantInsightEvidence`)
- recomendacao precisa apontar para meta, insight ou metrica

## 5. Escopo V1

Escopo intencionalmente incremental:

- CRUD de metas (`TenantGoal`)
- snapshots simples de metricas confiaveis (`TenantMetricSnapshot`)
- insights simples e rastreaveis (`TenantInsight` + evidencias)
- busca estrategica inicial (`StrategicSearchService`)
- recomendacoes basicas (`TenantRecommendation`)

Fora do escopo V1:

- inferencia causal avancada
- modelos preditivos complexos
- refactor transversal do core existente

## 6. Alinhamento com docs e arquitetura atual

Este desenho segue os principios documentados em:

- `docs/OBJETIVO_FINAL_PLATAFORMA.md`
- `docs/ROADMAP.md`
- `docs/ROADMAP_3A5_ANOS.md`
- `docs/TENANT_CONTEXT_RAG.md`
- `docs/RAG_POR_TENANT.md`
- `docs/PROCESS_INTELLIGENCE.md`
- `docs/TENANT_MULTI_TENANT_ARCHITECTURE.md`
- `docs/IMPLEMENTACAO_TENANT_CONTEXT.md`
- `docs/CONFIGURAR_IA_TENANT_SYSTEM.md`

Resultado arquitetural esperado:

- camada estrategica reutilizando o operacional existente
- isolamento estrito por tenant
- rastreabilidade ponta a ponta de decisao estrategica
