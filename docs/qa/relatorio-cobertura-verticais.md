# Relatório de Cobertura, Recursos e Gaps por Vertical

**Gerado em:** 2026-08-02 (dados reais das execuções locais e do CI)
**Fontes:** `qa-mesh/meshHistory/mesh-2026-08-02T03-16-50-852Z.json` (mesh canônico GO 130/130), `reports/coverage-gate-report.json` (gate GO), `config/system-inventory.json` (2.717 itens), `qa/qa-waves/scenario-store.json` (376 cenários), `tests/rpa/business/catalog.js`, `api/modules/vertical-templates/service.js`, `reports/page-surface-report.json` (138/138), `reports/api-surface-report.json` (768 rotas), `reports/db-integrity-report.json` (155 models).

## 1. Visão executiva

| Indicador global | Valor |
|---|---|
| Mesh canônico (go/no-go) | **GO — 130/130** (executionQuality=valid) |
| Coverage gate | **GO** — visited=100%, validated=94,5%, weighted=97,1% |
| Jornadas (91) | 100% visitadas e validadas |
| Outcomes (130) | 100% validados |
| Críticos sem cobertura / com falha / stale / órfãos | 0 / 0 / 0 / 0 |
| Page-surface wave | 138/138 VALIDATED |
| API-surface wave | 583 VALIDATED / 185 VISITED / 0 FAILED |
| DB-integrity wave | 155/155 models + 9/9 relações |
| Violações de visibilidade / isolamento de tenant | 0 / 0 |

Verticais com template oficial (`api/modules/vertical-templates/service.js`): **Beauty, Fitness, Food, Services**. Em operação adicional no catálogo QA: **Clínica** e **Mercado**.

## 2. Cobertura por vertical (mesh canônico GO de 2026-08-02)

| Vertical | Cenários mesh | Criticidade | QA Waves | Resultado |
|---|---|---|---|---|
| Core (plataforma) | 83 | 7 blocking, 44 high, 31 normal, 1 medium | 320 | 100% PASS |
| Fitness | 15 | 1 blocking, 8 high, 6 standard | 32 | 100% PASS |
| Beauty | 12 | 1 blocking, 10 high, 1 medium | 1 | 100% PASS |
| Food | 4 | 1 blocking, 3 high | 1 | 100% PASS |
| Omnichannel | 4 | 1 blocking, 2 standard, 1 medium | 9 | 100% PASS |
| PBX | 3 | 3 blocking | — | 100% PASS |
| Clínica | 2 | 2 high | 1 | 100% PASS |
| Mercado | 2 (+1 em `market`) | 2 medium (+1 high) | 1 | 100% PASS |
| Serviços | 2 | 2 medium | 1 | 100% PASS |
| Workspace | 1 | 1 blocking | — | 100% PASS |
| BPMN | 1 | 1 high | — | 100% PASS |
| Agent OS | — | — | 10 | 100% PASS |

Prova dedicada das verticais principais: `npm run test:vertical:proof` — **74 testes (unit + integration Beauty/Fitness) + validação E2E**, exit=0 em 2026-08-02.

## 3. Recursos inventariados por vertical

### Fitness
- **Superfície:** 5 páginas (`/fitness/*`, `/academy`), 9 APIs (`/api/fitness/*` — dashboard, memberships, attendance, metrics), 1 model/tabela dedicados, 20 campos.
- **Jornadas cobertas:** matrícula (onboarding, agendamento, check-in, checkout, renovação, cancelamento — 6 cenários standard), fluxos de cobrança/check-in/lead-funnel/aluno (4 high), jornada blocking `fitness_customer_checkin` (F1) com evidência operacional de browser real.
- **Ponto forte:** maior cobertura vertical (15 mesh + 32 qa-waves) e única vertical com cenários standard de ciclo completo de matrícula.

### Beauty
- **Superfície:** 8 páginas (`/beauty/*`), 16 APIs (`/api/beauty/*` — agenda, bundles, customers, dashboard).
- **Jornadas cobertas:** appointment, campaign, lead, payment (4 high), 6 telas (scr-01..06), jornada blocking B1 e B2 high.
- **Gap relativo:** apenas 1 cenário QA Wave com `vertical=beauty` (vs. 32 de fitness).

### Food
- **Superfície:** 3 páginas, 9 APIs (`/orders`, `/orders/:id`, `/storefront/orders/:id`, `/api/orders/metrics`), 1 model/tabela, 21 campos.
- **Jornadas cobertas:** criação de pedido, ciclo de vida, pagamento (blocking), 1 tela.
- **Gap relativo:** sem cenários standard; escopo de cardápio/menu digital não possui cenário dedicado.

### Clínica
- **Superfície:** 2 páginas; APIs compartilhadas com core (sem namespace próprio `/api/clinica/*` — usa agenda/ops/billing da plataforma).
- **Jornadas cobertas:** ticket clínico (high), 1 tela (high); fluxo `clinic_calendar_block_flow` coberto pela evidência operacional prod-like (GO em 2026-08-02).
- **Gap relativo:** cobertura mais rasa entre as verticais (2 cenários, sem blocking, sem standard).

### Mercado / Services
- **Superfície:** mercado apoia-se em storefront/orders e marketplace de nós; services em solutions.
- **Jornadas cobertas:** mercado — node flow + 1 tela (medium), order-customer (high, tag `market`); services — solution flow + 1 tela (medium).
- **Gap relativo:** sem cenários blocking; criticidade máxima medium em 2 de 3 cenários.

### Core / plataforma (transversal)
- **Superfície:** a maior parte do inventário (768 APIs, 138 páginas, 155 models).
- **Cobertura:** 83 cenários mesh + 320 QA Waves; inclui tenants, RBAC, billing, CRM, inbox, filas, RAG, backup, webhooks, WhatsApp, voz, automação, workspace-core (GO).

## 4. Gaps e inconsistências identificados

1. **Tag de domínio dividida `mercado` vs `market`** — cenários da mesma família (`business-market-flow-node`, `business-market-scr-01` vs `business-market-flow-order-customer`) estão em dois domínios distintos no registry, fragmentando métricas e análise de impacto da vertical. Recomendação: unificar sob um único domínio canônico.
2. **2 jornadas sem cenário vinculado no grafo** — `journey:omnichannel_engagement` e `journey:fitness_customer_checkin` constam VALIDATED via evidência operacional/waves, mas com `linkedScenarios` vazio no coverage gate. Recomendação: declarar o vínculo explícito jornada↔cenário para rastreabilidade EXPECTED/OBSERVED completa.
3. **Cobertura rasa das verticais novas** — Clínica (2 cenários), Mercado (2) e Serviços (2) não possuem cenário blocking nem trilha standard; uma regressão de baixa severidade pode passar despercebida. Beauty tem apenas 1 cenário QA Wave vertical.
4. **Refresh da evidência operacional blocking é manual** — a evidência prod-like (`qa/smoke/prod-like/qa-waves-operational-prod-like-smoke.json`, gitignored por ser artefato de runtime) expira em 7 dias; ao expirar (2026-08-02T11:08Z), o scheduler do mesh virou NO_GO às 11:15/11:30 (política STALE correta). Renová-la exige `RUN_QA_WAVES_PROD_LIKE_SMOKE=1 FRONTEND_URL=... API_URL=... node scripts/smoke/qa-waves-operational-final-smoke.js` contra stack viva. Recomendação: agendar refresh local semanal (mesma cadência do `wave-reports.yml` no CI) ou mover o scheduler crítico para o CI.
5. **Clínica sem namespace de API próprio** — dificulta descoberta automática de superfície da vertical e análise de impacto (itens ficam misturados ao core).

## 5. Estado operacional do momento

- Último mesh canônico completo: **GO 130/130** (2026-08-02T03:16Z).
- Scheduler crítico (15 cenários, a cada 15 min): NO_GO às 11:15/11:30 por evidência blocking STALE → smoke prod-like re-executado às **11:52Z com GO** (todos os fluxos, incl. support_ticket, fitness check-in, clinic calendar block) → scheduler crítico re-executado em confirmação: **GO 15/15** (exit=0). Evidência válida até **2026-08-09T11:52Z**.
- CI `3e12b9e`: 6/6 workflows verdes (Jest, Frontend, RAG, Release Governance, E2E, Wave Reports Refresh).
