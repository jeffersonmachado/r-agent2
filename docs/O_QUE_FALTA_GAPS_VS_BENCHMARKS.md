# O que falta (Gaps) vs benchmarks: n8n + RD Station + BLIP/Huggy/Zenvia/ChatPro + Twilio Flex/Talkdesk/Five9 + LangFlow/Flowise + Qminder/QLess/Waitwhile/Skiplino + iFood/Uber Eats/Rappi/DoorDash

> **Nota (Fev/2026)**: este documento virou **referência histórica**. A **fonte única** do “o que falta” (backlog operacional e critérios) é agora `docs/O_QUE_FALTA.md`.

## 0) Objetivo deste documento

Este documento consolida, de forma **capability-driven**, o que:

- **Já existe** (com evidência no repositório),
- **Existe parcialmente** (inclui o contexto do produto descrito + sinais no repo),
- **Falta construir** para atingir maturidade “enterprise suite” inspirada nos benchmarks.

> Referências internas usadas como evidência (não exaustivo): `README.md` (pipeline RAG/contratos), `IMPLEMENTACAO_SAAS_COMPLETA.md` (SaaS), `docs/BLIP_GAP_ANALYSIS.md` (atendimento), `docs/ARCHITECTURE_QUEUES_ROUTING_SLA.md` (filas/SLA), `docs/ARCHITECTURE_TEMPLATE_MARKETPLACE_PHASE5.md` (marketplace de templates), `docs/COMO_USAR_REPLAY.md` (replay), `docs/FILAS_FISICAS_FAST_SERVICE.md` (filas físicas — visão/arquitetura), `docs/DELIVERY_MARKETPLACE.md` (delivery — visão/arquitetura).

---

## 1) Base já entregue (evidência no repo)

### SaaS (base enterprise)
- **Multi-tenant + RBAC + planos/limites + auditoria + super-admin + onboarding**: documentado como completo em `IMPLEMENTACAO_SAAS_COMPLETA.md`.

### Atendimento (BLIP-like parcial já sólido)
- **Gateway omnichannel com persistência e idempotência** em `channel_*` + tickets/filas/handover + outbound queue + analytics: detalhado em `docs/BLIP_GAP_ANALYSIS.md`.
- **Filas com metadados + roteamento + worker + SLA**: `docs/ARCHITECTURE_QUEUES_ROUTING_SLA.md`.

### Automação / flows (n8n-like em construção)
- **Flows, validação e simulação** + **replay por sessionId**: `docs/COMO_USAR_REPLAY.md`.
- **Templates/marketplace (para flows)** com DB + fallback legado: `docs/ARCHITECTURE_TEMPLATE_MARKETPLACE_PHASE5.md`.

### IA e “contexto cognitivo”
- **RAG em Postgres/pgvector** e pipeline de scraping/upload/OCR: `README.md`.
- **Tenant Context** com regras de segurança (não fragmentar, injetar no prompt, proteção contra prompt injection): `docs/TENANT_MULTI_TENANT_ARCHITECTURE.md`.

### Voz (nível atual no repo)
- Existe **TTS no frontend (melhoria de qualidade)** para mensagens do bot no chat de teste: `docs/MELHORIA_VOZ_TTS.md`.
  - Isso é útil como UX, mas **não equivale** a CCaaS/telefonia tipo Twilio Flex/Talkdesk/Five9.

---

## 2) Gaps críticos que destravam o resto (ordem recomendada)

1) **Event model unificado (Customer 360 orientado a eventos)**  
   - Identidade e eventos normalizados para: tracker web, canais, tickets, flows, campanhas, voz, IA, **filas físicas** (senha, chamada, atendimento e abandono) e **delivery** (pedido, preparo, despacho, tracking e incidentes).

2) **Execution ledger persistente + replay “n8n-like”**  
   - Hoje o replay é descrito como **armazenado em memória** (ver `docs/COMO_USAR_REPLAY.md`), o que não atende operação enterprise.
   - Evoluir para histórico persistente, retenção, replay determinístico, auditoria e “node-by-node”.

3) **Queue distribuída e scheduler enterprise para execuções**  
   - Diferenciar “fila de mensagens outbound” (já existe) de **fila de execução do DAG** com workers escaláveis e prioridades.

4) **Governança do ecossistema (SDK, credenciais, permissões, marketplace)**  
   - Sem sandbox/permits e versionamento, marketplace e nodes viram risco de segurança e instabilidade.

5) **Camada analítica (funil/ROI/SLA/custos)**  
   - Sem dados analíticos consistentes, RD-like e enterprise dashboards não se sustentam.
   - Filas físicas exigem métricas próprias (espera, throughput, abandono) e correlação com CRM/jornadas.
   - Delivery exige métricas próprias (order_to_ready, order_to_deliver, cancelamentos, refunds, incidentes, custo logístico) e correlação com CRM/jornadas.

---

## 3) Mapa de capacidades por pilar (benchmarks → status → próximo passo)

Legenda de status:
- **Já existe**: evidência clara no repo/documentos.
- **Parcial**: existe parte do bloco, mas falta completar padrões enterprise.
- **Falta**: não há evidência suficiente ou está fora do escopo atual.

### 3.1) CORE / Automação (inspirado em n8n)

| Capacidade (benchmark: n8n) | Status | Evidência/Notas | Próximo passo recomendado |
|---|---|---|---|
| Runtime DAG completo | Parcial | Há flows com validação/simulação e execução; maturidade de runtime não está no nível “engine com fila/scheduler” | Separar “compile/execution”, suportar estados, timeouts, retries, idempotência por node |
| Execução por nó + histórico | Parcial | Existe replay de steps/eventos | Persistir ledger por node (inputs/outputs), correlacionar logs/métricas |
| Replay | Parcial | `GET /replay/:sessionId` documentado; replay em memória | Persistência em DB, retenção, replay parcial por node, “replay from here” |
| Queue distribuída | Falta (para DAG) | Existe `outbound_queue` para mensagens (atendimento), mas não uma fila de execução do DAG | Criar executor workers (prioridades, DLQ, escalabilidade) |
| Scheduler | Falta/Parcial | Não há evidência de scheduler tipo cron para flows (além de workers específicos) | Scheduler multi-tenant (cron/timezone), com execução garantida e auditável |
| Credentials vault | Parcial | Há credenciais de IA por tenant e criptografia; vault genérico para nodes não está explícito | Vault por conector (escopo, rotação, auditoria, permissões) |
| Versionamento de flows | Parcial | Há CRUD de flows; não há conceito explícito de versão imutável e publish/rollback | Introduzir flow versions, ambientes e promoção (dev/stage/prod) |
| Subflows | Parcial | Templates/instalação existem; subflow como bloco reutilizável parametrizado não está consolidado | Subflow como asset versionado e reusável (inputs/outputs) |
| Marketplace de nodes | Falta | Existe marketplace de templates de flow (fase 5), não de nodes/plugins | Definir SDK + registry + verificação + permissões + assinatura |
| Templates reutilizáveis | Já existe (parcialmente) | Marketplace de templates com DB + fallback legado: `docs/ARCHITECTURE_TEMPLATE_MARKETPLACE_PHASE5.md` | Evoluir: métricas de sucesso, “solution templates”, compatibilidade por versão |

### 3.2) MARKETING (inspirado em RD Station)

| Capacidade (benchmark: RD Station) | Status | Evidência/Notas | Próximo passo recomendado |
|---|---|---|---|
| Form builder | Falta | Não há evidência de forms/LP no repo | Criar forms com eventos (submissão, campos, consentimento) conectados ao Event Model |
| Landing pages | Falta | — | LP builder + domínio custom + integração com tracker e funil |
| Tracker JS (UTM + pageview) | Falta | — | SDK web (pageview/eventos), identidade (anon→known), consentimento LGPD |
| Lead scoring | Falta/Parcial | Há segmentação e tags/tickets; não há scoring de lead RD-like | Score por regras + eventos; integração com funil e jornadas |
| Jornadas | Falta | — | Orquestração omnichannel baseada em eventos (delays, janelas, supressão, holdout) |
| Email marketing | Falta | — | Envio, listas, templates, reputação, opt-in/out, métricas |
| Funil visual | Parcial | Há analytics e entidades operacionais (tickets/segmentation), mas não funil RD-like | Modelo de pipeline e conversões com atribuição e origem |
| Analytics de conversão | Parcial | Existe `analyticsService` para operação (SLA/filas), não marketing/receita | Modelo analítico por etapa, coortes, funil e receita |
| ROI | Falta | — | Atribuição, custos por canal, receita por jornada/campanha |

> Observação: existe `bulk-campaigns` e endpoints de segmentação (citados em `docs/BLIP_GAP_ANALYSIS.md`), o que pode servir como **ponto de partida**, mas ainda não cobre o “RD-like” (tracker, funil, ROI, jornadas).

### 3.3) ATENDIMENTO (inspirado em BLIP/Huggy/Zenvia/ChatPro)

| Capacidade (benchmark: BLIP/Huggy/Zenvia) | Status | Evidência/Notas | Próximo passo recomendado |
|---|---|---|---|
| Omnichannel unificado | Parcial (forte) | `channelGatewayService` + modelos `channel_*` e webhooks; persistência/idempotência por `external_message_id` | Consolidar timeline unificada e UX omnichannel (anexos, payloads, status) |
| Bot + humano | Parcial (forte) | Handover idempotente + regra “se human não responde bot”: `docs/BLIP_GAP_ANALYSIS.md` | Endurecer 1:1 conversa↔ticket e estados (bot/human) por canal |
| SLA | Parcial | Campos em ticket + métricas em analytics: `docs/ARCHITECTURE_QUEUES_ROUTING_SLA.md` | Padronizar métricas, metas por fila/departamento, alertas e auditoria |
| Filas | Parcial (forte) | Definições + routing strategy + worker: `docs/ARCHITECTURE_QUEUES_ROUTING_SLA.md` | Skill-based routing, regras por horário, capacidade por agente |
| Distribuição inteligente | Parcial | round_robin/least_busy e presença via WebSocket (best-effort) | Modelar skills, prioridades e aprendizado (IA) para roteamento |
| Histórico completo do cliente | Parcial | Há persistência de mensagens e tickets; “Customer 360” ainda fragmentado | Unificar identidade + eventos; consolidar timeline única por cliente |

**Gaps prioritários já mapeados internamente** (ver `docs/BLIP_GAP_ANALYSIS.md`):
- Unificação conversa↔ticket (1:1 consistente)
- Idempotência de mensagens no ticket (evitar duplicações por retry)
- Hardening multi-tenant em todo pipeline (especialmente webhooks e cache em memória)
- Status de entrega por mensagem integrado ao console do atendente

### 3.4) VOZ / Contact Center (inspirado em Twilio Flex / Talkdesk / Five9)

| Capacidade (benchmark: Twilio Flex/Talkdesk/Five9) | Status | Evidência/Notas | Próximo passo recomendado |
|---|---|---|---|
| Base PBX v1 (config + realtime + CDR) | Parcial (base) | Há base materializável para telefonia/CC: migrations `api/db/migrations/20260203011000-pbx-product-core.js` (camada produto), `api/db/migrations/20260203010000-pbx-realtime-core.js` (tables Asterisk realtime) e CDR (`api/db/migrations/20260204010000-pbx-cc-menu-domains.js` + compat `api/db/migrations/20260204011000-pbx-cdr-asterisk-adaptive.js`). Rotas `/api/pbx/*` em `api/server.js` e UI `frontend/src/pages/PbxLegacyPage.jsx`. | Consolidar “apply pipeline” com versionamento/auditoria e iniciar emissão de **call events** (ARI/AMI) para integrar ao Event Model. |
| Validação estrutural de fluxos de voz (kind=voice) | Parcial (MVP) | Validador `api/utils/voiceFlowValidator.js` e integração na validação de flows no `api/server.js` quando `flow.kind === 'voice'`. | Ligar ao runtime de voz/ARI e ampliar validações por node (ex.: configs obrigatórias por tipo). |
| Telefonia dentro do DAG | Falta (runtime) | Ainda não há evidência de **call events/triggers** conectados a execuções do DAG (voz como evento de primeira classe). | Definir modelo de chamada (callId, estados, eventos) e triggers/ações do DAG (ARI/AMI + Event Model). |
| URA visual | Falta | — | Editor de URA (menus, horários, roteamento) integrado ao runtime |
| Filas de voz | Falta | — | Queue de voz, skills, prioridades, SLAs, dashboards |
| Transferência | Falta | — | Warm/cold transfer, conferência, callbacks e logs |
| Gravação | Falta | — | Gravação, retenção, compliance e reprodução |
| Click-to-call | Falta | — | Discagem a partir de CRM/ticket, rastreio e auditoria |
| Eventos de chamada como triggers | Falta | — | Event model de voz (ringing/answered/hold/ended) para acionar jornadas/flows |

> Nota: o repo tem **TTS no chat de teste** (`docs/MELHORIA_VOZ_TTS.md`), que é um recurso UX de voz sintetizada — não CCaaS/telefonia.

### 3.5) IA (inspirado em LangFlow / Flowise)

| Capacidade (benchmark: LangFlow/Flowise) | Status | Evidência/Notas | Próximo passo recomendado |
|---|---|---|---|
| Nodes de IA reutilizáveis | Parcial | Há endpoints e geração/assistência; não há um “catálogo de AI nodes” com governança | Definir biblioteca de AI nodes com contratos, testes, versionamento |
| Classificação automática | Parcial | Existe base de contexto/IA e features em atendimento; não está consolidado como capability transversal | Classificar intenção/tipo de lead/ticket e alimentar roteamento/jornadas |
| Priorização | Parcial | Pode ser derivado de filas/SLA; ainda sem modelo explícito | Priorizar tickets/leads por impacto/risco/SLA e custo |
| Sugestão de ações | Parcial | Existem “sugestões”/rewrite/summarize no atendimento | Copilot por persona (agente/supervisor/marketer) com feedback e auditoria |
| Enriquecimento de dados | Parcial | RAG + tenant_context existem | Enriquecer lead/contato com fontes (site, docs, histórico) e registrar proveniência |
| Contexto unificado | Parcial (RAG forte) | RAG/pgvector e `tenant_context` bem definidos | Contexto unificado além de RAG: conversas + marketing + voz + execuções |
| Governança/observabilidade de IA | Falta/Parcial | Há auditoria geral SaaS; não há “AI observability” (custos, avaliação, safety) | Guardrails, avaliação offline/online, roteamento de modelos custo/qualidade, PII redaction |

### 3.6) SAAS / Enterprise Platform

| Capacidade (SaaS enterprise) | Status | Evidência/Notas | Próximo passo recomendado |
|---|---|---|---|
| Multi-tenant avançado | Parcial (forte) | Base SaaS completa documentada; há hardening em andamento (ver gaps BLIP) | Hierarquia (org/unidades), isolamento extremo em caches/workers/webhooks |
| Billing / planos / limites | Já existe (base) | `IMPLEMENTACAO_SAAS_COMPLETA.md` | Integrar billing externo (quando aplicável), chargeback interno, add-ons por uso |
| Auditoria | Já existe (base) | `IMPLEMENTACAO_SAAS_COMPLETA.md` + rotas de audit em `docs/BLIP_GAP_ANALYSIS.md` | Trilhas imutáveis, export enterprise, retenção e alertas |
| Dashboards executivos | Parcial | Há analytics operacionais | Consolidar KPIs executivos: ROI, eficiência, custos por canal, health |
| Templates por segmento | Parcial | Onboarding cria templates por segmento (marketplace de flows) | Evoluir para “solutions” completas (flows + dashboards + integrações) |
| Marketplace | Parcial | Marketplace de templates existe; marketplace de nodes não | Monetização, verificação, rev-share, portal de parceiros |
| APIs públicas | Parcial | Há muitas rotas internas; falta estratégia de API pública com versões/SDK | Definir API gateway, versionamento, portal dev, rate tiers |

### 3.7) FILAS FÍSICAS / FAST SERVICE (inspirado em Qminder / QLess / Waitwhile / Skiplino)

| Capacidade (benchmark: Qminder/QLess/Waitwhile/Skiplino) | Status | Evidência/Notas | Próximo passo recomendado |
|---|---|---|---|
| Emissão de senha (totem/QR/balcão) | Parcial (MVP) | Já existe implementação (DB+API+UI): migrations `api/db/migrations/20260203000004-create-physical-queues.js` e `api/db/migrations/20260203000005-create-physical-tickets.js`, endpoints públicos `/physical/*` em `api/server.js`, serviço `api/services/physicalQueueService.js` e UI `frontend/src/pages/KioskPage.jsx` (totem). Tokens públicos via `public_access_tokens`. | Endurecer idempotência, sequenciamento de `ticket_number` por unidade/fila/dia, limites anti-abuso e auditoria completa por estação. |
| Tipos de fila (serviços) e regras | Parcial (MVP) | Tabela `physical_queues` existe e há criação de fila padrão “Geral” (best-effort) em `api/services/physicalQueueService.js`. | CRUD de filas/serviços por unidade, regras por horário/capacidade e políticas de prioridade. |
| Painel de chamada (TV/display) | Parcial (MVP) | Endpoint `GET /physical/panel/state?token=...` em `api/server.js` + UI `frontend/src/pages/PanelPage.jsx`. | Modo “panel” resiliente (cache/fallback), múltiplos painéis por área e trilha auditável de exibição. |
| Estações/guichês (chamar próximo) | Parcial (MVP) | Endpoints `POST /physical/station/call-next` e `POST /physical/station/finish` em `api/server.js` + UI `frontend/src/pages/StationPage.jsx`. | Completar operações (pular/transferir/pausar/iniciar serviço) e auditoria/relatórios por estação. |
| Priorização (preferencial/agendamento/triagem) | Parcial (MVP) | Campo `priority` em `physical_tickets` + uso no kiosk (input) e ordenação no painel. | Políticas de prioridade (preferencial/agendado/triagem) e alertas de SLA físico. |
| Métricas (espera/throughput/abandono) | Falta | — | Event ledger de fila física + agregações por unidade/serviço/faixa horária |
| Integração com DAG (tudo vira node) | Falta | — | Triggers (`PhysicalTicketCreated/Called/Served/Abandoned`) e ações (`CallNext`, `UpdatePanel`, `NotifyCustomer`) no runtime |
| Integração com atendimento/voz/CRM/marketing | Falta | — | Correlação por `correlationId` (ticket físico ↔ ticket digital ↔ lead ↔ chamada ↔ jornada) |

### 3.8) DELIVERY / MARKETPLACE DE PEDIDOS (inspirado em iFood / Uber Eats / Rappi / DoorDash)

| Capacidade (benchmark: iFood/Uber Eats/Rappi/DoorDash) | Status | Evidência/Notas | Próximo passo recomendado |
|---|---|---|---|
| Criação de pedido (carrinho/itens/origem) | Parcial (MVP) | Já existe `orders` + `deliveries` (migrations `api/db/migrations/20260203000002-create-orders.js` e `api/db/migrations/20260203000003-create-deliveries.js`), serviços `api/services/orderService.js` e `api/services/deliveryService.js`, endpoints públicos `/storefront/orders` e endpoints autenticados `/orders` em `api/server.js`, além de UIs `frontend/src/pages/StorefrontOrderPage.jsx` e `frontend/src/pages/OrdersPage.jsx`. | Endurecer idempotência, validações, auditoria e contratos de eventos por status (preparar integração com Event Model). |
| Status em tempo real do pedido | Parcial (MVP) | Status existe e é consultável via `GET /storefront/orders/:id?token=...` e `GET /orders/:id` (polling no frontend). | Evoluir para ledger de eventos + notificação realtime (websocket/event bus) e correlação com atendimento/jornadas. |
| Produção/fulfillment (cozinha/expedição) | Parcial (MVP) | Operação mínima via status: cozinha (`confirmed→preparing`) em `frontend/src/pages/KitchenPage.jsx` e expedição (`ready→dispatched`) em `frontend/src/pages/DispatchPage.jsx`. | Modelar `FulfillmentJob`, filas/estações e métricas `order_to_ready` com dashboards. |
| Despacho de entregador | Parcial (MVP) | Delivery existe como entidade e há status `dispatched`/`delivered` (migrations + `deliveryService`). | Introduzir assignment (frota própria/parceiro), evidências e auditoria; base para tracking. |
| Tracking/ETA | Falta | — | Eventos de tracking + `ETAUpdated`, alertas `DeliverySLARisk` |
| Notificações e suporte | Falta | — | Integração com omnichannel/voz: incidentes, comunicação proativa e escalonamento |
| Avaliação/pós-venda | Falta | — | NPS/reviews + automações de retenção/cupom + analytics |
| SLA e custos do delivery | Falta | — | Agregações `order_to_deliver`, cancel/refund, custo logístico e impacto na margem |

---

## 4) Sequenciamento recomendado (reduz risco e acelera receita)

### 0–6 meses (destravadores)
- Event model unificado (identidade + eventos).
- Execution ledger persistente + replay enterprise (substituir replay em memória).
- Fila de execução do DAG + scheduler.
- Vault de credenciais para conectores/nodes (com RBAC e auditoria).
- Modelagem base de filas físicas (event ledger + correlação) para não virar silo à parte.
- Modelagem base de delivery (order ledger + correlação) para não virar silo à parte.

### 6–12 meses (produto vendável por “suites”)
- Marketing v1 (forms/LP/tracker/scoring/jornadas/email) para entrada de receita.
- Atendimento: fechar gaps de unificação conversa↔ticket e idempotência (BLIP-like).
- Templates por segmento como “solução” (reduzir time-to-value).
- Filas físicas v1 (totem + senha + painel + estação) integradas ao DAG e notificações omnichannel.
- Delivery v1 (pedido + preparo + despacho manual + notificações) integrados ao DAG e ao suporte.

### 12–24 meses (plataforma integrada)
- Marketplace/SDK (templates + nodes), analytics/ROI, roteamento inteligente.
- Voz v1 dentro do DAG (eventos/click-to-call/gravação inicial), quando o core estiver sólido.
- Filas físicas v2: priorização avançada, multi-unidade, dashboards e automações pós-atendimento (marketing/CRM).
- Delivery v2: tracking/ETA, incidentes, dashboards de SLA/custos e integrações com parceiros.

---

## 5) Riscos principais e mitigação

- **Histórico/replay não persistente** (risco enterprise)  
  - Mitigar com ledger persistente, retenção configurável e trilhas auditáveis.

- **Cross-tenant e inconsistências por caches/workers**  
  - Mitigar com hardening end-to-end (incluindo webhooks) e testes de isolamento por tenant.

- **Custos (tracking, IA, voz) fora de controle**  
  - Mitigar com quotas, tiering, retenção, roteamento de modelos e observabilidade de custo.

- **Marketplace como vetor de supply-chain**  
  - Mitigar com sandbox, assinatura/verificação, scanning e permissões declarativas.

---

## 6) Critérios de pronto (exemplos práticos)

- **Replay enterprise (n8n-like)**: histórico persistente por node, com inputs/outputs e correlação; replay parcial (a partir de um node) e auditoria.
- **Credentials vault**: segredos nunca retornam em APIs; rotação; escopo por tenant/flow/node; trilha de acesso.
- **Marketplace (nodes)**: pacote assinado; permissões declaradas; sandbox; compatibilidade por versão; telemetria.
- **Atendimento BLIP-like**: conversa↔ticket 1:1; idempotência no ticket; status por mensagem; roteamento por skills e SLA com alertas.
- **Filas físicas (Qminder-like)**: emissão de senha idempotente, estados claros (waiting/called/in_service/done/abandoned), auditoria por estação, painel resiliente e métricas consistentes (espera/throughput/abandono).
- **Delivery (iFood-like)**: pedido idempotente + ledger de eventos, estados consistentes, SLA mensurável (order_to_ready/order_to_deliver), incidentes integrados ao atendimento e métricas de cancel/refund/custo.
