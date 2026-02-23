# Índice da documentação

Este índice organiza a documentação do projeto em camadas (visão → arquitetura → roadmap → operação), deixando explícito que o produto é a convergência de **oito pilares**:

1) **Automação** (inspirado em **n8n**)  
2) **Marketing automation** (inspirado em **RD Station**)  
3) **CRM Operacional Integrado** (benchmark conceitual: **Sistema Operacional do Relacionamento com o Cliente**, inspirado em **HubSpot / Zendesk / RD Station / n8n / CCaaS**)  
4) **Atendimento omnichannel** (inspirado em **BLIP / Huggy / Zenvia / ChatPro**)  
5) **Voz / Contact Center** (inspirado em **Twilio Flex / Talkdesk / Five9**)  
6) **Orquestração de IA** (inspirado em **LangFlow / Flowise**)  
7) **Filas físicas / Fast service** (inspirado em **Qminder / QLess / Waitwhile / Skiplino**)  
8) **Delivery / Marketplace de pedidos** (inspirado em **iFood / Uber Eats / Rappi / DoorDash**)  

## 1) Visão e posicionamento

- **Objetivo final (North Star)**: `OBJETIVO_FINAL_PLATAFORMA.md`
- **Pilares + benchmarks (capabilities → nodes)**: `PILARES_E_BENCHMARKS.md`
- **Pilar CRM Operacional Integrado (definição formal)**: `CRM_OPERACIONAL_INTEGRADO.md`
- **Posicionamento de mercado**: `POSICIONAMENTO.md`

## 2) Arquitetura técnica

- **Arquitetura técnica (visão de módulos)**: `ARQUITETURA_TECNICA.md`
- **O que falta (fonte única, backlog operacional)**: `O_QUE_FALTA.md`
- (Histórico) **Gaps vs benchmarks (legado)**: `O_QUE_FALTA_GAPS_VS_BENCHMARKS.md`

## 3) Roadmap

- **Roadmap (atalho, fonte única)**: `ROADMAP.md`
- **Roadmap 3–5 anos (fases de maturidade)**: `ROADMAP_3A5_ANOS.md`
- **Roadmap do Pilar CRM (NOW/NEXT/LATER + backlog)**: `CRM_OPERACIONAL_INTEGRADO.md`

## 4) Filas físicas / Fast service

- **Módulo de filas físicas (totem/senha/painel/métricas)**: `FILAS_FISICAS_FAST_SERVICE.md`
- (Complementar) **Filas digitais/atendimento (SLA/roteamento)**: `ARCHITECTURE_QUEUES_ROUTING_SLA.md`

## 5) Delivery / Marketplace

- **Módulo de pedidos/delivery (order lifecycle + logística + SLA)**: `DELIVERY_MARKETPLACE.md`

## 6) Casos de uso (end-to-end)

- **Casos de uso por segmento**: `CASOS_DE_USO.md`

## 7) Documentação operacional e técnica existente (inventário)

Este repositório já contém documentação detalhada por área. Alguns pontos de entrada úteis:

- **Atendimento (análise e gaps BLIP-like)**: `BLIP_GAP_ANALYSIS.md`
- **Templates/marketplace de flows**: `ARCHITECTURE_TEMPLATE_MARKETPLACE_PHASE5.md`
- **Replay**: `COMO_USAR_REPLAY.md`
- **Multi-tenant (arquitetura e contexto cognitivo)**: `TENANT_MULTI_TENANT_ARCHITECTURE.md`
- **RAG**:
  - `RAG_POR_TENANT.md`
  - `COMO_TESTAR_RAG.md`
  - `CONFIGURACAO_IA.md`
