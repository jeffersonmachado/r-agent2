# Gate em fases da branch de desenvolvimento — cb1ea92e93bd (PARCIAL)

- **veredito**: `BLOQUEADO_POR_DEFEITOS`
- **equivale a validação completa**: `false`
- **fases pedidas**: `A,R`
- **fases obrigatórias**: `A,B,C,D,R,E,F`
- **fases faltantes**: `B,C,D,E,F`
- **entrada inválida**: `não`
- **branch**: `dev/engineering-hardening`
- **sha exato avaliado**: `cb1ea92e93bd3c7726a5c72c5e8cb390e98c9943`
- **gerado em**: 2026-10-22T10:56:53.471Z
- **gate efetivo**: LOCAL — o runner do GitHub não inicia jobs por limite de gastos da conta

## Estado por fase (comprovação, não intenção)

| fase | estado | passos reais | motivo |
|---|---|---|---|
| A | **PASS** | 10 | — |
| R | **BLOCKED** | 0 | FASE_NAO_AUTORIZADA |

## Pré-voo (fase A)

| check | resultado | detalhe |
|---|---|---|
| `A1-identidade-commit` | ok | HEAD=cb1ea92e93bd3c7726a5c72c5e8cb390e98c9943 |
| `A2-sha-esperado` | ok | não exigido nesta execução |
| `A3-arvore-limpa` | ok | NÃO exigida nesta execução; árvore SUJA (5+) |
| `A4-inventario-defeitos` | ok | 135 item(ns) |
| `A5-dependencias` | ok | node_modules presente |
| `A5b-jest` | ok | binário do Jest |
| `A6-node` | ok | node 22.12.0 |
| `A7-regras-preventivas` | ok | 12 presentes |
| `A8-evidencia-anterior` | nota (não bloqueia) | de OUTRO commit (133eb147c1e3) — STALE, não conta como evidência do código atual |
| `A9-lineage-run-projecao` | ok | projeção no run corrente (rap-governed-20261020150721180-09a2168d) |

Inventário de defeitos: 135 item(ns), 6 aberto(s), 1 bloqueante(s) para certificação.

## Autorizações de fase (Bug Closure First)

| fase | operação | decisão | motivos |
|---|---|---|---|
| R | `SELO_FINAL` | **DENIED** | BLOQUEIO_EXTERNO_NAO_RESOLVE_CERTIFICACAO, P1_BLOQUEANTE_ABERTO |

**BLOQUEIO**: fase R — `FASE_NAO_AUTORIZADA` BLOQUEIO_EXTERNO_NAO_RESOLVE_CERTIFICACAO,P1_BLOQUEANTE_ABERTO

## Passos executados (comando, exit code, duração, sha256 da saída)

(nenhum passo executado)

## Estado do runner do GitHub (medido)

```json
{
  "medido": true,
  "execucoesNaBranch": 1,
  "ultimaExecucao": {
    "databaseId": 39765830119,
    "headSha": "cb1ea92e93bd3c7726a5c72c5e8cb390e98c9943",
    "conclusao": "",
    "criadaEm": "2026-10-22T10:48:17Z"
  }
}
```

## Como reconferir a evidência

```bash
node scripts/ci/dev-branch-gate.js --fases A,R   # reexecuta as mesmas fases
git log -1 --format=%H -- AI_MEMORY/evidence/dev-branch-ci-cb1ea92e93bd-parcial.md   # commit que publicou esta evidência
```

`evidenceSha256` = `69b785e271c09dbdfeb357267d76637e733b8e9cd735b6b2b04a7de00d753933` (sha256 do payload sem este campo).

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
    "R"
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
    "B",
    "C",
    "D",
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
      "fase": "R",
      "estado": "BLOCKED",
      "passosReais": 0,
      "passosEsperados": 3,
      "motivo": "FASE_NAO_AUTORIZADA"
    }
  ],
  "fasesNaoAprovadas": [
    "R"
  ],
  "entradaInvalida": null,
  "entrada": {
    "bruto": "A,R",
    "duplicadas": [],
    "desconhecidas": []
  },
  "contextoExecucao": {
    "sha": "cb1ea92e93bd3c7726a5c72c5e8cb390e98c9943",
    "execucaoId": "50c7eae3-7ea3-482b-a8d5-b261e6b023c0"
  },
  "identidade": {
    "sha": "cb1ea92e93bd3c7726a5c72c5e8cb390e98c9943",
    "branch": "dev/engineering-hardening",
    "shaValido": true,
    "branchValida": true
  },
  "fasesConcluidas": [
    "A"
  ],
  "fasesNaoAplicaveis": [],
  "sha": "cb1ea92e93bd3c7726a5c72c5e8cb390e98c9943",
  "shaCurto": "cb1ea92e93bd",
  "branch": "dev/engineering-hardening",
  "escopoDefeitos": null,
  "runnerDoGithub": {
    "medido": true,
    "execucoesNaBranch": 1,
    "ultimaExecucao": {
      "databaseId": 39765830119,
      "headSha": "cb1ea92e93bd3c7726a5c72c5e8cb390e98c9943",
      "conclusao": "",
      "criadaEm": "2026-10-22T10:48:17Z"
    }
  },
  "gateEfetivo": "LOCAL (o runner do GitHub nao inicia jobs por limite de gastos da conta)",
  "preVoo": {
    "ok": true,
    "checks": [
      {
        "id": "A1-identidade-commit",
        "ok": true,
        "detalhe": "HEAD=cb1ea92e93bd3c7726a5c72c5e8cb390e98c9943"
      },
      {
        "id": "A2-sha-esperado",
        "ok": true,
        "detalhe": "não exigido nesta execução"
      },
      {
        "id": "A3-arvore-limpa",
        "ok": true,
        "detalhe": "NÃO exigida nesta execução; árvore SUJA (5+)"
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
        "ok": false,
        "detalhe": "de OUTRO commit (133eb147c1e3) — STALE, não conta como evidência do código atual",
        "bloqueante": false
      },
      {
        "id": "A9-lineage-run-projecao",
        "ok": true,
        "detalhe": "projeção no run corrente (rap-governed-20261020150721180-09a2168d)",
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
    "arvoreSuja": true,
    "arquivosSujos": [
      "M .github/workflows/dev-branch-ci.yml",
      " M scripts/ci/clean-checkout-verify.js",
      " M scripts/ci/dev-branch-gate.js",
      " M tests/unit/governance/phaseStepContract.test.js",
      "?? AI_MEMORY/evidence/dev-branch-ci-cb1ea92e93bd-parcial.md"
    ],
    "evidenciaAnterior": {
      "sha": "133eb147c1e360ae5919e80198decaf535431cb4",
      "veredito": "FAIL",
      "escopo": "PARCIAL"
    }
  },
  "autorizacoes": [
    {
      "fase": "R",
      "operacao": "SELO_FINAL",
      "allowed": false,
      "decision": "DENIED",
      "reasonCodes": [
        "BLOQUEIO_EXTERNO_NAO_RESOLVE_CERTIFICACAO",
        "P1_BLOQUEANTE_ABERTO"
      ],
      "requiredActions": [
        "fechar (VERIFIED com teste de regressão) todos os defeitos P1 bloqueantes antes desta operação"
      ],
      "blockingFindings": [
        {
          "code": "P1_BLOQUEANTE_ABERTO",
          "defectId": "L1-NPM-TEST-CI-VERMELHO",
          "severity": "P1",
          "state": "BLOCKED_EXTERNAL",
          "detail": "CI: L0, L0b, smoke prod-like e job de integracao VERDES no runner (medido); resta L1 (cadeia de governanca) que exige release selado"
        }
      ]
    }
  ],
  "bloqueio": {
    "fase": "R",
    "operacao": "SELO_FINAL",
    "code": "FASE_NAO_AUTORIZADA",
    "detail": "BLOQUEIO_EXTERNO_NAO_RESOLVE_CERTIFICACAO,P1_BLOQUEANTE_ABERTO",
    "requiredActions": [
      "fechar (VERIFIED com teste de regressão) todos os defeitos P1 bloqueantes antes desta operação"
    ]
  },
  "passos": [],
  "falhas": [],
  "evidenceSha256": "69b785e271c09dbdfeb357267d76637e733b8e9cd735b6b2b04a7de00d753933"
}
```
