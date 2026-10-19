# Gate em fases da branch de desenvolvimento — bc52dd90960e (PARCIAL)

- **veredito**: `FAIL`
- **equivale a validação completa**: `false`
- **fases pedidas**: `A,B,C,D`
- **fases obrigatórias**: `A,B,C,D,E,F`
- **fases faltantes**: `E,F`
- **entrada inválida**: `não`
- **branch**: `dev/engineering-hardening`
- **sha exato avaliado**: `bc52dd90960ed5e9bbcb3163407d9be9b3ce1cbe`
- **gerado em**: 2026-10-19T04:20:45.966Z
- **gate efetivo**: LOCAL — o runner do GitHub não inicia jobs por limite de gastos da conta

## Estado por fase (comprovação, não intenção)

| fase | estado | passos reais | motivo |
|---|---|---|---|
| A | **PASS** | 10 | — |
| B | **NOT_APPLICABLE** | 0 | SEM_DEFEITOS_ABERTOS |
| C | **PASS** | 1 | — |
| D | **FAIL** | 1 | PASSO_FALHOU:L1-cadeia-criptografica |

## Pré-voo (fase A)

| check | resultado | detalhe |
|---|---|---|
| `A1-identidade-commit` | ok | HEAD=bc52dd90960ed5e9bbcb3163407d9be9b3ce1cbe |
| `A2-sha-esperado` | ok | não exigido nesta execução |
| `A3-arvore-limpa` | ok | NÃO exigida nesta execução; árvore SUJA (4+) |
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
| B | `TESTES_NEGATIVOS_REGRESSAO` | **ALLOWED** | BLOQUEIO_EXTERNO_NAO_RESOLVE_CERTIFICACAO |
| C | `L0_COMPLETO` | **ALLOWED** | BLOQUEIO_EXTERNO_NAO_RESOLVE_CERTIFICACAO |
| D | `L1_AMPLO` | **ALLOWED** | BLOQUEIO_EXTERNO_NAO_RESOLVE_CERTIFICACAO |

**BLOQUEIO**: fase D — `PASSO_FALHOU` L1-cadeia-criptografica exit=1

## Passos executados (comando, exit code, duração, sha256 da saída)

| fase | passo | comando | exit | duração | sha256 da saída |
|---|---|---|---|---|---|
| B | `B-nada-a-executar` | `(nenhum)` | null | 0.0s | `e3b0c44298fc1c14…` |
| C | `L0-suite-oficial` | `npm test` | 0 | 185.5s | `950df687f9bf831f…` |
| D | `L1-cadeia-criptografica` | `node scripts/governance/validate-governance-chain.js` | 1 | 0.6s | `51dc664fece0db60…` |

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
node scripts/ci/dev-branch-gate.js --fases A,B,C,D   # reexecuta as mesmas fases
git log -1 --format=%H -- AI_MEMORY/evidence/dev-branch-ci-bc52dd90960e-parcial.md   # commit que publicou esta evidência
```

`evidenceSha256` = `0cc80310f125e291ebf521c4073aa50b52f1828ca2b7c725f1e4ff56f238f824` (sha256 do payload sem este campo).

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
      "estado": "NOT_APPLICABLE",
      "passosReais": 0,
      "motivo": "SEM_DEFEITOS_ABERTOS"
    },
    {
      "fase": "C",
      "estado": "PASS",
      "passosReais": 1,
      "motivo": null
    },
    {
      "fase": "D",
      "estado": "FAIL",
      "passosReais": 1,
      "motivo": "PASSO_FALHOU:L1-cadeia-criptografica"
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
    "sha": "bc52dd90960ed5e9bbcb3163407d9be9b3ce1cbe",
    "execucaoId": "c5c9b5e8-d378-47d8-a89c-c4266a72a8bc"
  },
  "identidade": {
    "sha": "bc52dd90960ed5e9bbcb3163407d9be9b3ce1cbe",
    "branch": "dev/engineering-hardening",
    "shaValido": true,
    "branchValida": true
  },
  "fasesConcluidas": [
    "A",
    "C"
  ],
  "fasesNaoAplicaveis": [
    "B"
  ],
  "sha": "bc52dd90960ed5e9bbcb3163407d9be9b3ce1cbe",
  "shaCurto": "bc52dd90960e",
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
        "detalhe": "HEAD=bc52dd90960ed5e9bbcb3163407d9be9b3ce1cbe"
      },
      {
        "id": "A2-sha-esperado",
        "ok": true,
        "detalhe": "não exigido nesta execução"
      },
      {
        "id": "A3-arvore-limpa",
        "ok": true,
        "detalhe": "NÃO exigida nesta execução; árvore SUJA (4+)"
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
      " M scripts/ci/dev-branch-gate.js",
      "?? AI_MEMORY/evidence/dev-branch-ci-bc52dd90960e-parcial.md"
    ],
    "evidenciaAnterior": {
      "sha": "bc52dd90960ed5e9bbcb3163407d9be9b3ce1cbe",
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
      "exitCode": 0,
      "timeout": false,
      "duracaoMs": 185502,
      "sha256Saida": "950df687f9bf831f07c3b4bc216c34f182b50c974cdcf48847cb34747ae38f33",
      "saidaFinal": "      ○ skipped deve inicializar corretamente\n      ○ skipped deve executar gravação simples\n      ○ skipped deve detectar erros\n      ○ skipped deve substituir variáveis\n\nTest Suites: 3 passed, 3 total\nTests:       4 skipped, 7 passed, 11 total\nSnapshots:   0 total\nTime:        2.125 s\nRan all test suites within paths \"tests/rpa/rpa.test.js\", \"tests/rpa/login.test.js\", \"tests/rpa/createTenantByAI.test.js\".\n[jest-global-teardown] Engineering Runner (pid 755378) encerrado (porta liberada)\nForce exiting Jest: Have you considered using `--detectOpenHandles` to detect async operations that kept running after all tests finished?"
    },
    {
      "id": "L1-cadeia-criptografica",
      "fase": "D",
      "nivel": "L1",
      "descricao": "Cadeia de governança RECALCULADA dos bytes atuais (e declaração auditável)",
      "comando": "node scripts/governance/validate-governance-chain.js",
      "exitCode": 1,
      "timeout": false,
      "duracaoMs": 643,
      "sha256Saida": "51dc664fece0db606dde568b972336d4a2941f8832a074c7f4ea6ada1a5b9f38",
      "saidaFinal": "  blocker_engine — cumulative_hash_broken\n  package_validation — hash_mismatch (governance/package-validation-report.json)\n  chain_root — chain_root_mismatch\n[governance-chain] a cadeia é RECALCULADA a partir dos artefatos: divergência = artefato alterado ou chain regravada\n[governance-chain] AUTO_DECLARACAO_DE_VALIDADE_FALSA: o artefato se declara válido (valid=true, estado=CERTIFICADA) mas a recalculação encontrou 9 divergência(s) — aparência de válida sobre conteúdo alterado\n[governance-chain] escritas posteriores a certificacao: 5 elo(s) (5 com CONTEUDO ALTERADO)\n  evidence_manifest (DERIVADO) +18496s conteudoIdentico=false\n  final_proof_report (DERIVADO) +18496s conteudoIdentico=false\n  final_readiness (DERIVADO) +18496s conteudoIdentico=false\n  proof_signature (DERIVADO) +18496s conteudoIdentico=false\n  package_validation (DERIVADO) +18496s conteudoIdentico=false\n[governance-chain] elos: canonicos=3 derivados=7 imutaveisPosSelo=3"
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
  "evidenceSha256": "0cc80310f125e291ebf521c4073aa50b52f1828ca2b7c725f1e4ff56f238f824"
}
```
