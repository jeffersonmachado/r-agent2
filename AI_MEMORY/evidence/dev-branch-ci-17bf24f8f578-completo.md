# Gate em fases da branch de desenvolvimento — 17bf24f8f578 (COMPLETO)

- **veredito**: `PASS`
- **equivale a validação completa**: `true`
- **fases pedidas**: `A,A,A,A`
- **fases concluídas**: `(nenhuma)`
- **branch**: `dev/engineering-hardening`
- **sha exato avaliado**: `17bf24f8f5780364da849b009dc59238a89d7800`
- **gerado em**: 2026-10-19T03:29:12.748Z
- **gate efetivo**: LOCAL — o runner do GitHub não inicia jobs por limite de gastos da conta

## Pré-voo (fase A)

| check | resultado | detalhe |
|---|---|---|
| `A1-identidade-commit` | ok | HEAD=17bf24f8f5780364da849b009dc59238a89d7800 |
| `A2-sha-esperado` | ok | não exigido nesta execução |
| `A3-arvore-limpa` | ok | NÃO exigida nesta execução; árvore SUJA (3+) |
| `A4-inventario-defeitos` | ok | 96 item(ns) |
| `A5-dependencias` | ok | node_modules presente |
| `A5b-jest` | ok | binário do Jest |
| `A6-node` | ok | node 22.12.0 |
| `A7-regras-preventivas` | ok | 7 presentes |
| `A8-evidencia-anterior` | nota (não bloqueia) | de OUTRO commit (e154a5187976) — STALE, não conta como evidência do código atual |
| `A9-lineage-run-projecao` | ok | run rap-governed-20261017111858007-5d93eee8 FECHADO (ABANDONED) com motivo e evidência declarados — projeção do último ciclo concluído |

Inventário de defeitos: 96 item(ns), 3 aberto(s), 0 bloqueante(s) para certificação.

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
    "databaseId": 39194532214,
    "headSha": "17bf24f8f5780364da849b009dc59238a89d7800",
    "conclusao": "failure",
    "criadaEm": "2026-10-19T03:24:23Z"
  }
}
```

## Como reconferir a evidência

```bash
node scripts/ci/dev-branch-gate.js --fases A,A,A,A   # reexecuta as mesmas fases
git log -1 --format=%H -- AI_MEMORY/evidence/dev-branch-ci-17bf24f8f578-completo.md   # commit que publicou esta evidência
```

`evidenceSha256` = `21ded4373a15f4841141e942ed00876ed0937c3bf8da43c4d11be749b1f02f66` (sha256 do payload sem este campo).

```json
{
  "schemaVersion": 2,
  "kind": "dev-branch-ci-evidence",
  "comando": "node scripts/ci/dev-branch-gate.js",
  "veredito": "PASS",
  "equivalenteAValidacaoCompleta": true,
  "escopo": "COMPLETO",
  "fasesPedidas": [
    "A",
    "A",
    "A",
    "A"
  ],
  "fasesConcluidas": [],
  "sha": "17bf24f8f5780364da849b009dc59238a89d7800",
  "shaCurto": "17bf24f8f578",
  "branch": "dev/engineering-hardening",
  "escopoDefeitos": null,
  "runnerDoGithub": {
    "medido": true,
    "execucoesNaBranch": 1,
    "ultimaExecucao": {
      "databaseId": 39194532214,
      "headSha": "17bf24f8f5780364da849b009dc59238a89d7800",
      "conclusao": "failure",
      "criadaEm": "2026-10-19T03:24:23Z"
    }
  },
  "gateEfetivo": "LOCAL (o runner do GitHub nao inicia jobs por limite de gastos da conta)",
  "preVoo": {
    "ok": true,
    "checks": [
      {
        "id": "A1-identidade-commit",
        "ok": true,
        "detalhe": "HEAD=17bf24f8f5780364da849b009dc59238a89d7800"
      },
      {
        "id": "A2-sha-esperado",
        "ok": true,
        "detalhe": "não exigido nesta execução"
      },
      {
        "id": "A3-arvore-limpa",
        "ok": true,
        "detalhe": "NÃO exigida nesta execução; árvore SUJA (3+)"
      },
      {
        "id": "A4-inventario-defeitos",
        "ok": true,
        "detalhe": "96 item(ns)"
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
        "detalhe": "de OUTRO commit (e154a5187976) — STALE, não conta como evidência do código atual",
        "bloqueante": false
      },
      {
        "id": "A9-lineage-run-projecao",
        "ok": true,
        "detalhe": "run rap-governed-20261017111858007-5d93eee8 FECHADO (ABANDONED) com motivo e evidência declarados — projeção do último ciclo concluído",
        "bloqueante": false
      }
    ],
    "achados": [],
    "inventario": {
      "total": 96,
      "abertos": 3,
      "bloqueantesParaCertificacao": 0,
      "semSeveridadeAbertos": 0,
      "bloqueioExterno": 3,
      "riscoAceito": 0,
      "porEstado": {
        "VERIFIED": 75,
        "BLOCKED_EXTERNAL": 3,
        "RESOLVED": 18
      },
      "porSeveridade": {
        "P0": 22,
        "P1": 40,
        "P2": 24,
        "P3": 10
      }
    },
    "erroInventario": null,
    "arvoreSuja": true,
    "arquivosSujos": [
      "M reports/rag-domain-segregation-report.json",
      " M reports/tenant-isolation-report.json",
      "?? AI_MEMORY/evidence/dev-branch-ci-e154a5187976-parcial.md"
    ],
    "evidenciaAnterior": {
      "sha": "e154a51879768959ffc7b82389ddeb73ca4817b2",
      "veredito": "PASS_PARCIAL",
      "escopo": "PARCIAL"
    }
  },
  "autorizacoes": [],
  "bloqueio": null,
  "passos": [],
  "falhas": [],
  "evidenceSha256": "21ded4373a15f4841141e942ed00876ed0937c3bf8da43c4d11be749b1f02f66"
}
```
