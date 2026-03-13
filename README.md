## Visão geral

Este repositório evolui para uma **plataforma unificada** que converte processos e operações em **fluxos visuais (DAG)** com **nodes plugáveis**, reunindo sete pilares em um único produto SaaS multi-tenant:

1) **Automação** (inspirado em **n8n**)  
2) **Marketing automation** (inspirado em **RD Station**)  
3) **Atendimento omnichannel** (inspirado em **BLIP / Huggy / Zenvia**)  
4) **Voz / Contact Center** (inspirado em **Twilio Flex / Talkdesk / Five9**)  
5) **Orquestração de IA** (inspirado em **LangFlow / Flowise**)  
6) **Filas físicas / Fast service** (inspirado em **Qminder / QLess / Waitwhile / Skiplino**)  
7) **Delivery / Marketplace de pedidos** (inspirado em **iFood / Uber Eats / Rappi / DoorDash**)  

**Tese do produto**: no nosso sistema, *tudo vira node* dentro do DAG — desde “gerar senha no totem” até “enviar WhatsApp”, “acionar URA”, “atualizar CRM”, “disparar jornada”, “medir ROI” e “replay da execução”.

## Problema que resolvemos

Organizações crescem usando ferramentas isoladas (automação, marketing, atendimento, voz, IA, operação física e delivery). O resultado é:

- **Dados fragmentados** (identidade do cliente espalhada; difícil reconciliar histórico)
- **Operação cara e frágil** (integrações pontuais; baixa rastreabilidade ponta a ponta)
- **Dificuldade de escala** (SLA, filas, produtividade, voz e atendimento físico)
- **Operação de delivery fragmentada** (pedido, preparo, despacho, tracking e pós-venda em sistemas distintos)
- **ROI obscuro** (atribuição e custo total por canal e jornada)

## Documentação (comece por aqui)

- **Índice da documentação**: `docs/00_DOCUMENTACAO_INDEX.md`
- **Objetivo final / visão**: `docs/OBJETIVO_FINAL_PLATAFORMA.md`
- **Arquitetura técnica alvo**: `docs/ARQUITETURA_TECNICA.md`
- **Roadmap (atalho)**: `docs/ROADMAP.md`
- **Roadmap 3–5 anos**: `docs/ROADMAP_3A5_ANOS.md`
- **O que falta (fonte única)**: `docs/O_QUE_FALTA.md`
- (Histórico) **Gaps vs benchmarks**: `docs/O_QUE_FALTA_GAPS_VS_BENCHMARKS.md`

Para decisões de arquitetura, priorização e convergência do código, estes documentos de visão prevalecem sobre exceções legadas encontradas no repositório.

## Pilares do produto (com benchmarks)

### 1) Automação (n8n)
- DAG runtime, execuções por nó, histórico e **replay**
- Queue distribuída, scheduler, retries/idempotência
- Credentials vault, versionamento, subflows
- Marketplace de nodes e templates reutilizáveis

### 2) Marketing automation (RD Station)
- Leads, formulários, landing pages e tracker JS (UTM/pageview)
- Scoring, segmentação e jornadas
- Email marketing, funil visual, analytics e ROI

### 3) Atendimento omnichannel (BLIP / Huggy / Zenvia)
- Inbox omnichannel unificado (bot + humano)
- Filas, SLA, roteamento e operação humana
- Histórico completo do cliente (timeline)

### 4) Voz / Contact Center (Twilio Flex / Talkdesk / Five9)
- URA visual, filas de voz, transferências e gravação
- Click-to-call, discagem, disposition codes
- Eventos de chamada como triggers/ações no DAG

### 5) IA (LangFlow / Flowise)
- Nodes reutilizáveis de IA (classificação, priorização, enriquecimento, sugestão)
- Contexto unificado + governança (custo, privacidade, auditoria)

### 6) Filas físicas / Fast service (Qminder / QLess / Waitwhile / Skiplino)
- Emissão de senha (totem/kiosk), tipos de fila e prioridades
- Painel de chamada (TV), estações/guichês e “chamar próximo”
- Métricas: tempo de espera, throughput, abandono e produtividade
- Integração com fluxos: **Totem → Fila → DAG → Atendimento/Voz/CRM/Marketing**

### 7) Delivery / Marketplace de pedidos (iFood / Uber Eats / Rappi / DoorDash)
- Criação de pedido, pagamento e antifraude (quando aplicável)
- Status em tempo real (pedido → preparo → despacho → entrega)
- Despacho de entregador e tracking
- Notificações (WhatsApp/SMS/push), avaliação e suporte
- SLA de entrega e métricas de operação
- Integração com fluxos: **Pedido → Cozinha → Entrega → CRM → Marketing**

## Estado atual (o que já existe neste repo)

Além do editor de fluxos e execução básica, o repositório já contém entregas importantes para SaaS e operação:

- **SaaS multi-tenant, RBAC, planos/limites, auditoria, super-admin e onboarding**: ver `IMPLEMENTACAO_SAAS_COMPLETA.md`.
- **Atendimento omnichannel com filas/roteamento/SLA (parcial) e handover bot↔humano**: ver `docs/BLIP_GAP_ANALYSIS.md` e `docs/ARCHITECTURE_QUEUES_ROUTING_SLA.md`.
- **Templates de flows (marketplace) e onboarding por segmento**: ver `docs/ARCHITECTURE_TEMPLATE_MARKETPLACE_PHASE5.md`.
- **Replay (simulação e visualização por sessionId)**: ver `docs/COMO_USAR_REPLAY.md`.
- **Pipeline de IA/RAG (scraping, upload PDF, OCR) e contratos de resposta**: detalhes abaixo e em `docs/` (RAG).

## IA/RAG (visão rápida)

O sistema atual também inclui um pipeline RAG que indexa fontes do tenant (site + arquivos) e gera sugestões baseadas em contexto.

- **Vector store**: PostgreSQL + `pgvector` (fonte única)
- **Scraping**: fetch + fallback Playwright (opcional)
- **Uploads**: PDF + imagens com OCR (opcional)

Documentos detalhados (RAG):
- `docs/COMO_TESTAR_RAG.md`
- `docs/RAG_POR_TENANT.md`
- `docs/CONFIGURACAO_IA.md`


