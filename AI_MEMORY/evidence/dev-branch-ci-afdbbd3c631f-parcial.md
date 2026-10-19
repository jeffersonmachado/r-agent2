# Gate em fases da branch de desenvolvimento — afdbbd3c631f (PARCIAL)

- **veredito**: `FAIL`
- **equivale a validação completa**: `false`
- **fases pedidas**: `A,B,C`
- **fases concluídas**: `(nenhuma)`
- **branch**: `dev/engineering-hardening`
- **sha exato avaliado**: `afdbbd3c631f34ed45bfb4f894255c9c1ae40d6c`
- **gerado em**: 2026-10-19T01:17:41.747Z
- **gate efetivo**: LOCAL — o runner do GitHub não inicia jobs por limite de gastos da conta

## Pré-voo (fase A)

| check | resultado | detalhe |
|---|---|---|
| `A1-identidade-commit` | ok | HEAD=afdbbd3c631f34ed45bfb4f894255c9c1ae40d6c |
| `A2-sha-esperado` | ok | não exigido nesta execução |
| `A3-arvore-limpa` | ok | NÃO exigida nesta execução; árvore SUJA (6+) |
| `A4-inventario-defeitos` | ok | 94 item(ns) |
| `A5-dependencias` | ok | node_modules presente |
| `A5b-jest` | ok | binário do Jest |
| `A6-node` | ok | node 22.12.0 |
| `A7-regras-preventivas` | ok | 7 presentes |
| `A8-evidencia-anterior` | nota (não bloqueia) | de OUTRO commit (7252c851656b) — STALE, não conta como evidência do código atual |
| `A9-lineage-run-projecao` | ok | run rap-governed-20261017111858007-5d93eee8 FECHADO (ABANDONED) com motivo e evidência declarados — projeção do último ciclo concluído |

Inventário de defeitos: 94 item(ns), 2 aberto(s), 0 bloqueante(s) para certificação.

## Autorizações de fase (Bug Closure First)

| fase | operação | decisão | motivos |
|---|---|---|---|
| B | `TESTES_NEGATIVOS_REGRESSAO` | **ALLOWED** | BLOQUEIO_EXTERNO_NAO_RESOLVE_CERTIFICACAO |
| C | `L0_COMPLETO` | **ALLOWED** | BLOQUEIO_EXTERNO_NAO_RESOLVE_CERTIFICACAO |

**BLOQUEIO**: fase C — `PASSO_FALHOU` L0-suite-oficial exit=1

## Passos executados (comando, exit code, duração, sha256 da saída)

| fase | passo | comando | exit | duração | sha256 da saída |
|---|---|---|---|---|---|
| B | `B-nada-a-executar` | `(nenhum)` | null | 0.0s | `e3b0c44298fc1c14…` |
| C | `L0-suite-oficial` | `npm test` | 1 | 140.7s | `36469e0ee47f4d0c…` |

## Estado do runner do GitHub (medido)

```json
{
  "medido": true,
  "execucoesNaBranch": 1,
  "ultimaExecucao": {
    "databaseId": 39184502775,
    "headSha": "afdbbd3c631f34ed45bfb4f894255c9c1ae40d6c",
    "conclusao": "failure",
    "criadaEm": "2026-10-19T01:15:12Z"
  }
}
```

## Como reconferir a evidência

```bash
node scripts/ci/dev-branch-gate.js --fases A,B,C   # reexecuta as mesmas fases
git log -1 --format=%H -- AI_MEMORY/evidence/dev-branch-ci-afdbbd3c631f-parcial.md   # commit que publicou esta evidência
```

`evidenceSha256` = `c097821e99b4b126ec39c11a60686641813366254a79cc1f3b6d11a977faf02a` (sha256 do payload sem este campo).

```json
{
  "schemaVersion": 2,
  "kind": "dev-branch-ci-evidence",
  "comando": "node scripts/ci/dev-branch-gate.js",
  "veredito": "FAIL",
  "equivalenteAValidacaoCompleta": false,
  "escopo": "PARCIAL",
  "fasesPedidas": [
    "A",
    "B",
    "C"
  ],
  "fasesConcluidas": [],
  "sha": "afdbbd3c631f34ed45bfb4f894255c9c1ae40d6c",
  "shaCurto": "afdbbd3c631f",
  "branch": "dev/engineering-hardening",
  "escopoDefeitos": null,
  "runnerDoGithub": {
    "medido": true,
    "execucoesNaBranch": 1,
    "ultimaExecucao": {
      "databaseId": 39184502775,
      "headSha": "afdbbd3c631f34ed45bfb4f894255c9c1ae40d6c",
      "conclusao": "failure",
      "criadaEm": "2026-10-19T01:15:12Z"
    }
  },
  "gateEfetivo": "LOCAL (o runner do GitHub nao inicia jobs por limite de gastos da conta)",
  "preVoo": {
    "ok": true,
    "checks": [
      {
        "id": "A1-identidade-commit",
        "ok": true,
        "detalhe": "HEAD=afdbbd3c631f34ed45bfb4f894255c9c1ae40d6c"
      },
      {
        "id": "A2-sha-esperado",
        "ok": true,
        "detalhe": "não exigido nesta execução"
      },
      {
        "id": "A3-arvore-limpa",
        "ok": true,
        "detalhe": "NÃO exigida nesta execução; árvore SUJA (6+)"
      },
      {
        "id": "A4-inventario-defeitos",
        "ok": true,
        "detalhe": "94 item(ns)"
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
        "detalhe": "de OUTRO commit (7252c851656b) — STALE, não conta como evidência do código atual",
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
      "total": 94,
      "abertos": 2,
      "bloqueantesParaCertificacao": 0,
      "semSeveridadeAbertos": 0,
      "bloqueioExterno": 2,
      "riscoAceito": 0,
      "porEstado": {
        "VERIFIED": 74,
        "BLOCKED_EXTERNAL": 2,
        "RESOLVED": 18
      },
      "porSeveridade": {
        "P0": 22,
        "P1": 40,
        "P2": 22,
        "P3": 10
      }
    },
    "erroInventario": null,
    "arvoreSuja": true,
    "arquivosSujos": [
      "M reports/rag-domain-segregation-report.json",
      " M reports/tenant-isolation-report.json",
      "?? AI_MEMORY/evidence/dev-branch-ci-4169290c0d6b-completo.md",
      "?? AI_MEMORY/evidence/dev-branch-ci-4169290c0d6b-parcial.md",
      "?? AI_MEMORY/evidence/dev-branch-ci-7252c851656b-parcial.md",
      "?? AI_MEMORY/evidence/dev-branch-ci-b8464c1a8e5f-parcial.md"
    ],
    "evidenciaAnterior": {
      "sha": "7252c851656bfbd3114f20dd6c1805d4e462576a",
      "veredito": "FAIL",
      "escopo": "PARCIAL"
    }
  },
  "autorizacoes": [
    {
      "fase": "B",
      "operacao": "TESTES_NEGATIVOS_REGRESSAO",
      "allowed": true,
      "decision": "ALLOWED",
      "reasonCodes": [
        "BLOQUEIO_EXTERNO_NAO_RESOLVE_CERTIFICACAO"
      ],
      "requiredActions": [],
      "blockingFindings": []
    },
    {
      "fase": "C",
      "operacao": "L0_COMPLETO",
      "allowed": true,
      "decision": "ALLOWED",
      "reasonCodes": [
        "BLOQUEIO_EXTERNO_NAO_RESOLVE_CERTIFICACAO"
      ],
      "requiredActions": [],
      "blockingFindings": []
    }
  ],
  "bloqueio": {
    "fase": "C",
    "code": "PASSO_FALHOU",
    "detail": "L0-suite-oficial exit=1"
  },
  "passos": [
    {
      "id": "B-nada-a-executar",
      "fase": "B",
      "nivel": "B",
      "descricao": "Nenhum regressionTest declarado para os defeitos em escopo",
      "comando": "(nenhum)",
      "exitCode": null,
      "timeout": false,
      "duracaoMs": 0,
      "sha256Saida": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      "saidaFinal": "",
      "naoExecutado": true
    },
    {
      "id": "L0-suite-oficial",
      "fase": "C",
      "nivel": "L0",
      "descricao": "Suíte oficial Jest (unit + flow + rpa sem browser)",
      "comando": "npm test",
      "exitCode": 1,
      "timeout": false,
      "duracaoMs": 140678,
      "sha256Saida": "36469e0ee47f4d0c9038cd17d1aef2207c3ee1375e1e06db9b4fface647675b8",
      "saidaFinal": "      208 |     expect(allPass).toBe(true);\n      209 |   }, 30000);\n      210 | });\n\n      at Object.toBe (tests/unit/engineeringRouterExecutionSandboxSecurity.test.js:207:31)\n\n\nTest Suites: 1 failed, 334 passed, 335 of 1053 total\nTests:       1 failed, 5353 passed, 5354 total\nSnapshots:   0 total\nTime:        138.367 s, estimated 141 s\nRan all test suites matching /tests\\/unit/i."
    }
  ],
  "falhas": [
    {
      "id": "B-nada-a-executar",
      "fase": "B",
      "comando": "(nenhum)",
      "exitCode": null
    },
    {
      "id": "L0-suite-oficial",
      "fase": "C",
      "comando": "npm test",
      "exitCode": 1
    }
  ],
  "evidenceSha256": "c097821e99b4b126ec39c11a60686641813366254a79cc1f3b6d11a977faf02a"
}
```
