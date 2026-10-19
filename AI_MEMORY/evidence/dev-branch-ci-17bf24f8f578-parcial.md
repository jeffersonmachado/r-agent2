# Gate em fases da branch de desenvolvimento — 17bf24f8f578 (PARCIAL)

- **veredito**: `ENTRADA_INVALIDA`
- **equivale a validação completa**: `false`
- **fases pedidas**: `(vazio)`
- **fases obrigatórias**: `A,B,C,D,E,F`
- **fases faltantes**: `A,B,C,D,E,F`
- **entrada inválida**: `LISTA_DE_FASES_VAZIA`
- **branch**: `dev/engineering-hardening`
- **sha exato avaliado**: `17bf24f8f5780364da849b009dc59238a89d7800`
- **gerado em**: 2026-10-19T03:31:24.962Z
- **gate efetivo**: LOCAL — o runner do GitHub não inicia jobs por limite de gastos da conta

## Estado por fase (comprovação, não intenção)

| fase | estado | passos reais | motivo |
|---|---|---|---|

## Pré-voo (fase A)

(pré-voo não executado)

Inventário de defeitos INDISPONÍVEL: pré-voo não executado

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
    "databaseId": 39194532214,
    "headSha": "17bf24f8f5780364da849b009dc59238a89d7800",
    "conclusao": "failure",
    "criadaEm": "2026-10-19T03:24:23Z"
  }
}
```

## Como reconferir a evidência

```bash
node scripts/ci/dev-branch-gate.js --fases A   # reexecuta as mesmas fases
git log -1 --format=%H -- AI_MEMORY/evidence/dev-branch-ci-17bf24f8f578-parcial.md   # commit que publicou esta evidência
```

`evidenceSha256` = `5beb4f1a7787e353d12cd09ef4db61e036d47aac1b7bd4aa794285b334cd200f` (sha256 do payload sem este campo).

```json
{
  "schemaVersion": 3,
  "kind": "dev-branch-ci-evidence",
  "comando": "node scripts/ci/dev-branch-gate.js",
  "veredito": "ENTRADA_INVALIDA",
  "equivalenteAValidacaoCompleta": false,
  "escopo": "PARCIAL",
  "fasesPedidas": [],
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
    "E",
    "F"
  ],
  "estadosPorFase": [],
  "fasesNaoAprovadas": [],
  "entradaInvalida": "LISTA_DE_FASES_VAZIA",
  "entrada": {
    "bruto": "",
    "duplicadas": [],
    "desconhecidas": []
  },
  "identidade": {
    "sha": "17bf24f8f5780364da849b009dc59238a89d7800",
    "branch": "dev/engineering-hardening",
    "shaValido": true,
    "branchValida": true
  },
  "fasesConcluidas": [],
  "sha": "17bf24f8f5780364da849b009dc59238a89d7800",
  "shaCurto": "17bf24f8f578",
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
    "ok": false,
    "checks": [],
    "achados": [
      {
        "code": "PRE_VOO_NAO_EXECUTADO"
      }
    ]
  },
  "autorizacoes": [],
  "bloqueio": null,
  "passos": [],
  "falhas": [],
  "evidenceSha256": "5beb4f1a7787e353d12cd09ef4db61e036d47aac1b7bd4aa794285b334cd200f"
}
```
