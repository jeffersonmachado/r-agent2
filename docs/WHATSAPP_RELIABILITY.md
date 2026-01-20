## WHATSAPP_RELIABILITY — Confiabilidade operacional (idempotência, retries, janela 24h)

Este documento descreve o comportamento do `r-agent2` para operar WhatsApp em ambiente real: **sem duplicação**, com **retries**, **status de entrega** e **fallback** quando a janela de 24h expira.

### 1) Idempotência inbound (webhook)

- A persistência omnichannel usa `channel_messages.external_message_id`.
- Regra:
  - se a mensagem já foi persistida (idempotente), o sistema **não** cria ticket novamente e **não** roda engine novamente.
- Implementação:
  - `channelGatewayService.ingestIncoming(...).persist.idempotent === true` → o `api/server.js` faz `continue` (hard gate).

### 2) Outbound resiliente (fila + retry/backoff)

- Saída vai para `outbound_queue` (`OutboundQueueItem`), com:
  - `attempts`, `next_attempt_at`, `last_error`, `processing_at/processing_by` (cluster-safe)
  - `reason_code` (classificação operacional do erro)
- Worker:
  - `outboundQueueService.processDue()` faz claim com lock + skipLocked e aplica backoff exponencial com jitter.

### 3) Status de entrega (sent/delivered/read/failed)

- Webhook da Meta pode enviar `value.statuses` com:
  - `sent|delivered|read|failed`
- Implementação:
  - `channelGatewayService.updateStatus('whatsapp', { value })` atualiza `channel_messages.status` e propaga para:
    - `outbound_queue.status` (quando correla por `external_message_id`)
    - ledger do ticket (`updateOutboundMessageMeta`) para a UI mostrar ✓/✓✓/lido/!

### 4) Janela 24h e fallback para template

- Quando a Meta rejeita envio de texto por estar fora da janela, o erro é classificado como:
  - `reason_code = outside_window_24h`
- Comportamento:
  - o outbound do texto é marcado como `failed` com `reason_code`
  - o sistema tenta enfileirar um **template** automaticamente (best-effort)
- Configuração:
  - `WHATSAPP_FALLBACK_TEMPLATE_NAME` (env) — nome do template a usar
  - fallback default: `hello_world`

### 5) Operação: como investigar falhas

- Por ticket:
  - UI → botão **“Falhas de entrega”**
  - API → `GET /tickets/:id/delivery-failures`
- Por tenant:
  - `GET /system/channel-health` (inclui contagem de pending/failed e últimos erros)

