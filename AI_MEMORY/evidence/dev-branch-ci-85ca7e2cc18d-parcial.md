# Gate em fases da branch de desenvolvimento — 85ca7e2cc18d (PARCIAL)

- **veredito**: `PASS_PARCIAL`
- **equivale a validação completa**: `false`
- **fases pedidas**: `A,B,C,D`
- **fases obrigatórias**: `A,B,C,D,R,E,F`
- **fases faltantes**: `R,E,F`
- **entrada inválida**: `não`
- **branch**: `codex/p1-governance-hardening-20261023`
- **sha exato avaliado**: `85ca7e2cc18d3f108a18ae13bcb37bf3bc67bf6b`
- **gerado em**: 2026-10-24T10:06:19.241Z
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
| `A1-identidade-commit` | ok | HEAD=85ca7e2cc18d3f108a18ae13bcb37bf3bc67bf6b |
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
| B | `B1-phaseStepContract.test.js` | `npx jest tests/unit/governance/phaseStepContract.test.js --bail=0` | 0 | 6.8s | `e17eb3b458aaa399…` |
| B | `B2-devBranchGatePhaseContract.test.js` | `npx jest tests/unit/governance/devBranchGatePhaseContract.test.js --bail=0` | 0 | 5.1s | `028739b6a1594ad1…` |
| B | `B3-devBranchGateStepEvidence.test.js` | `npx jest tests/unit/governance/devBranchGateStepEvidence.test.js --bail=0` | 0 | 3.0s | `bb1adf4a317a25cd…` |
| C | `L0-suite-oficial` | `npm test` | 0 | 471.4s | `818f4acbb1f3ebb2…` |
| C | `L0b-integracao-engenheiro` | `npx jest tests/integration/engineering --bail=0 --runInBand --forceExit` | 0 | 969.0s | `d445292c0bbb846b…` |
| D | `L1-release-dag` | `node scripts/governance/validate-release-dag.js` | 0 | 0.2s | `301c27daf96e87f5…` |
| D | `L1-fila-oficial` | `node scripts/governance/validate-hardening-queue.js` | 0 | 1.5s | `9559a265be2edb78…` |
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
git log -1 --format=%H -- AI_MEMORY/evidence/dev-branch-ci-85ca7e2cc18d-parcial.md   # commit que publicou esta evidência
```

`evidenceSha256` = `776cff965a597ac1ea9ef919e6c736855561b3b10cc421373145e71ca9e60a22` (sha256 do payload sem este campo).

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
    "sha": "85ca7e2cc18d3f108a18ae13bcb37bf3bc67bf6b",
    "execucaoId": "a5b19e59-0692-41f4-8d0b-86d1c1b7b1d8"
  },
  "identidade": {
    "sha": "85ca7e2cc18d3f108a18ae13bcb37bf3bc67bf6b",
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
  "sha": "85ca7e2cc18d3f108a18ae13bcb37bf3bc67bf6b",
  "shaCurto": "85ca7e2cc18d",
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
        "detalhe": "HEAD=85ca7e2cc18d3f108a18ae13bcb37bf3bc67bf6b"
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
      "duracaoMs": 6821,
      "sha256Saida": "e17eb3b458aaa3991df882e3db8f6f04afbf53b6f43ef06a6412ab0fb9962035",
      "saidaFinal": "  P0-01 — integração com decidirVeredito\n    ✓ fase D INCOMPLETE nunca vira PASS global (103 ms)\n\nTest Suites: 1 passed, 1 total\nTests:       28 passed, 28 total\nSnapshots:   0 total\nTime:        4.096 s\nRan all test suites matching /tests\\/unit\\/governance\\/phaseStepContract.test.js/i.\n[engineering-runner-jest 2026-10-24T09:42:08.016Z] runner ENCERROU: pid=330157 code=0 signal=null\n[engineering-runner-jest 2026-10-24T09:42:08.023Z] apos o encerramento, /health na porta 42269: sem resposta\n[jest-global-teardown] Engineering Runner (pid 330157) encerrado (porta liberada)\nForce exiting Jest: Have you considered using `--detectOpenHandles` to detect async operations that kept running after all tests finished?",
      "saidaRef": "AI_MEMORY/evidence/dev-branch-gate-logs/a5b19e59-0692-41f4-8d0b-86d1c1b7b1d8/B1-phaseStepContract.test.js.log"
    },
    {
      "id": "B2-devBranchGatePhaseContract.test.js",
      "fase": "B",
      "nivel": "B",
      "descricao": "Teste de regressão declarado: tests/unit/governance/devBranchGatePhaseContract.test.js",
      "comando": "npx jest tests/unit/governance/devBranchGatePhaseContract.test.js --bail=0",
      "exitCode": 0,
      "timeout": false,
      "duracaoMs": 5068,
      "sha256Saida": "028739b6a1594ad1fbe3b4ecc5247c85e622c6ed7e022f284dcca9d6b93ff7a0",
      "saidaFinal": "    ✓ --fases Z ⇒ ENTRADA_INVALIDA (247 ms)\n    ✓ o contexto de execução é único por rodada (104 ms)\n\nTest Suites: 1 passed, 1 total\nTests:       21 passed, 21 total\nSnapshots:   0 total\nTime:        3.299 s\nRan all test suites matching /tests\\/unit\\/governance\\/devBranchGatePhaseContract.test.js/i.\n[engineering-runner-jest 2026-10-24T09:42:13.135Z] runner ENCERROU: pid=330376 code=0 signal=null\n[engineering-runner-jest 2026-10-24T09:42:13.141Z] apos o encerramento, /health na porta 42269: sem resposta\n[jest-global-teardown] Engineering Runner (pid 330376) encerrado (porta liberada)\nForce exiting Jest: Have you considered using `--detectOpenHandles` to detect async operations that kept running after all tests finished?",
      "saidaRef": "AI_MEMORY/evidence/dev-branch-gate-logs/a5b19e59-0692-41f4-8d0b-86d1c1b7b1d8/B2-devBranchGatePhaseContract.test.js.log"
    },
    {
      "id": "B3-devBranchGateStepEvidence.test.js",
      "fase": "B",
      "nivel": "B",
      "descricao": "Teste de regressão declarado: tests/unit/governance/devBranchGateStepEvidence.test.js",
      "comando": "npx jest tests/unit/governance/devBranchGateStepEvidence.test.js --bail=0",
      "exitCode": 0,
      "timeout": false,
      "duracaoMs": 3022,
      "sha256Saida": "bb1adf4a317a25cdeff9fd913ff851216bc5c27f97d58f9fb6226d81cbb62946",
      "saidaFinal": "    ✓ passo que FALHA também deixa a saída completa — falha é diagnosticável, não só contada (147 ms)\n    ✓ o log fica separado por execucaoId — duas execuções não sobrescrevem a evidência uma da outra (124 ms)\n\nTest Suites: 1 passed, 1 total\nTests:       3 passed, 3 total\nSnapshots:   0 total\nTime:        0.917 s\nRan all test suites matching /tests\\/unit\\/governance\\/devBranchGateStepEvidence.test.js/i.\n[engineering-runner-jest 2026-10-24T09:42:16.198Z] runner ENCERROU: pid=330612 code=0 signal=null\n[engineering-runner-jest 2026-10-24T09:42:16.200Z] apos o encerramento, /health na porta 42269: sem resposta\n[jest-global-teardown] Engineering Runner (pid 330612) encerrado (porta liberada)\nForce exiting Jest: Have you considered using `--detectOpenHandles` to detect async operations that kept running after all tests finished?",
      "saidaRef": "AI_MEMORY/evidence/dev-branch-gate-logs/a5b19e59-0692-41f4-8d0b-86d1c1b7b1d8/B3-devBranchGateStepEvidence.test.js.log"
    },
    {
      "id": "L0-suite-oficial",
      "fase": "C",
      "nivel": "L0",
      "descricao": "Suíte oficial Jest (unit + flow + rpa sem browser)",
      "comando": "npm test",
      "exitCode": 0,
      "timeout": false,
      "duracaoMs": 471445,
      "sha256Saida": "818f4acbb1f3ebb299d440aa3bddd9a44cde5280788cb8e1d813e257e06b39c4",
      "saidaFinal": "      ○ skipped deve detectar erros\n      ○ skipped deve substituir variáveis\n\nTest Suites: 3 passed, 3 total\nTests:       4 skipped, 7 passed, 11 total\nSnapshots:   0 total\nTime:        8.029 s\nRan all test suites within paths \"tests/rpa/rpa.test.js\", \"tests/rpa/login.test.js\", \"tests/rpa/createTenantByAI.test.js\".\n[engineering-runner-jest 2026-10-24T09:50:07.615Z] runner ENCERROU: pid=351124 code=0 signal=null\n[engineering-runner-jest 2026-10-24T09:50:07.618Z] apos o encerramento, /health na porta 42269: sem resposta\n[jest-global-teardown] Engineering Runner (pid 351124) encerrado (porta liberada)\nForce exiting Jest: Have you considered using `--detectOpenHandles` to detect async operations that kept running after all tests finished?",
      "saidaRef": "AI_MEMORY/evidence/dev-branch-gate-logs/a5b19e59-0692-41f4-8d0b-86d1c1b7b1d8/L0-suite-oficial.log"
    },
    {
      "id": "L0b-integracao-engenheiro",
      "fase": "C",
      "nivel": "L0",
      "descricao": "Integração real do Engenheiro (Postgres + sandbox; falha sem banco)",
      "comando": "npx jest tests/integration/engineering --bail=0 --runInBand --forceExit",
      "exitCode": 0,
      "timeout": false,
      "duracaoMs": 969001,
      "sha256Saida": "d445292c0bbb846b2a1e682514d87a945ec2cfc1741f7ac9c561aff002410c86",
      "saidaFinal": "    ✓ modelo antes mapeado e presente, cujo discovery real confirma que o provider deixou de listar → RETIRED, nunca elegível (119 ms)\n    ✓ reconciliação repetida com os mesmos fatos é idempotente — nunca duplica a entrada (141 ms)\n\nTest Suites: 40 passed, 40 total\nTests:       219 passed, 219 total\nSnapshots:   0 total\nTime:        966.727 s\nRan all test suites matching /tests\\/integration\\/engineering/i.\n[engineering-runner-jest 2026-10-24T10:06:16.504Z] runner ENCERROU: pid=351906 code=0 signal=null\n[engineering-runner-jest 2026-10-24T10:06:16.515Z] apos o encerramento, /health na porta 42269: sem resposta\n[jest-global-teardown] Engineering Runner (pid 351906) encerrado (porta liberada)\nForce exiting Jest: Have you considered using `--detectOpenHandles` to detect async operations that kept running after all tests finished?",
      "saidaRef": "AI_MEMORY/evidence/dev-branch-gate-logs/a5b19e59-0692-41f4-8d0b-86d1c1b7b1d8/L0b-integracao-engenheiro.log"
    },
    {
      "id": "L1-release-dag",
      "fase": "D",
      "nivel": "L1",
      "descricao": "DAG do release sem ciclo e sem violação de ordem de fase",
      "comando": "node scripts/governance/validate-release-dag.js",
      "exitCode": 0,
      "timeout": false,
      "duracaoMs": 210,
      "sha256Saida": "301c27daf96e87f585ee70df7507f5c1fac37ab8fb37a9a61832b96ab05ca3da",
      "saidaFinal": "[release-dag] status=PASS decision=RELEASE_DAG_ACYCLIC_AND_PHASE_AWARE\n[release-dag] nós=29 artefatos=25 ciclos=0\n[release-dag] relatório: reports/release-dag-report.json",
      "saidaRef": "AI_MEMORY/evidence/dev-branch-gate-logs/a5b19e59-0692-41f4-8d0b-86d1c1b7b1d8/L1-release-dag.log"
    },
    {
      "id": "L1-fila-oficial",
      "fase": "D",
      "nivel": "L1",
      "descricao": "Fila oficial de hardening sem item aberto nem estado não canônico",
      "comando": "node scripts/governance/validate-hardening-queue.js",
      "exitCode": 0,
      "timeout": false,
      "duracaoMs": 1549,
      "sha256Saida": "9559a265be2edb7838ca7cb238adb1cd5bc520d2a0fb4f57ec497ca7f1be5be3",
      "saidaFinal": "[hardening-queue] 135 itens — done:75 blocked_external:6 prevention_active:35 verified:19\n[hardening-queue] abertos: H15-DIST-RECIBO-STALE(blocked_external), H19-DIST-CAUSA-UNICA(blocked_external), MISSAO-B9-CI-GITHUB-ACTIONS(blocked_external), H20-CADEIA-POS-CERTIFICACAO-DIVERGENTE(blocked_external), P1-PROJECAO-FINAL-DIVERGE-DA-CANONICA-DE-RUN-ABANDONADO(blocked_external), P1-AGREGADO-SEM-IDENTIDADE-DE-RUN-BLOQUEIA-L3(blocked_external)\n[hardening-queue] impedidos (blocked/blocked_external — NÃO são fechados): 6\n[hardening-queue] PASS",
      "saidaRef": "AI_MEMORY/evidence/dev-branch-gate-logs/a5b19e59-0692-41f4-8d0b-86d1c1b7b1d8/L1-fila-oficial.log"
    },
    {
      "id": "L1-ai-memory",
      "fase": "D",
      "nivel": "L1",
      "descricao": "Memória operacional íntegra",
      "comando": "node scripts/governance/validate-ai-memory.js",
      "exitCode": 0,
      "timeout": false,
      "duracaoMs": 264,
      "sha256Saida": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      "saidaFinal": "",
      "saidaRef": "AI_MEMORY/evidence/dev-branch-gate-logs/a5b19e59-0692-41f4-8d0b-86d1c1b7b1d8/L1-ai-memory.log"
    },
    {
      "id": "L1-aderencia-agente",
      "fase": "D",
      "nivel": "L1",
      "descricao": "Aderência do agente à Constituição",
      "comando": "node scripts/governance/validate-agent-adherence.js",
      "exitCode": 0,
      "timeout": false,
      "duracaoMs": 147,
      "sha256Saida": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      "saidaFinal": "",
      "saidaRef": "AI_MEMORY/evidence/dev-branch-gate-logs/a5b19e59-0692-41f4-8d0b-86d1c1b7b1d8/L1-aderencia-agente.log"
    }
  ],
  "falhas": [],
  "evidenceSha256": "776cff965a597ac1ea9ef919e6c736855561b3b10cc421373145e71ca9e60a22"
}
```
