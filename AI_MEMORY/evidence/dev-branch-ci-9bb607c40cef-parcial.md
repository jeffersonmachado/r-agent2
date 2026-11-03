# Gate em fases da branch de desenvolvimento — 9bb607c40cef (PARCIAL)

- **veredito**: `PASS_PARCIAL`
- **equivale a validação completa**: `false`
- **fases pedidas**: `A,B,C,D`
- **fases obrigatórias**: `A,B,C,D,R,E,F`
- **fases faltantes**: `R,E,F`
- **entrada inválida**: `não`
- **branch**: `codex/p1-governance-hardening-20261023`
- **sha exato avaliado**: `9bb607c40cef376ef4f39b137b725e345d663752`
- **gerado em**: 2026-10-24T10:40:36.660Z
- **gate efetivo**: LOCAL — o runner do GitHub não inicia jobs por limite de gastos da conta

## Estado por fase (comprovação, não intenção)

| fase | estado | passos reais | motivo |
|---|---|---|---|
| A | **PASS** | 10 | — |
| B | **PASS** | 3 | — |
| C | **PASS** | 2 | — |
| D | **PASS** | 4 | — |

## Pré-voo (fase A)

| check | resultado | detalhe |
|---|---|---|
| `A1-identidade-commit` | ok | HEAD=9bb607c40cef376ef4f39b137b725e345d663752 |
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
| D | `L1_AMPLO` | **ALLOWED** | BLOQUEIO_EXTERNO_NAO_RESOLVE_CERTIFICACAO |

**Sem bloqueio.**

## Passos executados (comando, exit code, duração, sha256 da saída)

| fase | passo | comando | exit | duração | sha256 da saída |
|---|---|---|---|---|---|
| B | `B1-phaseStepContract.test.js` | `npx jest tests/unit/governance/phaseStepContract.test.js --bail=0` | 0 | 6.1s | `fd0e6f2f4a82bbe2…` |
| B | `B2-devBranchGatePhaseContract.test.js` | `npx jest tests/unit/governance/devBranchGatePhaseContract.test.js --bail=0` | 0 | 5.0s | `9078896383c8fe4e…` |
| B | `B3-devBranchGateStepEvidence.test.js` | `npx jest tests/unit/governance/devBranchGateStepEvidence.test.js --bail=0` | 0 | 2.8s | `e5a6aed0dba62a88…` |
| C | `L0-suite-oficial` | `npm test` | 0 | 457.7s | `1265a852c4683307…` |
| C | `L0b-integracao-engenheiro` | `npx jest tests/integration/engineering --bail=0 --runInBand --forceExit` | 0 | 958.6s | `a4deb47a3dc47ec7…` |
| D | `L1-release-dag` | `node scripts/governance/validate-release-dag.js` | 0 | 0.1s | `301c27daf96e87f5…` |
| D | `L1-fila-oficial` | `node scripts/governance/validate-hardening-queue.js` | 0 | 1.1s | `9559a265be2edb78…` |
| D | `L1-ai-memory` | `node scripts/governance/validate-ai-memory.js` | 0 | 0.3s | `e3b0c44298fc1c14…` |
| D | `L1-aderencia-agente` | `node scripts/governance/validate-agent-adherence.js` | 0 | 0.1s | `e3b0c44298fc1c14…` |

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
git log -1 --format=%H -- AI_MEMORY/evidence/dev-branch-ci-9bb607c40cef-parcial.md   # commit que publicou esta evidência
```

`evidenceSha256` = `c8d8c3f537b8d1c8981c574cf86d0fa0c740b7c0ab316fbd55dbbe974bdaa95e` (sha256 do payload sem este campo).

```json
{
  "schemaVersion": 3,
  "kind": "dev-branch-ci-evidence",
  "comando": "node scripts/ci/dev-branch-gate.js",
  "veredito": "PASS_PARCIAL",
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
      "estado": "PASS",
      "passosReais": 2,
      "passosEsperados": 2,
      "passosAusentes": [],
      "motivo": null
    },
    {
      "fase": "D",
      "estado": "PASS",
      "passosReais": 4,
      "passosEsperados": 4,
      "passosAusentes": [],
      "motivo": null
    }
  ],
  "fasesNaoAprovadas": [],
  "entradaInvalida": null,
  "entrada": {
    "bruto": "A,B,C,D",
    "duplicadas": [],
    "desconhecidas": []
  },
  "contextoExecucao": {
    "sha": "9bb607c40cef376ef4f39b137b725e345d663752",
    "execucaoId": "63b9ee1e-4606-47ac-b06b-336675537033"
  },
  "identidade": {
    "sha": "9bb607c40cef376ef4f39b137b725e345d663752",
    "branch": "codex/p1-governance-hardening-20261023",
    "shaValido": true,
    "branchValida": true
  },
  "fasesConcluidas": [
    "A",
    "B",
    "C",
    "D"
  ],
  "fasesNaoAplicaveis": [],
  "sha": "9bb607c40cef376ef4f39b137b725e345d663752",
  "shaCurto": "9bb607c40cef",
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
        "detalhe": "HEAD=9bb607c40cef376ef4f39b137b725e345d663752"
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
    },
    {
      "fase": "D",
      "operacao": "L1_AMPLO",
      "allowed": true,
      "decision": "ALLOWED",
      "reasonCodes": [
        "BLOQUEIO_EXTERNO_NAO_RESOLVE_CERTIFICACAO"
      ],
      "requiredActions": [],
      "blockingFindings": []
    }
  ],
  "bloqueio": null,
  "passos": [
    {
      "id": "B1-phaseStepContract.test.js",
      "fase": "B",
      "nivel": "B",
      "descricao": "Teste de regressão declarado: tests/unit/governance/phaseStepContract.test.js",
      "comando": "npx jest tests/unit/governance/phaseStepContract.test.js --bail=0",
      "exitCode": 0,
      "timeout": false,
      "duracaoMs": 6143,
      "sha256Saida": "fd0e6f2f4a82bbe2fc9ac73d007a2de8b0e8717265cddba04af25f0c5e544801",
      "saidaFinal": "  P0-01 — integração com decidirVeredito\n    ✓ fase D INCOMPLETE nunca vira PASS global (103 ms)\n\nTest Suites: 1 passed, 1 total\nTests:       28 passed, 28 total\nSnapshots:   0 total\nTime:        3.614 s\nRan all test suites matching /tests\\/unit\\/governance\\/phaseStepContract.test.js/i.\n[engineering-runner-jest 2026-10-24T10:16:50.485Z] runner ENCERROU: pid=407159 code=0 signal=null\n[engineering-runner-jest 2026-10-24T10:16:50.492Z] apos o encerramento, /health na porta 42913: sem resposta\n[jest-global-teardown] Engineering Runner (pid 407159) encerrado (porta liberada)\nForce exiting Jest: Have you considered using `--detectOpenHandles` to detect async operations that kept running after all tests finished?",
      "saidaRef": "AI_MEMORY/evidence/dev-branch-gate-logs/63b9ee1e-4606-47ac-b06b-336675537033/B1-phaseStepContract.test.js.log"
    },
    {
      "id": "B2-devBranchGatePhaseContract.test.js",
      "fase": "B",
      "nivel": "B",
      "descricao": "Teste de regressão declarado: tests/unit/governance/devBranchGatePhaseContract.test.js",
      "comando": "npx jest tests/unit/governance/devBranchGatePhaseContract.test.js --bail=0",
      "exitCode": 0,
      "timeout": false,
      "duracaoMs": 4996,
      "sha256Saida": "9078896383c8fe4e5c4c9ddefc5d760cb40413e81d3e9fa3041fa51647fae183",
      "saidaFinal": "    ✓ --fases Z ⇒ ENTRADA_INVALIDA (297 ms)\n    ✓ o contexto de execução é único por rodada (102 ms)\n\nTest Suites: 1 passed, 1 total\nTests:       21 passed, 21 total\nSnapshots:   0 total\nTime:        3.239 s\nRan all test suites matching /tests\\/unit\\/governance\\/devBranchGatePhaseContract.test.js/i.\n[engineering-runner-jest 2026-10-24T10:16:55.536Z] runner ENCERROU: pid=407389 code=0 signal=null\n[engineering-runner-jest 2026-10-24T10:16:55.537Z] apos o encerramento, /health na porta 42913: sem resposta\n[jest-global-teardown] Engineering Runner (pid 407389) encerrado (porta liberada)\nForce exiting Jest: Have you considered using `--detectOpenHandles` to detect async operations that kept running after all tests finished?",
      "saidaRef": "AI_MEMORY/evidence/dev-branch-gate-logs/63b9ee1e-4606-47ac-b06b-336675537033/B2-devBranchGatePhaseContract.test.js.log"
    },
    {
      "id": "B3-devBranchGateStepEvidence.test.js",
      "fase": "B",
      "nivel": "B",
      "descricao": "Teste de regressão declarado: tests/unit/governance/devBranchGateStepEvidence.test.js",
      "comando": "npx jest tests/unit/governance/devBranchGateStepEvidence.test.js --bail=0",
      "exitCode": 0,
      "timeout": false,
      "duracaoMs": 2836,
      "sha256Saida": "e5a6aed0dba62a880d15d2f631166c99c60b5be9087fa082e0ff4e0eba3a11d2",
      "saidaFinal": "    ✓ passo que FALHA também deixa a saída completa — falha é diagnosticável, não só contada (186 ms)\n    ✓ o log fica separado por execucaoId — duas execuções não sobrescrevem a evidência uma da outra (149 ms)\n\nTest Suites: 1 passed, 1 total\nTests:       3 passed, 3 total\nSnapshots:   0 total\nTime:        1.071 s\nRan all test suites matching /tests\\/unit\\/governance\\/devBranchGateStepEvidence.test.js/i.\n[engineering-runner-jest 2026-10-24T10:16:58.334Z] runner ENCERROU: pid=407666 code=0 signal=null\n[engineering-runner-jest 2026-10-24T10:16:58.338Z] apos o encerramento, /health na porta 42913: sem resposta\n[jest-global-teardown] Engineering Runner (pid 407666) encerrado (porta liberada)\nForce exiting Jest: Have you considered using `--detectOpenHandles` to detect async operations that kept running after all tests finished?",
      "saidaRef": "AI_MEMORY/evidence/dev-branch-gate-logs/63b9ee1e-4606-47ac-b06b-336675537033/B3-devBranchGateStepEvidence.test.js.log"
    },
    {
      "id": "L0-suite-oficial",
      "fase": "C",
      "nivel": "L0",
      "descricao": "Suíte oficial Jest (unit + flow + rpa sem browser)",
      "comando": "npm test",
      "exitCode": 0,
      "timeout": false,
      "duracaoMs": 457711,
      "sha256Saida": "1265a852c46833070eb03f4caa3e999d9d3d1143eac3d06f769f7314055dde23",
      "saidaFinal": "      ○ skipped deve detectar erros\n      ○ skipped deve substituir variáveis\n\nTest Suites: 3 passed, 3 total\nTests:       4 skipped, 7 passed, 11 total\nSnapshots:   0 total\nTime:        6.673 s\nRan all test suites within paths \"tests/rpa/rpa.test.js\", \"tests/rpa/login.test.js\", \"tests/rpa/createTenantByAI.test.js\".\n[engineering-runner-jest 2026-10-24T10:24:35.972Z] runner ENCERROU: pid=427753 code=0 signal=null\n[engineering-runner-jest 2026-10-24T10:24:35.976Z] apos o encerramento, /health na porta 42913: sem resposta\n[jest-global-teardown] Engineering Runner (pid 427753) encerrado (porta liberada)\nForce exiting Jest: Have you considered using `--detectOpenHandles` to detect async operations that kept running after all tests finished?",
      "saidaRef": "AI_MEMORY/evidence/dev-branch-gate-logs/63b9ee1e-4606-47ac-b06b-336675537033/L0-suite-oficial.log"
    },
    {
      "id": "L0b-integracao-engenheiro",
      "fase": "C",
      "nivel": "L0",
      "descricao": "Integração real do Engenheiro (Postgres + sandbox; falha sem banco)",
      "comando": "npx jest tests/integration/engineering --bail=0 --runInBand --forceExit",
      "exitCode": 0,
      "timeout": false,
      "duracaoMs": 958608,
      "sha256Saida": "a4deb47a3dc47ec779f0441eca93076054b29c27a07e37dc59a8d9872f7cc08f",
      "saidaFinal": "    ✓ modelo antes mapeado e presente, cujo discovery real confirma que o provider deixou de listar → RETIRED, nunca elegível (143 ms)\n    ✓ reconciliação repetida com os mesmos fatos é idempotente — nunca duplica a entrada (117 ms)\n\nTest Suites: 40 passed, 40 total\nTests:       219 passed, 219 total\nSnapshots:   0 total\nTime:        956.686 s\nRan all test suites matching /tests\\/integration\\/engineering/i.\n[engineering-runner-jest 2026-10-24T10:40:34.667Z] runner ENCERROU: pid=428049 code=0 signal=null\n[engineering-runner-jest 2026-10-24T10:40:34.671Z] apos o encerramento, /health na porta 42913: sem resposta\n[jest-global-teardown] Engineering Runner (pid 428049) encerrado (porta liberada)\nForce exiting Jest: Have you considered using `--detectOpenHandles` to detect async operations that kept running after all tests finished?",
      "saidaRef": "AI_MEMORY/evidence/dev-branch-gate-logs/63b9ee1e-4606-47ac-b06b-336675537033/L0b-integracao-engenheiro.log"
    },
    {
      "id": "L1-release-dag",
      "fase": "D",
      "nivel": "L1",
      "descricao": "DAG do release sem ciclo e sem violação de ordem de fase",
      "comando": "node scripts/governance/validate-release-dag.js",
      "exitCode": 0,
      "timeout": false,
      "duracaoMs": 62,
      "sha256Saida": "301c27daf96e87f585ee70df7507f5c1fac37ab8fb37a9a61832b96ab05ca3da",
      "saidaFinal": "[release-dag] status=PASS decision=RELEASE_DAG_ACYCLIC_AND_PHASE_AWARE\n[release-dag] nós=29 artefatos=25 ciclos=0\n[release-dag] relatório: reports/release-dag-report.json",
      "saidaRef": "AI_MEMORY/evidence/dev-branch-gate-logs/63b9ee1e-4606-47ac-b06b-336675537033/L1-release-dag.log"
    },
    {
      "id": "L1-fila-oficial",
      "fase": "D",
      "nivel": "L1",
      "descricao": "Fila oficial de hardening sem item aberto nem estado não canônico",
      "comando": "node scripts/governance/validate-hardening-queue.js",
      "exitCode": 0,
      "timeout": false,
      "duracaoMs": 1072,
      "sha256Saida": "9559a265be2edb7838ca7cb238adb1cd5bc520d2a0fb4f57ec497ca7f1be5be3",
      "saidaFinal": "[hardening-queue] 135 itens — done:75 blocked_external:6 prevention_active:35 verified:19\n[hardening-queue] abertos: H15-DIST-RECIBO-STALE(blocked_external), H19-DIST-CAUSA-UNICA(blocked_external), MISSAO-B9-CI-GITHUB-ACTIONS(blocked_external), H20-CADEIA-POS-CERTIFICACAO-DIVERGENTE(blocked_external), P1-PROJECAO-FINAL-DIVERGE-DA-CANONICA-DE-RUN-ABANDONADO(blocked_external), P1-AGREGADO-SEM-IDENTIDADE-DE-RUN-BLOQUEIA-L3(blocked_external)\n[hardening-queue] impedidos (blocked/blocked_external — NÃO são fechados): 6\n[hardening-queue] PASS",
      "saidaRef": "AI_MEMORY/evidence/dev-branch-gate-logs/63b9ee1e-4606-47ac-b06b-336675537033/L1-fila-oficial.log"
    },
    {
      "id": "L1-ai-memory",
      "fase": "D",
      "nivel": "L1",
      "descricao": "Memória operacional íntegra",
      "comando": "node scripts/governance/validate-ai-memory.js",
      "exitCode": 0,
      "timeout": false,
      "duracaoMs": 283,
      "sha256Saida": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      "saidaFinal": "",
      "saidaRef": "AI_MEMORY/evidence/dev-branch-gate-logs/63b9ee1e-4606-47ac-b06b-336675537033/L1-ai-memory.log"
    },
    {
      "id": "L1-aderencia-agente",
      "fase": "D",
      "nivel": "L1",
      "descricao": "Aderência do agente à Constituição",
      "comando": "node scripts/governance/validate-agent-adherence.js",
      "exitCode": 0,
      "timeout": false,
      "duracaoMs": 140,
      "sha256Saida": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      "saidaFinal": "",
      "saidaRef": "AI_MEMORY/evidence/dev-branch-gate-logs/63b9ee1e-4606-47ac-b06b-336675537033/L1-aderencia-agente.log"
    }
  ],
  "falhas": [],
  "evidenceSha256": "c8d8c3f537b8d1c8981c574cf86d0fa0c740b7c0ab316fbd55dbbe974bdaa95e"
}
```
