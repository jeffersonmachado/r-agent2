# H21 — CRM: persistência única entre escrita, listagem e painel

Medição de fechamento em 2026-10-19 (branch `dev/engineering-hardening`).

## Defeito medido (antes)

- `api/modules/crm/routes.js` guardava leads, contas, funis, oportunidades e
  atividades em um `Map` por processo.
- `GET /api/crm/contacts` lia `marketing_leads` (banco) e caía em memória em
  qualquer erro — fallback que a regra do projeto proíbe.
- `GET /api/crm/analytics/dashboard` (em `domain-operations`) agregava
  **apenas** `marketing_leads`.

Consequências medidas no browser real (systemadmin / tenant `system`):

| Ação | Resultado observado |
|---|---|
| `POST /api/crm/leads` (200) | painel continuava `Leads=4` (contador não mexia) |
| contato criado na tela | não aparecia na lista (lista = banco, escrita = Map) |
| restart de `ragent2-api-dev` | registros criados desapareciam |

## Correção

- Nova tabela `crm_records` (`api/db/migrations/20261019120000-create-crm-records.js`,
  model `api/db/models/CrmRecord.js`): `tenant_key` + `entity` + `payload` JSONB.
  Guarda contas, funis, oportunidades e atividades.
- Leads e contatos passam a usar `marketing_leads` (a mesma fonte que o painel
  agrega e que a tela de contatos lista). `source`/`notes` ficam em
  `attributes.crm`; `department` em `attributes.department`.
- Removido o fallback silencioso: falha de banco responde
  `500 { error: "persistence_required" }`.
- Painel: `totalLeads`/`totalContacts` de `marketing_leads`;
  `totalAccounts`/`totalOpportunities`/`totalValue`/`winRate` de `crm_records`
  (win/loss pelo nome da etapa do pipeline).

## Prova (medida)

Migração aplicada: `npm run db:migrate` → `✅ Aplicada: 20261019120000-create-crm-records.js`.

| Passo | Medição |
|---|---|
| baseline | `leads=4`, dashboard `{accounts:0, contacts:4, leads:4, opportunities:0}` |
| `POST /api/crm/leads` "Ana Persistente" | dashboard `{accounts:0, contacts:5, leads:5, opportunities:0}` |
| `POST /api/crm/accounts` "Conta Persistida LTDA" | dashboard `{accounts:1, contacts:5, leads:5}` |
| **restart** de `ragent2-api-dev` | `leads total=5` (Ana presente), `contas total=1`, dashboard idêntico `{1,5,5,0}` |
| `DELETE` de ambos | dashboard volta a `{accounts:0, contacts:4, leads:4, opportunities:0}` |
| browser `/crm/leads` | lista com 5 linhas do banco, incluindo "Ana Persistente / website / Qualificado" |

## Testes

- `npx jest tests/unit/crmRealtimeEvents.test.js` → **13/13**
  (evento por mutação, criação lida de volta, DELETE 404, move persistido,
  `persistence_required` em falha de banco).
- `npx jest tests/unit/domainOperationsDashboardEndpoints.test.js` → **14/14**
  (dashboard com as duas fontes e escopo de tenant nas duas queries).
- `npx jest tests/unit` → **1055 suites / 8963 testes**.
- `vitest src/pages/crm + src/hooks/crm` → **19 testes**.
- `validate:route-mounts` → PASS (63/63).
