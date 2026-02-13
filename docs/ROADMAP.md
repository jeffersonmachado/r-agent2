# Roadmap (fonte única)

- **Última atualização**: Fev/2026 (05/02) — revisão completa com base no estado atual do repo
- **Onde ver o quê (fonte única)**:
  - **Roadmap (visão executiva + status + Now/Next/Later)**: `ROADMAP_3A5_ANOS.md`
  - **Backlog operacional (priorizado, com DoD/gates)**: `O_QUE_FALTA.md`

## Status atual (resumo do que já foi feito)

> Detalhe completo no bloco **“2) Status atual (Fev/2026)”** em `ROADMAP_3A5_ANOS.md`.

- **SaaS enterprise completo** (multi-tenant, RBAC, planos/limites, auditoria, super-admin, onboarding, rate-limit por tenant): ver `IMPLEMENTACAO_SAAS_COMPLETA.md`
- **Core de eventos**: event model + event ledger + dispatcher v1 (DB-first) + retenção mínima (prune): ver `ROADMAP_3A5_ANOS.md`
- **Execution queue + scheduler v1** + ledger por nó (DB-first) com endpoints de ops: ver `ROADMAP_3A5_ANOS.md`
- **Suites verticais v1 operacional**:
  - **Filas físicas (totem/painel/estação)** por token + multi-unidade/sequências + métricas mínimas
  - **Pedidos/Storefront/Delivery** por token + operação interna (kitchen/dispatch) + incidentes mínimos
- **PBX v1** (migrations produto/realtime/CDR) + CRUD básico + apply/preview + provisioning v1.1 (templates/token/validações): ver `ROADMAP_3A5_ANOS.md`
- **Omnichannel v1 (mínimo vendável)**: unificação conversa↔ticket 1:1, status por mensagem e roteamento/skills básicos
- **Marketing v1 completo** (core DB-first + público) com UI/admin completa, jornadas v1 e funil visual básico
- **Voz v1 (base CCaaS)**: URA via editor de fluxos + runtime de voz + ingestão de eventos + métricas/custos básicos
- **RPA Flow Pipeline v1 (preview/execução)**, **AI Output Envelope**, **Analytics/ROI v1** e **Node marketplace v0**
- **Governança base**: ambientes de flow (dev/stage/prod) + SSO/SCIM + backup/DR básico

## Links rápidos

- **Roadmap 3–5 anos (Now/Next/Later + fases)**: `ROADMAP_3A5_ANOS.md`
- **Backlog “o que falta” (priorizado, com DoD/gates)**: `O_QUE_FALTA.md`
- **Inventário de endpoints (codebase)**: `API_ENDPOINTS_CODEBASE.md`
- **Inventário completo (api/**/*.js)**: `API_ENDPOINTS_CODEBASE_FULL.md`
- **Endpoints no codebase não citados nos roadmaps**: `API_ENDPOINTS_UNDOCUMENTED.md`
- **Endpoints exatos não citados**: `API_ENDPOINTS_UNDOCUMENTED_EXACT.md`

> (Histórico) “Gaps vs benchmarks”: `O_QUE_FALTA_GAPS_VS_BENCHMARKS.md`
