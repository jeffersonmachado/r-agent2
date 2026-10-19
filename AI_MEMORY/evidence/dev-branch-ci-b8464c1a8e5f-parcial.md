# Gate em fases da branch de desenvolvimento — b8464c1a8e5f (PARCIAL)

- **veredito**: `FAIL`
- **equivale a validação completa**: `false`
- **fases pedidas**: `A,B,C`
- **fases concluídas**: `(nenhuma)`
- **branch**: `dev/engineering-hardening`
- **sha exato avaliado**: `b8464c1a8e5fd0654ed4b15cfc5a53b0999ec725`
- **gerado em**: 2026-10-17T23:16:32.323Z
- **gate efetivo**: LOCAL — o runner do GitHub não inicia jobs por limite de gastos da conta

## Pré-voo (fase A)

| check | resultado | detalhe |
|---|---|---|
| `A1-identidade-commit` | ok | HEAD=b8464c1a8e5fd0654ed4b15cfc5a53b0999ec725 |
| `A2-sha-esperado` | ok | não exigido nesta execução |
| `A3-arvore-limpa` | ok | NÃO exigida nesta execução; árvore SUJA (2+) |
| `A4-inventario-defeitos` | ok | 94 item(ns) |
| `A5-dependencias` | ok | node_modules presente |
| `A5b-jest` | ok | binário do Jest |
| `A6-node` | ok | node 22.12.0 |
| `A7-regras-preventivas` | ok | 7 presentes |
| `A8-evidencia-anterior` | nota (não bloqueia) | de OUTRO commit (4169290c0d6b) — STALE, não conta como evidência do código atual |
| `A9-lineage-run-projecao` | ok | run rap-governed-20261017111858007-5d93eee8 FECHADO (ABANDONED) com motivo e evidência declarados — projeção do último ciclo concluído |

Inventário de defeitos: 94 item(ns), 2 aberto(s), 0 bloqueante(s) para certificação.

## Autorizações de fase (Bug Closure First)

| fase | operação | decisão | motivos |
|---|---|---|---|
| B | `TESTES_NEGATIVOS_REGRESSAO` | **ALLOWED** | BLOQUEIO_EXTERNO_NAO_RESOLVE_CERTIFICACAO |
| C | `L0_COMPLETO` | **ALLOWED** | BLOQUEIO_EXTERNO_NAO_RESOLVE_CERTIFICACAO |

**BLOQUEIO**: fase C — `PASSO_FALHOU` L0-suite-oficial exit=null

## Passos executados (comando, exit code, duração, sha256 da saída)

| fase | passo | comando | exit | duração | sha256 da saída |
|---|---|---|---|---|---|
| B | `B-nada-a-executar` | `(nenhum)` | null | 0.0s | `e3b0c44298fc1c14…` |
| C | `L0-suite-oficial` | `npm test` | null | 1670.7s | `b18f463784cb8472…` |

## Estado do runner do GitHub (medido)

```json
{
  "medido": true,
  "execucoesNaBranch": 1,
  "ultimaExecucao": {
    "databaseId": 39076560400,
    "headSha": "b8464c1a8e5fd0654ed4b15cfc5a53b0999ec725",
    "conclusao": "failure",
    "criadaEm": "2026-10-17T22:48:40Z"
  }
}
```

## Como reconferir a evidência

```bash
node scripts/ci/dev-branch-gate.js --fases A,B,C   # reexecuta as mesmas fases
git log -1 --format=%H -- AI_MEMORY/evidence/dev-branch-ci-b8464c1a8e5f-parcial.md   # commit que publicou esta evidência
```

`evidenceSha256` = `09412e01453fc42e22b154e3e53048d0d3062998203d110c83829d64db539ffd` (sha256 do payload sem este campo).

```json
{
  "schemaVersion": 2,
  "kind": "dev-branch-ci-evidence",
  "comando": "node scripts/ci/dev-branch-gate.js",
  "veredito": "FAIL",
  "equivalenteAValidacaoCompleta": false,
  "escopo": "PARCIAL",
  "fasesPedidas": [
    "A",
    "B",
    "C"
  ],
  "fasesConcluidas": [],
  "sha": "b8464c1a8e5fd0654ed4b15cfc5a53b0999ec725",
  "shaCurto": "b8464c1a8e5f",
  "branch": "dev/engineering-hardening",
  "escopoDefeitos": null,
  "runnerDoGithub": {
    "medido": true,
    "execucoesNaBranch": 1,
    "ultimaExecucao": {
      "databaseId": 39076560400,
      "headSha": "b8464c1a8e5fd0654ed4b15cfc5a53b0999ec725",
      "conclusao": "failure",
      "criadaEm": "2026-10-17T22:48:40Z"
    }
  },
  "gateEfetivo": "LOCAL (o runner do GitHub nao inicia jobs por limite de gastos da conta)",
  "preVoo": {
    "ok": true,
    "checks": [
      {
        "id": "A1-identidade-commit",
        "ok": true,
        "detalhe": "HEAD=b8464c1a8e5fd0654ed4b15cfc5a53b0999ec725"
      },
      {
        "id": "A2-sha-esperado",
        "ok": true,
        "detalhe": "não exigido nesta execução"
      },
      {
        "id": "A3-arvore-limpa",
        "ok": true,
        "detalhe": "NÃO exigida nesta execução; árvore SUJA (2+)"
      },
      {
        "id": "A4-inventario-defeitos",
        "ok": true,
        "detalhe": "94 item(ns)"
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
        "ok": false,
        "detalhe": "de OUTRO commit (4169290c0d6b) — STALE, não conta como evidência do código atual",
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
      "total": 94,
      "abertos": 2,
      "bloqueantesParaCertificacao": 0,
      "semSeveridadeAbertos": 0,
      "bloqueioExterno": 2,
      "riscoAceito": 0,
      "porEstado": {
        "VERIFIED": 74,
        "BLOCKED_EXTERNAL": 2,
        "RESOLVED": 18
      },
      "porSeveridade": {
        "P0": 22,
        "P1": 40,
        "P2": 22,
        "P3": 10
      }
    },
    "erroInventario": null,
    "arvoreSuja": true,
    "arquivosSujos": [
      "?? AI_MEMORY/evidence/dev-branch-ci-4169290c0d6b-completo.md",
      "?? AI_MEMORY/evidence/dev-branch-ci-4169290c0d6b-parcial.md"
    ],
    "evidenciaAnterior": {
      "sha": "4169290c0d6bde8bbf0040270c506795977f39af",
      "veredito": "BLOQUEADO_POR_DEFEITOS",
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
    "fase": "C",
    "code": "PASSO_FALHOU",
    "detail": "L0-suite-oficial exit=null"
  },
  "passos": [
    {
      "id": "B-nada-a-executar",
      "fase": "B",
      "nivel": "B",
      "descricao": "Nenhum regressionTest declarado para os defeitos em escopo",
      "comando": "(nenhum)",
      "exitCode": null,
      "timeout": false,
      "duracaoMs": 0,
      "sha256Saida": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      "saidaFinal": "",
      "naoExecutado": true
    },
    {
      "id": "L0-suite-oficial",
      "fase": "C",
      "nivel": "L0",
      "descricao": "Suíte oficial Jest (unit + flow + rpa sem browser)",
      "comando": "npm test",
      "exitCode": null,
      "timeout": true,
      "duracaoMs": 1670676,
      "sha256Saida": "b18f463784cb8472c9f40c06830e232b7093787541c4796c7eb763bf2ec9fffa",
      "saidaFinal": "    ✓ deprecação registrada: deprecatedAliases aponta para canônicos e cobre os aliases legados (110 ms)\n    ✓ grants legados não foram removidos: aliases continuam na tabela viva (102 ms)\n\nPASS tests/unit/governance/releaseSuiteExclusiveGroups.test.js\n  agrupamento de lotes com exclusividade declarada\n    ✓ o manifesto declara o grupo do runner de laço de bugs com motivo auditável (104 ms)\n    ✓ NENHUM lote contém duas suítes do mesmo grupo exclusivo (105 ms)\n    ✓ a exclusividade NÃO serializa tudo: lotes continuam sendo preenchidos (103 ms)\n    ✓ um grupo de uma suíte só não restringe nada (não é grupo) (103 ms)\n    ✓ grupo sem motivo suficiente é recusado — restrição silenciosa não passa (197 ms)\n    ✓ suíte em DOIS grupos respeita ambos (103 ms)\n    ✓ o agrupamento é determinístico (mesma entrada ⇒ mesmos lotes) (101 ms)"
    }
  ],
  "falhas": [
    {
      "id": "B-nada-a-executar",
      "fase": "B",
      "comando": "(nenhum)",
      "exitCode": null
    },
    {
      "id": "L0-suite-oficial",
      "fase": "C",
      "comando": "npm test",
      "exitCode": null
    }
  ],
  "evidenceSha256": "09412e01453fc42e22b154e3e53048d0d3062998203d110c83829d64db539ffd"
}
```
