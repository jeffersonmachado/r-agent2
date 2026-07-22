# Runtime Navigation

Browser validation date: 2026-05-16.

Base URL: `http://127.0.0.1:5173`.
Authenticated as `systemadmin`, role `super_admin`, tenant `system`.

## Requested route normalization

| Rota solicitada | Rota canonica real | Alias/Redirect | Componente | Status | Observacoes |
|---|---|---|---|---|---|
| `/support` | `/support` | none observed | `SupportPage` | Validated | Renders Central de Atendimento with ticket inbox and support actions. |
| `/rpa-replays` | `/dev/rpa-replays` | `/rpa-replays` redirected to `/workspace` as unknown authenticated route | `RpaReplaysPage` | Canonical alias validated; requested path is not direct | Menu source: Plataforma/Super Admin/Replays RPA. |
| `/rag-documents` | `/rag-documents` | none observed | `RAGDocumentsPage` | Validated with warnings | Renders document totals; aborted API calls were observed during route transitions. |
| `/system-status` | `/dev/system-status` | `/system-status` returned 404 JSON | `SystemStatusPage` | Canonical alias validated; requested path is gap | Menu source: Operacoes/Monitoramento/Status do Sistema. |
| `/channel-accounts` | `/channel-accounts` | none in frontend router | `ChannelAccountsPage` | Gap in direct runtime validation | Frontend router/menu includes it, but direct browser navigation returned 401 JSON from backend in observed environment. Revalidate proxy/fallback before release. |
| `/channel-health` | `/channel-health` | none observed | `ChannelHealthPage` | Validated | Renders Saude de Canais under Operacoes. |
| `/generate-system` | `/generate-system` | none observed | `GenerateSystemPage` | Validated | Super-admin builder route; page states it is the only valid generate/validate/execute/decide screen. |
| dashboards | `/dashboard`, `/workspace`, `/dashboard-legacy` | `/` is also dashboard/public-sensitive in router | `DashboardV2`, `WorkspacePage`, `DashboardPage` | `/dashboard` and `/workspace` validated | Dashboard shows cockpit KPIs; workspace shows customer 360. |
| QA interfaces | `/dev/qa-waves`, `/qa`, `/qa-mesh`, `/qa/stability` | none observed for `/dev/qa-waves` | `QaWavesPage`, `QaPage`, `QaMeshPage`, `StabilityPage` | `/dev/qa-waves` validated | QA Waves UI rendered but API calls showed network aborts in this session. |
| replay interfaces | `/dev/rpa-replays`, `/dev/rpa-test`, `/rpa-seeds` | requested `/rpa-replays` is not canonical | `RpaReplaysPage`, `RpaTestPage`, `RpaSeedsPage` | `/dev/rpa-replays` validated | Replay list rendered empty in observed runtime; API fetch warnings occurred. |
| workspace interfaces | `/workspace` | none observed | `WorkspacePage` | Validated | Customer 360, timeline, tabs and IA/action panels rendered. |

## Menu areas observed

- RAP/Espaco de Trabalho
- Atendimento
- Clientes/CRM
- Conhecimento
- Operacoes
- Construtor
- Dev
- Admin

## Runtime errors to preserve as evidence

- `/system-status` -> 404 JSON.
- `/channel-accounts` -> 401 JSON on direct navigation.
- `/dev/rpa-replays` rendered but replay API fetches failed/aborted through `http://127.0.0.1:5173/api/test-executions/replays...`.
- `/dev/qa-waves` rendered but QA Waves API fetches had aborted/failed requests through the frontend origin.

## Browser validation 2026-07-22 (QA Waves cycle, driver `scripts/qa-waves/browser-run-cycle.js`)

- Full cycle validated headless/headed on `http://localhost:5173`: login (`systemadmin`/`Admin123!`, tenant `system`) → `/dev/qa-waves` → jornada FITNESS/Leads → cenário `fitness-matricula-leads` → "▶ Executar cenário" (HTTP 202) → replay em `/dev/rpa-replays?source=qa-waves` → `/dev/qa-waves/operational-health` → `/dev/qa-waves/enterprise-governance`. Evidências em `AI_MEMORY/evidence/qa-waves/browser-run-*/`.
- `QaWavesPage` não tem data-testids: título é `h1.qa-waves-title`; cenário selecionado clicando no botão que contém `<id>@<version>` na aba "Cenários". **O `selectedScenarioId` default é `items[0]` da lista global** — sem selecionar o cenário explicitamente, "Executar cenário" roda o primeiro da lista (hoje `beauty-campanha-lead-pagamento`, que exige pipeline e falha 500 em contexto local).
- Replays de execução QA Waves aparecem na listagem com `data-replay-id` = replayId (`qa_wave_replay_*`, base do filename). **O filtro `?source=qa-waves` retorna 0** — a listagem (`/api/test-executions/replays`) não extrai `source`/`scenarioId` desses arquivos. Buscar por `?search=<replayId>`. Cuidado com falso positivo: `search=fitness-matricula-leads` casa o arquivo de **seed** (`rpa/seeds/fitness-matricula-leads.json`, source `seed`), não o replay da execução.
- Em contexto local, só cenários com `platformScenarioIds` mapeados para mesh scenarios **sem** `requiresOfficialPipeline` executam; 28/47 mesh scenarios exigem pipeline oficial.

