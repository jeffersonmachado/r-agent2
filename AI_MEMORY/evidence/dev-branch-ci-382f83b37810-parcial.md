# Gate em fases da branch de desenvolvimento — 382f83b37810 (PARCIAL)

- **veredito**: `FAIL`
- **equivale a validação completa**: `false`
- **fases pedidas**: `A,B,C,D`
- **fases obrigatórias**: `A,B,C,D,E,F`
- **fases faltantes**: `E,F`
- **entrada inválida**: `não`
- **branch**: `HEAD`
- **sha exato avaliado**: `382f83b37810f4f1abaf433ac4b67e8c88d28a18`
- **gerado em**: 2026-10-22T01:22:40.535Z
- **gate efetivo**: LOCAL — o runner do GitHub não inicia jobs por limite de gastos da conta

## Estado por fase (comprovação, não intenção)

| fase | estado | passos reais | motivo |
|---|---|---|---|
| A | **PASS** | 10 | — |
| B | **PASS** | 3 | — |
| C | **BLOCKED** | 1 | PASSO_FALHOU |
| D | **NOT_EXECUTED** | 0 | FASE_NAO_EXECUTADA |

## Pré-voo (fase A)

| check | resultado | detalhe |
|---|---|---|
| `A1-identidade-commit` | ok | HEAD=382f83b37810f4f1abaf433ac4b67e8c88d28a18 |
| `A2-sha-esperado` | ok | não exigido nesta execução |
| `A3-arvore-limpa` | ok | limpa |
| `A4-inventario-defeitos` | ok | 131 item(ns) |
| `A5-dependencias` | ok | node_modules presente |
| `A5b-jest` | ok | binário do Jest |
| `A6-node` | ok | node 22.12.0 |
| `A7-regras-preventivas` | ok | 12 presentes |
| `A8-evidencia-anterior` | ok | não existe relatório anterior |
| `A9-lineage-run-projecao` | ok | sem run aberto ou sem projeção (nada a comparar) |

Inventário de defeitos: 131 item(ns), 6 aberto(s), 1 bloqueante(s) para certificação.

## Autorizações de fase (Bug Closure First)

| fase | operação | decisão | motivos |
|---|---|---|---|
| B | `TESTES_NEGATIVOS_REGRESSAO` | **ALLOWED** | BLOQUEIO_EXTERNO_NAO_RESOLVE_CERTIFICACAO |
| C | `L0_COMPLETO` | **ALLOWED** | BLOQUEIO_EXTERNO_NAO_RESOLVE_CERTIFICACAO |

**BLOQUEIO**: fase C — `PASSO_FALHOU` L0-suite-oficial exit=1

## Passos executados (comando, exit code, duração, sha256 da saída)

| fase | passo | comando | exit | duração | sha256 da saída |
|---|---|---|---|---|---|
| B | `B1-phaseStepContract.test.js` | `npx jest tests/unit/governance/phaseStepContract.test.js --bail=0` | 0 | 8.9s | `c5ac90b86e65a673…` |
| B | `B2-devBranchGatePhaseContract.test.js` | `npx jest tests/unit/governance/devBranchGatePhaseContract.test.js --bail=0` | 0 | 8.4s | `d912ebc018aac2b0…` |
| B | `B3-devBranchGateStepEvidence.test.js` | `npx jest tests/unit/governance/devBranchGateStepEvidence.test.js --bail=0` | 0 | 6.8s | `1f556f9237358e84…` |
| C | `L0-suite-oficial` | `npm test` | 1 | 257.3s | `fa60977546e2e4e5…` |

## Estado do runner do GitHub (medido)

```json
{
  "medido": false,
  "motivo": "gh indisponivel ou sem autenticacao nesta execucao",
  "observado": "failed to determine base repo: none of the git remotes configured for this repository point to a known GitHub host. To tell gh about a new GitHub host, please use `gh auth login`"
}
```

## Como reconferir a evidência

```bash
node scripts/ci/dev-branch-gate.js --fases A,B,C,D   # reexecuta as mesmas fases
git log -1 --format=%H -- AI_MEMORY/evidence/dev-branch-ci-382f83b37810-parcial.md   # commit que publicou esta evidência
```

`evidenceSha256` = `c41098ed14a47000e33ec3c002649b0d94bfa339a249281d17b0678dbc1df2cd` (sha256 do payload sem este campo).

```json
{
  "schemaVersion": 3,
  "kind": "dev-branch-ci-evidence",
  "comando": "node scripts/ci/dev-branch-gate.js",
  "veredito": "FAIL",
  "equivalenteAValidacaoCompleta": false,
  "escopo": "PARCIAL",
  "fasesPedidas": [
    "A",
    "B",
    "C",
    "D"
  ],
  "fasesObrigatorias": [
    "A",
    "B",
    "C",
    "D",
    "E",
    "F"
  ],
  "fasesFaltantes": [
    "E",
    "F"
  ],
  "estadosPorFase": [
    {
      "fase": "A",
      "estado": "PASS",
      "passosReais": 10,
      "motivo": null
    },
    {
      "fase": "B",
      "estado": "PASS",
      "passosReais": 3,
      "motivo": null
    },
    {
      "fase": "C",
      "estado": "BLOCKED",
      "passosReais": 1,
      "passosEsperados": 2,
      "motivo": "PASSO_FALHOU"
    },
    {
      "fase": "D",
      "estado": "NOT_EXECUTED",
      "passosReais": 0,
      "passosEsperados": 7,
      "passosAusentes": [],
      "motivo": "FASE_NAO_EXECUTADA"
    }
  ],
  "fasesNaoAprovadas": [
    "C",
    "D"
  ],
  "entradaInvalida": null,
  "entrada": {
    "bruto": "A,B,C,D",
    "duplicadas": [],
    "desconhecidas": []
  },
  "contextoExecucao": {
    "sha": "382f83b37810f4f1abaf433ac4b67e8c88d28a18",
    "execucaoId": "b986ca9b-7a13-49cf-b3d7-1ff9052db67f"
  },
  "identidade": {
    "sha": "382f83b37810f4f1abaf433ac4b67e8c88d28a18",
    "branch": "HEAD",
    "shaValido": true,
    "branchValida": true
  },
  "fasesConcluidas": [
    "A",
    "B"
  ],
  "fasesNaoAplicaveis": [],
  "sha": "382f83b37810f4f1abaf433ac4b67e8c88d28a18",
  "shaCurto": "382f83b37810",
  "branch": "HEAD",
  "escopoDefeitos": null,
  "runnerDoGithub": {
    "medido": false,
    "motivo": "gh indisponivel ou sem autenticacao nesta execucao",
    "observado": "failed to determine base repo: none of the git remotes configured for this repository point to a known GitHub host. To tell gh about a new GitHub host, please use `gh auth login`"
  },
  "gateEfetivo": "LOCAL (o runner do GitHub nao inicia jobs por limite de gastos da conta)",
  "preVoo": {
    "ok": true,
    "checks": [
      {
        "id": "A1-identidade-commit",
        "ok": true,
        "detalhe": "HEAD=382f83b37810f4f1abaf433ac4b67e8c88d28a18"
      },
      {
        "id": "A2-sha-esperado",
        "ok": true,
        "detalhe": "não exigido nesta execução"
      },
      {
        "id": "A3-arvore-limpa",
        "ok": true,
        "detalhe": "limpa"
      },
      {
        "id": "A4-inventario-defeitos",
        "ok": true,
        "detalhe": "131 item(ns)"
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
        "detalhe": "12 presentes"
      },
      {
        "id": "A8-evidencia-anterior",
        "ok": true,
        "detalhe": "não existe relatório anterior",
        "bloqueante": false
      },
      {
        "id": "A9-lineage-run-projecao",
        "ok": true,
        "detalhe": "sem run aberto ou sem projeção (nada a comparar)",
        "bloqueante": false
      }
    ],
    "achados": [],
    "inventario": {
      "total": 131,
      "abertos": 6,
      "bloqueantesParaCertificacao": 1,
      "semSeveridadeAbertos": 0,
      "bloqueioExterno": 6,
      "riscoAceito": 0,
      "porEstado": {
        "VERIFIED": 107,
        "BLOCKED_EXTERNAL": 6,
        "RESOLVED": 18
      },
      "porSeveridade": {
        "P0": 31,
        "P1": 64,
        "P2": 26,
        "P3": 10
      }
    },
    "erroInventario": null,
    "arvoreSuja": false,
    "arquivosSujos": [],
    "evidenciaAnterior": null
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
      "id": "B1-phaseStepContract.test.js",
      "fase": "B",
      "nivel": "B",
      "descricao": "Teste de regressão declarado: tests/unit/governance/phaseStepContract.test.js",
      "comando": "npx jest tests/unit/governance/phaseStepContract.test.js --bail=0",
      "exitCode": 0,
      "timeout": false,
      "duracaoMs": 8890,
      "sha256Saida": "c5ac90b86e65a6736b7a7bc0a3e9557d45fe3e392ef21d2ee717c8b1fbc33c1a",
      "saidaFinal": "  P0-01 — integração com decidirVeredito\n    ✓ fase D INCOMPLETE nunca vira PASS global (102 ms)\n\nTest Suites: 1 passed, 1 total\nTests:       27 passed, 27 total\nSnapshots:   0 total\nTime:        4.434 s\nRan all test suites matching /tests\\/unit\\/governance\\/phaseStepContract.test.js/i.\n[engineering-runner-jest 2026-10-22T01:18:07.696Z] runner ENCERROU: pid=4133795 code=0 signal=null\n[engineering-runner-jest 2026-10-22T01:18:07.703Z] apos o encerramento, /health na porta 8097: sem resposta\n[jest-global-teardown] Engineering Runner (pid 4133795) encerrado (porta liberada)\nForce exiting Jest: Have you considered using `--detectOpenHandles` to detect async operations that kept running after all tests finished?",
      "saidaRef": "AI_MEMORY/evidence/dev-branch-gate-logs/b986ca9b-7a13-49cf-b3d7-1ff9052db67f/B1-phaseStepContract.test.js.log"
    },
    {
      "id": "B2-devBranchGatePhaseContract.test.js",
      "fase": "B",
      "nivel": "B",
      "descricao": "Teste de regressão declarado: tests/unit/governance/devBranchGatePhaseContract.test.js",
      "comando": "npx jest tests/unit/governance/devBranchGatePhaseContract.test.js --bail=0",
      "exitCode": 0,
      "timeout": false,
      "duracaoMs": 8422,
      "sha256Saida": "d912ebc018aac2b0cffb9358e671cffda199af7ff61cc8015dc38fd77de026ff",
      "saidaFinal": "    ✓ --fases Z ⇒ ENTRADA_INVALIDA (550 ms)\n    ✓ o contexto de execução é único por rodada (102 ms)\n\nTest Suites: 1 passed, 1 total\nTests:       21 passed, 21 total\nSnapshots:   0 total\nTime:        4.592 s\nRan all test suites matching /tests\\/unit\\/governance\\/devBranchGatePhaseContract.test.js/i.\n[engineering-runner-jest 2026-10-22T01:18:16.139Z] runner ENCERROU: pid=4133993 code=0 signal=null\n[engineering-runner-jest 2026-10-22T01:18:16.143Z] apos o encerramento, /health na porta 8097: sem resposta\n[jest-global-teardown] Engineering Runner (pid 4133993) encerrado (porta liberada)\nForce exiting Jest: Have you considered using `--detectOpenHandles` to detect async operations that kept running after all tests finished?",
      "saidaRef": "AI_MEMORY/evidence/dev-branch-gate-logs/b986ca9b-7a13-49cf-b3d7-1ff9052db67f/B2-devBranchGatePhaseContract.test.js.log"
    },
    {
      "id": "B3-devBranchGateStepEvidence.test.js",
      "fase": "B",
      "nivel": "B",
      "descricao": "Teste de regressão declarado: tests/unit/governance/devBranchGateStepEvidence.test.js",
      "comando": "npx jest tests/unit/governance/devBranchGateStepEvidence.test.js --bail=0",
      "exitCode": 0,
      "timeout": false,
      "duracaoMs": 6830,
      "sha256Saida": "1f556f9237358e8494b76854f33051b7c0eb4b4b6b57c2b4324ff13fce7f8cfd",
      "saidaFinal": "    ✓ passo que FALHA também deixa a saída completa — falha é diagnosticável, não só contada (252 ms)\n    ✓ o log fica separado por execucaoId — duas execuções não sobrescrevem a evidência uma da outra (148 ms)\n\nTest Suites: 1 passed, 1 total\nTests:       3 passed, 3 total\nSnapshots:   0 total\nTime:        2.209 s\nRan all test suites matching /tests\\/unit\\/governance\\/devBranchGateStepEvidence.test.js/i.\n[engineering-runner-jest 2026-10-22T01:18:22.904Z] runner ENCERROU: pid=4134388 code=0 signal=null\n[engineering-runner-jest 2026-10-22T01:18:22.923Z] apos o encerramento, /health na porta 8097: sem resposta\n[jest-global-teardown] Engineering Runner (pid 4134388) encerrado (porta liberada)\nForce exiting Jest: Have you considered using `--detectOpenHandles` to detect async operations that kept running after all tests finished?",
      "saidaRef": "AI_MEMORY/evidence/dev-branch-gate-logs/b986ca9b-7a13-49cf-b3d7-1ff9052db67f/B3-devBranchGateStepEvidence.test.js.log"
    },
    {
      "id": "L0-suite-oficial",
      "fase": "C",
      "nivel": "L0",
      "descricao": "Suíte oficial Jest (unit + flow + rpa sem browser)",
      "comando": "npm test",
      "exitCode": 1,
      "timeout": false,
      "duracaoMs": 257272,
      "sha256Saida": "fa60977546e2e4e5023df6c4c4013d0f14cca4608147ca54a6d8a2e612574bb3",
      "saidaFinal": "     \u001b[90m 142 |\u001b[39m     expect(report\u001b[33m?\u001b[39m\u001b[33m.\u001b[39mpass)\u001b[33m.\u001b[39mtoBe(\u001b[36mtrue\u001b[39m)\u001b[33m;\u001b[39m\n     \u001b[90m 143 |\u001b[39m     expect(report\u001b[33m?\u001b[39m\u001b[33m.\u001b[39mdecision)\u001b[33m.\u001b[39mtoBe(\u001b[32m'MODEL_DRIVEN_E2E_VALIDATED'\u001b[39m)\u001b[33m;\u001b[39m\n     \u001b[90m 144 |\u001b[39m     expect(report\u001b[33m?\u001b[39m\u001b[33m.\u001b[39mpipelineOutput\u001b[33m?\u001b[39m\u001b[33m.\u001b[39mjourneysDiscovered)\u001b[33m.\u001b[39mtoBeGreaterThan(\u001b[35m0\u001b[39m)\u001b[33m;\u001b[39m\u001b[0m\n\n      at Object.toBe (tests/unit/governance/modelDrivenE2e.test.js:141:27)\n\n\nTest Suites: 1 failed, 378 passed, 379 of 1095 total\nTests:       1 failed, 5567 passed, 5568 total\nSnapshots:   0 total\nTime:        253.157 s\nRan all test suites matching /tests\\/unit/i.",
      "saidaRef": "AI_MEMORY/evidence/dev-branch-gate-logs/b986ca9b-7a13-49cf-b3d7-1ff9052db67f/L0-suite-oficial.log"
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
  "evidenceSha256": "c41098ed14a47000e33ec3c002649b0d94bfa339a249281d17b0678dbc1df2cd"
}
```
