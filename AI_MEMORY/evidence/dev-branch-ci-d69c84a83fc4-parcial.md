# Gate em fases da branch de desenvolvimento — d69c84a83fc4 (PARCIAL)

- **veredito**: `PASS_PARCIAL`
- **equivale a validação completa**: `false`
- **fases pedidas**: `A`
- **fases concluídas**: `(nenhuma)`
- **branch**: `dev/engineering-hardening`
- **sha exato avaliado**: `d69c84a83fc42bcbf09932777812c90f02cbc26a`
- **gerado em**: 2026-10-17T12:28:45.935Z
- **gate efetivo**: LOCAL — o runner do GitHub não inicia jobs por limite de gastos da conta

## Pré-voo (fase A)

| check | resultado | detalhe |
|---|---|---|
| `A1-identidade-commit` | ok | HEAD=d69c84a83fc42bcbf09932777812c90f02cbc26a |
| `A2-sha-esperado` | ok | não exigido nesta execução |
| `A3-arvore-limpa` | ok | NÃO exigida nesta execução; árvore SUJA (20+) |
| `A4-inventario-defeitos` | ok | 93 item(ns) |
| `A5-dependencias` | ok | node_modules presente |
| `A5b-jest` | ok | binário do Jest |
| `A6-node` | ok | node 22.12.0 |
| `A7-regras-preventivas` | ok | 7 presentes |
| `A8-evidencia-anterior` | nota (não bloqueia) | de OUTRO commit (aa2db65fb4d9) — STALE, não conta como evidência do código atual |
| `A9-lineage-run-projecao` | ok | projeção no run corrente (rap-governed-20261017111858007-5d93eee8) |

Inventário de defeitos: 93 item(ns), 61 aberto(s), 39 bloqueante(s) para certificação.

## Autorizações de fase (Bug Closure First)

(nenhuma fase técnica foi solicitada)

**Sem bloqueio.**

## Passos executados (comando, exit code, duração, sha256 da saída)

(nenhum passo executado)

## Estado do runner do GitHub (medido)

```json
{
  "medido": true,
  "execucoesNaBranch": 1,
  "ultimaExecucao": {
    "databaseId": 39030626770,
    "headSha": "d69c84a83fc42bcbf09932777812c90f02cbc26a",
    "conclusao": "failure",
    "criadaEm": "2026-10-17T11:57:06Z"
  }
}
```

## Como reconferir a evidência

```bash
node scripts/ci/dev-branch-gate.js --fases A   # reexecuta as mesmas fases
git log -1 --format=%H -- AI_MEMORY/evidence/dev-branch-ci-d69c84a83fc4-parcial.md   # commit que publicou esta evidência
```

`evidenceSha256` = `9d331a82b7067b1c123ea6dda1bf31008a0cb7aa8aae8753763f4417edccae7e` (sha256 do payload sem este campo).

```json
{
  "schemaVersion": 2,
  "kind": "dev-branch-ci-evidence",
  "comando": "node scripts/ci/dev-branch-gate.js",
  "veredito": "PASS_PARCIAL",
  "equivalenteAValidacaoCompleta": false,
  "escopo": "PARCIAL",
  "fasesPedidas": [
    "A"
  ],
  "fasesConcluidas": [],
  "sha": "d69c84a83fc42bcbf09932777812c90f02cbc26a",
  "shaCurto": "d69c84a83fc4",
  "branch": "dev/engineering-hardening",
  "escopoDefeitos": null,
  "runnerDoGithub": {
    "medido": true,
    "execucoesNaBranch": 1,
    "ultimaExecucao": {
      "databaseId": 39030626770,
      "headSha": "d69c84a83fc42bcbf09932777812c90f02cbc26a",
      "conclusao": "failure",
      "criadaEm": "2026-10-17T11:57:06Z"
    }
  },
  "gateEfetivo": "LOCAL (o runner do GitHub nao inicia jobs por limite de gastos da conta)",
  "preVoo": {
    "ok": true,
    "checks": [
      {
        "id": "A1-identidade-commit",
        "ok": true,
        "detalhe": "HEAD=d69c84a83fc42bcbf09932777812c90f02cbc26a"
      },
      {
        "id": "A2-sha-esperado",
        "ok": true,
        "detalhe": "não exigido nesta execução"
      },
      {
        "id": "A3-arvore-limpa",
        "ok": true,
        "detalhe": "NÃO exigida nesta execução; árvore SUJA (20+)"
      },
      {
        "id": "A4-inventario-defeitos",
        "ok": true,
        "detalhe": "93 item(ns)"
      },
      {
        "id": "A5-dependencias",
        "ok": true,
        "detalhe": "node_modules presente"
      },
      {
        "id": "A5b-jest",
        "ok": true,
        "detalhe": "binário do Jest"
      },
      {
        "id": "A6-node",
        "ok": true,
        "detalhe": "node 22.12.0"
      },
      {
        "id": "A7-regras-preventivas",
        "ok": true,
        "detalhe": "7 presentes"
      },
      {
        "id": "A8-evidencia-anterior",
        "ok": false,
        "detalhe": "de OUTRO commit (aa2db65fb4d9) — STALE, não conta como evidência do código atual",
        "bloqueante": false
      },
      {
        "id": "A9-lineage-run-projecao",
        "ok": true,
        "detalhe": "projeção no run corrente (rap-governed-20261017111858007-5d93eee8)",
        "bloqueante": false
      }
    ],
    "achados": [],
    "inventario": {
      "total": 93,
      "abertos": 61,
      "bloqueantesParaCertificacao": 39,
      "semSeveridadeAbertos": 0,
      "bloqueioExterno": 3,
      "riscoAceito": 0,
      "porEstado": {
        "FIXED_PENDING_VERIFICATION": 53,
        "BLOCKED_EXTERNAL": 3,
        "RESOLVED": 18,
        "VERIFIED": 14,
        "OPEN": 5
      },
      "porSeveridade": {
        "P0": 22,
        "P1": 40,
        "P2": 21,
        "P3": 10
      }
    },
    "erroInventario": null,
    "arvoreSuja": true,
    "arquivosSujos": [
      "M AI_MEMORY/hardening-queue.json",
      " M api/services/engineeringMission/missionContextService.js",
      " M api/services/engineeringRouter/executionSandbox.js",
      " M api/utils/operationDeadline.js",
      " M dev/platform-readiness/latest.json",
      " M docs/governance/PLATFORM_STATUS.md",
      " M docs/governance/_platform-status-source.json",
      " M governance/cleanup-proof.json",
      " M governance/evidence-manifest.json",
      " M governance/final-proof-report.json",
      " M governance/final-readiness-report.json",
      " M governance/materialized-proof-artifacts-report.json",
      " M governance/package-validation-report.json",
      " M governance/proof-signature.json",
      " M pipeline/runFullValidation.js",
      " M qa-mesh/gap-engine/latest.json",
      " M qa-mesh/meshScheduler.js",
      " M qa-waves/journey-coverage/bakery.json",
      " M qa-waves/journey-coverage/beauty.json",
      " M qa-waves/journey-coverage/clinic.json"
    ],
    "evidenciaAnterior": {
      "sha": "aa2db65fb4d9771ac605960ef108a6f209cb670b",
      "veredito": "BLOQUEADO_POR_DEFEITOS",
      "escopo": "PARCIAL"
    }
  },
  "autorizacoes": [],
  "bloqueio": null,
  "passos": [],
  "falhas": [],
  "evidenceSha256": "9d331a82b7067b1c123ea6dda1bf31008a0cb7aa8aae8753763f4417edccae7e"
}
```
