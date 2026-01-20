## Operação em Produção (Hardening)

Este documento descreve os requisitos operacionais para executar o `r-agent2` com segurança em produção, com foco em **multi-tenant** e em evitar **fallbacks perigosos**.

### Cadastro de `channel_accounts` (WhatsApp: `phone_number_id` -> tenant)

O webhook do WhatsApp **não é autenticado por tenant**. Portanto, o sistema resolve o `tenantId` a partir do mapeamento de `channel_accounts.external_id`.

- **Tabela/modelo**: `channel_accounts`
- **Campos relevantes**:
  - **`type`**: `'whatsapp'`
  - **`external_id`**: `phone_number_id` do WhatsApp Cloud API (ex.: `123456789012345`)
  - **`tenant_key`**: identificador do tenant (ex.: `tenant-1`)
  - **`status`**: `'active'`

**Comportamento em produção (importante)**:
- Se o `phone_number_id` recebido no webhook **não estiver cadastrado/ativo**, o sistema retorna `tenantId=null` e o webhook é **ignorado com `warn`**.
- **Não roda engine** e **não cria ticket** sem tenant resolvido.

### Outbound Queue e Worker

O envio outbound é **DB-first** (fila no banco) para garantir:
- auditabilidade,
- retry/backoff,
- status tracking.

#### Flags

- **`ENABLE_OUTBOUND_WORKER`**
  - **`true`**: habilita o worker que processa itens pendentes/failed na fila.
  - **`false`** (ou não definido): a API pode enfileirar, mas nada será enviado automaticamente.

- **`ALLOW_DIRECT_SEND_WITHOUT_DB`**
  - **`true`**: permite “envio direto” quando o DB está indisponível (sem persistência/retry).
  - **Padrão**: **desabilitado**.
  - **Em produção**: quando o DB está indisponível e essa flag **não** está habilitada, `enqueueOutbound` falha com **`db_unavailable_no_direct_send`**.

### Checklist de Deploy (produção)

- **Banco de dados**
  - Rodar migrations/seed (quando aplicável).
  - Garantir conectividade/credenciais e healthcheck do DB antes de expor a API.

- **Multi-tenant**
  - Cadastrar `channel_accounts` para cada número do WhatsApp:
    - `type='whatsapp'`
    - `external_id=<phone_number_id>`
    - `tenant_key=<tenant>`
    - `status='active'`

- **Outbound**
  - Definir `ENABLE_OUTBOUND_WORKER=true` em produção (recomendado).
  - **Não** habilitar `ALLOW_DIRECT_SEND_WITHOUT_DB` por padrão.
  - Ter runbook/alerta para `db_unavailable_no_direct_send` (indica indisponibilidade do DB e envio bloqueado).

- **Observabilidade**
  - Monitorar logs `warn` de:
    - webhook ignorado por `tenant` não resolvido (sinal de `phone_number_id` não cadastrado/errado)
    - worker não iniciado por DB indisponível

