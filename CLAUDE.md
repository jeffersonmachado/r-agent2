# CLAUDE.md — Results Autonomous Platform (r-agent2)
# Lido automaticamente em toda sessão. Mantenha conciso.

Constituição canônica obrigatória: `governance/RAP_AGENT_CONSTITUTION.md`. Este arquivo é somente adaptador e não pode divergir da Constituição.

## Memoria operacional obrigatoria
- Antes de propor arquitetura, fluxos, release ou navegacao, leia `AI_MEMORY/architecture.md`, `AI_MEMORY/project-map.md`, `AI_MEMORY/runtime-navigation.md` e o documento especifico da area alterada.
- `AI_MEMORY/*` e a camada oficial de contexto para Claude, Copilot, Codex/OpenAI Agents e futuras automacoes.
- Nao duplique documentacao canonica: consolide e referencie docs existentes em `docs/`, `docs/governance/`, `qa-mesh/`, `governance/` e `scripts/`.
- Fluxos web devem ser validados no browser real com `tests/helpers/playwrightAuth.js` antes de serem documentados como comportamento real.

## Stack
- Node >=20.19 ou >=22.12, npm >=10
- Backend: Express 4 (CommonJS, 'use strict'), Sequelize 6, pg 8, ioredis 5, ws
- Frontend: React 18, Rete 2.x, bpmn-js 18, Vite 7 (canônico: vite.config.mjs)
- Testes: Jest (backend) + Vitest (frontend) + Playwright (E2E)
- Infra: docker-compose.prod.yml, Apache, systemd

## Comandos essenciais
- Dev:        npm run dev (frontend porta 3000)
- Testes:     npm run test:unit        ← rodar após toda alteração de domínio
- Testes E2E: npm run test:flow
- Pipeline:   npm run system:bootstrap → system:validate → system:release → system:deploy
- Selagem:    npm run release:seal     ← ciclo completo (prepare→candidate→final→publish→consolidate); plano com release:seal:plan
- Deploy dry: npm run deploy:gate:official (dry-run por padrão)

## Governanca obrigatoria
- QA Waves, QA Mesh, Replay Governance, Release Hardening, Self-Proving e Runtime Governance sao gates, nao sugestoes.
- Se `docs/governance/PLATFORM_STATUS.md`, `qa-mesh/go-no-go-report.json` ou release gate indicarem `NO_GO`, nao declarar release final verde.
- Preserve `replayHash`, checksum, signature, tamper detection, provenance e linkage em qualquer trabalho de replay.
- Use `npm run zip:release`/`npm run system:release` como caminho oficial de release; nao empacotar a partir de workspace vivo sem gate.

## Enforcement executavel
- Antes de concluir mudancas com impacto operacional, rode os validadores em `scripts/governance/`.
- Gate agregado: `npm run validate:governance-enforcement`.
- Gates individuais: `validate:ai-memory`, `validate:runtime`, `validate:browser-evidence`, `validate:qa-governance`, `validate:replay-governance`, `validate:release-governance`, `validate:dist`, `validate:agent-adherence`, `validate:self-proving`, `validate:governance-summary`.
- Relatorios oficiais ficam em `reports/*.json`; `reports/governance-score.json` e a unica fonte para `overallGovernance`.
- Falhas nesses scripts sao bloqueantes. Nao converter falha em narrativa de sucesso.

## Arquitetura — camadas estritas (nunca misturar)
- frontend/     → UI, transformação de formato, validação de UX apenas
- api/          → Express, rotas, composition/{core,platform,extended}
- api/services/ → ~150 serviços, orquestração de casos de uso
- engine/       → núcleo determinístico; funções puras, zero I/O direto
- rag-service/  → Python/FastAPI, serviço separado

## Convenções obrigatórias
- Backend: CommonJS (require/module.exports). Frontend: ES modules.
- Módulos compartilhados via frontend/src/shared/ (re-exporta de engine/utils/)
- Estado realtime: WebSocket. PROIBIDO setInterval para sincronizar estado.
- Persistência: sem fallback em memória. Erro explícito (persistence_required) em falha de DB.
- Flow Editor: configs de nó sempre via SidebarProperties.
- nodeSchemas.js é fonte única para campos, portas e validação.
- Estilos: classes CSS reutilizáveis. Inline só para valores dinâmicos.
- Logger/Config: api/utils/logger e api/utils/config (nunca console.log direto).
- Coerção defensiva: api/utils/defensiveCoercion.

## O que ignorar (legado)
- Arquivos soltos na raiz: test-*.js, debug-*.js, validate-*.js, direct-*.js
- Diretórios: backups/
- Relatórios .md na raiz: PHASE2_*, EXECUTIVE_*, GO_REPORT_*, REFACTORING_*
- PNGs na raiz: modal-screenshot.png, rpa-replays-screenshot.png
- test_output.txt
  → Não editar, não referenciar, não apagar sem confirmação explícita.

## Áreas de atenção
- Padrão .impl.js em andamento (rpaService, flowGeneratorService, generationOrchestrator)
  → sempre editar o .impl.js, nunca o wrapper.
- Vite config canônico: frontend/vite.config.mjs (o .cjs foi removido).
- Config Apache canônico: apache-r-agent2.conf (rede Docker interna; os demais foram para docs/history/).
- .token.env: não commitar, confirmar cobertura no .gitignore.

## Regras de trabalho
- Branch: main direto (projeto em sprint de finalização).
- Antes de qualquer commit: npm run test:unit
- Antes de deploy: npm run test:unit + test:flow + deploy:gate:official
- Antes de inferir telas/rotas/permissoes: login browser real, menu/sidebar, DOM, network e console.
- Para rotas divergentes, mapear solicitada -> canonica -> componente -> permissao em `AI_MEMORY/runtime-navigation.md`.
- Ao trocar de área (ex: backend → frontend): /clear para limpar contexto.
- Ao finalizar sessão longa: /compact para sumarizar antes de continuar.

## Objetivo atual
Sprint de finalização para produção. Prioridade:
1. Mapear o que está incompleto ou bloqueando o deploy
2. Corrigir bloqueadores críticos
3. Validar pipeline completo (system:bootstrap → deploy)
