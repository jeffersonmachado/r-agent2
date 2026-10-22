# Gate em fases da branch de desenvolvimento — 133eb147c1e3 (PARCIAL)

- **veredito**: `FAIL`
- **equivale a validação completa**: `false`
- **fases pedidas**: `A,B,C,D`
- **fases obrigatórias**: `A,B,C,D,E,F`
- **fases faltantes**: `E,F`
- **entrada inválida**: `não`
- **branch**: `dev/engineering-hardening`
- **sha exato avaliado**: `133eb147c1e360ae5919e80198decaf535431cb4`
- **gerado em**: 2026-10-22T10:15:10.600Z
- **gate efetivo**: LOCAL — o runner do GitHub não inicia jobs por limite de gastos da conta

## Estado por fase (comprovação, não intenção)

| fase | estado | passos reais | motivo |
|---|---|---|---|
| A | **PASS** | 10 | — |
| B | **PASS** | 3 | — |
| C | **PASS** | 2 | — |
| D | **BLOCKED** | 1 | PASSO_FALHOU |

## Pré-voo (fase A)

| check | resultado | detalhe |
|---|---|---|
| `A1-identidade-commit` | ok | HEAD=133eb147c1e360ae5919e80198decaf535431cb4 |
| `A2-sha-esperado` | ok | não exigido nesta execução |
| `A3-arvore-limpa` | ok | limpa |
| `A4-inventario-defeitos` | ok | 135 item(ns) |
| `A5-dependencias` | ok | node_modules presente |
| `A5b-jest` | ok | binário do Jest |
| `A6-node` | ok | node 22.12.0 |
| `A7-regras-preventivas` | ok | 12 presentes |
| `A8-evidencia-anterior` | ok | não existe relatório anterior |
| `A9-lineage-run-projecao` | ok | sem run aberto ou sem projeção (nada a comparar) |

Inventário de defeitos: 135 item(ns), 6 aberto(s), 1 bloqueante(s) para certificação.

## Autorizações de fase (Bug Closure First)

| fase | operação | decisão | motivos |
|---|---|---|---|
| B | `TESTES_NEGATIVOS_REGRESSAO` | **ALLOWED** | BLOQUEIO_EXTERNO_NAO_RESOLVE_CERTIFICACAO |
| C | `L0_COMPLETO` | **ALLOWED** | BLOQUEIO_EXTERNO_NAO_RESOLVE_CERTIFICACAO |
| D | `L1_AMPLO` | **ALLOWED** | BLOQUEIO_EXTERNO_NAO_RESOLVE_CERTIFICACAO |

**BLOQUEIO**: fase D — `PASSO_FALHOU` L1-cadeia-criptografica exit=1

## Passos executados (comando, exit code, duração, sha256 da saída)

| fase | passo | comando | exit | duração | sha256 da saída |
|---|---|---|---|---|---|
| B | `B1-phaseStepContract.test.js` | `npx jest tests/unit/governance/phaseStepContract.test.js --bail=0` | 0 | 6.8s | `3499a6b15ec38890…` |
| B | `B2-devBranchGatePhaseContract.test.js` | `npx jest tests/unit/governance/devBranchGatePhaseContract.test.js --bail=0` | 0 | 5.7s | `452ba5a7787e2b0a…` |
| B | `B3-devBranchGateStepEvidence.test.js` | `npx jest tests/unit/governance/devBranchGateStepEvidence.test.js --bail=0` | 0 | 2.9s | `55c5237fe6f35eac…` |
| C | `L0-suite-oficial` | `npm test` | 0 | 418.4s | `84a3e829bd627580…` |
| C | `L0b-integracao-engenheiro` | `npx jest tests/integration/engineering --bail=0 --runInBand --forceExit` | 0 | 927.7s | `f1ff46c51279c088…` |
| D | `L1-cadeia-criptografica` | `node scripts/governance/validate-governance-chain.js` | 1 | 0.4s | `ada6fd6d8800fb9f…` |

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
git log -1 --format=%H -- AI_MEMORY/evidence/dev-branch-ci-133eb147c1e3-parcial.md   # commit que publicou esta evidência
```

`evidenceSha256` = `0cbbf331faa1345db0ca9b94cb5fbb8a13d87bcde1f930b336d6eff309a0703d` (sha256 do payload sem este campo).

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
      "estado": "PASS",
      "passosReais": 2,
      "passosEsperados": 2,
      "passosAusentes": [],
      "motivo": null
    },
    {
      "fase": "D",
      "estado": "BLOCKED",
      "passosReais": 1,
      "passosEsperados": 7,
      "motivo": "PASSO_FALHOU"
    }
  ],
  "fasesNaoAprovadas": [
    "D"
  ],
  "entradaInvalida": null,
  "entrada": {
    "bruto": "A,B,C,D",
    "duplicadas": [],
    "desconhecidas": []
  },
  "contextoExecucao": {
    "sha": "133eb147c1e360ae5919e80198decaf535431cb4",
    "execucaoId": "4124f4d0-c4cf-4879-b260-6377b65b9c12"
  },
  "identidade": {
    "sha": "133eb147c1e360ae5919e80198decaf535431cb4",
    "branch": "dev/engineering-hardening",
    "shaValido": true,
    "branchValida": true
  },
  "fasesConcluidas": [
    "A",
    "B",
    "C"
  ],
  "fasesNaoAplicaveis": [],
  "sha": "133eb147c1e360ae5919e80198decaf535431cb4",
  "shaCurto": "133eb147c1e3",
  "branch": "dev/engineering-hardening",
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
        "detalhe": "HEAD=133eb147c1e360ae5919e80198decaf535431cb4"
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
      "abertos": 6,
      "bloqueantesParaCertificacao": 1,
      "semSeveridadeAbertos": 0,
      "bloqueioExterno": 6,
      "riscoAceito": 0,
      "porEstado": {
        "VERIFIED": 111,
        "BLOCKED_EXTERNAL": 6,
        "RESOLVED": 18
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
  "bloqueio": {
    "fase": "D",
    "code": "PASSO_FALHOU",
    "detail": "L1-cadeia-criptografica exit=1"
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
      "duracaoMs": 6795,
      "sha256Saida": "3499a6b15ec388902b78a58383fc98646c96d8d9ead887cfb83a06d11acb4f02",
      "saidaFinal": "  P0-01 — integração com decidirVeredito\n    ✓ fase D INCOMPLETE nunca vira PASS global (102 ms)\n\nTest Suites: 1 passed, 1 total\nTests:       27 passed, 27 total\nSnapshots:   0 total\nTime:        3.707 s\nRan all test suites matching /tests\\/unit\\/governance\\/phaseStepContract.test.js/i.\n[engineering-runner-jest 2026-10-22T09:52:35.004Z] runner ENCERROU: pid=801713 code=0 signal=null\n[engineering-runner-jest 2026-10-22T09:52:35.011Z] apos o encerramento, /health na porta 33531: sem resposta\n[jest-global-teardown] Engineering Runner (pid 801713) encerrado (porta liberada)\nForce exiting Jest: Have you considered using `--detectOpenHandles` to detect async operations that kept running after all tests finished?",
      "saidaRef": "AI_MEMORY/evidence/dev-branch-gate-logs/4124f4d0-c4cf-4879-b260-6377b65b9c12/B1-phaseStepContract.test.js.log"
    },
    {
      "id": "B2-devBranchGatePhaseContract.test.js",
      "fase": "B",
      "nivel": "B",
      "descricao": "Teste de regressão declarado: tests/unit/governance/devBranchGatePhaseContract.test.js",
      "comando": "npx jest tests/unit/governance/devBranchGatePhaseContract.test.js --bail=0",
      "exitCode": 0,
      "timeout": false,
      "duracaoMs": 5702,
      "sha256Saida": "452ba5a7787e2b0a73b250b90d19f25baa0b92853f344970eb0d03a0dc1b3f42",
      "saidaFinal": "    ✓ --fases Z ⇒ ENTRADA_INVALIDA (530 ms)\n    ✓ o contexto de execução é único por rodada (104 ms)\n\nTest Suites: 1 passed, 1 total\nTests:       21 passed, 21 total\nSnapshots:   0 total\nTime:        3.584 s\nRan all test suites matching /tests\\/unit\\/governance\\/devBranchGatePhaseContract.test.js/i.\n[engineering-runner-jest 2026-10-22T09:52:40.761Z] runner ENCERROU: pid=801952 code=0 signal=null\n[engineering-runner-jest 2026-10-22T09:52:40.765Z] apos o encerramento, /health na porta 33531: sem resposta\n[jest-global-teardown] Engineering Runner (pid 801952) encerrado (porta liberada)\nForce exiting Jest: Have you considered using `--detectOpenHandles` to detect async operations that kept running after all tests finished?",
      "saidaRef": "AI_MEMORY/evidence/dev-branch-gate-logs/4124f4d0-c4cf-4879-b260-6377b65b9c12/B2-devBranchGatePhaseContract.test.js.log"
    },
    {
      "id": "B3-devBranchGateStepEvidence.test.js",
      "fase": "B",
      "nivel": "B",
      "descricao": "Teste de regressão declarado: tests/unit/governance/devBranchGateStepEvidence.test.js",
      "comando": "npx jest tests/unit/governance/devBranchGateStepEvidence.test.js --bail=0",
      "exitCode": 0,
      "timeout": false,
      "duracaoMs": 2917,
      "sha256Saida": "55c5237fe6f35eac4bb94999e1364f96c68e8975e55ed108c846548670a1d99c",
      "saidaFinal": "    ✓ passo que FALHA também deixa a saída completa — falha é diagnosticável, não só contada (247 ms)\n    ✓ o log fica separado por execucaoId — duas execuções não sobrescrevem a evidência uma da outra (144 ms)\n\nTest Suites: 1 passed, 1 total\nTests:       3 passed, 3 total\nSnapshots:   0 total\nTime:        1.012 s\nRan all test suites matching /tests\\/unit\\/governance\\/devBranchGateStepEvidence.test.js/i.\n[engineering-runner-jest 2026-10-22T09:52:43.615Z] runner ENCERROU: pid=802261 code=0 signal=null\n[engineering-runner-jest 2026-10-22T09:52:43.620Z] apos o encerramento, /health na porta 33531: sem resposta\n[jest-global-teardown] Engineering Runner (pid 802261) encerrado (porta liberada)\nForce exiting Jest: Have you considered using `--detectOpenHandles` to detect async operations that kept running after all tests finished?",
      "saidaRef": "AI_MEMORY/evidence/dev-branch-gate-logs/4124f4d0-c4cf-4879-b260-6377b65b9c12/B3-devBranchGateStepEvidence.test.js.log"
    },
    {
      "id": "L0-suite-oficial",
      "fase": "C",
      "nivel": "L0",
      "descricao": "Suíte oficial Jest (unit + flow + rpa sem browser)",
      "comando": "npm test",
      "exitCode": 0,
      "timeout": false,
      "duracaoMs": 418427,
      "sha256Saida": "84a3e829bd6275809445b0567fde38b64042b8073552d2974fb85f6c11973fcf",
      "saidaFinal": "      ○ skipped deve detectar erros\n      ○ skipped deve substituir variáveis\n\nTest Suites: 3 passed, 3 total\nTests:       4 skipped, 7 passed, 11 total\nSnapshots:   0 total\nTime:        3.249 s\nRan all test suites within paths \"tests/rpa/rpa.test.js\", \"tests/rpa/login.test.js\", \"tests/rpa/createTenantByAI.test.js\".\n[engineering-runner-jest 2026-10-22T09:59:41.724Z] runner ENCERROU: pid=819732 code=0 signal=null\n[engineering-runner-jest 2026-10-22T09:59:41.725Z] apos o encerramento, /health na porta 33531: sem resposta\n[jest-global-teardown] Engineering Runner (pid 819732) encerrado (porta liberada)\nForce exiting Jest: Have you considered using `--detectOpenHandles` to detect async operations that kept running after all tests finished?",
      "saidaRef": "AI_MEMORY/evidence/dev-branch-gate-logs/4124f4d0-c4cf-4879-b260-6377b65b9c12/L0-suite-oficial.log"
    },
    {
      "id": "L0b-integracao-engenheiro",
      "fase": "C",
      "nivel": "L0",
      "descricao": "Integração real do Engenheiro (Postgres + sandbox; falha sem banco)",
      "comando": "npx jest tests/integration/engineering --bail=0 --runInBand --forceExit",
      "exitCode": 0,
      "timeout": false,
      "duracaoMs": 927665,
      "sha256Saida": "f1ff46c51279c088036e75c7721e7711f892148e14c41c7fe7737e13d10b92d6",
      "saidaFinal": "    ✓ modelo antes mapeado e presente, cujo discovery real confirma que o provider deixou de listar → RETIRED, nunca elegível (119 ms)\n    ✓ reconciliação repetida com os mesmos fatos é idempotente — nunca duplica a entrada (124 ms)\n\nTest Suites: 40 passed, 40 total\nTests:       219 passed, 219 total\nSnapshots:   0 total\nTime:        923.347 s\nRan all test suites matching /tests\\/integration\\/engineering/i.\n[engineering-runner-jest 2026-10-22T10:15:09.687Z] runner ENCERROU: pid=819964 code=0 signal=null\n[engineering-runner-jest 2026-10-22T10:15:09.698Z] apos o encerramento, /health na porta 33531: sem resposta\n[jest-global-teardown] Engineering Runner (pid 819964) encerrado (porta liberada)\nForce exiting Jest: Have you considered using `--detectOpenHandles` to detect async operations that kept running after all tests finished?",
      "saidaRef": "AI_MEMORY/evidence/dev-branch-gate-logs/4124f4d0-c4cf-4879-b260-6377b65b9c12/L0b-integracao-engenheiro.log"
    },
    {
      "id": "L1-cadeia-criptografica",
      "fase": "D",
      "nivel": "L1",
      "descricao": "Cadeia de governança RECALCULADA dos bytes atuais (e declaração auditável)",
      "comando": "node scripts/governance/validate-governance-chain.js",
      "exitCode": 1,
      "timeout": false,
      "duracaoMs": 381,
      "sha256Saida": "ada6fd6d8800fb9fc4cdad9b66d9768c5995886726d787d0bbe233ba8810d38b",
      "saidaFinal": "[governance-chain] a cadeia é RECALCULADA a partir dos artefatos: divergência = artefato alterado ou chain regravada\n[governance-chain] AUTO_DECLARACAO_DE_VALIDADE_FALSA: o artefato se declara válido (valid=true, estado=CERTIFICADA) mas a recalculação encontrou 11 divergência(s) — aparência de válida sobre conteúdo alterado\n[governance-chain] escritas posteriores a certificacao: 8 elo(s) (5 com CONTEUDO ALTERADO)\n  evidence_manifest (DERIVADO) +440741s conteudoIdentico=false\n  final_proof_report (DERIVADO) +440741s conteudoIdentico=false\n  final_readiness (DERIVADO) +440741s conteudoIdentico=false\n  consistency_report (DERIVADO) +440741s conteudoIdentico=true\n  cross_report (DERIVADO) +440741s conteudoIdentico=true\n  proof_signature (DERIVADO) +440741s conteudoIdentico=false\n  blocker_engine (CANONICO) +440741s conteudoIdentico=true\n  package_validation (DERIVADO) +440741s conteudoIdentico=false\n[governance-chain] elos: canonicos=3 derivados=7 imutaveisPosSelo=3",
      "saidaRef": "AI_MEMORY/evidence/dev-branch-gate-logs/4124f4d0-c4cf-4879-b260-6377b65b9c12/L1-cadeia-criptografica.log"
    }
  ],
  "falhas": [
    {
      "id": "L1-cadeia-criptografica",
      "fase": "D",
      "comando": "node scripts/governance/validate-governance-chain.js",
      "exitCode": 1
    }
  ],
  "evidenceSha256": "0cbbf331faa1345db0ca9b94cb5fbb8a13d87bcde1f930b336d6eff309a0703d"
}
```
