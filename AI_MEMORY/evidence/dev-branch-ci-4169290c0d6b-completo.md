# Gate em fases da branch de desenvolvimento — 4169290c0d6b (COMPLETO)

- **veredito**: `BLOQUEADO_POR_DEFEITOS`
- **equivale a validação completa**: `false`
- **fases pedidas**: `A,B,C,D`
- **fases concluídas**: `(nenhuma)`
- **branch**: `dev/engineering-hardening`
- **sha exato avaliado**: `4169290c0d6bde8bbf0040270c506795977f39af`
- **gerado em**: 2026-10-17T22:39:09.143Z
- **gate efetivo**: LOCAL — o runner do GitHub não inicia jobs por limite de gastos da conta

## Pré-voo (fase A)

| check | resultado | detalhe |
|---|---|---|
| `A1-identidade-commit` | ok | HEAD=4169290c0d6bde8bbf0040270c506795977f39af |
| `A2-sha-esperado` | ok | não exigido nesta execução |
| `A3-arvore-limpa` | ok | limpa |
| `A4-inventario-defeitos` | ok | 94 item(ns) |
| `A5-dependencias` | ok | node_modules presente |
| `A5b-jest` | ok | binário do Jest |
| `A6-node` | ok | node 22.12.0 |
| `A7-regras-preventivas` | ok | 7 presentes |
| `A8-evidencia-anterior` | nota (não bloqueia) | de OUTRO commit (d69c84a83fc4) — STALE, não conta como evidência do código atual |
| `A9-lineage-run-projecao` | ok | run rap-governed-20261017111858007-5d93eee8 FECHADO (ABANDONED) com motivo e evidência declarados — projeção do último ciclo concluído |

Inventário de defeitos: 94 item(ns), 2 aberto(s), 0 bloqueante(s) para certificação.

## Autorizações de fase (Bug Closure First)

| fase | operação | decisão | motivos |
|---|---|---|---|
| B | `TESTES_NEGATIVOS_REGRESSAO` | **ALLOWED** | BLOQUEIO_EXTERNO_NAO_RESOLVE_CERTIFICACAO |
| C | `L0_COMPLETO` | **DENIED** | BLOQUEIO_EXTERNO_NAO_RESOLVE_CERTIFICACAO, TESTE_DIRECIONADO_PENDENTE |

**BLOQUEIO**: fase C — `FASE_NAO_AUTORIZADA` BLOQUEIO_EXTERNO_NAO_RESOLVE_CERTIFICACAO,TESTE_DIRECIONADO_PENDENTE

## Passos executados (comando, exit code, duração, sha256 da saída)

| fase | passo | comando | exit | duração | sha256 da saída |
|---|---|---|---|---|---|
| B | `B-nada-a-executar` | `(nenhum)` | null | 0.0s | `e3b0c44298fc1c14…` |

## Estado do runner do GitHub (medido)

```json
{
  "medido": true,
  "execucoesNaBranch": 1,
  "ultimaExecucao": {
    "databaseId": 39075925509,
    "headSha": "4169290c0d6bde8bbf0040270c506795977f39af",
    "conclusao": "",
    "criadaEm": "2026-10-17T22:38:56Z"
  }
}
```

## Como reconferir a evidência

```bash
node scripts/ci/dev-branch-gate.js --fases A,B,C,D   # reexecuta as mesmas fases
git log -1 --format=%H -- AI_MEMORY/evidence/dev-branch-ci-4169290c0d6b-completo.md   # commit que publicou esta evidência
```

`evidenceSha256` = `4e3de228c1bbfa375e75b5e7560acb2135b9f6a2ef8dcaf18d8648ab99d611c5` (sha256 do payload sem este campo).

```json
{
  "schemaVersion": 2,
  "kind": "dev-branch-ci-evidence",
  "comando": "node scripts/ci/dev-branch-gate.js",
  "veredito": "BLOQUEADO_POR_DEFEITOS",
  "equivalenteAValidacaoCompleta": false,
  "escopo": "COMPLETO",
  "fasesPedidas": [
    "A",
    "B",
    "C",
    "D"
  ],
  "fasesConcluidas": [],
  "sha": "4169290c0d6bde8bbf0040270c506795977f39af",
  "shaCurto": "4169290c0d6b",
  "branch": "dev/engineering-hardening",
  "escopoDefeitos": null,
  "runnerDoGithub": {
    "medido": true,
    "execucoesNaBranch": 1,
    "ultimaExecucao": {
      "databaseId": 39075925509,
      "headSha": "4169290c0d6bde8bbf0040270c506795977f39af",
      "conclusao": "",
      "criadaEm": "2026-10-17T22:38:56Z"
    }
  },
  "gateEfetivo": "LOCAL (o runner do GitHub nao inicia jobs por limite de gastos da conta)",
  "preVoo": {
    "ok": true,
    "checks": [
      {
        "id": "A1-identidade-commit",
        "ok": true,
        "detalhe": "HEAD=4169290c0d6bde8bbf0040270c506795977f39af"
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
        "detalhe": "de OUTRO commit (d69c84a83fc4) — STALE, não conta como evidência do código atual",
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
    "arvoreSuja": false,
    "arquivosSujos": [],
    "evidenciaAnterior": {
      "sha": "d69c84a83fc42bcbf09932777812c90f02cbc26a",
      "veredito": "PASS_PARCIAL",
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
          "defectId": "MISSAO-B1-CADEIA-CRIPTOGRAFICA",
          "severity": "P0",
          "state": "VERIFIED",
          "detail": "B1: cadeia criptografica existia mas NENHUM gate a recalculava"
        },
        {
          "code": "TESTE_DIRECIONADO_PENDENTE",
          "defectId": "HARDENING-ENG-GOV-RELEASE-P0-6",
          "severity": "P0",
          "state": "RESOLVED",
          "detail": "Reuso de lote do runner autoritativo nao pode mascarar exit code divergente"
        },
        {
          "code": "TESTE_DIRECIONADO_PENDENTE",
          "defectId": "HARDENING-ENG-GOV-RELEASE-P0-5",
          "severity": "P0",
          "state": "RESOLVED",
          "detail": "Eliminar falsos verdes de cobertura (L1) e fazer a malha REALMENTE executar"
        },
        {
          "code": "TESTE_DIRECIONADO_PENDENTE",
          "defectId": "HARDENING-ENG-GOV-RELEASE-P0-2",
          "severity": "P0",
          "state": "RESOLVED",
          "detail": "Cadeia criptografica reconstruida e assinada a cada ciclo (selo imutavel)"
        },
        {
          "code": "TESTE_DIRECIONADO_PENDENTE",
          "defectId": "HARDENING-ENG-GOV-RELEASE-P0-3",
          "severity": "P0",
          "state": "RESOLVED",
          "detail": "Certificar ANTES de publicar (ordem de fase do selo)"
        },
        {
          "code": "TESTE_DIRECIONADO_PENDENTE",
          "defectId": "HARDENING-ENG-GOV-RELEASE-P0-4",
          "severity": "P0",
          "state": "RESOLVED",
          "detail": "Autoridade unica de decisao de release (fim da comparacao por substring)"
        },
        {
          "code": "TESTE_DIRECIONADO_PENDENTE",
          "defectId": "HARDENING-ENG-GOV-RELEASE-P1-11",
          "severity": "P1",
          "state": "RESOLVED",
          "detail": "TTL/frescor de evidencia: autoridade unica com 5 regras e vinculacao por run"
        },
        {
          "code": "TESTE_DIRECIONADO_PENDENTE",
          "defectId": "HARDENING-ENG-GOV-RELEASE-MESH-EVIDENCE-POISONING",
          "severity": "P0",
          "state": "RESOLVED",
          "detail": "Execucao da malha sem lineage destruia a evidencia governada (agregado em vermelho)"
        },
        {
          "code": "TESTE_DIRECIONADO_PENDENTE",
          "defectId": "HARDENING-ENG-GOV-RELEASE-EVIDENCIA-DENTRO-DO-RUN",
          "severity": "P0",
          "state": "VERIFIED",
          "detail": "Evidencia runtime so vale se produzida DENTRO da janela de um run governado aberto"
        },
        {
          "code": "TESTE_DIRECIONADO_PENDENTE",
          "defectId": "HARDENING-ENG-GOV-RELEASE-CANDIDATE-IDENTIDADE-FOREIGN-RUN",
          "severity": "P0",
          "state": "VERIFIED",
          "detail": "Criar run governado novo torna o CANDIDATO entregue um artefato de outro run"
        },
        {
          "code": "TESTE_DIRECIONADO_PENDENTE",
          "defectId": "HARDENING-ENG-GOV-RELEASE-HANDSHAKE-AMBIGUO",
          "severity": "P1",
          "state": "RESOLVED",
          "detail": "Harness aceitava LOG JSON do produto como handshake do worker de lease (selo V2 abortado)"
        },
        {
          "code": "TESTE_DIRECIONADO_PENDENTE",
          "defectId": "HARDENING-ENG-GOV-RELEASE-HANDSHAKE-FENCE-UNDEFINED",
          "severity": "P1",
          "state": "RESOLVED",
          "detail": "FENCE_AVANCOU com antes=undefined: log JSON do produto confundido com handshake (selo V2 abortado)"
        },
        {
          "code": "TESTE_DIRECIONADO_PENDENTE",
          "defectId": "P0-FALSO-GO-ESTADO-DE-GATE-NAO-PERMITIDO",
          "severity": "P0",
          "state": "VERIFIED",
          "detail": "Falso GO: gate com status nao permitido (NOT_EXECUTED/UNKNOWN/SKIPPED/arbitrario) certificava"
        },
        {
          "code": "TESTE_DIRECIONADO_PENDENTE",
          "defectId": "P0-IDENTIDADE-AUSENTE-E-ACEITA-COMO-COERENTE",
          "severity": "P0",
          "state": "VERIFIED",
          "detail": "Identidade ausente era tratada como identidade coerente (aprovava sem runId/commit/fingerprint)"
        },
        {
          "code": "TESTE_DIRECIONADO_PENDENTE",
          "defectId": "P0-AVALIADOR-CONFIAVA-EM-CAMPO-VALID-GRAVADO",
          "severity": "P0",
          "state": "VERIFIED",
          "detail": "Avaliador canonico confiava no campo chain.valid GRAVADO em vez de recalcular a cadeia"
        },
        {
          "code": "TESTE_DIRECIONADO_PENDENTE",
          "defectId": "P0-ESTADO-E-VEREDITO-PODEM-DISCORDAR",
          "severity": "P0",
          "state": "VERIFIED",
          "detail": "state=CERTIFIED_GO coexistindo com veredito nao-ok (consumidor que le state via GO falso)"
        },
        {
          "code": "TESTE_DIRECIONADO_PENDENTE",
          "defectId": "P1-ENTREGA-EXIT-CODE-DESCARTAOO-GREP-COMO-AUTORIDADE",
          "severity": "P1",
          "state": "VERIFIED",
          "detail": "Verificacao de ENTREGA descartava o exit code e usava grep de texto positivo como autoridade"
        },
        {
          "code": "TESTE_DIRECIONADO_PENDENTE",
          "defectId": "P1-SELO-PUSH-ORIGIN-MAIN-NO-OP-FALSO-PUSH-OK",
          "severity": "P1",
          "state": "VERIFIED",
          "detail": "Selo publicava ref fixa (main) e imprimia \"push ok\" sem publicar o commit da branch em uso"
        },
        {
          "code": "TESTE_DIRECIONADO_PENDENTE",
          "defectId": "P0-CADEIA-APARENCIA-DE-VALIDA-APOS-ALTERACAO",
          "severity": "P0",
          "state": "RESOLVED",
          "detail": "Cadeia criptografica declarava valid=true sobre conteudo alterado e o agregado aprovava lendo o campo persistido"
        },
        {
          "code": "TESTE_DIRECIONADO_PENDENTE",
          "defectId": "FASE6-NOVO-CANDIDATO-POR-MUDANCA-DE-FINGERPRINT",
          "severity": "P1",
          "state": "VERIFIED",
          "detail": "Fix da FASE 6 mudou o sourceFingerprint: falta gerar novo candidato e nova certificacao preservando o anterior como historico"
        },
        {
          "code": "TESTE_DIRECIONADO_PENDENTE",
          "defectId": "P0-RUN-SEM-SOURCE-COMMIT-IDENTIDADE-DE-RELEASE-IMPOSSIVEL",
          "severity": "P0",
          "state": "RESOLVED",
          "detail": "Run governado nunca registrava o commit: identidade de release INCOMPLETA para sempre e GO definitivo impossivel"
        },
        {
          "code": "TESTE_DIRECIONADO_PENDENTE",
          "defectId": "P1-STAGING-DIST-GOVERNANCE-ARTIFACTS-DERRUBA-VALIDATE-DIST",
          "severity": "P1",
          "state": "RESOLVED",
          "detail": "Certificacao deixa staging transitorio em dist/ e o agregado falha em validate:dist"
        },
        {
          "code": "TESTE_DIRECIONADO_PENDENTE",
          "defectId": "P0-PRODUTORES-GRAVAM-LINEAGE-SEM-SOURCECOMMIT",
          "severity": "P0",
          "state": "RESOLVED",
          "detail": "Produtores que carimbam o proprio lineage gravam runId + sourceFingerprint mas NAO sourceCommit: GO definitivo continua impossivel"
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
    }
  ],
  "falhas": [
    {
      "id": "B-nada-a-executar",
      "fase": "B",
      "comando": "(nenhum)",
      "exitCode": null
    }
  ],
  "evidenceSha256": "4e3de228c1bbfa375e75b5e7560acb2135b9f6a2ef8dcaf18d8648ab99d611c5"
}
```
