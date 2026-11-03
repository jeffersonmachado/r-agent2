# Gate em fases da branch de desenvolvimento — ea7b96198beb (PARCIAL)

- **veredito**: `FAIL`
- **equivale a validação completa**: `false`
- **fases pedidas**: `A,B,C,D`
- **fases obrigatórias**: `A,B,C,D,R,E,F`
- **fases faltantes**: `R,E,F`
- **entrada inválida**: `não`
- **branch**: `codex/engineering-router-hardening-20261025`
- **sha exato avaliado**: `ea7b96198bebd36b5ac9557d26cb1b6c3ef1f43c`
- **gerado em**: 2026-10-25T18:16:10.554Z
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
| `A1-identidade-commit` | ok | HEAD=ea7b96198bebd36b5ac9557d26cb1b6c3ef1f43c |
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
| B | `B1-phaseStepContract.test.js` | `npx jest tests/unit/governance/phaseStepContract.test.js --bail=0` | 0 | 6.3s | `89558e990ee3913c…` |
| B | `B2-devBranchGatePhaseContract.test.js` | `npx jest tests/unit/governance/devBranchGatePhaseContract.test.js --bail=0` | 0 | 5.4s | `6efbbe83060f3a67…` |
| B | `B3-devBranchGateStepEvidence.test.js` | `npx jest tests/unit/governance/devBranchGateStepEvidence.test.js --bail=0` | 0 | 2.9s | `f6cf6736d260aeb9…` |
| C | `L0a-artefatos-canoeiros` | `npm run ci:artifacts` | 0 | 12.2s | `3692c9982c7772d9…` |
| C | `L0-suite-oficial` | `npm test` | 1 | 185.6s | `0615973c5a353e83…` |

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
git log -1 --format=%H -- AI_MEMORY/evidence/dev-branch-ci-ea7b96198beb-parcial.md   # commit que publicou esta evidência
```

`evidenceSha256` = `fa3559e2b08c1fb1ba2647b89b8a6aec41d7644649ce1eb97c3f10746ceb70fb` (sha256 do payload sem este campo).

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
    "sha": "ea7b96198bebd36b5ac9557d26cb1b6c3ef1f43c",
    "execucaoId": "fd15ffa2-7068-420b-9074-d08d12a0626d"
  },
  "identidade": {
    "sha": "ea7b96198bebd36b5ac9557d26cb1b6c3ef1f43c",
    "branch": "codex/engineering-router-hardening-20261025",
    "shaValido": true,
    "branchValida": true
  },
  "fasesConcluidas": [
    "A",
    "B"
  ],
  "fasesNaoAplicaveis": [],
  "sha": "ea7b96198bebd36b5ac9557d26cb1b6c3ef1f43c",
  "shaCurto": "ea7b96198beb",
  "branch": "codex/engineering-router-hardening-20261025",
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
        "detalhe": "HEAD=ea7b96198bebd36b5ac9557d26cb1b6c3ef1f43c"
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
      "duracaoMs": 6310,
      "sha256Saida": "89558e990ee3913c6edc4418ff82156eae3d553beaff9bcb7af038991f9960cc",
      "saidaFinal": "  P0-01 — integração com decidirVeredito\n    ✓ fase D INCOMPLETE nunca vira PASS global (103 ms)\n\nTest Suites: 1 passed, 1 total\nTests:       29 passed, 29 total\nSnapshots:   0 total\nTime:        3.83 s\nRan all test suites matching /tests\\/unit\\/governance\\/phaseStepContract.test.js/i.\n[engineering-runner-jest 2026-10-25T18:12:44.263Z] runner ENCERROU: pid=3288854 code=0 signal=null\n[engineering-runner-jest 2026-10-25T18:12:44.272Z] apos o encerramento, /health na porta 44345: sem resposta\n[jest-global-teardown] Engineering Runner (pid 3288854) encerrado (porta liberada)\nForce exiting Jest: Have you considered using `--detectOpenHandles` to detect async operations that kept running after all tests finished?",
      "saidaRef": "AI_MEMORY/evidence/dev-branch-gate-logs/fd15ffa2-7068-420b-9074-d08d12a0626d/B1-phaseStepContract.test.js.log"
    },
    {
      "id": "B2-devBranchGatePhaseContract.test.js",
      "fase": "B",
      "nivel": "B",
      "descricao": "Teste de regressão declarado: tests/unit/governance/devBranchGatePhaseContract.test.js",
      "comando": "npx jest tests/unit/governance/devBranchGatePhaseContract.test.js --bail=0",
      "exitCode": 0,
      "timeout": false,
      "duracaoMs": 5413,
      "sha256Saida": "6efbbe83060f3a67b546b91c4c0bea2beaee5662c02ba78f8bdba74e6d15a1bf",
      "saidaFinal": "    ✓ --fases Z ⇒ ENTRADA_INVALIDA (339 ms)\n    ✓ o contexto de execução é único por rodada (103 ms)\n\nTest Suites: 1 passed, 1 total\nTests:       21 passed, 21 total\nSnapshots:   0 total\nTime:        3.66 s\nRan all test suites matching /tests\\/unit\\/governance\\/devBranchGatePhaseContract.test.js/i.\n[engineering-runner-jest 2026-10-25T18:12:49.717Z] runner ENCERROU: pid=3289073 code=0 signal=null\n[engineering-runner-jest 2026-10-25T18:12:49.719Z] apos o encerramento, /health na porta 44345: sem resposta\n[jest-global-teardown] Engineering Runner (pid 3289073) encerrado (porta liberada)\nForce exiting Jest: Have you considered using `--detectOpenHandles` to detect async operations that kept running after all tests finished?",
      "saidaRef": "AI_MEMORY/evidence/dev-branch-gate-logs/fd15ffa2-7068-420b-9074-d08d12a0626d/B2-devBranchGatePhaseContract.test.js.log"
    },
    {
      "id": "B3-devBranchGateStepEvidence.test.js",
      "fase": "B",
      "nivel": "B",
      "descricao": "Teste de regressão declarado: tests/unit/governance/devBranchGateStepEvidence.test.js",
      "comando": "npx jest tests/unit/governance/devBranchGateStepEvidence.test.js --bail=0",
      "exitCode": 0,
      "timeout": false,
      "duracaoMs": 2907,
      "sha256Saida": "f6cf6736d260aeb97011d99902a7f7c43a592f4a061ebd9cb30f02ef2365a026",
      "saidaFinal": "    ✓ passo que FALHA também deixa a saída completa — falha é diagnosticável, não só contada (187 ms)\n    ✓ o log fica separado por execucaoId — duas execuções não sobrescrevem a evidência uma da outra (146 ms)\n\nTest Suites: 1 passed, 1 total\nTests:       3 passed, 3 total\nSnapshots:   0 total\nTime:        1.276 s\nRan all test suites matching /tests\\/unit\\/governance\\/devBranchGateStepEvidence.test.js/i.\n[engineering-runner-jest 2026-10-25T18:12:52.584Z] runner ENCERROU: pid=3289288 code=0 signal=null\n[engineering-runner-jest 2026-10-25T18:12:52.587Z] apos o encerramento, /health na porta 44345: sem resposta\n[jest-global-teardown] Engineering Runner (pid 3289288) encerrado (porta liberada)\nForce exiting Jest: Have you considered using `--detectOpenHandles` to detect async operations that kept running after all tests finished?",
      "saidaRef": "AI_MEMORY/evidence/dev-branch-gate-logs/fd15ffa2-7068-420b-9074-d08d12a0626d/B3-devBranchGateStepEvidence.test.js.log"
    },
    {
      "id": "L0a-artefatos-canoeiros",
      "fase": "C",
      "nivel": "L0",
      "descricao": "Produz os artefatos canônicos (ignorados pelo git) que o L0 consome",
      "comando": "npm run ci:artifacts",
      "exitCode": 0,
      "timeout": false,
      "duracaoMs": 12179,
      "sha256Saida": "3692c9982c7772d98f9d7a008ee8058001ae5ffe3029e7a2f2a5d34cc6e6bd99",
      "saidaFinal": "[ci:bootstrap]  ok   coverage-completeness veredito=PASS (1s)\n[ci:bootstrap]  ok   benchmark-sufficiency veredito=PASS (0s)\n[ci:bootstrap]  ok   evo-contract veredito=PASS (1s)\n[ci:bootstrap]  ok   layer-conventions veredito=PASS (1s)\n[ci:bootstrap]  ok   journey-projections veredito=PASS (0s)\n[ci:bootstrap]  ok   json-persistence-audit veredito=PASS (1s)\n[ci:bootstrap]  ok   timeout-architecture veredito=NO_GO (3s)\n[ci:bootstrap]  ok   engineering-router-v2 veredito=NO_GO (0s)\n[ci:bootstrap]  ok   governance-summary veredito=FAIL (1s)\n[ci:bootstrap]  ok   impact-validation veredito=ESCALATE (1s)\n[ci:bootstrap]  ok   artefatos-obrigatorios veredito=PASS (0s)\n[ci:bootstrap] modo=artifacts-only veredito=READY — relatório em reports/ci-bootstrap-report.json",
      "saidaRef": "AI_MEMORY/evidence/dev-branch-gate-logs/fd15ffa2-7068-420b-9074-d08d12a0626d/L0a-artefatos-canoeiros.log"
    },
    {
      "id": "L0-suite-oficial",
      "fase": "C",
      "nivel": "L0",
      "descricao": "Suíte oficial Jest (unit + flow + rpa sem browser)",
      "comando": "npm test",
      "exitCode": 1,
      "timeout": false,
      "duracaoMs": 185552,
      "sha256Saida": "0615973c5a353e830aa32d58ca6107940646751851efe346535e7aadd9cbd0e7",
      "saidaFinal": "> chatbot-engine@1.0.0 test\n> npm run test:unit && npm run test:flow && npm run test:rpa:jest\n\n\n> chatbot-engine@1.0.0 test:unit\n> jest tests/unit\n\n  console.info\n    [2026-10-25T18:13:14.995Z] [INFO] [Sequelize] Conectado ao PostgreSQL com sucesso\n\n      at Object.info (api/utils/logger.js:155:15)\n\n  console.info\n    [2026-10-25T18:13:15.141Z] [INFO] [McpClientHub] Connected\n    {\n      \"connection\": \"erp\",\n      \"tenant\": \"mcp-disc-real-1792951995070-w2zaas\"\n    }\n\n      at Object.info (api/utils/logger.js:155:15)\n\n  console.info\n    [2026-10-25T18:13:15.203Z] [INFO] [McpDiscoveryCore] Descoberta persistida\n    {\n      \"connection\": \"erp\",\n      \"mode\": \"discover\",\n      \"toolCount\": 1,\n      \"schemaChanged\": false,\n      \"revalidationRequired\": false\n    }\n\n      at Object.info (api/utils/logger.js:155:15)\n\n  console.info\n    [2026-10-25T18:13:15.385Z] [INFO] [McpClientHub] Connected\n    {\n      \"connection\": \"erp\",\n      \"tenant\": \"mcp-unmapped-real-1792951995319-k0h1t1\"\n    }\n\n      at Object.info (api/utils/logger.js:155:15)\n\n  console.info\n    [2026-10-25T18:13:15.449Z] [INFO] [McpDiscoveryCore] Descoberta persistida\n    {\n      \"connection\": \"erp\",\n      \"mode\": \"discover\",\n      \"toolCount\": 1,\n      \"schemaChanged\": false,\n      \"revalidationRequired\": false\n    }\n\n      at Object.info (api/utils/logger.js:155:15)\n\n  console.info\n    [2026-10-25T18:13:15.591Z] [INFO] [McpClientHub] Connected\n    {\n      \"connection\": \"erp\",\n      \"tenant\": \"mcp-invalid-inv-1792951995565-zbsuxw\"\n    }\n…\n\nSummary of all failing tests\nFAIL tests/unit/governance/governanceChainCanonicalPath.test.js\n  ● P0 — o caminho do elo não pode vir do manifesto verificado › ATAQUE (revisor P0): barra final + homônimo em dist/ — o hash vinha do FALLBACK por basename\n\n    TypeError: The \"path\" argument must be of type string. Received null\n\n    \u001b[0m \u001b[90m 171 |\u001b[39m       \u001b[36mconst\u001b[39m absHash \u001b[33m=\u001b[39m item\u001b[33m.\u001b[39mid \u001b[33m===\u001b[39m \u001b[32m'evidence_manifest'\u001b[39m\n     \u001b[90m 172 |\u001b[39m         \u001b[33m?\u001b[39m path\u001b[33m.\u001b[39mjoin(sandbox\u001b[33m.\u001b[39mraiz\u001b[33m,\u001b[39m \u001b[32m'dist'\u001b[39m\u001b[33m,\u001b[39m \u001b[32m'release'\u001b[39m\u001b[33m,\u001b[39m \u001b[32m'evidence-manifest.json'\u001b[39m)\n    \u001b[31m\u001b[1m>\u001b[22m\u001b[39m\u001b[90m 173 |\u001b[39m         \u001b[33m:\u001b[39m path\u001b[33m.\u001b[39mjoin(sandbox\u001b[33m.\u001b[39mraiz\u001b[33m,\u001b[39m item\u001b[33m.\u001b[39mpath)\u001b[33m;\u001b[39m\n     \u001b[90m     |\u001b[39m                \u001b[31m\u001b[1m^\u001b[22m\u001b[39m\n     \u001b[90m 174 |\u001b[39m       \u001b[36mconst\u001b[39m hash \u001b[33m=\u001b[39m sha256File(absHash)\u001b[33m;\u001b[39m\n     \u001b[90m 175 |\u001b[39m       cumHash \u001b[33m=\u001b[39m sha256String(\u001b[32m`${cumHash}:${hash}`\u001b[39m)\u001b[33m;\u001b[39m\n     \u001b[90m 176 |\u001b[39m       \u001b[36mreturn\u001b[39m { id\u001b[33m:\u001b[39m item\u001b[33m.\u001b[39mid\u001b[33m,\u001b[39m path\u001b[33m:\u001b[39m rel\u001b[33m,\u001b[39m exists\u001b[33m:\u001b[39m \u001b[36mtrue\u001b[39m\u001b[33m,\u001b[39m hash\u001b[33m,\u001b[39m cumulativeHash\u001b[33m:\u001b[39m cumHash }\u001b[33m;\u001b[39m\u001b[0m\n\n      at join (tests/unit/governance/governanceChainCanonicalPath.test.js:173:16)\n          at Array.map (<anonymous>)\n      at Object.map (tests/unit/governance/governanceChainCanonicalPath.test.js:169:36)\n\n\nTest Suites: 1 failed, 198 passed, 199 of 1119 total\nTests:       1 failed, 3797 passed, 3798 total\nSnapshots:   0 total\nTime:        183.728 s\nRan all test suites matching /tests\\/unit/i.",
      "saidaRef": "AI_MEMORY/evidence/dev-branch-gate-logs/fd15ffa2-7068-420b-9074-d08d12a0626d/L0-suite-oficial.log"
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
  "evidenceSha256": "fa3559e2b08c1fb1ba2647b89b8a6aec41d7644649ce1eb97c3f10746ceb70fb"
}
```
