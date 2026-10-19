# Gate em fases da branch de desenvolvimento — a34628787011 (PARCIAL)

- **veredito**: `FAIL`
- **equivale a validação completa**: `false`
- **fases pedidas**: `F`
- **fases obrigatórias**: `A,B,C,D,E,F`
- **fases faltantes**: `A,B,C,D,E`
- **entrada inválida**: `não`
- **branch**: `dev/engineering-hardening`
- **sha exato avaliado**: `a34628787011fe6e38ef4d410d80158238110a2e`
- **gerado em**: 2026-10-19T04:39:35.913Z
- **gate efetivo**: LOCAL — o runner do GitHub não inicia jobs por limite de gastos da conta

## Estado por fase (comprovação, não intenção)

| fase | estado | passos reais | motivo |
|---|---|---|---|
| F | **FAIL** | 1 | PASSO_FALHOU:L3-gate-agregado |

## Pré-voo (fase A)

| check | resultado | detalhe |
|---|---|---|
| `A1-identidade-commit` | ok | HEAD=a34628787011fe6e38ef4d410d80158238110a2e |
| `A2-sha-esperado` | ok | não exigido nesta execução |
| `A3-arvore-limpa` | ok | NÃO exigida nesta execução; árvore SUJA (5+) |
| `A4-inventario-defeitos` | ok | 102 item(ns) |
| `A5-dependencias` | ok | node_modules presente |
| `A5b-jest` | ok | binário do Jest |
| `A6-node` | ok | node 22.12.0 |
| `A7-regras-preventivas` | ok | 7 presentes |
| `A8-evidencia-anterior` | ok | do mesmo commit |
| `A9-lineage-run-projecao` | ok | run rap-governed-20261017111858007-5d93eee8 FECHADO (ABANDONED) com motivo e evidência declarados — projeção do último ciclo concluído |

Inventário de defeitos: 102 item(ns), 3 aberto(s), 0 bloqueante(s) para certificação.

## Autorizações de fase (Bug Closure First)

| fase | operação | decisão | motivos |
|---|---|---|---|
| F | `SELO_FINAL` | **ALLOWED** | BLOQUEIO_EXTERNO_NAO_RESOLVE_CERTIFICACAO |

**BLOQUEIO**: fase F — `PASSO_FALHOU` L3-gate-agregado exit=1

## Passos executados (comando, exit code, duração, sha256 da saída)

| fase | passo | comando | exit | duração | sha256 da saída |
|---|---|---|---|---|---|
| F | `L3-gate-agregado` | `npm run validate:governance-enforcement` | 1 | 0.3s | `a5ee402e2ba08395…` |

## Estado do runner do GitHub (medido)

```json
{
  "medido": true,
  "execucoesNaBranch": 1,
  "ultimaExecucao": {
    "databaseId": 39194532214,
    "headSha": "17bf24f8f5780364da849b009dc59238a89d7800",
    "conclusao": "failure",
    "criadaEm": "2026-10-19T03:24:23Z"
  }
}
```

## Como reconferir a evidência

```bash
node scripts/ci/dev-branch-gate.js --fases F   # reexecuta as mesmas fases
git log -1 --format=%H -- AI_MEMORY/evidence/dev-branch-ci-a34628787011-parcial.md   # commit que publicou esta evidência
```

`evidenceSha256` = `5c49130f8132c67758c0e9555a7e243bd5353fa9947e295d01d65708c5ad6c1b` (sha256 do payload sem este campo).

```json
{
  "schemaVersion": 3,
  "kind": "dev-branch-ci-evidence",
  "comando": "node scripts/ci/dev-branch-gate.js",
  "veredito": "FAIL",
  "equivalenteAValidacaoCompleta": false,
  "escopo": "PARCIAL",
  "fasesPedidas": [
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
  "fasesFaltantes": [
    "A",
    "B",
    "C",
    "D",
    "E"
  ],
  "estadosPorFase": [
    {
      "fase": "F",
      "estado": "FAIL",
      "passosReais": 1,
      "motivo": "PASSO_FALHOU:L3-gate-agregado"
    }
  ],
  "fasesNaoAprovadas": [
    "F"
  ],
  "entradaInvalida": null,
  "entrada": {
    "bruto": "F",
    "duplicadas": [],
    "desconhecidas": []
  },
  "contextoExecucao": {
    "sha": "a34628787011fe6e38ef4d410d80158238110a2e",
    "execucaoId": "60211197-ce1d-4594-9898-47b1b0cbdffc"
  },
  "identidade": {
    "sha": "a34628787011fe6e38ef4d410d80158238110a2e",
    "branch": "dev/engineering-hardening",
    "shaValido": true,
    "branchValida": true
  },
  "fasesConcluidas": [],
  "fasesNaoAplicaveis": [],
  "sha": "a34628787011fe6e38ef4d410d80158238110a2e",
  "shaCurto": "a34628787011",
  "branch": "dev/engineering-hardening",
  "escopoDefeitos": null,
  "runnerDoGithub": {
    "medido": true,
    "execucoesNaBranch": 1,
    "ultimaExecucao": {
      "databaseId": 39194532214,
      "headSha": "17bf24f8f5780364da849b009dc59238a89d7800",
      "conclusao": "failure",
      "criadaEm": "2026-10-19T03:24:23Z"
    }
  },
  "gateEfetivo": "LOCAL (o runner do GitHub nao inicia jobs por limite de gastos da conta)",
  "preVoo": {
    "ok": true,
    "checks": [
      {
        "id": "A1-identidade-commit",
        "ok": true,
        "detalhe": "HEAD=a34628787011fe6e38ef4d410d80158238110a2e"
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
        "detalhe": "102 item(ns)"
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
        "detalhe": "7 presentes"
      },
      {
        "id": "A8-evidencia-anterior",
        "ok": true,
        "detalhe": "do mesmo commit",
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
      "total": 102,
      "abertos": 3,
      "bloqueantesParaCertificacao": 0,
      "semSeveridadeAbertos": 0,
      "bloqueioExterno": 3,
      "riscoAceito": 0,
      "porEstado": {
        "VERIFIED": 81,
        "BLOCKED_EXTERNAL": 3,
        "RESOLVED": 18
      },
      "porSeveridade": {
        "P0": 25,
        "P1": 43,
        "P2": 24,
        "P3": 10
      }
    },
    "erroInventario": null,
    "arvoreSuja": true,
    "arquivosSujos": [
      "M reports/rag-domain-segregation-report.json",
      " M reports/tenant-isolation-report.json",
      "?? AI_MEMORY/evidence/dev-branch-ci-a34628787011-parcial.md",
      "?? AI_MEMORY/evidence/dev-branch-ci-bc52dd90960e-parcial.md",
      "?? AI_MEMORY/evidence/dev-branch-ci-vazio-parcial.md"
    ],
    "evidenciaAnterior": {
      "sha": "a34628787011fe6e38ef4d410d80158238110a2e",
      "veredito": "FAIL",
      "escopo": "PARCIAL"
    }
  },
  "autorizacoes": [
    {
      "fase": "F",
      "operacao": "SELO_FINAL",
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
    "fase": "F",
    "code": "PASSO_FALHOU",
    "detail": "L3-gate-agregado exit=1"
  },
  "passos": [
    {
      "id": "L3-gate-agregado",
      "fase": "F",
      "nivel": "L3",
      "descricao": "Gate agregado de governança (63 passos)",
      "comando": "npm run validate:governance-enforcement",
      "exitCode": 1,
      "timeout": false,
      "duracaoMs": 288,
      "sha256Saida": "a5ee402e2ba08395e7bd7031d6ae5744d4d7a6a54b25a03f282b96c980478ebb",
      "saidaFinal": "> chatbot-engine@1.0.0 validate:governance-enforcement\n> node scripts/governance/run-governance-enforcement.js\n\n[agg] status=BLOCKED passos=0/64\n[agg] motivo: identidade de run incompleta (runId,sourceFingerprint) — veredito não é certificável\n[agg] veredito: reports/governance-enforcement-verdict.json",
      "saidaRef": "AI_MEMORY/evidence/dev-branch-gate-logs/60211197-ce1d-4594-9898-47b1b0cbdffc/L3-gate-agregado.log"
    }
  ],
  "falhas": [
    {
      "id": "L3-gate-agregado",
      "fase": "F",
      "comando": "npm run validate:governance-enforcement",
      "exitCode": 1
    }
  ],
  "evidenceSha256": "5c49130f8132c67758c0e9555a7e243bd5353fa9947e295d01d65708c5ad6c1b"
}
```
