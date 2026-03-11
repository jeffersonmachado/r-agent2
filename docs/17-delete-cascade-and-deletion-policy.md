# Delete, Cascade and Deletion Policy

Este documento formaliza como o projeto deve usar:

- `ON DELETE CASCADE`
- `ON DELETE SET NULL`
- exclusão dirigida por serviço de domínio

O objetivo é evitar dois erros comuns:

- depender de `CASCADE` para regras de negócio
- implementar purge, delete lógico ou cleanup diretamente na rota HTTP

## Regra principal

No `r-agent2`, `CASCADE` é mecanismo de integridade relacional, não política canônica de exclusão de domínio.

A política de exclusão deve continuar sendo decidida por:

- serviço de domínio
- purge service
- delete handler
- storage/file service

## Hierarquia de decisão

1. Se a relação é técnica, estrita e sem valor histórico, preferir `ON DELETE CASCADE`
2. Se a relação é de auditoria, trilha ou histórico, preferir `ON DELETE SET NULL`
3. Se a exclusão precisa preservar semântica operacional, auditoria, outcomes, eventos ou cleanup transversal, usar exclusão dirigida por serviço
4. Se o recurso é multitenant por `tenant_key`, não assumir que `CASCADE` resolve purge

## Matriz canônica

| Tipo de relação | Estratégia recomendada |
| --- | --- |
| Join table pura | `ON DELETE CASCADE` |
| Configuração filha sem vida própria | `ON DELETE CASCADE` |
| Artefato binário/derivado de um registro pai | `ON DELETE CASCADE` |
| Trilha de auditoria | `ON DELETE SET NULL` |
| Histórico operacional | Serviço canônico + soft delete, deactivate ou purge controlado |
| Dados multitenant por `tenant_key` | Purge service explícito |
| Artefato em filesystem | File/storage service |
| Delete com webhook, evento ou cleanup adicional | Delete handler dedicado |

## Relações onde `CASCADE` deve ser mantido

Estas relações já estão corretas e devem continuar assim:

- `tenant_users.tenant_id -> tenants.id`
- `tenant_users.user_id -> users.id`
- `tenant_settings.tenant_id -> tenants.id`
- `tenant_ai_settings.tenant_id -> tenants.id`
- `tenant_ai_credentials.tenant_id -> tenants.id`
- `sessions.user_id -> users.id`
- `rag_document_files.document_id -> rag_documents.id`
- `rag_chunks.document_id -> rag_documents.id`
- `crm_user_roles.role_id -> crm_roles.id`
- `crm_webhook_queue.webhook_id -> crm_webhooks.id`

Referências:

- [`20250111000003-create-tenant-users.js`](/opt/results/ria/r-agent2/api/db/migrations/20250111000003-create-tenant-users.js)
- [`20250111000004-create-tenant-settings.js`](/opt/results/ria/r-agent2/api/db/migrations/20250111000004-create-tenant-settings.js)
- [`20250111000005-create-tenant-ai-settings.js`](/opt/results/ria/r-agent2/api/db/migrations/20250111000005-create-tenant-ai-settings.js)
- [`20250111000006-create-tenant-ai-credentials.js`](/opt/results/ria/r-agent2/api/db/migrations/20250111000006-create-tenant-ai-credentials.js)
- [`20250111000010-create-sessions.js`](/opt/results/ria/r-agent2/api/db/migrations/20250111000010-create-sessions.js)
- [`20260122000002-create-rag-document-files.js`](/opt/results/ria/r-agent2/api/db/migrations/20260122000002-create-rag-document-files.js)
- [`20260122000003-enable-pgvector-and-create-rag-chunks.js`](/opt/results/ria/r-agent2/api/db/migrations/20260122000003-enable-pgvector-and-create-rag-chunks.js)
- [`20260221020000-crm-rbac-security.js`](/opt/results/ria/r-agent2/api/db/migrations/20260221020000-crm-rbac-security.js)
- [`20260221030000-crm-webhooks-integrations.js`](/opt/results/ria/r-agent2/api/db/migrations/20260221030000-crm-webhooks-integrations.js)

## Relações onde `SET NULL` deve ser mantido

Estas relações preservam histórico e não devem apagar trilha:

- `audit_logs.tenant_id -> tenants.id`
- `audit_logs.actor_user_id -> users.id`

Referência:

- [`20250111000007-create-audit-logs.js`](/opt/results/ria/r-agent2/api/db/migrations/20250111000007-create-audit-logs.js)

## Relações candidatas para adicionar `CASCADE`

Estes são os melhores candidatos reais para evoluir o schema:

### 1. `autonomous_gap_candidates.campaign_id -> autonomous_gap_campaigns.id`

Referência:

- [`20260306010000-create-autonomous-scheduling-core.js`](/opt/results/ria/r-agent2/api/db/migrations/20260306010000-create-autonomous-scheduling-core.js)

Justificativa:

- o candidato é filho direto da campanha
- não faz sentido manter candidato sem campanha
- reduz órfãos no domínio de autonomous scheduling

### 2. `pbx_queue_members.queue_id -> pbx_queues.id`

Referência:

- [`20260203011000-pbx-product-core.js`](/opt/results/ria/r-agent2/api/db/migrations/20260203011000-pbx-product-core.js)

Justificativa:

- membro de fila é dependência direta da fila
- não deve sobreviver à exclusão da fila

## Relações onde não se deve depender de `CASCADE`

### 1. Purge de tenant

Não depender de FK para limpar:

- `crm_*`
- `operational_*`
- `pbx_*`
- `fitness_*`
- `beauty_*`
- `queues`, `tickets`, `flows`, `channel_*`
- `autonomous_*`

Motivo:

- a base é híbrida entre `tenant_key`, `tenant_id` string e `tenant_id` UUID
- purge completo precisa serviço canônico

O fluxo atual correto é:

- `DELETE /tenants/:id` -> `tenantPurgeService`

### 2. Estado operacional e histórico

Evitar `CASCADE` silencioso em:

- `operational_schedules`
- `schedule_blocks`
- `schedule_reminders`
- `operational_signals`
- `operational_recommendations`
- `operational_outcomes`
- `operational_playbook_executions`

Motivo:

- esses dados fazem parte de observabilidade, auditoria ou memória operacional

### 3. CRM operacional principal

Evitar modelar exclusão de domínio só por cascade em:

- `crm_accounts`
- `crm_contacts`
- `crm_leads`
- `crm_opportunities`
- `crm_activities`
- `crm_events`

Motivo:

- são entidades operacionais vivas
- exclusão depende de política de domínio

### 4. Fitness / Beauty / Scheduling

Evitar `CASCADE` automático em cadeias de histórico como:

- `fitness_class_schedules`
- `fitness_attendance`
- `fitness_checkins`
- `fitness_schedule_professionals`
- `fitness_schedule_resources`
- `beauty_schedule_professionals`
- `beauty_schedule_services`

Referências:

- [`20260307003000-create-fitness-core.js`](/opt/results/ria/r-agent2/api/db/migrations/20260307003000-create-fitness-core.js)
- [`20260307013000-expand-beauty-fitness-operations.js`](/opt/results/ria/r-agent2/api/db/migrations/20260307013000-expand-beauty-fitness-operations.js)
- [`20260307021000-add-fitness-schedule-relations.js`](/opt/results/ria/r-agent2/api/db/migrations/20260307021000-add-fitness-schedule-relations.js)
- [`20260307030000-add-beauty-schedule-relations.js`](/opt/results/ria/r-agent2/api/db/migrations/20260307030000-add-beauty-schedule-relations.js)

Motivo:

- esses dados normalmente precisam histórico, desativação ou cleanup controlado

## Como isso se conecta ao padrão de rotas DELETE

Na borda HTTP:

- a rota valida autenticação, permissão e identificadores
- a rota delega para serviço ou handler canônico
- a rota não deve depender da existência de `CASCADE` para definir o comportamento funcional

Exemplos canônicos já adotados:

- `tenantPurgeService`
- `schedulingService.deleteBlock()`
- `flowDeleteHandler`
- `rpaReplayService`

## Próximas evoluções recomendadas

1. adicionar FK com `ON DELETE CASCADE` para `autonomous_gap_candidates.campaign_id`
2. adicionar FK com `ON DELETE CASCADE` para `pbx_queue_members.queue_id`
3. manter purge de tenant dirigido por serviço
4. não tentar converter tabelas `tenant_key` para purge por cascade como atalho

## Documentos relacionados

- [`04-api-and-services.md`](/opt/results/ria/r-agent2/docs/04-api-and-services.md)
- [`04-architecture-overview.md`](/opt/results/ria/r-agent2/docs/04-architecture-overview.md)
- [`15-how-to-align-code-with-architecture.md`](/opt/results/ria/r-agent2/docs/15-how-to-align-code-with-architecture.md)
