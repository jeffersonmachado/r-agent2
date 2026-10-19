# Gate em fases da branch de desenvolvimento — 30509f2d3b18 (PARCIAL)

- **veredito**: `BLOQUEADO_POR_DEFEITOS`
- **equivale a validação completa**: `false`
- **fases pedidas**: `A,B,C,D,E,F`
- **fases obrigatórias**: `A,B,C,D,E,F`
- **fases faltantes**: `(nenhuma)`
- **entrada inválida**: `não`
- **branch**: `dev/engineering-hardening`
- **sha exato avaliado**: `30509f2d3b18b29c8c9b33effff3765dae4addcc`
- **gerado em**: 2026-10-19T09:39:16.273Z
- **gate efetivo**: LOCAL — o runner do GitHub não inicia jobs por limite de gastos da conta

## Estado por fase (comprovação, não intenção)

| fase | estado | passos reais | motivo |
|---|---|---|---|
| A | **PASS** | 10 | — |
| B | **PASS** | 6 | — |
| C | **BLOCKED** | 0 | FASE_NAO_AUTORIZADA |
| D | **NOT_EXECUTED** | 0 | FASE_NAO_EXECUTADA |
| E | **NOT_EXECUTED** | 0 | FASE_NAO_EXECUTADA |
| F | **NOT_EXECUTED** | 0 | FASE_NAO_EXECUTADA |

## Pré-voo (fase A)

| check | resultado | detalhe |
|---|---|---|
| `A1-identidade-commit` | ok | HEAD=30509f2d3b18b29c8c9b33effff3765dae4addcc |
| `A2-sha-esperado` | ok | não exigido nesta execução |
| `A3-arvore-limpa` | ok | limpa |
| `A4-inventario-defeitos` | ok | 106 item(ns) |
| `A5-dependencias` | ok | node_modules presente |
| `A5b-jest` | ok | binário do Jest |
| `A6-node` | ok | node 22.12.0 |
| `A7-regras-preventivas` | ok | 12 presentes |
| `A8-evidencia-anterior` | nota (não bloqueia) | de OUTRO commit (a34628787011) — STALE, não conta como evidência do código atual |
| `A9-lineage-run-projecao` | ok | run rap-governed-20261017111858007-5d93eee8 FECHADO (ABANDONED) com motivo e evidência declarados — projeção do último ciclo concluído |

Inventário de defeitos: 106 item(ns), 5 aberto(s), 2 bloqueante(s) para certificação.

## Autorizações de fase (Bug Closure First)

| fase | operação | decisão | motivos |
|---|---|---|---|
| B | `TESTES_NEGATIVOS_REGRESSAO` | **ALLOWED** | BLOQUEIO_EXTERNO_NAO_RESOLVE_CERTIFICACAO |
| C | `L0_COMPLETO` | **DENIED** | BLOQUEIO_EXTERNO_NAO_RESOLVE_CERTIFICACAO, TESTE_DIRECIONADO_PENDENTE |

**BLOQUEIO**: fase C — `FASE_NAO_AUTORIZADA` BLOQUEIO_EXTERNO_NAO_RESOLVE_CERTIFICACAO,TESTE_DIRECIONADO_PENDENTE

## Passos executados (comando, exit code, duração, sha256 da saída)

| fase | passo | comando | exit | duração | sha256 da saída |
|---|---|---|---|---|---|
| B | `B1-phaseStepContract.test.js` | `npx jest tests/unit/governance/phaseStepContract.test.js --bail=0` | 0 | 5.7s | `0ce732c9532955c0…` |
| B | `B2-devBranchGatePhaseContract.test.js` | `npx jest tests/unit/governance/devBranchGatePhaseContract.test.js --bail=0` | 0 | 6.5s | `33c86b0d0f108e9c…` |
| B | `B3-devBranchGateStepEvidence.test.js` | `npx jest tests/unit/governance/devBranchGateStepEvidence.test.js --bail=0` | 0 | 2.8s | `3be3ab38d7eb4ce6…` |
| B | `B4-crmNoUpsertRegression.test.js` | `npx jest tests/unit/crmNoUpsertRegression.test.js --bail=0` | 0 | 3.0s | `410ebd7616884062…` |
| B | `B5-crmOpportunityUpdate.test.js` | `npx jest tests/unit/crmOpportunityUpdate.test.js --bail=0` | 0 | 3.8s | `560583fe44d82c15…` |
| B | `B6-crmTenantIsolation.postgres.test.js` | `npx jest tests/integration/crmTenantIsolation.postgres.test.js --bail=0` | 0 | 5.3s | `7299e322052c5ae9…` |

## Estado do runner do GitHub (medido)

```json
{
  "medido": true,
  "execucoesNaBranch": 1,
  "ultimaExecucao": {
    "databaseId": 39200662947,
    "headSha": "511ae5249d906eca21d2cb1f818b110e09ca896f",
    "conclusao": "failure",
    "criadaEm": "2026-10-19T04:40:38Z"
  }
}
```

## Como reconferir a evidência

```bash
node scripts/ci/dev-branch-gate.js --fases A,B,C,D,E,F   # reexecuta as mesmas fases
git log -1 --format=%H -- AI_MEMORY/evidence/dev-branch-ci-30509f2d3b18-parcial.md   # commit que publicou esta evidência
```

`evidenceSha256` = `4d41f07413a811e03bc6936a34993219a7e3f1e9ff874f8cf72077e5b42744c0` (sha256 do payload sem este campo).

```json
{
  "schemaVersion": 3,
  "kind": "dev-branch-ci-evidence",
  "comando": "node scripts/ci/dev-branch-gate.js",
  "veredito": "BLOQUEADO_POR_DEFEITOS",
  "equivalenteAValidacaoCompleta": false,
  "escopo": "PARCIAL",
  "fasesPedidas": [
    "A",
    "B",
    "C",
    "D",
    "E",
    "F"
  ],
  "fasesObrigatorias": [
    "A",
    "B",
    "C",
    "D",
    "E",
    "F"
  ],
  "fasesFaltantes": [],
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
      "passosReais": 6,
      "motivo": null
    },
    {
      "fase": "C",
      "estado": "BLOCKED",
      "passosReais": 0,
      "passosEsperados": 1,
      "motivo": "FASE_NAO_AUTORIZADA"
    },
    {
      "fase": "D",
      "estado": "NOT_EXECUTED",
      "passosReais": 0,
      "passosEsperados": 7,
      "passosAusentes": [],
      "motivo": "FASE_NAO_EXECUTADA"
    },
    {
      "fase": "E",
      "estado": "NOT_EXECUTED",
      "passosReais": 0,
      "passosEsperados": 1,
      "passosAusentes": [],
      "motivo": "FASE_NAO_EXECUTADA"
    },
    {
      "fase": "F",
      "estado": "NOT_EXECUTED",
      "passosReais": 0,
      "passosEsperados": 1,
      "passosAusentes": [],
      "motivo": "FASE_NAO_EXECUTADA"
    }
  ],
  "fasesNaoAprovadas": [
    "C",
    "D",
    "E",
    "F"
  ],
  "entradaInvalida": null,
  "entrada": {
    "bruto": "A,B,C,D,E,F",
    "duplicadas": [],
    "desconhecidas": []
  },
  "contextoExecucao": {
    "sha": "30509f2d3b18b29c8c9b33effff3765dae4addcc",
    "execucaoId": "f74c43ec-885f-4445-8cd8-14aef197d719"
  },
  "identidade": {
    "sha": "30509f2d3b18b29c8c9b33effff3765dae4addcc",
    "branch": "dev/engineering-hardening",
    "shaValido": true,
    "branchValida": true
  },
  "fasesConcluidas": [
    "A",
    "B"
  ],
  "fasesNaoAplicaveis": [],
  "sha": "30509f2d3b18b29c8c9b33effff3765dae4addcc",
  "shaCurto": "30509f2d3b18",
  "branch": "dev/engineering-hardening",
  "escopoDefeitos": null,
  "runnerDoGithub": {
    "medido": true,
    "execucoesNaBranch": 1,
    "ultimaExecucao": {
      "databaseId": 39200662947,
      "headSha": "511ae5249d906eca21d2cb1f818b110e09ca896f",
      "conclusao": "failure",
      "criadaEm": "2026-10-19T04:40:38Z"
    }
  },
  "gateEfetivo": "LOCAL (o runner do GitHub nao inicia jobs por limite de gastos da conta)",
  "preVoo": {
    "ok": true,
    "checks": [
      {
        "id": "A1-identidade-commit",
        "ok": true,
        "detalhe": "HEAD=30509f2d3b18b29c8c9b33effff3765dae4addcc"
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
        "detalhe": "106 item(ns)"
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
        "ok": false,
        "detalhe": "de OUTRO commit (a34628787011) — STALE, não conta como evidência do código atual",
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
      "total": 106,
      "abertos": 5,
      "bloqueantesParaCertificacao": 2,
      "semSeveridadeAbertos": 0,
      "bloqueioExterno": 5,
      "riscoAceito": 0,
      "porEstado": {
        "VERIFIED": 83,
        "BLOCKED_EXTERNAL": 5,
        "RESOLVED": 18
      },
      "porSeveridade": {
        "P0": 27,
        "P1": 45,
        "P2": 24,
        "P3": 10
      }
    },
    "erroInventario": null,
    "arvoreSuja": false,
    "arquivosSujos": [],
    "evidenciaAnterior": {
      "sha": "a34628787011fe6e38ef4d410d80158238110a2e",
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
      "allowed": false,
      "decision": "DENIED",
      "reasonCodes": [
        "BLOQUEIO_EXTERNO_NAO_RESOLVE_CERTIFICACAO",
        "TESTE_DIRECIONADO_PENDENTE"
      ],
      "requiredActions": [
        "registrar teste direcionado APROVADO (targetedTestPassing=true) para cada defeito aberto antes de ampliar a execução"
      ],
      "blockingFindings": [
        {
          "code": "TESTE_DIRECIONADO_PENDENTE",
          "defectId": "P1-PROJECAO-FINAL-DIVERGE-DA-CANONICA-DE-RUN-ABANDONADO",
          "severity": "P1",
          "state": "BLOCKED_EXTERNAL",
          "detail": "Projeções de status (docs) gravadas ANTES da decisão final: divergem da canônica do mesmo run e travam o L2"
        },
        {
          "code": "TESTE_DIRECIONADO_PENDENTE",
          "defectId": "P1-AGREGADO-SEM-IDENTIDADE-DE-RUN-BLOQUEIA-L3",
          "severity": "P1",
          "state": "BLOCKED_EXTERNAL",
          "detail": "Gate agregado nao tem identidade de run no branch de desenvolvimento e para em fail-closed (0/64 passos)"
        }
      ]
    }
  ],
  "bloqueio": {
    "fase": "C",
    "operacao": "L0_COMPLETO",
    "code": "FASE_NAO_AUTORIZADA",
    "detail": "BLOQUEIO_EXTERNO_NAO_RESOLVE_CERTIFICACAO,TESTE_DIRECIONADO_PENDENTE",
    "requiredActions": [
      "registrar teste direcionado APROVADO (targetedTestPassing=true) para cada defeito aberto antes de ampliar a execução"
    ]
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
      "duracaoMs": 5669,
      "sha256Saida": "0ce732c9532955c08f689715268ad876f57fa3bfa08dfda52d1c2f35c13e17f2",
      "saidaFinal": "    ✓ 24. conjunto completo, aprovado e com evidência verificável ⇒ PASS (102 ms)\n    ✓ o mesmo conjunto SEM uma evidência passa a INCOMPLETE (o PASS depende do contrato) (102 ms)\n  P0-01 — integração com decidirVeredito\n    ✓ fase D INCOMPLETE nunca vira PASS global (102 ms)\n\nTest Suites: 1 passed, 1 total\nTests:       27 passed, 27 total\nSnapshots:   0 total\nTime:        3.201 s, estimated 5 s\nRan all test suites matching /tests\\/unit\\/governance\\/phaseStepContract.test.js/i.\n[jest-global-teardown] Engineering Runner (pid 1192031) encerrado (porta liberada)\nForce exiting Jest: Have you considered using `--detectOpenHandles` to detect async operations that kept running after all tests finished?",
      "saidaRef": "AI_MEMORY/evidence/dev-branch-gate-logs/f74c43ec-885f-4445-8cd8-14aef197d719/B1-phaseStepContract.test.js.log"
    },
    {
      "id": "B2-devBranchGatePhaseContract.test.js",
      "fase": "B",
      "nivel": "B",
      "descricao": "Teste de regressão declarado: tests/unit/governance/devBranchGatePhaseContract.test.js",
      "comando": "npx jest tests/unit/governance/devBranchGatePhaseContract.test.js --bail=0",
      "exitCode": 0,
      "timeout": false,
      "duracaoMs": 6451,
      "sha256Saida": "33c86b0d0f108e9cc78acecdb017a95e86a739c8931eb687375f0761dbdf6f2e",
      "saidaFinal": "  P0 gate de fases — execução real recusa antes de qualquer passo\n    ✓ --fases A,A,A,A ⇒ ENTRADA_INVALIDA, completo=false, exit != 0 (1362 ms)\n    ✓ --fases Z ⇒ ENTRADA_INVALIDA (1292 ms)\n    ✓ o contexto de execução é único por rodada (104 ms)\n\nTest Suites: 1 passed, 1 total\nTests:       20 passed, 20 total\nSnapshots:   0 total\nTime:        4.744 s, estimated 7 s\nRan all test suites matching /tests\\/unit\\/governance\\/devBranchGatePhaseContract.test.js/i.\n[jest-global-teardown] Engineering Runner (pid 1192209) encerrado (porta liberada)\nForce exiting Jest: Have you considered using `--detectOpenHandles` to detect async operations that kept running after all tests finished?",
      "saidaRef": "AI_MEMORY/evidence/dev-branch-gate-logs/f74c43ec-885f-4445-8cd8-14aef197d719/B2-devBranchGatePhaseContract.test.js.log"
    },
    {
      "id": "B3-devBranchGateStepEvidence.test.js",
      "fase": "B",
      "nivel": "B",
      "descricao": "Teste de regressão declarado: tests/unit/governance/devBranchGateStepEvidence.test.js",
      "comando": "npx jest tests/unit/governance/devBranchGateStepEvidence.test.js --bail=0",
      "exitCode": 0,
      "timeout": false,
      "duracaoMs": 2781,
      "sha256Saida": "3be3ab38d7eb4ce67049f59394acc66d7561c8788bdc00a492b78dcde8a0011d",
      "saidaFinal": "  dev-branch-gate — evidência completa por passo\n    ✓ passo com sucesso grava a saída completa e publica saidaRef existente (124 ms)\n    ✓ passo que FALHA também deixa a saída completa — falha é diagnosticável, não só contada (229 ms)\n    ✓ o log fica separado por execucaoId — duas execuções não sobrescrevem a evidência uma da outra (144 ms)\n\nTest Suites: 1 passed, 1 total\nTests:       3 passed, 3 total\nSnapshots:   0 total\nTime:        0.886 s, estimated 2 s\nRan all test suites matching /tests\\/unit\\/governance\\/devBranchGateStepEvidence.test.js/i.\n[jest-global-teardown] Engineering Runner (pid 1192494) encerrado (porta liberada)\nForce exiting Jest: Have you considered using `--detectOpenHandles` to detect async operations that kept running after all tests finished?",
      "saidaRef": "AI_MEMORY/evidence/dev-branch-gate-logs/f74c43ec-885f-4445-8cd8-14aef197d719/B3-devBranchGateStepEvidence.test.js.log"
    },
    {
      "id": "B4-crmNoUpsertRegression.test.js",
      "fase": "B",
      "nivel": "B",
      "descricao": "Teste de regressão declarado: tests/unit/crmNoUpsertRegression.test.js",
      "comando": "npx jest tests/unit/crmNoUpsertRegression.test.js --bail=0",
      "exitCode": 0,
      "timeout": false,
      "duracaoMs": 2988,
      "sha256Saida": "410ebd7616884062b9b322156b67e86cf1f64d1c28fae9460b8ae69f04a9d4e1",
      "saidaFinal": "    ✓ api/services/crm/crmRecordStore.js não contém chamada de upsert (103 ms)\n    ✓ a criação e a atualização são funções distintas no caminho de escrita (104 ms)\n    ✓ a atualização carrega a condição de tenant na própria operação SQL (105 ms)\n    ✓ tenant_key nunca é escrito a partir do payload do cliente (105 ms)\n\nTest Suites: 1 passed, 1 total\nTests:       5 passed, 5 total\nSnapshots:   0 total\nTime:        0.817 s, estimated 1 s\nRan all test suites matching /tests\\/unit\\/crmNoUpsertRegression.test.js/i.\n[jest-global-teardown] Engineering Runner (pid 1192666) encerrado (porta liberada)\nForce exiting Jest: Have you considered using `--detectOpenHandles` to detect async operations that kept running after all tests finished?",
      "saidaRef": "AI_MEMORY/evidence/dev-branch-gate-logs/f74c43ec-885f-4445-8cd8-14aef197d719/B4-crmNoUpsertRegression.test.js.log"
    },
    {
      "id": "B5-crmOpportunityUpdate.test.js",
      "fase": "B",
      "nivel": "B",
      "descricao": "Teste de regressão declarado: tests/unit/crmOpportunityUpdate.test.js",
      "comando": "npx jest tests/unit/crmOpportunityUpdate.test.js --bail=0",
      "exitCode": 0,
      "timeout": false,
      "duracaoMs": 3751,
      "sha256Saida": "560583fe44d82c1538bd9631174d578bc3668fed95fd73b3af264743d439fb53",
      "saidaFinal": "    ✓ campos não permitidos são ignorados (id/tenantId/createdAt imutáveis) (104 ms)\n    ✓ criações concorrentes de ids distintos não se perdem (171 ms)\n    ✓ atualizações concorrentes do MESMO registro mantêm 1 registro (sem duplicata) (155 ms)\n    ✓ repetir a mesma atualização é idempotente (1 registro, mesmo conteúdo) (106 ms)\n\nTest Suites: 1 passed, 1 total\nTests:       11 passed, 11 total\nSnapshots:   0 total\nTime:        1.891 s, estimated 3 s\nRan all test suites matching /tests\\/unit\\/crmOpportunityUpdate.test.js/i.\n[jest-global-teardown] Engineering Runner (pid 1192816) encerrado (porta liberada)\nForce exiting Jest: Have you considered using `--detectOpenHandles` to detect async operations that kept running after all tests finished?",
      "saidaRef": "AI_MEMORY/evidence/dev-branch-gate-logs/f74c43ec-885f-4445-8cd8-14aef197d719/B5-crmOpportunityUpdate.test.js.log"
    },
    {
      "id": "B6-crmTenantIsolation.postgres.test.js",
      "fase": "B",
      "nivel": "B",
      "descricao": "Teste de regressão declarado: tests/integration/crmTenantIsolation.postgres.test.js",
      "comando": "npx jest tests/integration/crmTenantIsolation.postgres.test.js --bail=0",
      "exitCode": 0,
      "timeout": false,
      "duracaoMs": 5268,
      "sha256Saida": "7299e322052c5ae9b01d514b8ce0e3a8485324df2b3d6929c03df360a4c1674e",
      "saidaFinal": "    ✓ 20. após reconexão (restart da aplicação) o isolamento continua (224 ms)\n  P0-02 — métricas e persistência após a matriz\n    ✓ 21. contagem por tenant continua consistente (métricas) (106 ms)\n    ✓ 22. nenhuma linha tem tenant_key divergente do dono original (108 ms)\n\nTest Suites: 1 passed, 1 total\nTests:       22 passed, 22 total\nSnapshots:   0 total\nTime:        3.57 s, estimated 6 s\nRan all test suites matching /tests\\/integration\\/crmTenantIsolation.postgres.test.js/i.\n[jest-global-teardown] Engineering Runner (pid 1193076) encerrado (porta liberada)\nForce exiting Jest: Have you considered using `--detectOpenHandles` to detect async operations that kept running after all tests finished?",
      "saidaRef": "AI_MEMORY/evidence/dev-branch-gate-logs/f74c43ec-885f-4445-8cd8-14aef197d719/B6-crmTenantIsolation.postgres.test.js.log"
    }
  ],
  "falhas": [],
  "evidenceSha256": "4d41f07413a811e03bc6936a34993219a7e3f1e9ff874f8cf72077e5b42744c0"
}
```
