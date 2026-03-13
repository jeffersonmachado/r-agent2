# Casos de uso (end-to-end) — Totem/Fila/Pedido → DAG → Atendimento/Voz → CRM → Marketing → Delivery

## Visão

Os casos de uso abaixo demonstram como a plataforma unificada conecta os sete pilares (com benchmarks explícitos):

- **Automação (n8n)**: DAG orquestra tudo
- **Marketing (RD Station)**: jornadas, funil e ROI
- **Atendimento (BLIP/Huggy/Zenvia)**: omnichannel bot+humano e SLA
- **Voz (Twilio Flex/Talkdesk/Five9)**: URA, filas e eventos de chamada
- **IA (LangFlow/Flowise)**: classificação, priorização e sugestão
- **Filas físicas (Qminder/Waitwhile/QLess/Skiplino)**: totem, senha, painel e métricas
- **Delivery (iFood/Uber Eats/Rappi/DoorDash)**: pedido, preparo, despacho, tracking e SLA

---

## 1) Restaurante / pizzaria (balcão + delivery próprio)

### Jornada
1. Pedido entra por **WhatsApp**, site, balcão ou app próprio.
2. O **DAG** cria/atualiza o pedido e inicia **produção (cozinha)** com fila de preparo.
3. Quando estiver pronto, o fluxo dispara:
   - despacho (entregador próprio ou parceiro),
   - tracking/ETA,
   - comunicação proativa com o cliente (atrasos/ocorrências),
   - pós-venda (avaliação, cupom, reengajamento).

### Nodes típicos
- `InboundMessageTrigger` (WhatsApp) / `OrderCreatedTrigger`
- `CreateOrder` / `ConfirmOrder`
- `EnqueueKitchenJob` / `UpdateKitchenStatus`
- `DispatchCourier` / `UpdateCourierStatus` / `ComputeETA`
- `NotifyCustomer(WhatsApp/SMS/Push)`
- `OpenSupportTicket` / `EscalateToVoice`
- `FeedbackRequest` / `CouponIssue` / `JourneyStart`

### Métricas/KPIs
- `order_to_ready`, `order_to_deliver`, cancelamentos/refunds (quando aplicável), incidentes, avaliação/NPS, custo logístico.

---

## 2) Fastfood com totem (balcão + retirada + delivery)

### Jornada
1. Cliente entra e usa o **totem** para selecionar “Retirada” ou “Balcão”.
2. O sistema emite **senha** e entra na **fila física** (com prioridade se aplicável).
3. Em paralelo, pedidos podem entrar por delivery (app/WhatsApp) e alimentam a fila de produção.
4. O **DAG** dispara automações:
   - registrar atendimento no CRM,
   - avisar o cliente por WhatsApp quando estiver próximo,
   - atualizar painel de chamada,
   - após finalizar, enviar cupom e iniciar jornada de retorno.

### Nodes típicos
- `KioskTicketCreatedTrigger`
- `SetPhysicalTicketPriority`
- `UpdatePanelDisplay`
- `NotifyCustomer(WhatsApp)`
- `CreateOrUpdateCRMContact`
- `CreatePostServiceJourney`

### Métricas/KPIs
- tempo médio de espera, throughput, abandono, tempo por estação, NPS pós-atendimento.

---

## 3) Clínicas (triagem + agendamento + retorno)

### Jornada
1. Check-in no totem (ou QR) confirma agendamento.
2. IA faz **triagem** (quando aplicável) e ajusta fila/prioridade.
3. Chamada em painel + atendimento.
4. DAG registra desfecho e dispara:
   - lembrete de retorno,
   - pesquisa de satisfação,
   - reengajamento em caso de abandono.

### Nodes típicos
- `KioskTicketCreatedTrigger`
- `ConsentCheck`
- `Classify` (triagem)
- `TransferPhysicalTicket`
- `ServiceCompletedTrigger`
- `EmailSend` / `WhatsAppSend`

### Métricas/KPIs
- aderência a horários, taxa de no-show, SLA físico, taxa de retorno, satisfação.

---

## 4) Academias (check-in, fila e upsell)

### Jornada
1. Check-in no totem/QR.
2. Se a unidade estiver cheia, entra em fila física (capacidade).
3. DAG atualiza CRM e segmenta:
   - recorrência, preferências, churn risk.
4. Marketing dispara jornada de upsell (planos) e retenção.

### Nodes típicos
- `QueueJoinedTrigger`
- `CRMUpsert`
- `LeadScoreUpdate`
- `JourneyStart`

---

## 5) Vendas (lead → qualificação → atendimento → conversão)

### Jornada
1. Lead entra via form/landing (RD-like).
2. Tracker JS registra comportamento e scoring.
3. DAG roteia para atendimento omnichannel (BLIP-like) e/ou discagem (voz).
4. Conversão atualiza funil e ROI.

### Nodes típicos
- `FormSubmitTrigger`
- `TrackerEventTrigger`
- `LeadScoreUpdate`
- `AssignAgent`
- `Dial` / `ClickToCall`
- `ConversionEvent` + `AttributionAssign`

---

## 6) Atendimento corporativo (SLA + voice escalation)

### Jornada
1. Mensagem inbound cria ticket/conversa.
2. IA classifica e prioriza por SLA/impacto.
3. Se necessário, escalona para voz (call back) e registra gravação.
4. Fechamento alimenta base e dashboards.

### Nodes típicos
- `InboundMessageTrigger`
- `IntentClassify`
- `SLAThresholdTrigger`
- `CreateTicketFromCall`
- `RecordCall`
- `SummarizeConversation`

---

## Padrão recomendável para templates por segmento (Solutions)

Cada caso de uso deve ser empacotado como uma “solução”:
- **Templates de flows** (DAG)
- **Templates de filas físicas** (serviços, prioridades, painéis)
- **Templates de delivery** (pedido, preparo, despacho, tracking)
- **Dashboards** (SLA físico + SLA digital + SLA delivery + ROI)
- **Integrações** (CRM, canais, voz)

