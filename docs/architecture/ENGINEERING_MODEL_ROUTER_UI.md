# ENGINEERING_MODEL_ROUTER_UI.md

Cinco telas, todas sob `/dev/engineering/*`, `DEVELOPMENT`-only (bloqueio real no backend via
`requireClassification`, não apenas ocultação de menu). Seguem o padrão visual/estrutural já
usado pela área `/dev` existente (roteador próprio por `window.location.pathname`,
`fetchJson`, Tailwind utility classes do design system atual — nenhuma aplicação visual
paralela).

## 1. Engineering Overview (`/dev/engineering`, `EngineeringOverviewPage.jsx`)
Totais (`total`, `GREEN`, `RED`, em execução, bloqueadas, release blockers) e lista de tasks
ativas clicáveis para o detalhe. Fonte: `GET /engineering/overview`.

## 2. Tasks (`/dev/engineering/tasks`, `EngineeringTasksPage.jsx`)
Tabela: Título, Tipo, Risco, Coder, Reviewer, Status, Atualizado. Filtros por status/risco/tipo.
Formulário de criação de nova task (título, objetivo, taskType/risk opcionais — o classifier
completa o que faltar, allowedPaths, testCommands). Fonte: `GET/POST /engineering/tasks`.

## 3. Task Detail (`/dev/engineering/tasks/:id`, `EngineeringTaskDetailPage.jsx`)
Task Contract completo, routing decision (CODER/REVIEWER + `reasonCodes`), trilha visual do
pipeline (`CREATED → ... → GREEN`/estado terminal), histórico de tentativas com patch
(colapsável), resultado de teste por comando (`PASS`/`FAIL` + exitCode real), findings do
reviewer classificados, telemetria (tokens, latência, custo). Botões `Run`/`Cancel`. Fonte:
`GET /engineering/tasks/:id`, `/attempts`, `/tests`, `/reviews`, `/telemetry`,
`POST /:id/run`, `POST /:id/cancel`.

## 4. Models / Model Router (`/dev/engineering/models`, `EngineeringModelsPage.jsx`)
Todo modelo mapeado em `modelCapabilities.js`: provider, status real (`ready`/`sem
credencial`/`unhealthy`/`disabled`), roles, capabilities, classe de contexto/custo, telemetria
básica acumulada (tasks, sucessos, falhas, latência média). Nenhuma chave/segredo exibida.
Fonte: `GET /engineering/models`. Para uma task específica, os candidatos qualificados e a
decisão estruturada aparecem na própria Task Detail (routing decision) — não há ranking
adaptativo (fora do escopo V1).

## 5. Release Closure (`/dev/engineering/release-closure`, `EngineeringReleaseClosurePage.jsx`)
Dados reais lidos de artefatos de governança já existentes (`governance/.current-run.json`,
`qa-mesh/go-no-go-report.json`, `governance/final-readiness-report.json`) combinados com
estatísticas do Engineering Router (tasks GREEN/RED, release blockers, findings
`POST_RELEASE`). `cleanReleaseState` só é `true` quando TODOS os artefatos existem e indicam
GO/PASS e não há release blocker de engenharia pendente — nunca 100%/GO inventado quando um
artefato está ausente ou indica o contrário.

## Roteamento e permissões

- Rotas registradas em `frontend/src/main.jsx` (`isEngineering*`, checadas da mais específica
  — `/dev/engineering/tasks/:id` — para a mais genérica — `/dev/engineering`).
- Item de menu "Engineering" em `frontend/src/navigation/menu.js`, no grupo `dev-engineering`,
  filho direto do nó de topo `plataforma` e exposto pela **área `dev`** (rail DEV, blueprint
  `dev` em `frontend/src/navigation/workspaceAreas.js`). `roles: ['super_admin']` e
  `classifications: ['DEVELOPMENT']` em cada folha (mesmo padrão usado por
  `dev-benchmark-research`). Desde 2026-10-08 a superfície de engenharia NÃO fica mais dentro
  do grupo `super-admin` (Admin).
- `canAccessPath` (`frontend/src/utils/menuPermissions.js`) bloqueia acesso direto por URL para
  quem não é `DEVELOPMENT` — mas a autoridade real é sempre o backend
  (`requireClassification('DEVELOPMENT')` em toda rota `/engineering/*`).
