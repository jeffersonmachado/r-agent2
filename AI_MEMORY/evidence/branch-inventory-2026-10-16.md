# Branch inventory (inventário auditável)

> Artefato DERIVADO do estado real do git. Nada foi apagado. Gerado por
> `tools/audit/branch-inventory.js`.

- **Gerado em**: 2026-10-16T19:25:45.223Z
- **Branch atual**: `dev/engineering-hardening`
- **Branches locais**: 2497
- **Já contidas em `origin/main`** (podáveis com segurança): 2112
- **Não contidas em `origin/main`** (exigem decisão): 385

## Famílias

| família | branches | mergeadas | não mergeadas |
|---|---|---|---|
| `engineering/missions` | 2468 | 2108 | 360 |
| `engineering-router/candidates` | 18 | 0 | 18 |
| `dev/engineering-hardening` | 1 | 0 | 1 |
| `feat/f10-ai-envelope-safe-mode` | 1 | 0 | 1 |
| `feature/bakery-vertical` | 1 | 1 | 0 |
| `feature/funnel-ia-phase1-voice-ready` | 1 | 0 | 1 |
| `fix/autonomous-scheduling-schema-hotfix` | 1 | 0 | 1 |
| `hardening/p0-certificacao` | 1 | 0 | 1 |
| `main` | 1 | 1 | 0 |
| `mission/eng-router-iso` | 1 | 0 | 1 |
| `mission/engineer-router-memory-hardening-20261008` | 1 | 1 | 0 |
| `mission/p0p1-hardening-20261010` | 1 | 1 | 0 |
| `wip/safe-cleanup-2026-03-10` | 1 | 0 | 1 |

## Branches mergeadas — comando sugerido (dry-run)

`-d` (não `-D`): o próprio git recusa apagar branch não mergeada. Rode primeiro em modo lista:

```bash
git branch --merged origin/main --format='%(refname:short)' | grep -v '^*' | head -20
```

## Branches NÃO mergeadas — classificação pelo que elas tocam

- **Só o fixture sandbox** (`tests/fixtures/engineering-router-sandbox/mathUtils.js` — artefato descartável do loop autônomo): 377
- **Tocam outros arquivos** (histórico de missões; revisar antes de descartar): 8
- **Sem arquivos** (branch vazia em relação a `origin/main`): 0

### Tocam outros arquivos

| branch | commits à frente | arquivos fora do fixture (até 4) |
|---|---|---|
| `dev/engineering-hardening` | 27 | `AGENTS.md`, `AI_MEMORY/evidence/checkpoints.md`, `AI_MEMORY/operational-checklists/checkpoint-protocol.md`, `AI_MEMORY/evidence/AUDIT_ENTRYPOINT.md` |
| `engineering/missions/ca56cbdc-3280-4be8-beff-f9301199fc9f` | 8 | `api/services/engineeringMission/missionReplanService.js`, `engine/engineeringMission/replanPolicy.js`, `tests/unit/engineeringMission/replanPolicy.test.js`, `tests/unit/engineeringMission/missionReplanService.test.js` |
| `feat/f10-ai-envelope-safe-mode` | 80 | `apps/mobile/App.tsx`, `apps/mobile/src/support-types.ts`, `.github/workflows/crm-api-ci.yml`, `AUTOMACAO_CRM.md` |
| `feature/funnel-ia-phase1-voice-ready` | 104 | `api/db/migrations/20260311153000-fix-autonomous-policy-min-gap-duration.js`, `api/db/migrations/20260311154000-fix-revenue-opportunities-metadata.js`, `api/db/migrations/20260311154500-fix-kiosk-sessions-contact-ticket-columns.js`, `frontend/src/__tests__/AutonomousSchedulingPage.test.jsx` |
| `fix/autonomous-scheduling-schema-hotfix` | 2 | `api/db/migrations/20260311153000-fix-autonomous-policy-min-gap-duration.js`, `api/db/migrations/20260311154000-fix-revenue-opportunities-metadata.js`, `api/db/migrations/20260311154500-fix-kiosk-sessions-contact-ticket-columns.js`, ` .Destination}}{{end}}'` |
| `hardening/p0-certificacao` | 24 | `AI_MEMORY/evidence/missao-hardening-eng-gov-release-2026-10-16.md`, `AI_MEMORY/evidence/AUDIT_ENTRYPOINT.md`, `AGENTS.md`, `AI_MEMORY/evidence/AUDIT_ENTRYPOINT.json` |
| `mission/eng-router-iso` | 3 | `api/services/engineeringRouter/modelAvailabilityStore.js`, `tests/unit/engineeringRouterModelAvailabilityStore.test.js`, `engine/engineeringRouter/constants.js`, `engine/engineeringRouter/patchValidator.js` |
| `wip/safe-cleanup-2026-03-10` | 96 | `api/bootstrap/registerErrorHandling.js`, `api/bootstrap/registerJobs.js`, `api/bootstrap/registerMiddlewares.js`, `api/bootstrap/registerObservability.js` |

## Política

- Nada é apagado por este script nem por automação: poda é decisão explícita do dono.
- Nunca `-D` em branch não mergeada sem antes confirmar que o conteúdo já está em `main`.
