# Gate em fases da branch de desenvolvimento — eac0fae086d8 (PARCIAL)

- **veredito**: `PASS_PARCIAL`
- **equivale a validação completa**: `false`
- **fases pedidas**: `A,B,C,D`
- **fases obrigatórias**: `A,B,C,D,R,E,F`
- **fases faltantes**: `R,E,F`
- **entrada inválida**: `não`
- **branch**: `ci-clean-checkout`
- **sha exato avaliado**: `eac0fae086d8513a6ffb58053080592157f20a02`
- **gerado em**: 2026-10-25T12:30:13.224Z
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
| `A1-identidade-commit` | ok | HEAD=eac0fae086d8513a6ffb58053080592157f20a02 |
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
| B | `B1-phaseStepContract.test.js` | `npx jest tests/unit/governance/phaseStepContract.test.js --bail=0` | 0 | 6.7s | `3a747d164fff7afb…` |
| B | `B2-devBranchGatePhaseContract.test.js` | `npx jest tests/unit/governance/devBranchGatePhaseContract.test.js --bail=0` | 0 | 5.7s | `316af6588c45ab86…` |
| B | `B3-devBranchGateStepEvidence.test.js` | `npx jest tests/unit/governance/devBranchGateStepEvidence.test.js --bail=0` | 0 | 3.0s | `09b5ebfd81f80ca5…` |
| C | `L0a-artefatos-canoeiros` | `npm run ci:artifacts` | 0 | 12.0s | `0574bcd40e1c23b5…` |
| C | `L0-suite-oficial` | `npm test` | 0 | 552.4s | `df51f795007d6b65…` |
| C | `L0b-integracao-engenheiro` | `npx jest tests/integration/engineering --bail=0 --runInBand --forceExit` | 0 | 1110.1s | `701486e58569f310…` |
| D | `L1-release-dag` | `node scripts/governance/validate-release-dag.js` | 0 | 0.1s | `301c27daf96e87f5…` |
| D | `L1-fila-oficial` | `node scripts/governance/validate-hardening-queue.js` | 0 | 1.0s | `9559a265be2edb78…` |
| D | `L1-ai-memory` | `node scripts/governance/validate-ai-memory.js` | 0 | 0.1s | `e3b0c44298fc1c14…` |
| D | `L1-aderencia-agente` | `node scripts/governance/validate-agent-adherence.js` | 0 | 0.0s | `e3b0c44298fc1c14…` |

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
git log -1 --format=%H -- AI_MEMORY/evidence/dev-branch-ci-eac0fae086d8-parcial.md   # commit que publicou esta evidência
```

`evidenceSha256` = `f55df60a038aaacbe9d970015f9aa52617279e5f754e5cafcd870211e7351764` (sha256 do payload sem este campo).

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
    "sha": "eac0fae086d8513a6ffb58053080592157f20a02",
    "execucaoId": "54445202-9d87-41e7-b5cf-cda9b6801a0f"
  },
  "identidade": {
    "sha": "eac0fae086d8513a6ffb58053080592157f20a02",
    "branch": "ci-clean-checkout",
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
  "sha": "eac0fae086d8513a6ffb58053080592157f20a02",
  "shaCurto": "eac0fae086d8",
  "branch": "ci-clean-checkout",
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
        "detalhe": "HEAD=eac0fae086d8513a6ffb58053080592157f20a02"
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
      "duracaoMs": 6728,
      "sha256Saida": "3a747d164fff7afbbc4892317190f35e24311b4db89ec5fd20052dfc235e2a1e",
      "saidaFinal": "  P0-01 — integração com decidirVeredito\n    ✓ fase D INCOMPLETE nunca vira PASS global (102 ms)\n\nTest Suites: 1 passed, 1 total\nTests:       29 passed, 29 total\nSnapshots:   0 total\nTime:        3.757 s\nRan all test suites matching /tests\\/unit\\/governance\\/phaseStepContract.test.js/i.\n[engineering-runner-jest 2026-10-25T12:02:08.535Z] runner ENCERROU: pid=2679008 code=0 signal=null\n[engineering-runner-jest 2026-10-25T12:02:08.546Z] apos o encerramento, /health na porta 44069: sem resposta\n[jest-global-teardown] Engineering Runner (pid 2679008) encerrado (porta liberada)\nForce exiting Jest: Have you considered using `--detectOpenHandles` to detect async operations that kept running after all tests finished?",
      "saidaRef": "AI_MEMORY/evidence/dev-branch-gate-logs/54445202-9d87-41e7-b5cf-cda9b6801a0f/B1-phaseStepContract.test.js.log"
    },
    {
      "id": "B2-devBranchGatePhaseContract.test.js",
      "fase": "B",
      "nivel": "B",
      "descricao": "Teste de regressão declarado: tests/unit/governance/devBranchGatePhaseContract.test.js",
      "comando": "npx jest tests/unit/governance/devBranchGatePhaseContract.test.js --bail=0",
      "exitCode": 0,
      "timeout": false,
      "duracaoMs": 5747,
      "sha256Saida": "316af6588c45ab86c810735f155c8d00c83bf9553b629667b0c07aca50eb4c55",
      "saidaFinal": "    ✓ --fases Z ⇒ ENTRADA_INVALIDA (570 ms)\n    ✓ o contexto de execução é único por rodada (103 ms)\n\nTest Suites: 1 passed, 1 total\nTests:       21 passed, 21 total\nSnapshots:   0 total\nTime:        3.885 s\nRan all test suites matching /tests\\/unit\\/governance\\/devBranchGatePhaseContract.test.js/i.\n[engineering-runner-jest 2026-10-25T12:02:14.297Z] runner ENCERROU: pid=2679241 code=0 signal=null\n[engineering-runner-jest 2026-10-25T12:02:14.302Z] apos o encerramento, /health na porta 44069: sem resposta\n[jest-global-teardown] Engineering Runner (pid 2679241) encerrado (porta liberada)\nForce exiting Jest: Have you considered using `--detectOpenHandles` to detect async operations that kept running after all tests finished?",
      "saidaRef": "AI_MEMORY/evidence/dev-branch-gate-logs/54445202-9d87-41e7-b5cf-cda9b6801a0f/B2-devBranchGatePhaseContract.test.js.log"
    },
    {
      "id": "B3-devBranchGateStepEvidence.test.js",
      "fase": "B",
      "nivel": "B",
      "descricao": "Teste de regressão declarado: tests/unit/governance/devBranchGateStepEvidence.test.js",
      "comando": "npx jest tests/unit/governance/devBranchGateStepEvidence.test.js --bail=0",
      "exitCode": 0,
      "timeout": false,
      "duracaoMs": 3045,
      "sha256Saida": "09b5ebfd81f80ca532f9bf266e1dacc485040268219e8f1802e2da5f165b82bd",
      "saidaFinal": "    ✓ passo que FALHA também deixa a saída completa — falha é diagnosticável, não só contada (147 ms)\n    ✓ o log fica separado por execucaoId — duas execuções não sobrescrevem a evidência uma da outra (140 ms)\n\nTest Suites: 1 passed, 1 total\nTests:       3 passed, 3 total\nSnapshots:   0 total\nTime:        0.903 s\nRan all test suites matching /tests\\/unit\\/governance\\/devBranchGateStepEvidence.test.js/i.\n[engineering-runner-jest 2026-10-25T12:02:17.335Z] runner ENCERROU: pid=2679485 code=0 signal=null\n[engineering-runner-jest 2026-10-25T12:02:17.341Z] apos o encerramento, /health na porta 44069: sem resposta\n[jest-global-teardown] Engineering Runner (pid 2679485) encerrado (porta liberada)\nForce exiting Jest: Have you considered using `--detectOpenHandles` to detect async operations that kept running after all tests finished?",
      "saidaRef": "AI_MEMORY/evidence/dev-branch-gate-logs/54445202-9d87-41e7-b5cf-cda9b6801a0f/B3-devBranchGateStepEvidence.test.js.log"
    },
    {
      "id": "L0a-artefatos-canoeiros",
      "fase": "C",
      "nivel": "L0",
      "descricao": "Produz os artefatos canônicos (ignorados pelo git) que o L0 consome",
      "comando": "npm run ci:artifacts",
      "exitCode": 0,
      "timeout": false,
      "duracaoMs": 11957,
      "sha256Saida": "0574bcd40e1c23b51653be13fd5ae37645be87486909cf589100574a606585f7",
      "saidaFinal": "[ci:bootstrap]  ok   coverage-completeness veredito=PASS (1s)\n[ci:bootstrap]  ok   benchmark-sufficiency veredito=PASS (1s)\n[ci:bootstrap]  ok   evo-contract veredito=PASS (0s)\n[ci:bootstrap]  ok   layer-conventions veredito=PASS (1s)\n[ci:bootstrap]  ok   journey-projections veredito=PASS (0s)\n[ci:bootstrap]  ok   json-persistence-audit veredito=PASS (1s)\n[ci:bootstrap]  ok   timeout-architecture veredito=NO_GO (3s)\n[ci:bootstrap]  ok   engineering-router-v2 veredito=NO_GO (0s)\n[ci:bootstrap]  ok   governance-summary veredito=FAIL (1s)\n[ci:bootstrap]  ok   impact-validation veredito=ESCALATE (1s)\n[ci:bootstrap]  ok   artefatos-obrigatorios veredito=PASS (0s)\n[ci:bootstrap] modo=artifacts-only veredito=READY — relatório em reports/ci-bootstrap-report.json",
      "saidaRef": "AI_MEMORY/evidence/dev-branch-gate-logs/54445202-9d87-41e7-b5cf-cda9b6801a0f/L0a-artefatos-canoeiros.log"
    },
    {
      "id": "L0-suite-oficial",
      "fase": "C",
      "nivel": "L0",
      "descricao": "Suíte oficial Jest (unit + flow + rpa sem browser)",
      "comando": "npm test",
      "exitCode": 0,
      "timeout": false,
      "duracaoMs": 552382,
      "sha256Saida": "df51f795007d6b65e7b85f15a6fadbbb7829eca83020a1e44593f142cea8a0fc",
      "saidaFinal": "      ○ skipped deve detectar erros\n      ○ skipped deve substituir variáveis\n\nTest Suites: 3 passed, 3 total\nTests:       4 skipped, 7 passed, 11 total\nSnapshots:   0 total\nTime:        3.426 s\nRan all test suites within paths \"tests/rpa/rpa.test.js\", \"tests/rpa/login.test.js\", \"tests/rpa/createTenantByAI.test.js\".\n[engineering-runner-jest 2026-10-25T12:11:41.611Z] runner ENCERROU: pid=2703776 code=0 signal=null\n[engineering-runner-jest 2026-10-25T12:11:41.614Z] apos o encerramento, /health na porta 44069: sem resposta\n[jest-global-teardown] Engineering Runner (pid 2703776) encerrado (porta liberada)\nForce exiting Jest: Have you considered using `--detectOpenHandles` to detect async operations that kept running after all tests finished?",
      "saidaRef": "AI_MEMORY/evidence/dev-branch-gate-logs/54445202-9d87-41e7-b5cf-cda9b6801a0f/L0-suite-oficial.log"
    },
    {
      "id": "L0b-integracao-engenheiro",
      "fase": "C",
      "nivel": "L0",
      "descricao": "Integração real do Engenheiro (Postgres + sandbox; falha sem banco)",
      "comando": "npx jest tests/integration/engineering --bail=0 --runInBand --forceExit",
      "exitCode": 0,
      "timeout": false,
      "duracaoMs": 1110056,
      "sha256Saida": "701486e58569f310b6c7535a31d9d441e65c67cfd21cf16e967bdd47af033bde",
      "saidaFinal": "    ✓ modelo antes mapeado e presente, cujo discovery real confirma que o provider deixou de listar → RETIRED, nunca elegível (137 ms)\n    ✓ reconciliação repetida com os mesmos fatos é idempotente — nunca duplica a entrada (137 ms)\n\nTest Suites: 40 passed, 40 total\nTests:       219 passed, 219 total\nSnapshots:   0 total\nTime:        1107.862 s\nRan all test suites matching /tests\\/integration\\/engineering/i.\n[engineering-runner-jest 2026-10-25T12:30:11.654Z] runner ENCERROU: pid=2703991 code=0 signal=null\n[engineering-runner-jest 2026-10-25T12:30:11.666Z] apos o encerramento, /health na porta 44069: sem resposta\n[jest-global-teardown] Engineering Runner (pid 2703991) encerrado (porta liberada)\nForce exiting Jest: Have you considered using `--detectOpenHandles` to detect async operations that kept running after all tests finished?",
      "saidaRef": "AI_MEMORY/evidence/dev-branch-gate-logs/54445202-9d87-41e7-b5cf-cda9b6801a0f/L0b-integracao-engenheiro.log"
    },
    {
      "id": "L1-release-dag",
      "fase": "D",
      "nivel": "L1",
      "descricao": "DAG do release sem ciclo e sem violação de ordem de fase",
      "comando": "node scripts/governance/validate-release-dag.js",
      "exitCode": 0,
      "timeout": false,
      "duracaoMs": 66,
      "sha256Saida": "301c27daf96e87f585ee70df7507f5c1fac37ab8fb37a9a61832b96ab05ca3da",
      "saidaFinal": "[release-dag] status=PASS decision=RELEASE_DAG_ACYCLIC_AND_PHASE_AWARE\n[release-dag] nós=29 artefatos=25 ciclos=0\n[release-dag] relatório: reports/release-dag-report.json",
      "saidaRef": "AI_MEMORY/evidence/dev-branch-gate-logs/54445202-9d87-41e7-b5cf-cda9b6801a0f/L1-release-dag.log"
    },
    {
      "id": "L1-fila-oficial",
      "fase": "D",
      "nivel": "L1",
      "descricao": "Fila oficial de hardening sem item aberto nem estado não canônico",
      "comando": "node scripts/governance/validate-hardening-queue.js",
      "exitCode": 0,
      "timeout": false,
      "duracaoMs": 991,
      "sha256Saida": "9559a265be2edb7838ca7cb238adb1cd5bc520d2a0fb4f57ec497ca7f1be5be3",
      "saidaFinal": "[hardening-queue] 135 itens — done:75 blocked_external:6 prevention_active:35 verified:19\n[hardening-queue] abertos: H15-DIST-RECIBO-STALE(blocked_external), H19-DIST-CAUSA-UNICA(blocked_external), MISSAO-B9-CI-GITHUB-ACTIONS(blocked_external), H20-CADEIA-POS-CERTIFICACAO-DIVERGENTE(blocked_external), P1-PROJECAO-FINAL-DIVERGE-DA-CANONICA-DE-RUN-ABANDONADO(blocked_external), P1-AGREGADO-SEM-IDENTIDADE-DE-RUN-BLOQUEIA-L3(blocked_external)\n[hardening-queue] impedidos (blocked/blocked_external — NÃO são fechados): 6\n[hardening-queue] PASS",
      "saidaRef": "AI_MEMORY/evidence/dev-branch-gate-logs/54445202-9d87-41e7-b5cf-cda9b6801a0f/L1-fila-oficial.log"
    },
    {
      "id": "L1-ai-memory",
      "fase": "D",
      "nivel": "L1",
      "descricao": "Memória operacional íntegra",
      "comando": "node scripts/governance/validate-ai-memory.js",
      "exitCode": 0,
      "timeout": false,
      "duracaoMs": 148,
      "sha256Saida": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      "saidaFinal": "",
      "saidaRef": "AI_MEMORY/evidence/dev-branch-gate-logs/54445202-9d87-41e7-b5cf-cda9b6801a0f/L1-ai-memory.log"
    },
    {
      "id": "L1-aderencia-agente",
      "fase": "D",
      "nivel": "L1",
      "descricao": "Aderência do agente à Constituição",
      "comando": "node scripts/governance/validate-agent-adherence.js",
      "exitCode": 0,
      "timeout": false,
      "duracaoMs": 49,
      "sha256Saida": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      "saidaFinal": "",
      "saidaRef": "AI_MEMORY/evidence/dev-branch-gate-logs/54445202-9d87-41e7-b5cf-cda9b6801a0f/L1-aderencia-agente.log"
    }
  ],
  "falhas": [],
  "evidenceSha256": "f55df60a038aaacbe9d970015f9aa52617279e5f754e5cafcd870211e7351764"
}
```
