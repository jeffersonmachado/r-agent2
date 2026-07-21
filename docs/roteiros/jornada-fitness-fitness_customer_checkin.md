# Fitness — Fitness Customer Checkin

> Gerado: 2026-07-21T09:12:35.346Z | Vertical: fitness | Jornada: fitness_customer_checkin

## 1. Objetivo

Validar o fluxo operacional completo da jornada **fitness_customer_checkin** com cobertura de 6 capabilities obrigatórias e confiança de contrato de 82%.

**Capabilities requeridas:**
- `customer_identification`
- `membership_validation`
- `access_decision`
- `turnstile_release`
- `attendance_record`
- `crm_update`

## 2. Pré-condições

| Condição | Obrigatória |
|---|---|
| API em execução (porta 3001) | Sim |
| Redis acessível | Sim |
| PostgreSQL acessível | Sim |
| Tenant configurado para vertical Fitness | Sim |
| Credenciais de QA (`systemadmin` / tenant `system`) | Sim |
| RPA/Playwright disponível para replay | Sim |

## 3. Cenários

Total: **12** cenários (0 aprovados, 12 drafts)

### ⬜ Check-in Completo de Aluno Fitness

- **ID**: `business-e2e-fitness_customer_checkin`
- **Status**: draft_ai
- **Canais**: whatsapp, app
- **Pré-condições**: nenhuma
- **Integrações**: api

**Passos:**

| Ordem | Tipo | Nome | Adapter | Canal | Timeout |
|---|---|---|---|---|
| 1 | Evento de Canal | - | api | - | 20000ms |
| 2 | Validação de Backend | - | api | - | 20000ms |
| 3 | validate_access_release | - | api | - | 20000ms |
| 4 | Validação de Backend | - | api | - | 20000ms |

**Validações**: replay=true, backend=true

### ⬜ Validação: Customer Identification

- **ID**: `cap-customer_identification`
- **Status**: draft_ai
- **Canais**: api
- **Pré-condições**: nenhuma
- **Integrações**: api

**Passos:**

| Ordem | Tipo | Nome | Adapter | Canal | Timeout |
|---|---|---|---|---|
| 1 | Validação de Backend | - | api | - | 15000ms |

**Validações**: replay=true, backend=true

### ⬜ Validação: Membership Validation

- **ID**: `cap-membership_validation`
- **Status**: draft_ai
- **Canais**: api
- **Pré-condições**: nenhuma
- **Integrações**: api

**Passos:**

| Ordem | Tipo | Nome | Adapter | Canal | Timeout |
|---|---|---|---|---|
| 1 | Validação de Backend | - | api | - | 15000ms |
| 2 | Validação de Backend | - | api | - | 15000ms |

**Validações**: replay=true, backend=true

### ⬜ Validação: Access Decision

- **ID**: `cap-access_decision`
- **Status**: draft_ai
- **Canais**: api
- **Pré-condições**: nenhuma
- **Integrações**: api

**Passos:**

| Ordem | Tipo | Nome | Adapter | Canal | Timeout |
|---|---|---|---|---|
| 1 | Validação de Backend | - | api | - | 15000ms |

**Validações**: replay=true, backend=true

### ⬜ Validação: Turnstile Release

- **ID**: `cap-turnstile_release`
- **Status**: draft_ai
- **Canais**: api
- **Pré-condições**: nenhuma
- **Integrações**: api

**Passos:**

| Ordem | Tipo | Nome | Adapter | Canal | Timeout |
|---|---|---|---|---|
| 1 | Validação de Backend | - | api | - | 15000ms |
| 2 | Validação de Backend | - | api | - | 15000ms |

**Validações**: replay=true, backend=true

### ⬜ Validação: Attendance Record

- **ID**: `cap-attendance_record`
- **Status**: draft_ai
- **Canais**: api
- **Pré-condições**: nenhuma
- **Integrações**: api

**Passos:**

| Ordem | Tipo | Nome | Adapter | Canal | Timeout |
|---|---|---|---|---|
| 1 | Validação de Backend | - | api | - | 15000ms |
| 2 | Validação de Backend | - | api | - | 15000ms |

**Validações**: replay=true, backend=true

### ⬜ Validação: Crm Update

- **ID**: `cap-crm_update`
- **Status**: draft_ai
- **Canais**: api
- **Pré-condições**: nenhuma
- **Integrações**: api

**Passos:**

| Ordem | Tipo | Nome | Adapter | Canal | Timeout |
|---|---|---|---|---|
| 1 | Validação de Backend | - | api | - | 15000ms |
| 2 | Validação de Backend | - | api | - | 15000ms |

**Validações**: replay=true, backend=true

### ⬜ Precondição: Crm Contact Exists

- **ID**: `precond-fitness_customer_checkin-crm_contact_exists`
- **Status**: draft_ai
- **Canais**: api
- **Pré-condições**: nenhuma
- **Integrações**: api

**Passos:**

| Ordem | Tipo | Nome | Adapter | Canal | Timeout |
|---|---|---|---|---|
| 1 | Validação de Backend | - | api | - | 10000ms |

**Validações**: replay=false, backend=true

### ⬜ Precondição: Membership Exists

- **ID**: `precond-fitness_customer_checkin-membership_exists`
- **Status**: draft_ai
- **Canais**: api
- **Pré-condições**: nenhuma
- **Integrações**: api

**Passos:**

| Ordem | Tipo | Nome | Adapter | Canal | Timeout |
|---|---|---|---|---|
| 1 | Validação de Backend | - | api | - | 10000ms |

**Validações**: replay=false, backend=true

### ⬜ Precondição: Credential Exists

- **ID**: `precond-fitness_customer_checkin-credential_exists`
- **Status**: draft_ai
- **Canais**: api
- **Pré-condições**: nenhuma
- **Integrações**: api

**Passos:**

| Ordem | Tipo | Nome | Adapter | Canal | Timeout |
|---|---|---|---|---|
| 1 | Validação de Backend | - | api | - | 10000ms |

**Validações**: replay=false, backend=true

### ⬜ Precondição: Device Available

- **ID**: `precond-fitness_customer_checkin-device_available`
- **Status**: draft_ai
- **Canais**: api
- **Pré-condições**: nenhuma
- **Integrações**: api

**Passos:**

| Ordem | Tipo | Nome | Adapter | Canal | Timeout |
|---|---|---|---|---|
| 1 | Validação de Backend | - | api | - | 10000ms |

**Validações**: replay=false, backend=true

### ⬜ Precondição: Attendance Database Accessible

- **ID**: `precond-fitness_customer_checkin-attendance_database_accessible`
- **Status**: draft_ai
- **Canais**: api
- **Pré-condições**: nenhuma
- **Integrações**: api

**Passos:**

| Ordem | Tipo | Nome | Adapter | Canal | Timeout |
|---|---|---|---|---|
| 1 | Validação de Backend | - | api | - | 10000ms |

**Validações**: replay=false, backend=true

## 4. Evidência Esperada

Após execução de todos os cenários aprovados via QA Mesh:

| Artefato | Formato | Local |
|---|---|---|
| Resultado da execução | JSON | `qa-mesh/meshHistory/` |
| Relatório GO/NO_GO | JSON | `qa-mesh/go-no-go-report.json` |
| Replay (se aplicável) | JSON + trace | `qa/` (governado) |
| Evidência de smoke | JSON | `qa/smoke/prod-like/` |
| Diagrama da jornada | Mermaid | `docs/diagrams/qa-waves/journey-*.md` |

## 5. Validações de Governança

Gates aplicáveis após execução:

```bash
npm run validate:qa-governance        # QA Mesh GO/NO_GO
npm run validate:qa-waves-registry     # Integridade do registry
npm run validate:replay-governance     # Integridade de replay
npm run validate:self-proving          # Prova final
```

## 6. Troubleshooting

| Sintoma | Causa provável | Ação |
|---|---|---|
| Cenário falha na validação de schema | Passos não conformes com `waveScenarioSchema.js` | Regerar via bot ou corrigir manualmente |
| Execução retorna 500 | API ou dependência indisponível | Verificar `docker-compose.prod.yml` serviços |
| Mesh runner falha | Adapter não configurado para o canal | Verificar configuração de canais no tenant |
| Replay não gera evidência | RPA não configurado ou browser ausente | Rodar `npx playwright install` |
| GO/NO_GO retorna NO_GO | Bloqueadores ativos no enterprise governance | Rodar `npm run validate:qa-governance` e inspecionar `reports/` |
| Cenário sem passos (draft) | Não passou pelo bot de geração | Usar `POST /api/qa-waves/intelligence/generate-scenario` |
