# Runtime Navigation

Browser validation date: 2026-05-16.

Base URL: `http://127.0.0.1:5173`.
Authenticated as `systemadmin`, role `super_admin`, tenant `system`.

## Requested route normalization

| Rota solicitada | Rota canonica real | Alias/Redirect | Componente | Status | Observacoes |
|---|---|---|---|---|---|
| `/support` | `/support` | none observed | `SupportPage` | Validated (deprecated) | Central de Atendimento legada ticket-based. Desde 2026-09-01 é gated pela capability `caseManagement` (menu "Central de Atendimento" oculto e acesso direto fail-closed com guard de capability quando desligada). Superfície canônica: Inbox (`/inbox`) + Chamados (`/cases`). |
| `/rpa-replays` | `/dev/rpa-replays` | `/rpa-replays` redirected to `/workspace` as unknown authenticated route | `RpaReplaysPage` | Canonical alias validated; requested path is not direct | Menu source: Plataforma/Super Admin/Replays RPA. |
| `/rag-documents` | `/rag-documents` | none observed | `RAGDocumentsPage` | Validated | Rendered in authenticated runtime; no console/network failures in the 2026-08-14 run. |
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

- Full cycle validated headless/headed on `http://localhost:5173`: login (`systemadmin`/`***`, tenant `system`) → `/dev/qa-waves` → jornada FITNESS/Leads → cenário `fitness-matricula-leads` → "▶ Executar cenário" (HTTP 202) → replay em `/dev/rpa-replays?source=qa-waves` → `/dev/qa-waves/operational-health` → `/dev/qa-waves/enterprise-governance`. Evidências em `AI_MEMORY/evidence/qa-waves/browser-run-*/`.
- `QaWavesPage` não tem data-testids: título é `h1.qa-waves-title`; cenário selecionado clicando no botão que contém `<id>@<version>` na aba "Cenários". **O `selectedScenarioId` default é `items[0]` da lista global** — sem selecionar o cenário explicitamente, "Executar cenário" roda o primeiro da lista (hoje `beauty-campanha-lead-pagamento`, que exige pipeline e falha 500 em contexto local).
- Replays de execução QA Waves aparecem na listagem com `data-replay-id` = replayId (`qa_wave_replay_*`, base do filename). **O filtro `?source=qa-waves` retorna 0** — a listagem (`/api/test-executions/replays`) não extrai `source`/`scenarioId` desses arquivos. Buscar por `?search=<replayId>`. Cuidado com falso positivo: `search=fitness-matricula-leads` casa o arquivo de **seed** (`rpa/seeds/fitness-matricula-leads.json`, source `seed`), não o replay da execução.
- Em contexto local, só cenários com `platformScenarioIds` mapeados para mesh scenarios **sem** `requiresOfficialPipeline` executam; 28/47 mesh scenarios exigem pipeline oficial.

## Reorganização QA & RPA (2026-07-23)

Mapa canônico das rotas de QA após revisão completa de menus/rotas:

- **Plataforma > Qualidade** (roles super_admin): `/qa` (QaPage), `/qa/stability` (StabilityPage), `/qa-mesh` (QaMeshPage) — visão de negócio/qualidade. **MOVIDAS para a área Dev em 2026-10-09** (ver seção no fim do arquivo): o grupo de menu `qualidade` pertence à área Dev, não ao Admin.
- **Plataforma > Super Admin > QA & RPA** (roles super_admin; novo subgrupo `dev-qa-rpa`): `/dev/qa-waves`, `/dev/qa-audit`, `/dev/qa-waves/operational-health`, `/dev/qa-waves/enterprise-governance`, `/dev/qa-gaps`, `/dev/rpa-test`, `/dev/rpa-replays`, `/dev/rpa-seeds` — ferramentas de engenharia. Antes estavam soltas no nível direto de Super Admin, misturadas com Gerar Sistema/Chat de Teste.
- **Aliases preservados**: `/rpa-replays` → `/dev/rpa-replays`; `/rpa-seeds` → `/dev/rpa-seeds` (canonizado nesta data — era a única ferramenta RPA fora de `/dev/*`; o alias legado continua renderizando porque `main.jsx` aceita ambos e `DashboardPage.jsx:498` ainda linka para `/rpa-seeds`); `/system-status` → `/dev/system-status`; `/dev-dashboard` → `/dev`.
- **Decisão consciente (não movido)**: `/dev/system-status` permanece exposto em Operação > Monitoramento (é monitoramento operacional, apesar do path `/dev`); área `operacoes` em `workspaceAreas.js` mantém o prefixo `/dev/system-status`.
- **Colisões de path página×API resolvidas**: `/qa/stability` e `/qa/checkpoints` (1 segmento) eram capturados por `/qa/:id` do módulo qa (404 indevido) — guarda com `next()` em `api/modules/qa/routes.js`; proxy Vite `^/qa(/|$)` com bypass de navegação separa página (Accept text/html) de API (Accept application/json), mesmo padrão já usado por `/qa-mesh` e `/rag`.

## Ask AI — validação de jornada real 2026-09-18 (release `r-agent2-20260918-115949`)

Jornada executada em browser real (Chromium headless, 1440×900) com o helper canônico
`tests/helpers/playwrightAuth.js` → `loginWithTenantSelection(page, { targetUrl: 'http://localhost:5173/ai-tools', tenantId: 'system' })`.

- **`/ai-tools`** carrega `AIToolsPage` ("🤖 Ferramentas de IA" — Sugestão de Resposta / Reescrita Inteligente). Funciona com `systemadmin` + tenant `system`; o modal de tenant é resolvido pelo helper.
- **GAP de navegação: Ask AI NÃO é uma página.** Não existe rota `/ask-ai` (nem alias): o assistente é um **widget flutuante global** montado no shell (`AskAiWidget`, renderizado em `main.jsx` ~L1138 e ~L1188) e presente em qualquer rota autenticada. Quem procurar "Ask AI" no menu não encontra — o acesso é o botão flutuante com `aria-label="Perguntar à IA"` (alterna com "Fechar assistente de IA"). Placeholder do campo: `Digite sua pergunta…`; envio por Enter ou botão `Enviar`.
- **Chamada de backend**: `POST /api/ask-ai` (via `fetchJson` em `frontend/src/api/client.js`).
- **Resposta real verificada**: pergunta procedimental → resposta textual **com seção "Fontes:"** listando documentos do tenant (ex.: `Roteiros Jornada Bakery Bakery Estoque Perdas`, `Roteiros Jornada Beauty Beauty Booking`). O painel NÃO renderiza um `<ol>` de mensagens com testid; a evidência de resposta está no texto do painel + bloco "Fontes:".
- **Zero** erros de console, **zero** `pageerror`, **zero** requisições falhas (nenhum HTTP ≥ 500) durante toda a jornada.
- Evidência visual: `AI_MEMORY/evidence/ask-ai-journey-<timestamp>.png`.
- Complemento de runtime (API, sem UI): `npm run verify:ask-ai-copilot:runtime` → **9/9 PASS** com `ASKAI_VERIFY_USER/PASSWORD/TENANT/BASE` (evidência em `reports/ask-ai-copilot-runtime-evidence.json`).

## Engineering Missions — enriquecimento com Qwen (2026-09-24)

Ciclo novo de engenharia: missão em linguagem natural → enriquecimento com provenance →
preview → aprovação (humana ou por política) → Engineer Router → GREEN. Entrega e evidência
completa: `docs/architecture/QWEN_COM_ENRIQUECIMENTO.md` e
`reports/qwen-com-enriquecimento-report.json`.

Rotas de interface (todas `requireAuth` + `requireClassification('DEVELOPMENT')`):

- `/dev/engineering/missions` — lista + formulário de missão + painel/toggle da política de
  autoaprovação (`EngineeringMissionsPage`).
- `/dev/engineering/missions/:id` — preview ORIGINAL × ENRIQUECIDO com provenance
  (`ADDED`/`MODIFIED`/`INFERRED`/`POLICY_REQUIRED`/`UNCHANGED`), contrato de execução editável,
  Aprovar/Rejeitar/Reenriquecer/Executar, histórico de versões e de decisões, execução real,
  relatório de auditoria, painel de **Meta Review / Adversarial Review** e aviso **“GREEN recusado”**
  quando a revisão da versão corrente bloqueia (`EngineeringMissionDetailPage` +
  `MissionReviewPanel`).
- Cartão **“Autoavaliação contínua”** na lista de missões (botão *Calcular*): métricas de
  enriquecimento/aprovação/execução/revisões; métrica sem denominador aparece como “—” (`null`),
  nunca como `0`.
- Menu: `Engineering → Missions / Enriquecimento` (classificação DEVELOPMENT).

Rotas de API (mesmo prefixo `/engineering/missions`): `GET /overview`, `GET /` (lista),
`POST /` (compilar/enriquecer), `GET /:id`, `GET /:id/preview`, `GET /:id/versions`,
`GET /:id/approvals`, `POST /:id/enrich`, `POST /:id/approve`, `POST /:id/reject`,
`POST /:id/edit`, `POST /:id/execute`, `GET /:id/report`, `GET|PUT /policy`,
`GET /self-assessment`, `POST /:id/review`, `GET /:id/review`, `POST /resume-interrupted`. Registradas em `api/composition/engineering-missions`,
`api/app/registerRoutes.js` e `api/app/routeRegistry.js` (router fora do registry responde 404
silencioso — validado por `npm run validate:route-mounts`).

Jornada validada em browser real (Chromium, `tests/helpers/playwrightAuth.js` +
`loginWithTenantSelection`, tenant `system`): abrir a URL → autenticar → digitar a missão →
enriquecer → revisar diff/provenance → aprovar → conferir histórico e relatório → rodar Meta
Review + Adversarial Review pela UI → calcular a autoavaliação. **18/18 PASS**, sem erros de
console inesperados e sem falhas de rede reais (`net::ERR_ABORTED` em `/auth/me` é cancelamento
por navegação; o toast de erro do próprio app no passo de revisão é o resultado ESPERADO de uma
revisão bloqueante e é contado à parte, não como defeito de página). Evidência:
`AI_MEMORY/evidence/2026-09-24-engineering-missions-browser.json` + screenshots
`2026-09-24-engineering-mission-preview.png`, `...-approved.png`, `...-review.png` e
`...-self-assessment.png`.

Notas de runtime medidas:

- Qwen aparece em `ai_providers` como builtin (`enabled=true`, `kind=openai-compatible`) após o
  boot real; sem credencial configurada, o provider fica indisponível de forma explícita
  (`AI_PROVIDER_NOT_CONFIGURED`) e o Router continua operando com os demais providers.
- Sem nenhum provider com credencial, o enriquecimento registra a degradação
  (`modelSelection.selected = null`) e segue com fatos + regras — nunca finge interpretação.
- Reiniciar a API é necessário para montar routers novos: `/engineering/missions` respondia 404
  com o processo antigo e 401 (montada + auth) depois do restart.
- Ordem de rota é contrato: `GET /self-assessment` estava capturada por `/:id` e respondia o
  handler errado — rota estática tem de vir ANTES de `/:id` (teste de regressão em
  `tests/unit/engineeringMissionRoutes.test.js`).

## Área DEV passa a existir de verdade (2026-10-08)

Medido em browser real (`systemadmin` / tenant `system`) ao tentar abrir a UI do engenheiro **pelo menu**: ela não existia em navegação nenhuma. Três defeitos de produto:

1. **Grupo aninhado era descartado em silêncio.** `SecondaryNav.buildSections` só tratava UM nível de grupo; `Engineering` e `QA & RPA` são grupos de nível 3 (dentro de `plataforma > super-admin`) e sumiam. Corrigido com recursão (`collectGroupSections`).
2. **`/dev*` resolvia para a área `admin`.** O rail DEV era injetado sinteticamente por `PrimaryRail` e não tinha blueprint em `workspaceAreas.js`; o Admin declara prefixo `/dev` (para `/dev/system-status` e `/dev/stack-versions`), então o menu secundário da área DEV mostrava o menu do Admin.
3. **Trilha/ativo por prefixo.** `pathMatches` é por prefixo, então `/dev` casava `/dev/engineering`: breadcrumb/H1 das páginas de engenharia mostravam "Central Dev" e **dois** itens apareciam ativos. Agora vence o path mais específico (`findNavigationTrail`) e o item ativo é único (`activeItemPath`).

Layout canônico resultante:

- **Área Dev (rail DEV)**: blueprint `dev` em `workspaceAreas.js` (`pathPrefixes: ['/dev']`, sem `fallbackPath` de propósito — sem item acessível a área não existe e o rail não aparece). Seções: **DEV** (`/dev`, Central Dev) e **ENGINEERING** (`/dev/engineering`, `/tasks`, `/missions`, `/findings`, `/models`, `/release-closure`).
- Nós de menu: grupo `dev-hub` (label `Dev`) + grupo `dev-engineering`, ambos filhos diretos de `plataforma`, com `roles: ['super_admin']`. **Os `roles` do grupo são obrigatórios**: sem eles as folhas de engenharia deixariam de herdar `super_admin` (o scanner de inventário herda roles de ancestrais) e o campo `roles` de `config/system-inventory.json` mudaria → fingerprint estrutural diferente → `REVALIDATION_REQUIRED` no coverage gate. Medido: com os roles, `inventory:build` altera só `generatedAt`.
- A área `admin` exclui `dev-hub`/`dev-engineering`; a área `dev` exclui `operacao` e `dev-qa-rpa` (recorte por EXCLUSÃO: `includeNodeIds` poda os filhos do nó incluído).
- `dev-qa-rpa` **permanece** em Admin > Super Admin (decisão de 2026-07-23) — mas agora **visível**, e `/rpa-replays` continua SUPPORT/DEVELOPMENT no Admin.
- Seção recolhida por padrão escondia a rota atual: o estado passou a guardar apenas o override do usuário e o padrão é derivado da rota (`collapsedOverrides` + `isSectionCollapsed`).

Jornada completa das 6 telas validada no browser (Overview, Tasks, Missions / Enriquecimento, Findings / Ciclo de Bug, Models / Router, Release Closure): todas com área `Dev`, H1 correto, exatamente 1 item ativo, seção Engineering aberta e **zero** erro de console/pageerror/request falho. Regressão conferida em `/workspace`, `/inbox`, `/supervisor`, `/config`, `/qa` e `/crm`: nenhuma seção da rota ativa ficou recolhida.

Gaps observados (pré-existentes, não introduzidos nesta mudança):

- `Clientes` (`/crm`): **CORRIGIDO em 2026-10-08** — a área reivindicava `/support` (Central de Atendimento LEGADA) como página própria: `includeNodeIds: ['crm']` podava os filhos do nó `crm` e o path do nó ancestral `relacionamento` contava como item da área. Agora o recorte é por exclusão (`atendimento`, `canais-mensageria`) e o path de um nó de GRUPO só vale como item se casar o `pathPrefixes` da área. A seção CRM aparece com "Painel CRM" (`/crm`) e o alias `/crm/dashboard` saiu do submenu (rota preservada, `hiddenInSubNav`).
- `/config` e `/supervisor` não têm item marcado como ativo no menu secundário (paths sem item visível), comportamento pré-existente.
- `/dev/engineering/release-closure` reporta `NÃO É UM RELEASE LIMPO` com motivos explícitos (`NO_CURRENT_GOVERNED_RUN`, `QA_MESH_GO_NO_GO_MISSING`, `FINAL_READINESS_MISSING`, `FINAL_CONSISTENCY_GATE_MISSING`, `ENGINEERING_RELEASE_BLOCKERS_PENDING`, `ENGINEERING_REGRESSIONS_PENDING`): o run corrente não está amarrado ao fingerprint da árvore.

## Grupo Qualidade passa para a área Dev (2026-10-09)

Decisão do usuário (substitui a de 2026-07-23): **os itens de menu de qualidade ficam em Dev, não em Admin**.

- `workspaceAreas.js` — blueprint `dev`: `pathPrefixes: ['/dev', '/qa', '/qa/stability', '/qa-mesh']` e descrição passa a citar Qualidade.
- `workspaceAreas.js` — blueprint `admin`: prefixos `/qa`, `/qa/stability`, `/qa-mesh` **removidos** e `qualidade` adicionado a `excludeNodeIds` (`['dev-hub', 'dev-engineering', 'qualidade']`).
- A estrutura de `menu.js` **não mudou**: `qualidade` continua filho direto de `plataforma` com `roles: ['super_admin']` (o `SecondaryNav` renderiza os filhos de `plataforma` como seções; o nome "Plataforma" não aparece na sidebar). Trocar de área é só `pathPrefixes`/`excludeNodeIds`.
- O inventário (`frontendRouteScanner`) lê `menu.js`, não `workspaceAreas.js` → `config/system-inventory.json` **não muda** e não há `REVALIDATION_REQUIRED`.
- `dev-qa-rpa` (QA Waves, QA Audit, RPA técnico) **permanece no Admin**, como em 2026-07-23.
- Validação: área ativa de `/qa`, `/qa/stability` e `/qa-mesh` é `dev`; essas rotas não aparecem em `admin.items`. Regressão em `frontend/src/navigation/workspaceAreas.test.js`.

## Auditoria de TODAS as rotas no browser (2026-10-09)

Varredura das **131 rotas do menu** com Playwright headless (`systemadmin`/tenant `system`), medindo carga, erros de console, respostas HTTP >=400, superfícies fora do tema, overflow horizontal em 1366 e 390, conteúdo inalcançável a 390 e presença de conteúdo. Evidência: `AI_MEMORY/evidence/route-audit-2026-10-09.json`.

**Resultado: 131/131 respondem.** Zero rota sem conteúdo, zero overflow horizontal, zero conteúdo inalcançável, zero superfície clara fora do tema, zero resposta >=400. Uma rota tem erro de console de biblioteca: `/bpmn-editor` (avisos internos do bpmn-js), sem impacto na página.

### Defeito real encontrado e corrigido — SSE do Painel Operador

`GET /api/pbx/operator-panel/events` respondia **403 `tenant_required`** para o próprio `systemadmin` que abria `/pbx/operator-panel` (o painel ficava sem dados ao vivo). Causa: o `EventSource` não envia headers e a rota só aceitava o token via query param; `requireAuth` preenche `req.tenantId` de super-admin **apenas** pelo header `X-Tenant-Id`, que nunca chegava. Correção espelhada do escape hatch do token, restrita a esta rota SSE:

- `api/modules/pbx/pbx-core/operatorPanelRoutes.js`: quando não há `x-tenant-id`, lê `tenantId` da query e injeta no header (o tenant segue validado por `requireTenant`).
- `frontend/src/api/pbx.js` (`buildOperatorPanelEventsUrl`): envia `tenantId` via `getTenantId()` e o token via `getToken()` (fonte canônica, não `localStorage` cru).
- Regressão: `tests/unit/pbxOperatorPanelRoutes.test.js` (3 casos novos: token via query, tenant via query, header existente não é sobrescrito).

### Armadilhas de medição (não são defeitos)

- Página que ainda mostra o placeholder `Carregando...` parece "vazia": o critério de assentamento deve exigir `h1` **e** texto real, não "texto estável".
- Limiar de "página vazia" precisa ser baixo (~40 chars): `/crm/activities` (57) e `/crm/pipelines` (97) renderizam estado vazio legítimo ("Nenhum registro encontrado") e eram falso positivo com limiar de 100.
- Alvos de toque < 28px a 390px seguem numerosos em telas densas (`/departments` 466, `/dev/security-intel` 349, `/dev/rpa-seeds` 222) — medido, não alterado (mesma decisão do ciclo de 2026-09-29).

## Superfícies de governança de engenharia (2026-10-11)

Adicionadas para fechar pendências que **não tinham UI nenhuma**. Todas na área
Dev, classificação **DEVELOPMENT** (menu por `classifications`; a API também
exige a classificação — ocultar o menu não é o controle de acesso).

| Rota de UI | Tela | API | Autoridade (RBAC) |
|---|---|---|---|
| `/dev/pendencies` | Pendências (fila de missão + isenções aguardando aprovação + bloqueios de release) com filtro **"Apenas pendências"** | `GET /api/dev-governance/pendencies?onlyPending=1` | `dev_governance:read` |
| `/dev/release` | Release: veredito (entregue/superada), artefatos, guard local e ações governadas | `GET /api/dev-governance/release`, `GET|POST /api/dev-governance/release/{verify,seal,publish-tag}` | `read` / `release_verify` / `release_seal` / `release_publish` |
| `/dev/security-intel` | Versões e Segurança — ganhou o filtro **"Apenas pendências"** (sem correção publicada ou severidade bloqueante) | — | `security_intel:*` |
| `/dev/engineering/release-closure` | Release Closure — ganhou o filtro **"Apenas pendências"** (esconde os cartões OK; o motivo do bloqueio NUNCA é escondido) | — | `reports:read` |

Critério de "pendência" (fonte única em `engine/governance/pendenciesModel.js`):
exige ação humana = item `blocked`/`pending`/`in_progress` da fila oficial, OU
isenção em `PENDING_APPROVAL`, OU bloqueio de release declarado. Item `done` não é
pendência — e **desconhecido não é bloqueio** (regressão medida: `finalDecision =
AUTONOMOUS_READY_GO` com `pass=true` era falso bloqueio).

Ações de release são **allowlist fechada** (`releaseActionService`): comando e
argumentos fixos, `confirm: true` obrigatório para o que altera o repositório,
single-flight, e recusa com o MESMO motivo que a tela exibe. Se um guard local
recusa push de tag, a tela mostra o motivo do guard e desabilita o botão — **não
contorna** (nem remove hook, nem `--no-verify`).

Gap conhecido: a lista de achados é paginada pelo backend; o filtro "Apenas
pendências" de `/dev/security-intel` opera sobre os achados CARREGADOS e a tela
declara isso em vez de sugerir cobertura total.


