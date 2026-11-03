# Copilot Instructions - RAP/r-agent2

Antes de qualquer alteração, carregue `governance/RAP_AGENT_CONSTITUTION.md`. Este arquivo é adaptador da Constituição única; o enforcement executável é `node governance/verify-agent-policy-compliance.js`.

Use `AI_MEMORY/` as the official operational memory before suggesting or changing architecture, runtime flows, release gates, QA, replay or browser behavior.

Read first:

- `AI_MEMORY/architecture.md`
- `AI_MEMORY/project-map.md`
- `AI_MEMORY/project-runtime-map.md`
- `AI_MEMORY/operational-rules.md`
- area-specific files such as `AI_MEMORY/qa-waves.md`, `AI_MEMORY/replay-governance.md`, `AI_MEMORY/workspace.md`, `AI_MEMORY/rag-rules.md`, `AI_MEMORY/pbx-ivr.md`

Rules:

- Do not duplicate canonical docs; reference existing docs under `docs/`, `docs/governance/`, `qa-mesh/`, `governance/` and `scripts/`.
- Do not weaken QA Waves, QA Mesh, replay governance, release hardening or self-proving.
- Do not declare release success when canonical governance is `NO_GO`.
- Keep `dist/` clean and never package `.env`, `.token.env`, tokens, dumps, backups, `node_modules` or transient runtime evidence.
- Validate relevant behavior before concluding tasks. For web routes, validate with browser automation and document route aliases/gaps.
- Prefer executable enforcement over passive prose: use `npm run validate:governance-enforcement` or the relevant `npm run validate:*` gate before suggesting completion.
- Treat `reports/governance-score.json` as the source of truth for operational governance score.
- Keep `AI_MEMORY/stack-versions.md` in sync with the declared stack: when Node, npm, package version, RAG pins, embedding model or compose images change, run `npm run stack:versions:sync` and commit the doc.

Blocking validators:

- `npm run validate:ai-memory`
- `npm run validate:runtime`
- `npm run validate:browser-evidence`
- `npm run validate:qa-governance`
- `npm run validate:replay-governance`
- `npm run validate:release-governance`
- `npm run validate:dist`
- `npm run validate:agent-adherence`
- `npm run validate:self-proving`
- `npm run validate:stack-versions`

## Continuidade de missão (loop obrigatório)

A fila oficial de pendências é `AI_MEMORY/hardening-queue.json`.

- Antes de começar um item, mude o status para `in_progress`.
- Ao concluir, mude para `done` gravando `commit` e `evidence` reais (hash do commit + caminho da prova).
- Item impossível vira `blocked` com `blocked_reason` escrito — nunca `done` sem prova.
- Nunca encerre o turno com item `pending`/`in_progress` na fila.

Enforcement determinístico: o hook `.github/hooks/continue-until-done.json`
(script `continue-until-done.cjs`) roda em `SessionStart`/`Stop` e **bloqueia o
encerramento** enquanto houver item aberto e houver progresso (commit/worktree/
fila) desde o último bloqueio; sem progresso ele libera, para não entrar em loop
infinito. Isso é enforcement executável, não prosa: não remova nem relaxe.

Para testes browser/Playwright que autenticam na interface:

- Sempre reutilize o helper compartilhado em `tests/helpers/playwrightAuth.js`.
- Nunca duplique login manual com preenchimento de usuario/senha seguido de clique cego no modal de tenant.
- Ao testar rotas protegidas com `systemadmin`, normalize a selecao de tenant antes de qualquer interacao funcional usando `loginWithTenantSelection(...)`.
- Use `TEST_TENANT_ID` quando o teste precisar escolher tenant explicitamente; default recomendado: `system`.
- Ao criar ou ajustar smoke tests, trate o fluxo como: abrir URL alvo -> autenticar -> selecionar tenant -> retornar para a URL alvo autenticado.
- Se um teste browser falhar apos o login, considere primeiro problema funcional da tela alvo; nao reimplemente o fluxo de autenticacao no proprio teste.
