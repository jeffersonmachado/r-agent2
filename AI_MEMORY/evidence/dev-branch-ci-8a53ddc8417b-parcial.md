# Gate em fases da branch de desenvolvimento — 8a53ddc8417b (PARCIAL)

- **veredito**: `PASS_PARCIAL`
- **equivale a validação completa**: `false`
- **fases pedidas**: `A,D`
- **fases obrigatórias**: `A,B,C,D,R,E,F`
- **fases faltantes**: `B,C,R,E,F`
- **entrada inválida**: `não`
- **branch**: `codex/bug-closure-adversarial-hardening`
- **sha exato avaliado**: `8a53ddc8417b99bddd2084de2eb0529960986736`
- **gerado em**: 2026-10-23T03:23:20.773Z
- **gate efetivo**: LOCAL — o runner do GitHub não inicia jobs por limite de gastos da conta

## Estado por fase (comprovação, não intenção)

| fase | estado | passos reais | motivo |
|---|---|---|---|
| A | **PASS** | 10 | — |
| D | **PASS** | 4 | — |

## Pré-voo (fase A)

| check | resultado | detalhe |
|---|---|---|
| `A1-identidade-commit` | ok | HEAD=8a53ddc8417b99bddd2084de2eb0529960986736 |
| `A2-sha-esperado` | ok | não exigido nesta execução |
| `A3-arvore-limpa` | ok | NÃO exigida nesta execução; árvore SUJA (1+) |
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
| D | `L1_AMPLO` | **ALLOWED** | BLOQUEIO_EXTERNO_NAO_RESOLVE_CERTIFICACAO |

**Sem bloqueio.**

## Passos executados (comando, exit code, duração, sha256 da saída)

| fase | passo | comando | exit | duração | sha256 da saída |
|---|---|---|---|---|---|
| D | `L1-release-dag` | `node scripts/governance/validate-release-dag.js` | 0 | 0.3s | `301c27daf96e87f5…` |
| D | `L1-fila-oficial` | `node scripts/governance/validate-hardening-queue.js` | 0 | 2.5s | `9559a265be2edb78…` |
| D | `L1-ai-memory` | `node scripts/governance/validate-ai-memory.js` | 0 | 0.3s | `e3b0c44298fc1c14…` |
| D | `L1-aderencia-agente` | `node scripts/governance/validate-agent-adherence.js` | 0 | 0.2s | `e3b0c44298fc1c14…` |

## Estado do runner do GitHub (medido)

```json
{
  "medido": true,
  "execucoesNaBranch": 0,
  "conclusao": "NENHUMA_EXECUCAO"
}
```

## Como reconferir a evidência

```bash
node scripts/ci/dev-branch-gate.js --fases A,D   # reexecuta as mesmas fases
git log -1 --format=%H -- AI_MEMORY/evidence/dev-branch-ci-8a53ddc8417b-parcial.md   # commit que publicou esta evidência
```

`evidenceSha256` = `fd37126d47719cef4326203c3c2334d7c7d9934415623e6b7c1fe35bef4dbd61` (sha256 do payload sem este campo).

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
    "B",
    "C",
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
    "bruto": "A,D",
    "duplicadas": [],
    "desconhecidas": []
  },
  "contextoExecucao": {
    "sha": "8a53ddc8417b99bddd2084de2eb0529960986736",
    "execucaoId": "86ae623b-772a-481e-bcf6-6a3cf1b86b98"
  },
  "identidade": {
    "sha": "8a53ddc8417b99bddd2084de2eb0529960986736",
    "branch": "codex/bug-closure-adversarial-hardening",
    "shaValido": true,
    "branchValida": true
  },
  "fasesConcluidas": [
    "A",
    "D"
  ],
  "fasesNaoAplicaveis": [],
  "sha": "8a53ddc8417b99bddd2084de2eb0529960986736",
  "shaCurto": "8a53ddc8417b",
  "branch": "codex/bug-closure-adversarial-hardening",
  "escopoDefeitos": null,
  "runnerDoGithub": {
    "medido": true,
    "execucoesNaBranch": 0,
    "conclusao": "NENHUMA_EXECUCAO"
  },
  "gateEfetivo": "LOCAL (o runner do GitHub nao inicia jobs por limite de gastos da conta)",
  "preVoo": {
    "ok": true,
    "checks": [
      {
        "id": "A1-identidade-commit",
        "ok": true,
        "detalhe": "HEAD=8a53ddc8417b99bddd2084de2eb0529960986736"
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
    "arvoreSuja": true,
    "arquivosSujos": [
      "?? node_modules"
    ],
    "evidenciaAnterior": null
  },
  "autorizacoes": [
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
      "id": "L1-release-dag",
      "fase": "D",
      "nivel": "L1",
      "descricao": "DAG do release sem ciclo e sem violação de ordem de fase",
      "comando": "node scripts/governance/validate-release-dag.js",
      "exitCode": 0,
      "timeout": false,
      "duracaoMs": 333,
      "sha256Saida": "301c27daf96e87f585ee70df7507f5c1fac37ab8fb37a9a61832b96ab05ca3da",
      "saidaFinal": "[release-dag] status=PASS decision=RELEASE_DAG_ACYCLIC_AND_PHASE_AWARE\n[release-dag] nós=29 artefatos=25 ciclos=0\n[release-dag] relatório: reports/release-dag-report.json",
      "saidaRef": "AI_MEMORY/evidence/dev-branch-gate-logs/86ae623b-772a-481e-bcf6-6a3cf1b86b98/L1-release-dag.log"
    },
    {
      "id": "L1-fila-oficial",
      "fase": "D",
      "nivel": "L1",
      "descricao": "Fila oficial de hardening sem item aberto nem estado não canônico",
      "comando": "node scripts/governance/validate-hardening-queue.js",
      "exitCode": 0,
      "timeout": false,
      "duracaoMs": 2515,
      "sha256Saida": "9559a265be2edb7838ca7cb238adb1cd5bc520d2a0fb4f57ec497ca7f1be5be3",
      "saidaFinal": "[hardening-queue] 135 itens — done:75 blocked_external:6 prevention_active:35 verified:19\n[hardening-queue] abertos: H15-DIST-RECIBO-STALE(blocked_external), H19-DIST-CAUSA-UNICA(blocked_external), MISSAO-B9-CI-GITHUB-ACTIONS(blocked_external), H20-CADEIA-POS-CERTIFICACAO-DIVERGENTE(blocked_external), P1-PROJECAO-FINAL-DIVERGE-DA-CANONICA-DE-RUN-ABANDONADO(blocked_external), P1-AGREGADO-SEM-IDENTIDADE-DE-RUN-BLOQUEIA-L3(blocked_external)\n[hardening-queue] impedidos (blocked/blocked_external — NÃO são fechados): 6\n[hardening-queue] PASS",
      "saidaRef": "AI_MEMORY/evidence/dev-branch-gate-logs/86ae623b-772a-481e-bcf6-6a3cf1b86b98/L1-fila-oficial.log"
    },
    {
      "id": "L1-ai-memory",
      "fase": "D",
      "nivel": "L1",
      "descricao": "Memória operacional íntegra",
      "comando": "node scripts/governance/validate-ai-memory.js",
      "exitCode": 0,
      "timeout": false,
      "duracaoMs": 309,
      "sha256Saida": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      "saidaFinal": "",
      "saidaRef": "AI_MEMORY/evidence/dev-branch-gate-logs/86ae623b-772a-481e-bcf6-6a3cf1b86b98/L1-ai-memory.log"
    },
    {
      "id": "L1-aderencia-agente",
      "fase": "D",
      "nivel": "L1",
      "descricao": "Aderência do agente à Constituição",
      "comando": "node scripts/governance/validate-agent-adherence.js",
      "exitCode": 0,
      "timeout": false,
      "duracaoMs": 184,
      "sha256Saida": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      "saidaFinal": "",
      "saidaRef": "AI_MEMORY/evidence/dev-branch-gate-logs/86ae623b-772a-481e-bcf6-6a3cf1b86b98/L1-aderencia-agente.log"
    }
  ],
  "falhas": [],
  "evidenceSha256": "fd37126d47719cef4326203c3c2334d7c7d9934415623e6b7c1fe35bef4dbd61"
}
```
