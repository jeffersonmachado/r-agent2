## Geração de Fluxo por IA (chatbot / RPA) — seguro e auditável

### Endpoints existentes

- `POST /flows/generate` / `POST /flows/generate/dry-run`: orquestrador (contrato `generation.interface.json` + auditoria `auditService`)
- `POST /ai/chatbot/generate`: wrapper oficial (retorna **sempre** `envelope` + `flow` e mantém `IaGenerationResult` por compatibilidade)
- `POST /ai/rpa/generate`: wrapper oficial (retorna **sempre** `envelope` + `rpaTest` e mantém `IaGenerationResult` por compatibilidade)
- `POST /flows`: persistência de fluxo (gate obrigatório quando `metadata.generatedBy === 'ai'`)
- `POST /flows/preview`: preview/diff read-only do FlowDefinition

### Pipeline de validação (obrigatório)

- **Forma/estrutura**: `engine/validator.js` + `api/utils/validateFlowPlan.js`
- **Gate IA (semântica + hardening)**: `engine/ai/validateGeneratedPlan.js`
  - chatbot: exige `fallback` e bloqueia `api` por padrão
  - retorna `qualityScore` e `riskFlags`

### Safe-mode (draft / pending review)

- Fluxos gerados por IA nascem com:
  - `metadata.status = "draft"`
  - `metadata.requiresReview = true`
- Execução é bloqueada quando `requiresReview=true` (ver `engine/executeStep.js`).
- Aprovação explícita: em `PUT /flows/:id`, enviar `metadata.approveAiGenerated=true` (apenas admin/super-admin).

### Auditoria/telemetria

- Failures do gate: `engine/ai/aiTelemetry.js` (JSONL) + `engine/qa/qaTelemetry.js`
- Store unificado de gerações: `logs/qa/ai-generations.jsonl`
- Listagem: `GET /super-admin/ai-generations?domain=chatbot|chatbot_flow|rpa|rpa_test|tenant&valid=true|false`

