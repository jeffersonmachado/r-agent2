# Operação “Blip-style” — Checklist (r-agent2)

Este guia é um checklist prático para operar o `r-agent2` com robustez e previsibilidade (multi-tenant, WhatsApp Cloud, tickets/filas, handover, SLA, observabilidade).

## 1) Pré-requisitos

- **Banco (PostgreSQL)**: obrigatório.
- **Migrations (Umzug)**: executadas no boot da API.
- **Credenciais por tenant**:
  - **Canais** (WhatsApp/Instagram) em `channel_accounts` (recomendado para produção).
  - **IA** (se aplicável) via configuração do tenant.

## 2) Inicialização e Healthchecks

- **API**:
  - `GET /health/live` deve retornar 200 sempre (processo vivo).
  - `GET /health/db` deve retornar 200 quando DB está ok e listar migrations.
  - `GET /health/ready` deve retornar 200 apenas quando **DB ok e sem migrations pendentes**.

## 3) Multi-tenant (hardening)

- **Regras**:
  - Toda operação autenticada deve usar `req.tenantId`.
  - Ticket e dados persistidos devem ser filtrados por `tenant_key`.
  - Evitar qualquer acesso cross-tenant (403).

- **Webhooks**:
  - Webhooks são não autenticados. Produção deve ter `channel_accounts` configurado para resolver `tenantId` de forma segura.
  - Acompanhe dados de tentativas de fallback e **bloqueie** por política de rollout quando necessário (não existe tenant default em produção).

## 4) WhatsApp Cloud — fluxo recomendado

- **Inbound**:
  - Webhook recebe mensagens (`POST /webhooks/whatsapp`).
  - Persistência omnichannel em `channel_messages` (idempotente por `external_message_id`).
  - Se existir ticket em `mode=human`, o bot não responde automaticamente.

- **Outbound** (robustez):
  - Envio de texto deve ir para `outbound_queue` (retry/backoff).
  - Worker processa itens pendentes e persiste outbound em `channel_messages`.
  - Status `sent/delivered/read/failed` deve ser atualizado via webhook e refletido na UI (best-effort).

## 5) Worker de outbound

- **Configuração**:
  - Habilitado por padrão.
  - Pode ser desabilitado com `ENABLE_OUTBOUND_WORKER=false` (não recomendado em produção).

- **Sinais de problema**:
  - backlog crescente (`pending` alto) ou `dueNow` alto indica falha de envio ou worker não rodando.
  - muitos `failed` indica credenciais inválidas ou instabilidade de rede/API.

## 6) Handover bot ↔ humano

- **Expectativa**:
  - `mode=human`: bloquear respostas automáticas do bot; operador responde.
  - `mode=bot`: bot responde; operador pode observar.

- **Operação**:
  - Botões na tela de atendimento: “Assumir atendimento” / “Devolver ao bot”.
  - Auditoria/linha do tempo deve registrar eventos de handover.

## 7) SLA e métricas operacionais

- **Definições**:
  - **TME**: tempo até primeira resposta do agente.
  - **TMA**: tempo de atendimento até encerramento.
  - **Contenção**: % de conversas que não viraram ticket (best-effort via `channel_conversations.current_ticket_id`).

- **Boas práticas**:
  - medir por tenant e por fila/agente.
  - usar os cards do dashboard/analytics para acompanhar tendências.

## 8) Observabilidade (Channel Health)

- **Backend**:
  - `GET /system/channel-health` deve retornar:
    - totais da fila outbound (`pending`, `dueNow`, `oldestPendingSeconds`)
    - taxa de falhas em janela (padrão 10 min)
    - status geral por canal

- **Frontend**:
  - Página: `/channel-health` (cards por canal + alertas).

## 9) Troubleshooting rápido

- **Mensagens não chegam**:
  - Verifique credenciais do canal e `channel_accounts` ativo.
  - Verifique backlog e falhas em `/channel-health`.
  - Verifique logs do worker outbound (erros e retries).

- **Mensagens duplicadas**:
  - Confirmar idempotência por `external_message_id` em `channel_messages`.
  - Confirmar idempotência no ledger do ticket (mensagens com `externalMessageId` não duplicam).

- **Bot respondendo durante humano**:
  - Verifique `ticket.mode` e histórico de handover.
  - Verifique se o webhook/engine está respeitando `mode=human`.

