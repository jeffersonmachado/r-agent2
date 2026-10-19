# Gate em fases da branch de desenvolvimento — 1f427bfbcfb4 (PARCIAL)

- **veredito**: `FAIL`
- **equivale a validação completa**: `false`
- **fases pedidas**: `A,B,C`
- **fases concluídas**: `(nenhuma)`
- **branch**: `dev/engineering-hardening`
- **sha exato avaliado**: `1f427bfbcfb40b3f6a2a3e8bacbe7182adca980d`
- **gerado em**: 2026-10-19T01:42:45.381Z
- **gate efetivo**: LOCAL — o runner do GitHub não inicia jobs por limite de gastos da conta

## Pré-voo (fase A)

| check | resultado | detalhe |
|---|---|---|
| `A1-identidade-commit` | ok | HEAD=1f427bfbcfb40b3f6a2a3e8bacbe7182adca980d |
| `A2-sha-esperado` | ok | não exigido nesta execução |
| `A3-arvore-limpa` | ok | NÃO exigida nesta execução; árvore SUJA (10+) |
| `A4-inventario-defeitos` | ok | 94 item(ns) |
| `A5-dependencias` | ok | node_modules presente |
| `A5b-jest` | ok | binário do Jest |
| `A6-node` | ok | node 22.12.0 |
| `A7-regras-preventivas` | ok | 7 presentes |
| `A8-evidencia-anterior` | nota (não bloqueia) | de OUTRO commit (02e4312a2b6e) — STALE, não conta como evidência do código atual |
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
| C | `L0-suite-oficial` | `npm test` | 1 | 136.9s | `9664edd611c76592…` |

## Estado do runner do GitHub (medido)

```json
{
  "medido": true,
  "execucoesNaBranch": 1,
  "ultimaExecucao": {
    "databaseId": 39186425689,
    "headSha": "1f427bfbcfb40b3f6a2a3e8bacbe7182adca980d",
    "conclusao": "failure",
    "criadaEm": "2026-10-19T01:40:27Z"
  }
}
```

## Como reconferir a evidência

```bash
node scripts/ci/dev-branch-gate.js --fases A,B,C   # reexecuta as mesmas fases
git log -1 --format=%H -- AI_MEMORY/evidence/dev-branch-ci-1f427bfbcfb4-parcial.md   # commit que publicou esta evidência
```

`evidenceSha256` = `5a8732a47de21275d129ef24912f48103f6421d25dc74fb92d47e983c653cc35` (sha256 do payload sem este campo).

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
  "sha": "1f427bfbcfb40b3f6a2a3e8bacbe7182adca980d",
  "shaCurto": "1f427bfbcfb4",
  "branch": "dev/engineering-hardening",
  "escopoDefeitos": null,
  "runnerDoGithub": {
    "medido": true,
    "execucoesNaBranch": 1,
    "ultimaExecucao": {
      "databaseId": 39186425689,
      "headSha": "1f427bfbcfb40b3f6a2a3e8bacbe7182adca980d",
      "conclusao": "failure",
      "criadaEm": "2026-10-19T01:40:27Z"
    }
  },
  "gateEfetivo": "LOCAL (o runner do GitHub nao inicia jobs por limite de gastos da conta)",
  "preVoo": {
    "ok": true,
    "checks": [
      {
        "id": "A1-identidade-commit",
        "ok": true,
        "detalhe": "HEAD=1f427bfbcfb40b3f6a2a3e8bacbe7182adca980d"
      },
      {
        "id": "A2-sha-esperado",
        "ok": true,
        "detalhe": "não exigido nesta execução"
      },
      {
        "id": "A3-arvore-limpa",
        "ok": true,
        "detalhe": "NÃO exigida nesta execução; árvore SUJA (10+)"
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
        "detalhe": "de OUTRO commit (02e4312a2b6e) — STALE, não conta como evidência do código atual",
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
      "M api/services/engineeringRouter/executionSandbox.js",
      " M reports/rag-domain-segregation-report.json",
      " M reports/tenant-isolation-report.json",
      "?? AI_MEMORY/evidence/dev-branch-ci-02e4312a2b6e-parcial.md",
      "?? AI_MEMORY/evidence/dev-branch-ci-290e56afbf4d-parcial.md",
      "?? AI_MEMORY/evidence/dev-branch-ci-4169290c0d6b-completo.md",
      "?? AI_MEMORY/evidence/dev-branch-ci-4169290c0d6b-parcial.md",
      "?? AI_MEMORY/evidence/dev-branch-ci-7252c851656b-parcial.md",
      "?? AI_MEMORY/evidence/dev-branch-ci-afdbbd3c631f-parcial.md",
      "?? AI_MEMORY/evidence/dev-branch-ci-b8464c1a8e5f-parcial.md"
    ],
    "evidenciaAnterior": {
      "sha": "02e4312a2b6e46d2933976f54c192506707b7089",
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
      "duracaoMs": 136883,
      "sha256Saida": "9664edd611c765920cf78a24a176eb068afd3880c57e86ea87b1beed2621fedc",
      "saidaFinal": "      134 |       // Nenhum reload em nenhuma das duas passagens.\n      135 |       expect(ensure.log).not.toContain('module reload');\n      136 |     } finally {\n\n      at Object.toContain (tests/unit/pbx/pbxCdrHealth.test.js:133:28)\n\n\nTest Suites: 1 failed, 207 passed, 208 of 1053 total\nTests:       1 failed, 3674 passed, 3675 total\nSnapshots:   0 total\nTime:        135.183 s, estimated 194 s\nRan all test suites matching /tests\\/unit/i."
    }
  ],
  "falhas": [
    {
      "id": "L0-suite-oficial",
      "fase": "C",
      "comando": "npm test",
      "exitCode": 1
    }
  ],
  "evidenceSha256": "5a8732a47de21275d129ef24912f48103f6421d25dc74fb92d47e983c653cc35"
}
```
