# Pilares do produto (com benchmarks) — capabilities → nodes no DAG

## Visão

O produto é uma plataforma unificada orientada a **fluxos visuais (DAG)**. Cada pilar abaixo (e seus benchmarks de referência) é materializado como:

- **Nodes** (ações, triggers, transformações, integrações),
- **Eventos** (inputs/outputs padronizados),
- **Assets reutilizáveis** (subflows, templates, marketplace),
- **Operação** (SLA, auditoria, replay e analytics).

Benchmarks citados explicitamente como referências de capacidade:

- Automação: **n8n**
- Marketing: **RD Station**
- Atendimento: **BLIP / Huggy / Zenvia**
- Voz/Contact Center: **Twilio Flex / Talkdesk / Five9**
- IA: **LangFlow / Flowise**
- Filas físicas: **Qminder / QLess / Waitwhile / Skiplino**
- Delivery/Marketplace: **iFood / Uber Eats / Rappi / DoorDash**

---

## 1) Automação (inspirado em n8n)

### Capacidades esperadas (n8n-like)
- **DAG runtime**: execução determinística, estados, paralelismo, timeouts, retries.
- **Execução por nó**: inputs/outputs persistidos, métricas por node, rastreabilidade.
- **Histórico e replay**: reexecução total/parcial, debug “node-by-node”.
- **Scheduler**: cron/timezone, janelas e reprocessamento.
- **Queue distribuída**: workers, prioridades, DLQ, backpressure.
- **Credentials vault**: segredos por tenant/projeto/flow, rotação e auditoria.
- **Versionamento**: publish/rollback, ambientes (dev/stage/prod).
- **Subflows**: blocos parametrizados reutilizáveis.
- **Marketplace**: nodes e templates com governança e versionamento.

### Como vira nodes no nosso DAG

Exemplos de nodes e assets (não exaustivo):

- **Triggers**:
  - `WebhookTrigger`, `SchedulerTrigger`, `QueueEventTrigger`, `InboundMessageTrigger`, `CallEventTrigger`, `KioskTicketCreatedTrigger`
- **Integrações**:
  - `HttpRequest`, `DatabaseQuery`, `CRMUpsert`, `WhatsAppSend`, `EmailSend`, `IpabxDial`, `QueueCallNext`
- **Controle de fluxo**:
  - `If`, `Switch`, `Wait/Delay`, `RateLimit`, `RetryPolicy`, `Parallel`, `SubflowCall`
- **Dados**:
  - `Transform`, `ValidateSchema`, `Deduplicate`, `EnrichFromRAG`, `PIIMasking`

Operação “n8n-like” esperada:

- **Execução por nó** gera um registro de execução (input/output + status + duração + erros).
- **Replay** reexecuta a partir de um nó (quando possível) usando snapshots/versionamento do flow e do contexto.
- **Credenciais** são sempre referenciadas por ID/alias (nunca trafegadas em claro no flow).

---

## 2) Marketing automation (inspirado em RD Station)

### Capacidades esperadas (RD-like)
- **Aquisição**: form builder, landing pages, tracking web (UTM/pageview/eventos).
- **Gestão de leads**: identidade (anon→known), atributos, consentimento e preferências.
- **Jornadas**: regras, delays, janelas, supressão, A/B/holdout.
- **Scoring**: regras + eventos (com explicabilidade).
- **Email marketing**: templates, listas/segmentos, entregabilidade, métricas.
- **Funil e analytics**: pipeline visual, conversão por etapa/canal, coortes.
- **ROI**: atribuição (inicialmente por regras), custo por canal/jornada e receita.

### Como vira nodes no nosso DAG
- **Captação**:
  - `FormSubmitTrigger`, `LandingPageViewTrigger`, `TrackerEventTrigger`
- **Dados e segmentação**:
  - `LeadUpsert`, `LeadScoreUpdate`, `SegmentEvaluate`, `ConsentCheck`
- **Orquestração**:
  - `JourneyStart`, `JourneyStep`, `WaitWindow`, `FrequencyCap`, `SuppressionListCheck`, `ABTestSplit`
- **Canais**:
  - `EmailSend`, `WhatsAppTemplateSend`, `SMS/PushSend` (quando aplicável)
- **Medição**:
  - `ConversionEvent`, `AttributionAssign`, `ROICalcEmit`

Saídas esperadas (eventos):
- `LeadCreated/Updated`, `JourneyEntered/Exited`, `EmailDelivered/Open/Click`, `ConversionRecorded`, `RevenueAttributed`

---

## 3) Atendimento omnichannel (inspirado em BLIP / Huggy / Zenvia)

### Capacidades esperadas (BLIP/Huggy/Zenvia-like)
- **Inbox omnichannel**: WhatsApp, Instagram, Messenger, webchat e outros canais.
- **Bot + humano**: handover, regras de prioridade e contenção de bot.
- **Filas e SLA**: roteamento, priorização, metas e monitoramento.
- **Distribuição inteligente**: round-robin/least-busy → skill-based routing.
- **Histórico completo**: timeline do cliente unificando mensagens, tickets e eventos.

### Como vira nodes no nosso DAG
- **Triggers**:
  - `InboundMessageTrigger(channel=...)`, `TicketCreatedTrigger`, `SLAThresholdTrigger`
- **Operação humana**:
  - `AssignAgent`, `ChangeQueue`, `SetSLA`, `RequestHandover`, `CloseTicket`
- **Bot/IA aplicada ao atendimento**:
  - `IntentClassify`, `SummarizeConversation`, `SuggestReply`, `AutoTagCategory`
- **Integrações**:
  - `CRMUpsert`, `KnowledgeQuery(RAG)`, `WebhookNotify`

Saídas esperadas (eventos):
- `ConversationCreated`, `MessageReceived/Sent`, `TicketAssigned`, `SLAAtRisk`, `TicketClosed`

---

## 4) Voz / Contact Center (inspirado em Twilio Flex / Talkdesk / Five9)

### Capacidades esperadas (CCaaS-like)
- **Telefonia dentro do DAG**: chamadas como eventos e ações.
- **URA visual**: menus, horários, roteamento e fallback.
- **Filas de voz**: prioridades, skills, SLAs, transbordo.
- **Transferência**: warm/cold transfer, conferência, callback.
- **Gravação**: retenção, compliance, reprodução e auditoria.
- **Click-to-call**: do CRM/ticket para discagem rastreada.

### Como vira nodes no nosso DAG
- **Triggers (eventos de chamada)**:
  - `CallRingingTrigger`, `CallAnsweredTrigger`, `CallEndedTrigger`, `CallDTMFTrigger`
- **Ações de voz**:
  - `Dial`, `PlayTTS`, `PlayAudio`, `CollectDTMF`, `EnqueueCall`, `TransferCall`, `RecordCall`
- **Integração operacional**:
  - `CreateTicketFromCall`, `LinkCallToCustomer`, `DispositionCodeSet`

Saídas esperadas (eventos):
- `CallCreated`, `CallQueued`, `CallTransferred`, `CallRecorded`, `CallOutcome`

> Nota: a integração existente com **r-IPABX** é tratada como “provider de voz” (adaptador) e deve emitir/consumir esses eventos de forma padronizada.

---

## 5) Orquestração de IA (inspirado em LangFlow / Flowise)

### Capacidades esperadas (LangFlow/Flowise-like)
- **Nodes de IA reutilizáveis**: prompts/chain/tools versionados.
- **Classificação e roteamento**: intenção, sentimento, prioridade, risco de SLA.
- **Sugestão de ações**: copilot por persona (agente, supervisor, marketer).
- **Enriquecimento**: extração estruturada + validação + proveniência.
- **Contexto unificado**: Customer 360 + histórico + RAG + políticas.
- **Governança**: auditoria, custo por execução, avaliação, PII redaction.

### Como vira nodes no nosso DAG
- `LLMCall`, `ToolCall`, `RAGQuery`, `ExtractToSchema`, `Classify`, `Summarize`, `ActionSuggest`
- Nodes “enterprise”:
  - `PolicyGate` (segurança/compliance), `PIIRedact`, `EvalAndScore`, `ModelRouter`

Saídas esperadas (eventos):
- `AIClassification`, `AISuggestion`, `AIEnrichment`, `AICostRecorded`, `AIPolicyViolation`

---

## 6) Filas físicas / Fast service (inspirado em Qminder / QLess / Waitwhile / Skiplino)

### Capacidades esperadas (fast service/queue management)
- **Emissão de senha**: totem/kiosk, QR, ou balcão; impressão/opcional.
- **Tipos de fila**: por serviço (ex.: retirada, drive-thru, triagem, consulta, caixa).
- **Priorização**: preferencial, agendamento, triagem, SLA físico (p.ex. 10 min).
- **Painel de chamada**: TV/display, áudio, múltiplos pontos/guichês.
- **Estações**: guichê/atendente “chamar próximo”, pausar, transferir, finalizar.
- **Métricas**: tempo de espera, throughput, abandono, picos, produtividade por estação.
- **Integração com fluxos**: atendimento físico disparando automações (CRM, marketing, voz, omnichannel).

### Como vira nodes no nosso DAG
- **Triggers (mundo físico → eventos)**:
  - `KioskTicketCreatedTrigger`, `QueueJoinedTrigger`, `QueueAbandonedTrigger`, `TicketCalledTrigger`, `ServiceStartedTrigger`, `ServiceCompletedTrigger`
- **Ações (DAG → operação física)**:
  - `CreatePhysicalTicket`, `CallNextTicket`, `TransferTicket`, `SetPriority`, `UpdateDisplayPanel`, `NotifyCustomer(WhatsApp/SMS)`
- **Integrações**:
  - `SyncAppointment`, `LinkToCRMContact`, `IssueCouponAfterService`

Saídas esperadas (eventos):
- `PhysicalTicketCreated`, `PhysicalTicketWaiting`, `PhysicalTicketCalled`, `PhysicalTicketServed`, `PhysicalQueueMetrics`

---

## 7) Delivery / Marketplace de pedidos (inspirado em iFood / Uber Eats / Rappi / DoorDash)

### Capacidades esperadas (order lifecycle + logística)
- **Criação de pedido**: carrinho/itens/observações, origem (app, balcão, WhatsApp), pagamento (quando aplicável).
- **Status em tempo real**: pedido criado/confirmado/preparando/pronto/despachado/entregue + cancelamentos.
- **Produção/fulfillment**: fila de preparo, expedição, batching e “handoff” interno.
- **Despacho de entregador**: próprio ou parceiro; assignment, ocorrências e proof-of-delivery.
- **Tracking**: status e ETA; eventos de logística.
- **Notificações**: WhatsApp/SMS/push/email; comunicação proativa de atrasos.
- **Avaliação e pós-venda**: NPS, reviews, cupons, reentrega/reembolso (quando aplicável).
- **SLA de entrega**: `order_to_ready`, `ready_to_dispatch`, `dispatch_to_deliver`, `order_to_deliver`.

### Como vira nodes no nosso DAG
- **Triggers**:
  - `OrderCreatedTrigger`, `OrderStatusChangedTrigger`, `CourierAssignedTrigger`, `DeliverySLARiskTrigger`, `SupportIncidentTrigger`
- **Pedido e produção**:
  - `CreateOrder`, `ConfirmOrder`, `EnqueueKitchenJob`, `UpdateKitchenStatus`, `CancelOrder`
- **Logística**:
  - `DispatchCourier`, `UpdateCourierStatus`, `RequestProofOfDelivery`, `ComputeETA`
- **Comunicação e suporte**:
  - `NotifyCustomer(WhatsApp/SMS/Push)`, `OpenSupportTicket`, `EscalateToVoice`
- **CRM/Marketing**:
  - `CRMUpsert`, `JourneyStart`, `CouponIssue`, `FeedbackRequest`, `LeadScoreUpdate`
- **IA aplicada**:
  - `ClassifyIncident`, `SuggestCompensation`, `PredictDelayRisk`

Saídas esperadas (eventos):
- `OrderCreated/Confirmed/Preparing/Ready/Dispatched/Delivered`
- `DeliveryETAUpdated`, `DeliverySLARisk`, `OrderCancelled`, `RefundIssued`

---

## 7) Cross-cutting (enterprise SaaS)

Independentemente do pilar, a plataforma precisa manter consistência enterprise:

- **Multi-tenant**: isolamento por tenant em dados, caches, workers e webhooks.
- **RBAC e auditoria**: trilhas de ações relevantes (flows, credenciais, operações, atendimento, fila física).
- **Observabilidade**: métricas e logs correlacionados por execução/cliente/ticket/chamada/senha.
- **Custos previsíveis**: limites por tenant e pricing por uso (execuções, eventos, seats, minutos, IA).

