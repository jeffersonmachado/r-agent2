# Cognitive Core — Visibility Policy

Data: 2026-06-12
Fontes: `src/core/cognitive/visibility.js` (núcleo) + `api/modules/agent-os/experience-segregation.js` (rotas/agentes — política canônica reutilizada, não duplicada).

## Classificação obrigatória

### PRODUCTION (usuários operacionais)
- Workspace, Inbox, CRM, Agenda, PBX, Campanhas, Analytics, IA Operacional
- No Cognitive Core: as 13 tools de negócio do Tool Registry; o retorno do orchestrator (`status`, `intent`, `outputs`, `humanHandoff`, `requiresConfirmation`)

### SUPPORT (suporte)
- Replay, Diagnóstico, Evidências, Auditoria, Logs
- No Cognitive Core: registros de execução estruturados (event ledger `cognitive.execution.*`, sanitizados), trilha de auditoria

### DEVELOPMENT (engenharia)
- QA Waves, Mesh, Seeds, Validation Engine interno, Scenario Builder, Coverage Analysis, RPA Lab
- No Cognitive Core: Validation Engine (checks técnicos), trace interno de contexto, templates de plano

## Regras

1. **Nunca exibir componentes DEVELOPMENT para operação.** Ator `PRODUCTION` não lista nem executa tools `SUPPORT`/`DEVELOPMENT` (`canAccess` em `visibility.js`).
2. O retorno operacional do orchestrator contém **somente** resultado de negócio — testado em `cognitiveCorePipeline.test.js` ("resposta operacional não expõe engines internas").
3. `OPERATIONAL_FORBIDDEN_PATTERN` bloqueia por regressão qualquer tool operacional cujo id/descrição mencione QA Wave, QA Mesh, Replay, Seeds, RPA, Scenario Builder ou Coverage Analysis.
4. Rotas técnicas continuam ocultas pela política do Agent OS (`PRODUCTION_HIDDEN_ROUTES`): `/dev/qa-waves`, `/qa`, `/qa-mesh`, `/dev/rpa-replays`, `/rpa-seeds`, `/dev/rpa-test`, `/generate-system`, `/dev*`, `/admin/agents` — cross-check testado.
5. QA Waves **podem** validar o Cognitive Core (gate de release); o inverso — núcleo expor QA à operação — é proibido.

## Workspace (Etapa 6)

O Workspace permanece o centro da experiência. O Cognitive Core entrega a ele apenas:

- sugestões/insights (`generateInsight` → `WorkspaceInsight`, source `cognitive-core`)
- alertas e automações executadas (timeline/ações via serviços de Workspace existentes)
- resultados e indicadores (outputs de negócio do orchestrator)

Nunca: replay, QA, seeds, mesh, RPA, engines internas ou pipelines técnicos.
