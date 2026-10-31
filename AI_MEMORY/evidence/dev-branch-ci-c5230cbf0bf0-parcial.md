# Gate em fases da branch de desenvolvimento — c5230cbf0bf0 (PARCIAL)

- **veredito**: `FAIL`
- **equivale a validação completa**: `false`
- **fases pedidas**: `A,B,C,D`
- **fases obrigatórias**: `A,B,C,D,R,E,F`
- **fases faltantes**: `R,E,F`
- **entrada inválida**: `não`
- **branch**: `codex/p1-governance-hardening-20261023`
- **sha exato avaliado**: `c5230cbf0bf08dbfffe1c3dab21849ae6e515640`
- **gerado em**: 2026-10-24T18:55:15.745Z
- **gate efetivo**: LOCAL — o runner do GitHub não inicia jobs por limite de gastos da conta

## Estado por fase (comprovação, não intenção)

| fase | estado | passos reais | motivo |
|---|---|---|---|
| A | **PASS** | 10 | — |
| B | **PASS** | 3 | — |
| C | **BLOCKED** | 2 | PASSO_FALHOU |
| D | **NOT_EXECUTED** | 0 | FASE_NAO_EXECUTADA |

## Pré-voo (fase A)

| check | resultado | detalhe |
|---|---|---|
| `A1-identidade-commit` | ok | HEAD=c5230cbf0bf08dbfffe1c3dab21849ae6e515640 |
| `A2-sha-esperado` | ok | não exigido nesta execução |
| `A3-arvore-limpa` | ok | limpa |
| `A4-inventario-defeitos` | ok | 135 item(ns) |
| `A5-dependencias` | ok | node_modules presente |
| `A5b-jest` | ok | binário do Jest |
| `A6-node` | ok | node 22.12.0 |
| `A7-regras-preventivas` | ok | 12 presentes |
| `A8-evidencia-anterior` | ok | não existe relatório anterior |
| `A9-lineage-run-projecao` | ok | sem run aberto ou sem projeção (nada a comparar) |

Inventário de defeitos: 135 item(ns), 135 aberto(s), 98 bloqueante(s) para certificação.

## Autorizações de fase (Bug Closure First)

| fase | operação | decisão | motivos |
|---|---|---|---|
| B | `TESTES_NEGATIVOS_REGRESSAO` | **ALLOWED** | BLOQUEIO_EXTERNO_NAO_RESOLVE_CERTIFICACAO |
| C | `L0_COMPLETO` | **ALLOWED** | BLOQUEIO_EXTERNO_NAO_RESOLVE_CERTIFICACAO |

**BLOQUEIO**: fase C — `PASSO_FALHOU` L0-suite-oficial exit=1

## Passos executados (comando, exit code, duração, sha256 da saída)

| fase | passo | comando | exit | duração | sha256 da saída |
|---|---|---|---|---|---|
| B | `B1-phaseStepContract.test.js` | `npx jest tests/unit/governance/phaseStepContract.test.js --bail=0` | 0 | 8.1s | `2e4de8adf4be92c7…` |
| B | `B2-devBranchGatePhaseContract.test.js` | `npx jest tests/unit/governance/devBranchGatePhaseContract.test.js --bail=0` | 0 | 5.7s | `33d28d981223368c…` |
| B | `B3-devBranchGateStepEvidence.test.js` | `npx jest tests/unit/governance/devBranchGateStepEvidence.test.js --bail=0` | 0 | 3.5s | `91c12c12aa1dd2c3…` |
| C | `L0a-artefatos-canoeiros` | `npm run ci:artifacts` | 0 | 13.6s | `768c1f2a2f9b30e2…` |
| C | `L0-suite-oficial` | `npm test` | 1 | 249.7s | `31d699ffb535cf62…` |

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
git log -1 --format=%H -- AI_MEMORY/evidence/dev-branch-ci-c5230cbf0bf0-parcial.md   # commit que publicou esta evidência
```

`evidenceSha256` = `0825d64b9e218876bc12ad325d62d1af989a28dff897109c39362a27aeb18ac9` (sha256 do payload sem este campo).

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
    "R",
    "E",
    "F"
  ],
  "fasesFaltantes": [
    "R",
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
      "passosReais": 2,
      "passosEsperados": 3,
      "motivo": "PASSO_FALHOU"
    },
    {
      "fase": "D",
      "estado": "NOT_EXECUTED",
      "passosReais": 0,
      "passosEsperados": 4,
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
    "sha": "c5230cbf0bf08dbfffe1c3dab21849ae6e515640",
    "execucaoId": "4c30271e-a1b7-4203-bfa5-afe020c3c9c2"
  },
  "identidade": {
    "sha": "c5230cbf0bf08dbfffe1c3dab21849ae6e515640",
    "branch": "codex/p1-governance-hardening-20261023",
    "shaValido": true,
    "branchValida": true
  },
  "fasesConcluidas": [
    "A",
    "B"
  ],
  "fasesNaoAplicaveis": [],
  "sha": "c5230cbf0bf08dbfffe1c3dab21849ae6e515640",
  "shaCurto": "c5230cbf0bf0",
  "branch": "codex/p1-governance-hardening-20261023",
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
        "detalhe": "HEAD=c5230cbf0bf08dbfffe1c3dab21849ae6e515640"
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
        "detalhe": "135 item(ns)"
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
      "total": 135,
      "abertos": 135,
      "bloqueantesParaCertificacao": 98,
      "semSeveridadeAbertos": 0,
      "bloqueioExterno": 5,
      "riscoAceito": 0,
      "porEstado": {
        "VERIFIED": 111,
        "BLOCKED_EXTERNAL": 5,
        "RESOLVED": 19
      },
      "porSeveridade": {
        "P0": 31,
        "P1": 67,
        "P2": 27,
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
      "duracaoMs": 8098,
      "sha256Saida": "2e4de8adf4be92c71b0c4023c23d55ab371c2fcf0cd06c2ad17cf480f9f46c01",
      "saidaFinal": "  P0-01 — integração com decidirVeredito\n    ✓ fase D INCOMPLETE nunca vira PASS global (103 ms)\n\nTest Suites: 1 passed, 1 total\nTests:       29 passed, 29 total\nSnapshots:   0 total\nTime:        4.643 s\nRan all test suites matching /tests\\/unit\\/governance\\/phaseStepContract.test.js/i.\n[engineering-runner-jest 2026-10-24T18:50:42.951Z] runner ENCERROU: pid=1303935 code=0 signal=null\n[engineering-runner-jest 2026-10-24T18:50:42.962Z] apos o encerramento, /health na porta 34877: sem resposta\n[jest-global-teardown] Engineering Runner (pid 1303935) encerrado (porta liberada)\nForce exiting Jest: Have you considered using `--detectOpenHandles` to detect async operations that kept running after all tests finished?",
      "saidaRef": "AI_MEMORY/evidence/dev-branch-gate-logs/4c30271e-a1b7-4203-bfa5-afe020c3c9c2/B1-phaseStepContract.test.js.log"
    },
    {
      "id": "B2-devBranchGatePhaseContract.test.js",
      "fase": "B",
      "nivel": "B",
      "descricao": "Teste de regressão declarado: tests/unit/governance/devBranchGatePhaseContract.test.js",
      "comando": "npx jest tests/unit/governance/devBranchGatePhaseContract.test.js --bail=0",
      "exitCode": 0,
      "timeout": false,
      "duracaoMs": 5693,
      "sha256Saida": "33d28d981223368c5f82dfb1f1e590a00086be9dd3c15ea1135730796712e4f7",
      "saidaFinal": "    ✓ --fases Z ⇒ ENTRADA_INVALIDA (297 ms)\n    ✓ o contexto de execução é único por rodada (105 ms)\n\nTest Suites: 1 passed, 1 total\nTests:       21 passed, 21 total\nSnapshots:   0 total\nTime:        3.235 s\nRan all test suites matching /tests\\/unit\\/governance\\/devBranchGatePhaseContract.test.js/i.\n[engineering-runner-jest 2026-10-24T18:50:48.603Z] runner ENCERROU: pid=1304186 code=0 signal=null\n[engineering-runner-jest 2026-10-24T18:50:48.608Z] apos o encerramento, /health na porta 34877: sem resposta\n[jest-global-teardown] Engineering Runner (pid 1304186) encerrado (porta liberada)\nForce exiting Jest: Have you considered using `--detectOpenHandles` to detect async operations that kept running after all tests finished?",
      "saidaRef": "AI_MEMORY/evidence/dev-branch-gate-logs/4c30271e-a1b7-4203-bfa5-afe020c3c9c2/B2-devBranchGatePhaseContract.test.js.log"
    },
    {
      "id": "B3-devBranchGateStepEvidence.test.js",
      "fase": "B",
      "nivel": "B",
      "descricao": "Teste de regressão declarado: tests/unit/governance/devBranchGateStepEvidence.test.js",
      "comando": "npx jest tests/unit/governance/devBranchGateStepEvidence.test.js --bail=0",
      "exitCode": 0,
      "timeout": false,
      "duracaoMs": 3453,
      "sha256Saida": "91c12c12aa1dd2c347e800065cfd5039dbefdc756dbf205ed7557f78a50f8421",
      "saidaFinal": "    ✓ passo que FALHA também deixa a saída completa — falha é diagnosticável, não só contada (278 ms)\n    ✓ o log fica separado por execucaoId — duas execuções não sobrescrevem a evidência uma da outra (156 ms)\n\nTest Suites: 1 passed, 1 total\nTests:       3 passed, 3 total\nSnapshots:   0 total\nTime:        1.08 s\nRan all test suites matching /tests\\/unit\\/governance\\/devBranchGateStepEvidence.test.js/i.\n[engineering-runner-jest 2026-10-24T18:50:52.109Z] runner ENCERROU: pid=1304483 code=0 signal=null\n[engineering-runner-jest 2026-10-24T18:50:52.114Z] apos o encerramento, /health na porta 34877: sem resposta\n[jest-global-teardown] Engineering Runner (pid 1304483) encerrado (porta liberada)\nForce exiting Jest: Have you considered using `--detectOpenHandles` to detect async operations that kept running after all tests finished?",
      "saidaRef": "AI_MEMORY/evidence/dev-branch-gate-logs/4c30271e-a1b7-4203-bfa5-afe020c3c9c2/B3-devBranchGateStepEvidence.test.js.log"
    },
    {
      "id": "L0a-artefatos-canoeiros",
      "fase": "C",
      "nivel": "L0",
      "descricao": "Produz os artefatos canônicos (ignorados pelo git) que o L0 consome",
      "comando": "npm run ci:artifacts",
      "exitCode": 0,
      "timeout": false,
      "duracaoMs": 13570,
      "sha256Saida": "768c1f2a2f9b30e2c402b6fa7e6c6719a090f090c88985243522da7eb00efd75",
      "saidaFinal": "[ci:bootstrap]  ok   coverage-completeness veredito=PASS (1s)\n[ci:bootstrap]  ok   benchmark-sufficiency veredito=PASS (0s)\n[ci:bootstrap]  ok   evo-contract veredito=PASS (0s)\n[ci:bootstrap]  ok   layer-conventions veredito=PASS (1s)\n[ci:bootstrap]  ok   journey-projections veredito=PASS (0s)\n[ci:bootstrap]  ok   json-persistence-audit veredito=PASS (1s)\n[ci:bootstrap]  ok   timeout-architecture veredito=NO_GO (4s)\n[ci:bootstrap]  ok   engineering-router-v2 veredito=NO_GO (0s)\n[ci:bootstrap]  ok   governance-summary veredito=FAIL (0s)\n[ci:bootstrap]  ok   impact-validation veredito=ESCALATE (1s)\n[ci:bootstrap]  ok   artefatos-obrigatorios veredito=PASS (0s)\n[ci:bootstrap] modo=artifacts-only veredito=READY — relatório em reports/ci-bootstrap-report.json",
      "saidaRef": "AI_MEMORY/evidence/dev-branch-gate-logs/4c30271e-a1b7-4203-bfa5-afe020c3c9c2/L0a-artefatos-canoeiros.log"
    },
    {
      "id": "L0-suite-oficial",
      "fase": "C",
      "nivel": "L0",
      "descricao": "Suíte oficial Jest (unit + flow + rpa sem browser)",
      "comando": "npm test",
      "exitCode": 1,
      "timeout": false,
      "duracaoMs": 249734,
      "sha256Saida": "31d699ffb535cf625f3517582c509eec14e309e46996429b3cb2a6272dddb4be",
      "saidaFinal": "> chatbot-engine@1.0.0 test\n> npm run test:unit && npm run test:flow && npm run test:rpa:jest\n\n\n> chatbot-engine@1.0.0 test:unit\n> jest tests/unit\n\n  console.info\n    [2026-10-24T18:51:18.593Z] [INFO] [Sequelize] Conectado ao PostgreSQL com sucesso\n\n      at Object.info (api/utils/logger.js:155:15)\n\n  console.info\n    [2026-10-24T18:51:18.837Z] [INFO] [McpClientHub] Connected\n    {\n      \"connection\": \"erp\",\n      \"tenant\": \"mcp-disc-real-1792867878714-nadxlt\"\n    }\n\n      at Object.info (api/utils/logger.js:155:15)\n\n  console.info\n    [2026-10-24T18:51:18.909Z] [INFO] [McpDiscoveryCore] Descoberta persistida\n    {\n      \"connection\": \"erp\",\n      \"mode\": \"discover\",\n      \"toolCount\": 1,\n      \"schemaChanged\": false,\n      \"revalidationRequired\": false\n    }\n\n      at Object.info (api/utils/logger.js:155:15)\n\n  console.info\n    [2026-10-24T18:51:19.075Z] [INFO] [McpClientHub] Connected\n    {\n      \"connection\": \"erp\",\n      \"tenant\": \"mcp-unmapped-real-1792867879026-czn4nd\"\n    }\n\n      at Object.info (api/utils/logger.js:155:15)\n\n  console.info\n    [2026-10-24T18:51:19.147Z] [INFO] [McpDiscoveryCore] Descoberta persistida\n    {\n      \"connection\": \"erp\",\n      \"mode\": \"discover\",\n      \"toolCount\": 1,\n      \"schemaChanged\": false,\n      \"revalidationRequired\": false\n    }\n\n      at Object.info (api/utils/logger.js:155:15)\n\n  console.info\n    [2026-10-24T18:51:19.316Z] [INFO] [McpClientHub] Connected\n    {\n      \"connection\": \"erp\",\n      \"tenant\": \"mcp-invalid-inv-1792867879268-ly3il5\"\n    }\n…\n\nSummary of all failing tests\nFAIL tests/unit/publicStorefrontPhysicalEndpoints.test.js (38.476 s)\n  ● endpoints públicos /storefront e /physical › POST /storefront/orders exige token\n\n    thrown: \"Exceeded timeout of 30000 ms for a test.\n    Add a timeout value to this test to increase the timeout, if this is a long-running test. See https://jestjs.io/docs/api#testname-fn-timeout.\"\n\n    \u001b[0m \u001b[90m 82 |\u001b[39m   }\n     \u001b[90m 83 |\u001b[39m\n    \u001b[31m\u001b[1m>\u001b[22m\u001b[39m\u001b[90m 84 |\u001b[39m   test(\u001b[32m'POST /storefront/orders exige token'\u001b[39m\u001b[33m,\u001b[39m \u001b[36masync\u001b[39m () \u001b[33m=>\u001b[39m {\n     \u001b[90m    |\u001b[39m   \u001b[31m\u001b[1m^\u001b[22m\u001b[39m\n     \u001b[90m 85 |\u001b[39m     jest\u001b[33m.\u001b[39mdoMock(\u001b[32m'../../api/db/sequelize'\u001b[39m\u001b[33m,\u001b[39m () \u001b[33m=>\u001b[39m ({\n     \u001b[90m 86 |\u001b[39m       connect\u001b[33m:\u001b[39m jest\u001b[33m.\u001b[39mfn(\u001b[36masync\u001b[39m () \u001b[33m=>\u001b[39m ({}))\u001b[33m,\u001b[39m\n     \u001b[90m 87 |\u001b[39m       getSequelize\u001b[33m:\u001b[39m jest\u001b[33m.\u001b[39mfn(() \u001b[33m=>\u001b[39m ({}))\u001b[33m,\u001b[39m\u001b[0m\n\n      at test (tests/unit/publicStorefrontPhysicalEndpoints.test.js:84:3)\n      at Object.describe (tests/unit/publicStorefrontPhysicalEndpoints.test.js:41:1)\n\n\nTest Suites: 1 failed, 184 passed, 185 of 1116 total\nTests:       1 failed, 3618 passed, 3619 total\nSnapshots:   0 total\nTime:        247.688 s\nRan all test suites matching /tests\\/unit/i.",
      "saidaRef": "AI_MEMORY/evidence/dev-branch-gate-logs/4c30271e-a1b7-4203-bfa5-afe020c3c9c2/L0-suite-oficial.log"
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
  "evidenceSha256": "0825d64b9e218876bc12ad325d62d1af989a28dff897109c39362a27aeb18ac9"
}
```
