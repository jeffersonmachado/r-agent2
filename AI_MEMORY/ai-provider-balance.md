# Saldo por provedor de IA (consulta real, todos os provedores)

Fonte única de código: `api/services/aiCredentialValidation.js`
(`fetchProviderBalanceInfo` + `BALANCE_PROBES`), consumida por
`api/modules/config/controller.js` (chave digitada, ainda não salva) e
`api/modules/tenant/service.js` (chave já salva, rota
`POST /tenants/:key/ai-credentials/test`). Persistência em
`tenant_ai_credentials.metadata.balance`, leitura via
`tenantAIService.getCredentialDetailsMap` e exibição no badge da tela
Configuração → IA (`frontend/src/pages/config/ConfigAiTab.jsx`).

## Regra

A consulta é feita para **todos** os provedores, e o resultado é sempre explícito:

| status | significado |
|---|---|
| `available` | saldo real obtido (`amount` + `currency`) |
| `requires_admin_key` | o endpoint de billing existe, mas exige chave de administrador |
| `not_supported` | o provedor não expõe saldo por API (console-only ou rota inexistente) |
| `error` | rede/timeout/resposta inesperada |

Nunca existe silêncio: quando não há saldo, `note` carrega a razão real (inclusive a
mensagem devolvida pelo próprio provedor). A UI mostra "saldo não consultável" /
"saldo só via chave de admin" no badge e a razão no tooltip.

## Medições reais (2026-09-29)

Método: probe com chave **inválida** separa `404 rota inexistente` de `401 rota existe`;
as chaves do tenant `system` confirmaram os payloads.

| provedor | endpoint | resultado |
|---|---|---|
| DeepSeek | `GET https://api.deepseek.com/user/balance` (na origem, **fora** do `/v1`) | 200 — `balance_infos[]`, saldo real |
| Kimi (Moonshot) | `GET https://api.moonshot.ai/v1/users/me/balance` | 200 — `data.available_balance`, saldo real |
| Mistral | `GET https://api.mistral.ai/v1/users/me/balance` | rota existe (401 na chave inválida); nome dos campos não verificável sem credencial — parser aceita os nomes plausíveis |
| OpenAI | `GET /v1/dashboard/billing/credit_grants` | 403 "must be made with a **session key**" — chave de uso não lê créditos |
| OpenAI | `GET /v1/organization/costs` | 403 "Missing scopes: `api.usage.read`" (e devolve **custo**, não saldo) |
| Anthropic | `GET /v1/organizations/cost_report` | rota existe, exige **Admin API key** (`sk-ant-admin...`) |
| Groq | `/balance`, `/users/me/balance`, `/usage` | 404 — não existe endpoint de saldo |
| Qwen (DashScope) | `/api/v1/users/me/balance`, `/compatible-mode/v1/users/me/balance` | 404 — consumo só no console da Alibaba Cloud |

O comentário antigo do código afirmava que Kimi/Moonshot "não tem endpoint de saldo
utilizável" — **estava errado**; a correção veio de medição, não de suposição.

## Armadilhas

- `deepseek` é o único cujo caminho de saldo **não** está sob o `baseUrl`
  (`https://api.deepseek.com/v1`): usa-se `origin` + `/user/balance`.
- Saldo anterior é **removido** quando o teste não trouxe resultado de saldo — número
  velho exibido como atual é pior do que ausência.
- Provider custom (fora do registry) cai em `not_supported` com nota, sem chamada de rede
  inventada.
- Evidência de browser da jornada: `tests/smoke/ai-provider-balance-browser.js`
  (reutiliza `tests/helpers/playwrightAuth.js`; saída em `AI_MEMORY/evidence/`).
