# Gate em fases da branch de desenvolvimento — 122f9b6e1629 (PARCIAL)

- **veredito**: `PASS_PARCIAL`
- **equivale a validação completa**: `false`
- **fases pedidas**: `A`
- **fases obrigatórias**: `A,B,C,D,R,E,F`
- **fases faltantes**: `B,C,D,R,E,F`
- **entrada inválida**: `não`
- **branch**: `fix/jest-ci-history`
- **sha exato avaliado**: `122f9b6e16297993b2871ac9423c76d70878ec93`
- **gerado em**: 2026-10-31T23:12:40.125Z
- **gate efetivo**: LOCAL — este arquivo é produzido por este runner; em CI o mesmo par é publicado como artifact `dev-branch-ci-evidence-<sha>`

## Estado por fase (comprovação, não intenção)

| fase | estado | passos reais | motivo |
|---|---|---|---|
| A | **PASS** | 10 | — |

## Pré-voo (fase A)

| check | resultado | detalhe |
|---|---|---|
| `A1-identidade-commit` | ok | HEAD=122f9b6e16297993b2871ac9423c76d70878ec93 |
| `A2-sha-esperado` | ok | não exigido nesta execução |
| `A3-arvore-limpa` | ok | NÃO exigida nesta execução; árvore SUJA (1+) |
| `A4-inventario-defeitos` | ok | 175 item(ns) |
| `A5-dependencias` | ok | node_modules presente |
| `A5b-jest` | ok | binário do Jest |
| `A6-node` | ok | node 22.12.0 |
| `A7-regras-preventivas` | ok | 12 presentes |
| `A8-evidencia-anterior` | nota (não bloqueia) | de OUTRO commit (c7ef740319c7) — STALE, não conta como evidência do código atual |
| `A9-lineage-run-projecao` | ok | sem run aberto ou sem projeção (nada a comparar) |

Inventário de defeitos: 175 item(ns), 175 aberto(s), 117 bloqueante(s) para certificação.

## Autorizações de fase (Bug Closure First)

(nenhuma fase técnica foi solicitada)

**Sem bloqueio.**

## Passos executados (comando, exit code, duração, sha256 da saída)

(nenhum passo executado)

## Estado do runner do GitHub (medido)

```json
{
  "medido": true,
  "execucoesNaBranch": 1,
  "ultimaExecucao": {
    "databaseId": 40946848570,
    "headSha": "dd379d8206c77e84a91064ab245c7dbb10179aed",
    "conclusao": "failure",
    "criadaEm": "2026-10-29T20:11:52Z"
  }
}
```

## Como reconferir a evidência

```bash
node scripts/ci/dev-branch-gate.js --fases A   # reexecuta as mesmas fases
git log -1 --format=%H -- AI_MEMORY/evidence/dev-branch-ci-122f9b6e1629-parcial.md   # commit que publicou esta evidência
```

`evidenceSha256` = `148b07addb018e3578ed0b542c8a8919b7ac3caf84f94fbed6511559ac2caecf` (sha256 do payload sem este campo).

```json
{
  "schemaVersion": 3,
  "kind": "dev-branch-ci-evidence",
  "comando": "node scripts/ci/dev-branch-gate.js",
  "veredito": "PASS_PARCIAL",
  "equivalenteAValidacaoCompleta": false,
  "escopo": "PARCIAL",
  "fasesPedidas": [
    "A"
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
    }
  ],
  "fasesNaoAprovadas": [],
  "entradaInvalida": null,
  "entrada": {
    "bruto": "A",
    "duplicadas": [],
    "desconhecidas": []
  },
  "contextoExecucao": {
    "sha": null,
    "execucaoId": null
  },
  "identidade": {
    "sha": "122f9b6e16297993b2871ac9423c76d70878ec93",
    "branch": "fix/jest-ci-history",
    "shaValido": true,
    "branchValida": true
  },
  "fasesConcluidas": [
    "A"
  ],
  "fasesNaoAplicaveis": [],
  "sha": "122f9b6e16297993b2871ac9423c76d70878ec93",
  "shaCurto": "122f9b6e1629",
  "branch": "fix/jest-ci-history",
  "escopoDefeitos": null,
  "runnerDoGithub": {
    "medido": true,
    "execucoesNaBranch": 1,
    "ultimaExecucao": {
      "databaseId": 40946848570,
      "headSha": "dd379d8206c77e84a91064ab245c7dbb10179aed",
      "conclusao": "failure",
      "criadaEm": "2026-10-29T20:11:52Z"
    }
  },
  "gateEfetivo": "LOCAL (execucao deste runner; em CI o par e publicado como artifact dev-branch-ci-evidence-<sha>)",
  "preVoo": {
    "ok": true,
    "checks": [
      {
        "id": "A1-identidade-commit",
        "ok": true,
        "detalhe": "HEAD=122f9b6e16297993b2871ac9423c76d70878ec93"
      },
      {
        "id": "A2-sha-esperado",
        "ok": true,
        "detalhe": "não exigido nesta execução"
      },
      {
        "id": "A3-arvore-limpa",
        "ok": true,
        "detalhe": "NÃO exigida nesta execução; árvore SUJA (1+)"
      },
      {
        "id": "A4-inventario-defeitos",
        "ok": true,
        "detalhe": "175 item(ns)"
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
        "detalhe": "de OUTRO commit (c7ef740319c7) — STALE, não conta como evidência do código atual",
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
      "total": 175,
      "abertos": 175,
      "bloqueantesParaCertificacao": 117,
      "semSeveridadeAbertos": 0,
      "bloqueioExterno": 8,
      "riscoAceito": 0,
      "porEstado": {
        "VERIFIED": 148,
        "BLOCKED_EXTERNAL": 8,
        "RESOLVED": 19
      },
      "porSeveridade": {
        "P0": 31,
        "P1": 86,
        "P2": 48,
        "P3": 10
      }
    },
    "erroInventario": null,
    "arvoreSuja": true,
    "arquivosSujos": [
      "?? governance/bug-closure/transitions.log.jsonl"
    ],
    "evidenciaAnterior": {
      "sha": "c7ef740319c7088165e2effe797aef6c3efced92",
      "veredito": "FAIL",
      "escopo": "PARCIAL"
    }
  },
  "autorizacoes": [],
  "bloqueio": null,
  "passos": [],
  "falhas": [],
  "evidenceSha256": "148b07addb018e3578ed0b542c8a8919b7ac3caf84f94fbed6511559ac2caecf"
}
```
