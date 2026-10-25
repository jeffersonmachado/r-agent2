# Gate em fases da branch de desenvolvimento — 7f87aeedc875 (PARCIAL)

- **veredito**: `FAIL`
- **equivale a validação completa**: `false`
- **fases pedidas**: `A,B,C,D`
- **fases obrigatórias**: `A,B,C,D,R,E,F`
- **fases faltantes**: `R,E,F`
- **entrada inválida**: `não`
- **branch**: `codex/engineering-router-hardening-20261025`
- **sha exato avaliado**: `7f87aeedc875d270a45991032a82a62eed7497f8`
- **gerado em**: 2026-10-25T18:55:48.714Z
- **gate efetivo**: LOCAL — o runner do GitHub não inicia jobs por limite de gastos da conta

## Estado por fase (comprovação, não intenção)

| fase | estado | passos reais | motivo |
|---|---|---|---|
| A | **PASS** | 10 | — |
| B | **PASS** | 3 | — |
| C | **BLOCKED** | 3 | PASSO_FALHOU |
| D | **NOT_EXECUTED** | 0 | FASE_NAO_EXECUTADA |

## Pré-voo (fase A)

| check | resultado | detalhe |
|---|---|---|
| `A1-identidade-commit` | ok | HEAD=7f87aeedc875d270a45991032a82a62eed7497f8 |
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

**BLOQUEIO**: fase C — `PASSO_FALHOU` L0b-integracao-engenheiro exit=1

## Passos executados (comando, exit code, duração, sha256 da saída)

| fase | passo | comando | exit | duração | sha256 da saída |
|---|---|---|---|---|---|
| B | `B1-phaseStepContract.test.js` | `npx jest tests/unit/governance/phaseStepContract.test.js --bail=0` | 0 | 6.3s | `1df0e4847f0ac0c5…` |
| B | `B2-devBranchGatePhaseContract.test.js` | `npx jest tests/unit/governance/devBranchGatePhaseContract.test.js --bail=0` | 0 | 4.8s | `2401a57e0a775ac6…` |
| B | `B3-devBranchGateStepEvidence.test.js` | `npx jest tests/unit/governance/devBranchGateStepEvidence.test.js --bail=0` | 0 | 3.1s | `5136418f5e2f0d09…` |
| C | `L0a-artefatos-canoeiros` | `npm run ci:artifacts` | 0 | 9.0s | `54cefa2e030bd6a0…` |
| C | `L0-suite-oficial` | `npm test` | 0 | 492.1s | `8cdeee328e3d2ad5…` |
| C | `L0b-integracao-engenheiro` | `npx jest tests/integration/engineering --bail=0 --runInBand --forceExit` | 1 | 1013.0s | `954df5e867b028b7…` |

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
git log -1 --format=%H -- AI_MEMORY/evidence/dev-branch-ci-7f87aeedc875-parcial.md   # commit que publicou esta evidência
```

`evidenceSha256` = `43d12d4e0612a36216f0db321977403f9b514862fc06f9c7971e242465f4a26c` (sha256 do payload sem este campo).

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
      "passosReais": 3,
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
    "sha": "7f87aeedc875d270a45991032a82a62eed7497f8",
    "execucaoId": "6dfb4655-f3f8-468b-8c9e-ce72b53e318d"
  },
  "identidade": {
    "sha": "7f87aeedc875d270a45991032a82a62eed7497f8",
    "branch": "codex/engineering-router-hardening-20261025",
    "shaValido": true,
    "branchValida": true
  },
  "fasesConcluidas": [
    "A",
    "B"
  ],
  "fasesNaoAplicaveis": [],
  "sha": "7f87aeedc875d270a45991032a82a62eed7497f8",
  "shaCurto": "7f87aeedc875",
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
        "detalhe": "HEAD=7f87aeedc875d270a45991032a82a62eed7497f8"
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
    "detail": "L0b-integracao-engenheiro exit=1"
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
      "duracaoMs": 6266,
      "sha256Saida": "1df0e4847f0ac0c528792059b5034177050486f89a83d52dabd16461fd932d57",
      "saidaFinal": "  P0-01 — integração com decidirVeredito\n    ✓ fase D INCOMPLETE nunca vira PASS global (103 ms)\n\nTest Suites: 1 passed, 1 total\nTests:       29 passed, 29 total\nSnapshots:   0 total\nTime:        3.722 s\nRan all test suites matching /tests\\/unit\\/governance\\/phaseStepContract.test.js/i.\n[engineering-runner-jest 2026-10-25T18:30:26.334Z] runner ENCERROU: pid=3323418 code=0 signal=null\n[engineering-runner-jest 2026-10-25T18:30:26.342Z] apos o encerramento, /health na porta 45153: sem resposta\n[jest-global-teardown] Engineering Runner (pid 3323418) encerrado (porta liberada)\nForce exiting Jest: Have you considered using `--detectOpenHandles` to detect async operations that kept running after all tests finished?",
      "saidaRef": "AI_MEMORY/evidence/dev-branch-gate-logs/6dfb4655-f3f8-468b-8c9e-ce72b53e318d/B1-phaseStepContract.test.js.log"
    },
    {
      "id": "B2-devBranchGatePhaseContract.test.js",
      "fase": "B",
      "nivel": "B",
      "descricao": "Teste de regressão declarado: tests/unit/governance/devBranchGatePhaseContract.test.js",
      "comando": "npx jest tests/unit/governance/devBranchGatePhaseContract.test.js --bail=0",
      "exitCode": 0,
      "timeout": false,
      "duracaoMs": 4767,
      "sha256Saida": "2401a57e0a775ac68ae204d778b1980045bbf15a9664ee0cbb17d8a2ac78b150",
      "saidaFinal": "    ✓ --fases Z ⇒ ENTRADA_INVALIDA (251 ms)\n    ✓ o contexto de execução é único por rodada (102 ms)\n\nTest Suites: 1 passed, 1 total\nTests:       21 passed, 21 total\nSnapshots:   0 total\nTime:        3.152 s\nRan all test suites matching /tests\\/unit\\/governance\\/devBranchGatePhaseContract.test.js/i.\n[engineering-runner-jest 2026-10-25T18:30:31.155Z] runner ENCERROU: pid=3323637 code=0 signal=null\n[engineering-runner-jest 2026-10-25T18:30:31.156Z] apos o encerramento, /health na porta 45153: sem resposta\n[jest-global-teardown] Engineering Runner (pid 3323637) encerrado (porta liberada)\nForce exiting Jest: Have you considered using `--detectOpenHandles` to detect async operations that kept running after all tests finished?",
      "saidaRef": "AI_MEMORY/evidence/dev-branch-gate-logs/6dfb4655-f3f8-468b-8c9e-ce72b53e318d/B2-devBranchGatePhaseContract.test.js.log"
    },
    {
      "id": "B3-devBranchGateStepEvidence.test.js",
      "fase": "B",
      "nivel": "B",
      "descricao": "Teste de regressão declarado: tests/unit/governance/devBranchGateStepEvidence.test.js",
      "comando": "npx jest tests/unit/governance/devBranchGateStepEvidence.test.js --bail=0",
      "exitCode": 0,
      "timeout": false,
      "duracaoMs": 3112,
      "sha256Saida": "5136418f5e2f0d0921f9b696a93b931a8e188c79417e02b6963723af6797bb80",
      "saidaFinal": "    ✓ passo que FALHA também deixa a saída completa — falha é diagnosticável, não só contada (238 ms)\n    ✓ o log fica separado por execucaoId — duas execuções não sobrescrevem a evidência uma da outra (142 ms)\n\nTest Suites: 1 passed, 1 total\nTests:       3 passed, 3 total\nSnapshots:   0 total\nTime:        1.065 s\nRan all test suites matching /tests\\/unit\\/governance\\/devBranchGateStepEvidence.test.js/i.\n[engineering-runner-jest 2026-10-25T18:30:34.239Z] runner ENCERROU: pid=3324143 code=0 signal=null\n[engineering-runner-jest 2026-10-25T18:30:34.244Z] apos o encerramento, /health na porta 45153: sem resposta\n[jest-global-teardown] Engineering Runner (pid 3324143) encerrado (porta liberada)\nForce exiting Jest: Have you considered using `--detectOpenHandles` to detect async operations that kept running after all tests finished?",
      "saidaRef": "AI_MEMORY/evidence/dev-branch-gate-logs/6dfb4655-f3f8-468b-8c9e-ce72b53e318d/B3-devBranchGateStepEvidence.test.js.log"
    },
    {
      "id": "L0a-artefatos-canoeiros",
      "fase": "C",
      "nivel": "L0",
      "descricao": "Produz os artefatos canônicos (ignorados pelo git) que o L0 consome",
      "comando": "npm run ci:artifacts",
      "exitCode": 0,
      "timeout": false,
      "duracaoMs": 8967,
      "sha256Saida": "54cefa2e030bd6a04ba34c5d863ab58587373af2e35cd4e0c31f657695405740",
      "saidaFinal": "[ci:bootstrap]  ok   coverage-completeness veredito=PASS (0s)\n[ci:bootstrap]  ok   benchmark-sufficiency veredito=PASS (0s)\n[ci:bootstrap]  ok   evo-contract veredito=PASS (0s)\n[ci:bootstrap]  ok   layer-conventions veredito=PASS (1s)\n[ci:bootstrap]  ok   journey-projections veredito=PASS (0s)\n[ci:bootstrap]  ok   json-persistence-audit veredito=PASS (1s)\n[ci:bootstrap]  ok   timeout-architecture veredito=NO_GO (3s)\n[ci:bootstrap]  ok   engineering-router-v2 veredito=NO_GO (0s)\n[ci:bootstrap]  ok   governance-summary veredito=FAIL (1s)\n[ci:bootstrap]  ok   impact-validation veredito=ESCALATE (0s)\n[ci:bootstrap]  ok   artefatos-obrigatorios veredito=PASS (0s)\n[ci:bootstrap] modo=artifacts-only veredito=READY — relatório em reports/ci-bootstrap-report.json",
      "saidaRef": "AI_MEMORY/evidence/dev-branch-gate-logs/6dfb4655-f3f8-468b-8c9e-ce72b53e318d/L0a-artefatos-canoeiros.log"
    },
    {
      "id": "L0-suite-oficial",
      "fase": "C",
      "nivel": "L0",
      "descricao": "Suíte oficial Jest (unit + flow + rpa sem browser)",
      "comando": "npm test",
      "exitCode": 0,
      "timeout": false,
      "duracaoMs": 492126,
      "sha256Saida": "8cdeee328e3d2ad57e3a17c850a7ca3673c03fdf6190329f8a756b1bac549d7e",
      "saidaFinal": "      ○ skipped deve detectar erros\n      ○ skipped deve substituir variáveis\n\nTest Suites: 3 passed, 3 total\nTests:       4 skipped, 7 passed, 11 total\nSnapshots:   0 total\nTime:        5.062 s\nRan all test suites within paths \"tests/rpa/rpa.test.js\", \"tests/rpa/login.test.js\", \"tests/rpa/createTenantByAI.test.js\".\n[engineering-runner-jest 2026-10-25T18:38:55.285Z] runner ENCERROU: pid=3347044 code=0 signal=null\n[engineering-runner-jest 2026-10-25T18:38:55.288Z] apos o encerramento, /health na porta 45153: sem resposta\n[jest-global-teardown] Engineering Runner (pid 3347044) encerrado (porta liberada)\nForce exiting Jest: Have you considered using `--detectOpenHandles` to detect async operations that kept running after all tests finished?",
      "saidaRef": "AI_MEMORY/evidence/dev-branch-gate-logs/6dfb4655-f3f8-468b-8c9e-ce72b53e318d/L0-suite-oficial.log"
    },
    {
      "id": "L0b-integracao-engenheiro",
      "fase": "C",
      "nivel": "L0",
      "descricao": "Integração real do Engenheiro (Postgres + sandbox; falha sem banco)",
      "comando": "npx jest tests/integration/engineering --bail=0 --runInBand --forceExit",
      "exitCode": 1,
      "timeout": false,
      "duracaoMs": 1013003,
      "sha256Saida": "954df5e867b028b78932af78346d0345dad42db55db21d1152d45966a9cf1d27",
      "saidaFinal": "console.error\n    [2026-10-25T18:39:01.513Z] [ERROR] [WebScraping] cheerio não instalado. Defina SCRAPING_ALLOW_DEGRADED=true para modo degradado explícito.\n\n    \u001b[0m \u001b[90m 183 |\u001b[39m       \n     \u001b[90m 184 |\u001b[39m       \u001b[90m// eslint-disable-next-line no-console\u001b[39m\n    \u001b[31m\u001b[1m>\u001b[22m\u001b[39m\u001b[90m 185 |\u001b[39m       console\u001b[33m.\u001b[39merror(formatMessage(\u001b[33mLOG_LEVELS\u001b[39m\u001b[33m.\u001b[39m\u001b[33mERROR\u001b[39m\u001b[33m,\u001b[39m message\u001b[33m,\u001b[39m errorData))\u001b[33m;\u001b[39m\n     \u001b[90m     |\u001b[39m               \u001b[31m\u001b[1m^\u001b[22m\u001b[39m\n     \u001b[90m 186 |\u001b[39m     }\n     \u001b[90m 187 |\u001b[39m   }\u001b[33m,\u001b[39m\n     \u001b[90m 188 |\u001b[39m   \u001b[0m\n\n      at Object.error (api/utils/logger.js:185:15)\n      at Object.error (api/services/webScrapingService.js:63:12)\n      at Object.require (api/services/tenantService.js:24:28)\n      at Object.require (api/services/authService.js:18:55)\n      at Object.require (api/services/websocketService.js:19:27)\n      at Object.require (api/services/engineeringMission/missionEvents.js:11:23)\n      at Object.require (api/services/engineeringMission/bugFindingService.js:28:30)\n      at Object.require (tests/integration/engineeringBugLoop.test.js:24:27)\n\n  console.info\n    [2026-10-25T18:39:01.825Z] [INFO] [Sequelize] Conectado ao PostgreSQL com sucesso\n\n      at Object.info (api/utils/logger.js:155:15)\n\n  console.info\n    [2026-10-25T18:39:02.055Z] [INFO] [bugFindingService] finding\n    {\n      \"findingId\": \"83756725-d12d-4464-9770-55278c5289a4\",\n      \"action\": \"registrado\",\n      \"status\": \"SUSPECTED\",\n      \"severity\": \"MEDIUM\",\n      \"category\": \"BUG\",\n      \"selfModification\": false\n    }\n\n      at Object.info (api/utils/logger.js:155:15)\n\n  console.info\n    [2026-10-25T18:39:02.233Z] [INFO] [bugFindingService] finding\n    {\n      \"findingId\": \"141bc43e-eca8-4914-98dc-860c3fcdb3b6\",\n      \"action\": \"registrado\",\n      \"status\": \"SUSPECTED\",\n      \"severity\": \"MEDIUM\",\n      \"category\": \"BUG\",\n      \"selfModification\": false\n    }\n\n      at Object.info (api/utils/logger.js:155:15)\n\n  console.warn\n    [2026-10-25T18:39:02.344Z] [WARN] [bugFindingService] conflito de versão na transição\n    {\n      \"findingId\": \"141bc43e-eca8-4914-98dc-860c3fcdb3b6\",\n      \"from\": \"REPRODUCING\",\n      \"to\": \"CONFIRMED\",\n      \"currentStatus\": \"SUSPECTED\",\n      \"expectedVersion\": 1,\n      \"currentVersion\": 2\n…\n    transição concorrente rejeitada: finding 141bc43e-eca8-4914-98dc-860c3fcdb3b6 está em SUSPECTED (tentativa REPRODUCING → CONFIRMED)\n\n    \u001b[0m \u001b[90m 406 |\u001b[39m     \u001b[90m// Concorrência convergente: outra transação já levou o finding ao MESMO destino ⇒ idempotente.\u001b[39m\n     \u001b[90m 407 |\u001b[39m     \u001b[36mif\u001b[39m (current \u001b[33m&&\u001b[39m current\u001b[33m.\u001b[39mstatus \u001b[33m===\u001b[39m toStatus) \u001b[36mreturn\u001b[39m { finding\u001b[33m:\u001b[39m current\u001b[33m,\u001b[39m idempotent\u001b[33m:\u001b[39m \u001b[36mtrue\u001b[39m\u001b[33m,\u001b[39m concurrent\u001b[33m:\u001b[39m \u001b[36mtrue\u001b[39m }\u001b[33m;\u001b[39m\n    \u001b[31m\u001b[1m>\u001b[22m\u001b[39m\u001b[90m 408 |\u001b[39m     \u001b[36mconst\u001b[39m err \u001b[33m=\u001b[39m \u001b[36mnew\u001b[39m \u001b[33mError\u001b[39m(\u001b[32m`transição concorrente rejeitada: finding ${findingId} está em ${current?.status || 'desconhecido'} (tentativa ${finding.status} → ${toStatus})`\u001b[39m)\u001b[33m;\u001b[39m\n     \u001b[90m     |\u001b[39m                 \u001b[31m\u001b[1m^\u001b[22m\u001b[39m\n     \u001b[90m 409 |\u001b[39m     err\u001b[33m.\u001b[39mcode \u001b[33m=\u001b[39m \u001b[32m'FINDING_STATE_CONFLICT'\u001b[39m\u001b[33m;\u001b[39m\n     \u001b[90m 410 |\u001b[39m     err\u001b[33m.\u001b[39mdetail \u001b[33m=\u001b[39m {\n     \u001b[90m 411 |\u001b[39m       findingId\u001b[33m,\u001b[39m\u001b[0m\n\n      at transitionFinding (api/services/engineeringMission/bugFindingService.js:408:17)\n      at Object.confirmFinding (api/services/engineeringMission/bugFindingService.js:463:18)\n      at Object.reproduce (api/services/engineeringMission/bugReproductionService.js:136:23)\n      at Object.<anonymous> (tests/integration/engineeringBugLoop.test.js:192:20)\n\n\nTest Suites: 1 failed, 39 passed, 40 total\nTests:       1 failed, 218 passed, 219 total\nSnapshots:   0 total\nTime:        1009.676 s\nRan all test suites matching /tests\\/integration\\/engineering/i.\n[engineering-runner-jest 2026-10-25T18:55:48.281Z] runner ENCERROU: pid=3347364 code=0 signal=null\n[engineering-runner-jest 2026-10-25T18:55:48.283Z] apos o encerramento, /health na porta 45153: sem resposta\n[jest-global-teardown] Engineering Runner (pid 3347364) encerrado (porta liberada)\nForce exiting Jest: Have you considered using `--detectOpenHandles` to detect async operations that kept running after all tests finished?",
      "saidaRef": "AI_MEMORY/evidence/dev-branch-gate-logs/6dfb4655-f3f8-468b-8c9e-ce72b53e318d/L0b-integracao-engenheiro.log"
    }
  ],
  "falhas": [
    {
      "id": "L0b-integracao-engenheiro",
      "fase": "C",
      "comando": "npx jest tests/integration/engineering --bail=0 --runInBand --forceExit",
      "exitCode": 1
    }
  ],
  "evidenceSha256": "43d12d4e0612a36216f0db321977403f9b514862fc06f9c7971e242465f4a26c"
}
```
