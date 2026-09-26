# Índice da documentação

Este índice organiza a documentação do projeto em camadas (visão → arquitetura → roadmap → operação), deixando explícito que o produto é a convergência de **sete pilares**:

1) **Automação** (inspirado em **n8n**)  
2) **Marketing automation** (inspirado em **RD Station**)  
3) **Atendimento omnichannel** (inspirado em **BLIP / Huggy / Zenvia / ChatPro**)  
4) **Voz / Contact Center** (inspirado em **Twilio Flex / Talkdesk / Five9**)  
5) **Orquestração de IA** (inspirado em **LangFlow / Flowise**)  
6) **Filas físicas / Fast service** (inspirado em **Qminder / QLess / Waitwhile / Skiplino**)  
7) **Delivery / Marketplace de pedidos** (inspirado em **iFood / Uber Eats / Rappi / DoorDash**)  

## 1) Visão e posicionamento

- **Objetivo final (North Star)**: `OBJETIVO_FINAL_PLATAFORMA.md`
- **Pilares + benchmarks (capabilities → nodes)**: `PILARES_E_BENCHMARKS.md`
- **Posicionamento de mercado**: `POSICIONAMENTO.md`

## 2) Arquitetura técnica

- **North Star / visão normativa**: `OBJETIVO_FINAL_PLATAFORMA.md`
- **Arquitetura técnica (visão de módulos)**: `ARQUITETURA_TECNICA.md`
- **Timeouts, deadlines, lease, heartbeat e detecção de ausência de progresso (`SLOW != STUCK != DEAD`)**: `architecture/timeout-architecture.md`
- **Guardrails de implementação e convergência**: `../PROJECT_RULES.md`
- **O que falta (fonte única, backlog operacional)**: `O_QUE_FALTA.md`
- (Histórico) **Gaps vs benchmarks (legado)**: `O_QUE_FALTA_GAPS_VS_BENCHMARKS.md`

> Quando houver divergência entre código legado e a direção do produto, os documentos desta seção definem a referência a seguir.

## 3) Roadmap

- **Roadmap (atalho, fonte única)**: `ROADMAP.md`
- **Roadmap 3–5 anos (fases de maturidade)**: `ROADMAP_3A5_ANOS.md`

## 4) Filas físicas / Fast service

- **Módulo de filas físicas (totem/senha/painel/métricas)**: `FILAS_FISICAS_FAST_SERVICE.md`
- (Complementar) **Filas digitais/atendimento (SLA/roteamento)**: `ARCHITECTURE_QUEUES_ROUTING_SLA.md`

## 5) Delivery / Marketplace

- **Módulo de pedidos/delivery (order lifecycle + logística + SLA)**: `DELIVERY_MARKETPLACE.md`

## 6) Casos de uso (end-to-end)

- **Casos de uso por segmento**: `CASOS_DE_USO.md`

## 6.1) Operacao vertical Beauty/Fitness

- **Painel operacional (pilot MVP)**: `OPERATIONS_DASHBOARD.md`
- **Base tecnica das verticais Beauty/Fitness**: `VERTICALS_BEAUTY_FITNESS.md`

## 7) Documentação operacional e técnica existente (inventário)

Este repositório já contém documentação detalhada por área. Alguns pontos de entrada úteis:

- **Trilha operacional oficial (autoridade de release completo: `npm run release:seal`)**: `official-path.md`
- **Deploy — política de build local (bloqueante)**: `deployment/local-build-policy.md`
- **Marketing / Google Ads (configuração, conversões offline, upload e operação)**: `MARKETING_GOOGLE_ADS_OPERACAO.md`
- **Marketing / Google Ads (roadmap de gestão completa e supervisão por IA)**: `MARKETING_GOOGLE_ADS_GESTAO_COMPLETA_IA.md`
- **Atendimento (análise e gaps BLIP-like)**: `BLIP_GAP_ANALYSIS.md`
- **Padrões do workspace `/support` (layout, cards, compositor, handover, IA)**: `SUPORTE_PADRAO_WORKSPACE.md`
- **Templates/marketplace de flows**: `ARCHITECTURE_TEMPLATE_MARKETPLACE_PHASE5.md`
- **Replay**: `COMO_USAR_REPLAY.md`
- **Multi-tenant (arquitetura e contexto cognitivo)**: `TENANT_MULTI_TENANT_ARCHITECTURE.md`
- **Motor de cobertura (inventário, grafo de rastreabilidade, evidências, gate GO/NO_GO, impacto)**: `qa/coverage-engine.md`
- **Propostas de mudança da pesquisa de benchmarks (pesquisa propõe → aprovação humana com ressalvas → aplicação)**: `benchmark/change-proposals.md`
- **Autoridade única de certificação de benchmarks (conjunto de verticais certificadas derivado do relatório do engine; `sample.claim` inerte)**: `benchmark/certification-authority.md`
- **Versionamento semântico do pipeline de benchmark (`sem-v1:<hash>`, estados de achado, reprocesso e aposento governado)**: `benchmark/semantic-versioning.md`
- **RAG**:
  - `RAG_POR_TENANT.md`
  - `COMO_TESTAR_RAG.md`
  - `CONFIGURACAO_IA.md`
- **MCP Research (container das capabilities `research.*`)**: `mcp-research/README.md` (arquitetura/ADR/integração), `mcp-research/tool-contracts.md`, `mcp-research/security-model.md`, `mcp-research/operations.md`, `mcp-research/data-flow.md`
