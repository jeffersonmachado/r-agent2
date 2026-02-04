# Roadmap (fonte única)

- **Última atualização**: Fev/2026
- **Onde ver o quê (fonte única)**:
  - **Roadmap (visão executiva + status + Now/Next/Later)**: `ROADMAP_3A5_ANOS.md`
  - **Backlog operacional (priorizado, com DoD/gates)**: `O_QUE_FALTA.md`

## Status atual (resumo do que já foi feito)

> Detalhe completo no bloco **“2) Status atual (Fev/2026)”** em `ROADMAP_3A5_ANOS.md`.

- **SaaS enterprise completo** (multi-tenant, RBAC, planos/limites, auditoria, super-admin, onboarding, rate-limit por tenant): ver `IMPLEMENTACAO_SAAS_COMPLETA.md`
- **Event model + event ledger + dispatcher v1** (DB-first) + retenção mínima (prune): ver `ROADMAP_3A5_ANOS.md` e `docs/O_QUE_FALTA.md`
- **Execution queue + scheduler v1** + ledger por nó (base DB-first): ver `ROADMAP_3A5_ANOS.md`
- **Suites verticais v1 operacional**:
  - **Filas físicas (totem/painel/estação)** por token + multi-unidade/sequências + métricas mínimas
  - **Pedidos/Storefront/Delivery** por token + operação interna (kitchen/dispatch) + incidentes mínimos
- **PBX v1** (migrations produto/realtime/CDR) + CRUD básico + apply/preview + provisioning (Grandstream/Avaya): ver `ROADMAP_3A5_ANOS.md`
- **Marketing v1 (core DB-first)**:
  - migrations/models base + serviço inicial (ver `ROADMAP_3A5_ANOS.md`)
  - ainda faltam UI, tracker, jornadas e email (detalhe em `O_QUE_FALTA.md`)
- **Voz v0 (base técnica)**:
  - call events v0 (PBX) + voice nodes no engine
  - falta ligação de triggers/ações no runtime DAG (detalhe em `O_QUE_FALTA.md`)
- **AI Output Envelope (safe-mode + validação por contrato)**: ver `docs/IA_OUTPUT_ENVELOPE.md` e `contracts/ia/ai-output-envelope.schema.json`

## Links rápidos

- **Roadmap 3–5 anos (Now/Next/Later + fases)**: `ROADMAP_3A5_ANOS.md`
- **Backlog “o que falta” (priorizado, com DoD/gates)**: `O_QUE_FALTA.md`

> (Histórico) “Gaps vs benchmarks”: `O_QUE_FALTA_GAPS_VS_BENCHMARKS.md`

