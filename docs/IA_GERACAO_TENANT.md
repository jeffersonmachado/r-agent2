## Geração de Tenant por IA — ultra-segura (multi-tenant)

### Endpoint existente

- `POST /tenants/generate-by-ai`
  - gera `tenantDraft` em safe-mode + `envelope` (obrigatório)
  - opcional: `create=true` cria o tenant em `pending_review` (NUNCA ativa automaticamente)

### Contratos e validação

- Contrato travado: `contracts/tenant.contract.json` (`additionalProperties=false`)
- Safe-mode / semântica:
  - `status = "pending_review"`
  - `externalIntegrationsEnabled=false` e `webScrapingEnabled=false`
  - proíbe campos sensíveis (tokens, api keys, secrets)
  - `tenant_key` (slug) seguro e único

Implementação:

- Validação e draft: `api/services/tenantAiDraft.js`
- Envelope: `engine/ai/aiEnvelope.js`
- Persistência/auditoria: `logs/qa/ai-generations.jsonl` + `GET /super-admin/ai-generations`

### Nota sobre integrações externas

- A criação de tenant (produção) indexa o site institucional de forma assíncrona.
- Em `pending_review`, essa indexação é **bloqueada** (hardening) até revisão/aprovação.

