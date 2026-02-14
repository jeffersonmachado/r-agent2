## AI Output Envelope (padrão obrigatório)

Todo artefato gerado por IA (fluxo chatbot, teste RPA, tenant) deve ser encapsulado em um envelope padronizado e auditável.

### Shape

Ver contrato: `contracts/ia/ai-output-envelope.schema.json`

Campos principais (obrigatórios):

- `envelope_version`: `"1.0"`
- `domain`: `chatbot_flow | rpa_test | tenant`
- `created_at`: ISO8601
- `provider`: `{ name, model, temperature }`
- `input`: `{ prompt_summary, user_goal, context }` (context pode incluir `raw_model_output` para debug)
- `output`: output bruto do domínio (não confiável)
- `validation`: `{ valid, errors, warnings, qualityScore, riskFlags }`
- `audit`: `{ request_id, seed, tenant_id, user_id }`

### Validação obrigatória

- **Envelope**: validado por AJV contra `contracts/ia/ai-output-envelope.schema.json`
- **Domínio**: `output` deve ser validado por AJV contra o contrato do domínio:
  - chatbot_flow: `api/data/rag/chatbot/schema/flow.schema.json`
  - rpa_test: `api/data/rag/rpa/rpa.schema.json`
  - tenant: `contracts/tenant.contract.json`
- **Validação semântica**: regras hardening por domínio (ex.: fluxo exige fallback; tenant proíbe segredos)
- **Safe-mode**: artefatos de IA nascem como rascunho/pendentes de revisão

