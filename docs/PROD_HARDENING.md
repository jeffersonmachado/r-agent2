## Garantias de Produção (HARDENING)

Este documento resume as blindagens finais aplicadas para produção (modelo Blip-like), **sem mudar endpoints/UI existentes**.

### Multi-tenant (obrigatório)

- **Sem tenant default**: não existe fallback para tenant “demo” em runtime.
- **HTTP**: rotas sensíveis exigem `req.agent.tenantId` (ou retornam **401/403** quando ausente).
- **Webhooks**: `tenantId` é resolvido **somente** via `channel_accounts.external_id`. Se não resolver, o webhook é **ignorado/rejeitado** (evita cross-tenant).

### Idempotência REAL por DB (UNIQUE)

#### Índices criados via Umzug

- `channel_messages`:
  - coluna `channel_type` (backfill via `channel_conversations`, fallback `unknown` apenas para linhas órfãs)
  - **UNIQUE parcial**: \(`tenant_key`, `channel_type`, `external_message_id`\) **quando** `external_message_id IS NOT NULL`
- `outbound_queue`:
  - **UNIQUE parcial**: \(`tenant_key`, `channel_type`, `external_message_id`\) **quando** `external_message_id IS NOT NULL`

Migrations:
- `api/db/migrations/20260119000012-hardening-unique-external-message-id.js`
- `api/db/migrations/20260119000013-hardening-outbound-queue-processing-fields.js`

#### Tratamento de duplicatas

- Em ingest/persistência, violação de UNIQUE (`SequelizeUniqueConstraintError` / PostgreSQL `23505`) é tratada como **idempotente**:
  - log debug: **“Duplicate message ignored”**
  - request não falha por duplicata

### Outbound Worker cluster-safe (múltiplas instâncias)

#### Estratégia de anti-duplicação

- `outbound_queue` é processada com:
  - **transaction**
  - `SELECT ... FOR UPDATE SKIP LOCKED` (via Sequelize `lock` + `skipLocked`)
  - marca imediata de “claim” com:
    - `status = 'sending'`
    - `processing_at`
    - `processing_by` (formato `hostname:pid`)
  - envio ocorre **fora** da transação (após commit)

#### Recuperação pós-crash

- Itens presos em `status='sending'` com `processing_at` antigo são devolvidos para `pending` automaticamente.
- Timeout padrão: **2 minutos**
  - configurável via `OUTBOUND_PROCESSING_TIMEOUT_MS`

#### Flags relevantes

- `ENABLE_OUTBOUND_WORKER`
  - default: habilitado (qualquer valor diferente de `'false'`)
- `ALLOW_DIRECT_SEND_WITHOUT_DB`
  - default: **false**
  - quando `true`, permite envio “direto” mesmo sem DB (uso emergencial; **não recomendado**)

### Como rodar migrations (Umzug)

O servidor executa migrations no boot. Para rodar manualmente:

```bash
node api/db/migrate.js
```

### Checklist de deploy

- [ ] Variáveis de ambiente configuradas (DB, secrets, flags)
- [ ] Migrations aplicadas (Umzug) e sem pendências
- [ ] `channel_accounts` preenchido para todos os canais (webhook resolve tenant)
- [ ] Rodar com 2+ instâncias e confirmar ausência de duplicação no outbound
- [ ] `ALLOW_DIRECT_SEND_WITHOUT_DB` permanece **false** em produção (exceto incidente)

