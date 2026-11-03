# Gate em fases da branch de desenvolvimento — 83b50f1e4209 (PARCIAL)

- **veredito**: `PASS_PARCIAL`
- **equivale a validação completa**: `false`
- **fases pedidas**: `A,B,C,D`
- **fases obrigatórias**: `A,B,C,D,R,E,F`
- **fases faltantes**: `R,E,F`
- **entrada inválida**: `não`
- **branch**: `codex/p1-governance-hardening-20261023`
- **sha exato avaliado**: `83b50f1e4209522593d554a84a40b1d02abeb6cc`
- **gerado em**: 2026-10-24T19:38:20.160Z
- **gate efetivo**: LOCAL — o runner do GitHub não inicia jobs por limite de gastos da conta

## Estado por fase (comprovação, não intenção)

| fase | estado | passos reais | motivo |
|---|---|---|---|
| A | **PASS** | 10 | — |
| B | **PASS** | 3 | — |
| C | **PASS** | 3 | — |
| D | **PASS** | 4 | — |

## Pré-voo (fase A)

| check | resultado | detalhe |
|---|---|---|
| `A1-identidade-commit` | ok | HEAD=83b50f1e4209522593d554a84a40b1d02abeb6cc |
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
| B | `B1-phaseStepContract.test.js` | `npx jest tests/unit/governance/phaseStepContract.test.js --bail=0` | 0 | 6.6s | `613cb58943ee3301…` |
| B | `B2-devBranchGatePhaseContract.test.js` | `npx jest tests/unit/governance/devBranchGatePhaseContract.test.js --bail=0` | 0 | 5.2s | `a7875da0f2142690…` |
| B | `B3-devBranchGateStepEvidence.test.js` | `npx jest tests/unit/governance/devBranchGateStepEvidence.test.js --bail=0` | 0 | 2.8s | `e84449c05fa9c729…` |
| C | `L0a-artefatos-canoeiros` | `npm run ci:artifacts` | 0 | 10.1s | `d7d02d6d7ccecc18…` |
| C | `L0-suite-oficial` | `npm test` | 0 | 517.2s | `ded06b1398b19259…` |
| C | `L0b-integracao-engenheiro` | `npx jest tests/integration/engineering --bail=0 --runInBand --forceExit` | 0 | 1071.8s | `ef5bb2da3c654353…` |
| D | `L1-release-dag` | `node scripts/governance/validate-release-dag.js` | 0 | 0.2s | `301c27daf96e87f5…` |
| D | `L1-fila-oficial` | `node scripts/governance/validate-hardening-queue.js` | 0 | 1.7s | `9559a265be2edb78…` |
| D | `L1-ai-memory` | `node scripts/governance/validate-ai-memory.js` | 0 | 0.1s | `e3b0c44298fc1c14…` |
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
git log -1 --format=%H -- AI_MEMORY/evidence/dev-branch-ci-83b50f1e4209-parcial.md   # commit que publicou esta evidência
```

`evidenceSha256` = `acbea5dc6494f1dae490ee66eb50a37ccff6b762f45de9c0e9497311cd0d328d` (sha256 do payload sem este campo).

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
      "passosReais": 3,
      "passosEsperados": 3,
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
    "sha": "83b50f1e4209522593d554a84a40b1d02abeb6cc",
    "execucaoId": "99b45054-b665-49c6-9b9c-c0f0519184c1"
  },
  "identidade": {
    "sha": "83b50f1e4209522593d554a84a40b1d02abeb6cc",
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
  "sha": "83b50f1e4209522593d554a84a40b1d02abeb6cc",
  "shaCurto": "83b50f1e4209",
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
        "detalhe": "HEAD=83b50f1e4209522593d554a84a40b1d02abeb6cc"
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
      "duracaoMs": 6621,
      "sha256Saida": "613cb58943ee3301f9cdd608f3700a7ce1ba5811c51eb173f95682a3e02459eb",
      "saidaFinal": "  P0-01 — integração com decidirVeredito\n    ✓ fase D INCOMPLETE nunca vira PASS global (101 ms)\n\nTest Suites: 1 passed, 1 total\nTests:       29 passed, 29 total\nSnapshots:   0 total\nTime:        3.793 s\nRan all test suites matching /tests\\/unit\\/governance\\/phaseStepContract.test.js/i.\n[engineering-runner-jest 2026-10-24T19:11:30.844Z] runner ENCERROU: pid=1343054 code=0 signal=null\n[engineering-runner-jest 2026-10-24T19:11:30.847Z] apos o encerramento, /health na porta 39295: sem resposta\n[jest-global-teardown] Engineering Runner (pid 1343054) encerrado (porta liberada)\nForce exiting Jest: Have you considered using `--detectOpenHandles` to detect async operations that kept running after all tests finished?",
      "saidaRef": "AI_MEMORY/evidence/dev-branch-gate-logs/99b45054-b665-49c6-9b9c-c0f0519184c1/B1-phaseStepContract.test.js.log"
    },
    {
      "id": "B2-devBranchGatePhaseContract.test.js",
      "fase": "B",
      "nivel": "B",
      "descricao": "Teste de regressão declarado: tests/unit/governance/devBranchGatePhaseContract.test.js",
      "comando": "npx jest tests/unit/governance/devBranchGatePhaseContract.test.js --bail=0",
      "exitCode": 0,
      "timeout": false,
      "duracaoMs": 5180,
      "sha256Saida": "a7875da0f214269068ded35713669a723d5388781b6db68315651d44be8dae44",
      "saidaFinal": "    ✓ --fases Z ⇒ ENTRADA_INVALIDA (254 ms)\n    ✓ o contexto de execução é único por rodada (102 ms)\n\nTest Suites: 1 passed, 1 total\nTests:       21 passed, 21 total\nSnapshots:   0 total\nTime:        3.37 s\nRan all test suites matching /tests\\/unit\\/governance\\/devBranchGatePhaseContract.test.js/i.\n[engineering-runner-jest 2026-10-24T19:11:36.019Z] runner ENCERROU: pid=1343321 code=0 signal=null\n[engineering-runner-jest 2026-10-24T19:11:36.024Z] apos o encerramento, /health na porta 39295: sem resposta\n[jest-global-teardown] Engineering Runner (pid 1343321) encerrado (porta liberada)\nForce exiting Jest: Have you considered using `--detectOpenHandles` to detect async operations that kept running after all tests finished?",
      "saidaRef": "AI_MEMORY/evidence/dev-branch-gate-logs/99b45054-b665-49c6-9b9c-c0f0519184c1/B2-devBranchGatePhaseContract.test.js.log"
    },
    {
      "id": "B3-devBranchGateStepEvidence.test.js",
      "fase": "B",
      "nivel": "B",
      "descricao": "Teste de regressão declarado: tests/unit/governance/devBranchGateStepEvidence.test.js",
      "comando": "npx jest tests/unit/governance/devBranchGateStepEvidence.test.js --bail=0",
      "exitCode": 0,
      "timeout": false,
      "duracaoMs": 2799,
      "sha256Saida": "e84449c05fa9c729b6a48d59cd5e5f7ac6f0ec2bc0abe8dce53bb3521806db33",
      "saidaFinal": "    ✓ passo que FALHA também deixa a saída completa — falha é diagnosticável, não só contada (162 ms)\n    ✓ o log fica separado por execucaoId — duas execuções não sobrescrevem a evidência uma da outra (123 ms)\n\nTest Suites: 1 passed, 1 total\nTests:       3 passed, 3 total\nSnapshots:   0 total\nTime:        0.986 s\nRan all test suites matching /tests\\/unit\\/governance\\/devBranchGateStepEvidence.test.js/i.\n[engineering-runner-jest 2026-10-24T19:11:38.821Z] runner ENCERROU: pid=1343718 code=0 signal=null\n[engineering-runner-jest 2026-10-24T19:11:38.822Z] apos o encerramento, /health na porta 39295: sem resposta\n[jest-global-teardown] Engineering Runner (pid 1343718) encerrado (porta liberada)\nForce exiting Jest: Have you considered using `--detectOpenHandles` to detect async operations that kept running after all tests finished?",
      "saidaRef": "AI_MEMORY/evidence/dev-branch-gate-logs/99b45054-b665-49c6-9b9c-c0f0519184c1/B3-devBranchGateStepEvidence.test.js.log"
    },
    {
      "id": "L0a-artefatos-canoeiros",
      "fase": "C",
      "nivel": "L0",
      "descricao": "Produz os artefatos canônicos (ignorados pelo git) que o L0 consome",
      "comando": "npm run ci:artifacts",
      "exitCode": 0,
      "timeout": false,
      "duracaoMs": 10098,
      "sha256Saida": "d7d02d6d7ccecc18bf140a755aa5a60bf820ece999123888b83936887eef75b5",
      "saidaFinal": "[ci:bootstrap]  ok   coverage-completeness veredito=PASS (1s)\n[ci:bootstrap]  ok   benchmark-sufficiency veredito=PASS (0s)\n[ci:bootstrap]  ok   evo-contract veredito=PASS (0s)\n[ci:bootstrap]  ok   layer-conventions veredito=PASS (1s)\n[ci:bootstrap]  ok   journey-projections veredito=PASS (0s)\n[ci:bootstrap]  ok   json-persistence-audit veredito=PASS (1s)\n[ci:bootstrap]  ok   timeout-architecture veredito=NO_GO (3s)\n[ci:bootstrap]  ok   engineering-router-v2 veredito=NO_GO (0s)\n[ci:bootstrap]  ok   governance-summary veredito=FAIL (0s)\n[ci:bootstrap]  ok   impact-validation veredito=ESCALATE (1s)\n[ci:bootstrap]  ok   artefatos-obrigatorios veredito=PASS (0s)\n[ci:bootstrap] modo=artifacts-only veredito=READY — relatório em reports/ci-bootstrap-report.json",
      "saidaRef": "AI_MEMORY/evidence/dev-branch-gate-logs/99b45054-b665-49c6-9b9c-c0f0519184c1/L0a-artefatos-canoeiros.log"
    },
    {
      "id": "L0-suite-oficial",
      "fase": "C",
      "nivel": "L0",
      "descricao": "Suíte oficial Jest (unit + flow + rpa sem browser)",
      "comando": "npm test",
      "exitCode": 0,
      "timeout": false,
      "duracaoMs": 517216,
      "sha256Saida": "ded06b1398b1925924ba0311655b944c68ad40a7bbc7ed5027d4842870e1ee6d",
      "saidaFinal": "      ○ skipped deve detectar erros\n      ○ skipped deve substituir variáveis\n\nTest Suites: 3 passed, 3 total\nTests:       4 skipped, 7 passed, 11 total\nSnapshots:   0 total\nTime:        3.444 s\nRan all test suites within paths \"tests/rpa/rpa.test.js\", \"tests/rpa/login.test.js\", \"tests/rpa/createTenantByAI.test.js\".\n[engineering-runner-jest 2026-10-24T19:20:26.113Z] runner ENCERROU: pid=1367062 code=0 signal=null\n[engineering-runner-jest 2026-10-24T19:20:26.114Z] apos o encerramento, /health na porta 39295: sem resposta\n[jest-global-teardown] Engineering Runner (pid 1367062) encerrado (porta liberada)\nForce exiting Jest: Have you considered using `--detectOpenHandles` to detect async operations that kept running after all tests finished?",
      "saidaRef": "AI_MEMORY/evidence/dev-branch-gate-logs/99b45054-b665-49c6-9b9c-c0f0519184c1/L0-suite-oficial.log"
    },
    {
      "id": "L0b-integracao-engenheiro",
      "fase": "C",
      "nivel": "L0",
      "descricao": "Integração real do Engenheiro (Postgres + sandbox; falha sem banco)",
      "comando": "npx jest tests/integration/engineering --bail=0 --runInBand --forceExit",
      "exitCode": 0,
      "timeout": false,
      "duracaoMs": 1071753,
      "sha256Saida": "ef5bb2da3c65435351c391087e094f703edfc52719337ec021799a0212388655",
      "saidaFinal": "    ✓ modelo antes mapeado e presente, cujo discovery real confirma que o provider deixou de listar → RETIRED, nunca elegível (174 ms)\n    ✓ reconciliação repetida com os mesmos fatos é idempotente — nunca duplica a entrada (148 ms)\n\nTest Suites: 40 passed, 40 total\nTests:       219 passed, 219 total\nSnapshots:   0 total\nTime:        1069.895 s\nRan all test suites matching /tests\\/integration\\/engineering/i.\n[engineering-runner-jest 2026-10-24T19:38:17.767Z] runner ENCERROU: pid=1367295 code=0 signal=null\n[engineering-runner-jest 2026-10-24T19:38:17.777Z] apos o encerramento, /health na porta 39295: sem resposta\n[jest-global-teardown] Engineering Runner (pid 1367295) encerrado (porta liberada)\nForce exiting Jest: Have you considered using `--detectOpenHandles` to detect async operations that kept running after all tests finished?",
      "saidaRef": "AI_MEMORY/evidence/dev-branch-gate-logs/99b45054-b665-49c6-9b9c-c0f0519184c1/L0b-integracao-engenheiro.log"
    },
    {
      "id": "L1-release-dag",
      "fase": "D",
      "nivel": "L1",
      "descricao": "DAG do release sem ciclo e sem violação de ordem de fase",
      "comando": "node scripts/governance/validate-release-dag.js",
      "exitCode": 0,
      "timeout": false,
      "duracaoMs": 204,
      "sha256Saida": "301c27daf96e87f585ee70df7507f5c1fac37ab8fb37a9a61832b96ab05ca3da",
      "saidaFinal": "[release-dag] status=PASS decision=RELEASE_DAG_ACYCLIC_AND_PHASE_AWARE\n[release-dag] nós=29 artefatos=25 ciclos=0\n[release-dag] relatório: reports/release-dag-report.json",
      "saidaRef": "AI_MEMORY/evidence/dev-branch-gate-logs/99b45054-b665-49c6-9b9c-c0f0519184c1/L1-release-dag.log"
    },
    {
      "id": "L1-fila-oficial",
      "fase": "D",
      "nivel": "L1",
      "descricao": "Fila oficial de hardening sem item aberto nem estado não canônico",
      "comando": "node scripts/governance/validate-hardening-queue.js",
      "exitCode": 0,
      "timeout": false,
      "duracaoMs": 1702,
      "sha256Saida": "9559a265be2edb7838ca7cb238adb1cd5bc520d2a0fb4f57ec497ca7f1be5be3",
      "saidaFinal": "[hardening-queue] 135 itens — done:75 blocked_external:6 prevention_active:35 verified:19\n[hardening-queue] abertos: H15-DIST-RECIBO-STALE(blocked_external), H19-DIST-CAUSA-UNICA(blocked_external), MISSAO-B9-CI-GITHUB-ACTIONS(blocked_external), H20-CADEIA-POS-CERTIFICACAO-DIVERGENTE(blocked_external), P1-PROJECAO-FINAL-DIVERGE-DA-CANONICA-DE-RUN-ABANDONADO(blocked_external), P1-AGREGADO-SEM-IDENTIDADE-DE-RUN-BLOQUEIA-L3(blocked_external)\n[hardening-queue] impedidos (blocked/blocked_external — NÃO são fechados): 6\n[hardening-queue] PASS",
      "saidaRef": "AI_MEMORY/evidence/dev-branch-gate-logs/99b45054-b665-49c6-9b9c-c0f0519184c1/L1-fila-oficial.log"
    },
    {
      "id": "L1-ai-memory",
      "fase": "D",
      "nivel": "L1",
      "descricao": "Memória operacional íntegra",
      "comando": "node scripts/governance/validate-ai-memory.js",
      "exitCode": 0,
      "timeout": false,
      "duracaoMs": 102,
      "sha256Saida": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      "saidaFinal": "",
      "saidaRef": "AI_MEMORY/evidence/dev-branch-gate-logs/99b45054-b665-49c6-9b9c-c0f0519184c1/L1-ai-memory.log"
    },
    {
      "id": "L1-aderencia-agente",
      "fase": "D",
      "nivel": "L1",
      "descricao": "Aderência do agente à Constituição",
      "comando": "node scripts/governance/validate-agent-adherence.js",
      "exitCode": 0,
      "timeout": false,
      "duracaoMs": 53,
      "sha256Saida": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      "saidaFinal": "",
      "saidaRef": "AI_MEMORY/evidence/dev-branch-gate-logs/99b45054-b665-49c6-9b9c-c0f0519184c1/L1-aderencia-agente.log"
    }
  ],
  "falhas": [],
  "evidenceSha256": "acbea5dc6494f1dae490ee66eb50a37ccff6b762f45de9c0e9497311cd0d328d"
}
```
