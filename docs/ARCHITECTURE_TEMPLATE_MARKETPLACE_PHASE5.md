## Fase 5 — Template Marketplace (Flow Templates)

Objetivo: disponibilizar uma **biblioteca de templates de fluxo** com:
- **templates globais** (catálogo padrão)
- **templates por tenant**
- **tags** para busca/descoberta
- **preview** e **instalação** (criar um flow a partir do template)

### Compatibilidade

- O endpoint legado `GET /templates` (arquivos em `frontend/public/templates`) **permanece funcionando**.
- O novo marketplace usa banco (`flow_templates`) e endpoints `GET/POST /flow-templates`.
- O frontend tenta usar o marketplace e faz **fallback** para o legado se necessário.

### Modelo de dados (PostgreSQL)

Tabela `flow_templates` (tenant_key-based):
- `id` (PK)
- `tenant_key` (string)
  - `system` = template global
  - `<tenantId>` = template do tenant
- `name`, `description`, `icon`
- `tags` (JSONB array)
- `flow` (JSONB)
- `active` (bool)
- `created_by`, `created_at`, `updated_at`

Migration:
- `api/db/migrations/20260119000010-create-flow-templates.js`

Model:
- `api/db/models/FlowTemplate.js`

### Service

`api/services/flowTemplateMarketplaceService.js`
- Mantém **cache em memória** (`Map`) para leitura rápida.
- `initialize()`: carrega do DB e faz **seed best-effort** de 10 templates globais (catálogo “Blip-like”) lendo arquivos existentes em `frontend/public/templates`.
  - O seed é **idempotente (upsert)**: garante que os 10 templates padrão existam mesmo após upgrades.
- `listTemplates({ tenantId, tag, q, scope })`: retorna listagem sem o campo `flow`.
- `getTemplate({ tenantId, id })`: retorna template completo (inclui `flow`) respeitando isolamento tenant.
- `createTemplate({ tenantId, ... })`: cria template do tenant com validação (`validateFlow`).
- `deleteTemplate({ tenantId, id })`: remove apenas templates do tenant (não remove globais).

### Endpoints

Marketplace (DB):
- `GET /flow-templates`
  - query: `scope=all|global|tenant`, `tag=<tag>`, `q=<texto>`, `activeOnly=true|false`
  - retorna `{ templates: [...] }`
- `GET /flow-templates/:id`
  - retorna template completo (inclui `flow`)
- `POST /flow-templates`
  - cria template do tenant (body inclui `flow`)
- `DELETE /flow-templates/:id`
  - remove template do tenant (bloqueia globais)
- `POST /flow-templates/:id/install`
  - cria e persiste um **flow** a partir do template (body: `{ id?, name? }`)

Legado (arquivos):
- `GET /templates`
- `GET /templates/:id`
- `POST /templates`
- `DELETE /templates/:id`

### Onboarding + Segmento

O endpoint `POST /onboarding/create-templates` aceita body opcional:

- `{ "segment": "ecommerce" | "varejo" | "servicos" | "saude" | "educacao" | "financeiro" | "cobranca" | "academia" }`

E cria (best-effort) templates de fluxo **do tenant** no marketplace a partir do catálogo global, adicionando tags:
- `onboarding`
- `segment:<segment>`

### Frontend (FlowTemplateSelector)

Arquivos:
- `frontend/src/templates/flowTemplates.js`: carrega via marketplace e faz fallback para o legado.
- `frontend/src/components/FlowTemplateSelector.jsx`:
  - **busca por texto**
  - **filtro por tags**
  - preview básico (tags + contagem de nós)
  - botão "Criar Fluxo" chama instalação via backend (`/flow-templates/:id/install`) e faz fallback local se necessário.

