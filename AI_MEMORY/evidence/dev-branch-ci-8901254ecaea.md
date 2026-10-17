# Gate L0+L1 da branch de desenvolvimento — 8901254ecaea

- **veredito**: `FAIL`
- **branch**: `dev/engineering-hardening`
- **sha exato avaliado**: `8901254ecaea8b91912862fcf159e55c1bd83764`
- **gerado em**: 2026-10-17T00:19:14.273Z
- **gate efetivo**: LOCAL — o runner do GitHub não inicia jobs por limite de gastos da conta

## Passos executados (comando, exit code, duração, sha256 da saída)

| nível | passo | comando | exit | duração | sha256 da saída |
|---|---|---|---|---|---|
| L1 | `L1-cadeia-criptografica` | `node scripts/governance/validate-governance-chain.js` | 0 | 0.5s | `02f6bc55b63102ad…` |
| L1 | `L1-self-proving` | `node scripts/governance/validate-self-proving.js` | 0 | 0.3s | `e3b0c44298fc1c14…` |
| L1 | `L1-release-dag` | `node scripts/governance/validate-release-dag.js` | 0 | 0.1s | `301c27daf96e87f5…` |
| L1 | `L1-decisao-canonica` | `node scripts/governance/assert-canonical-release-decision.js` | 1 | 0.3s | `88a310645bdee7cb…` |
| L1 | `L1-fila-oficial` | `node scripts/governance/validate-hardening-queue.js` | 0 | 0.0s | `949ab72877b86fbb…` |
| L1 | `L1-ai-memory` | `node scripts/governance/validate-ai-memory.js` | 0 | 0.1s | `e3b0c44298fc1c14…` |
| L1 | `L1-aderencia-agente` | `node scripts/governance/validate-agent-adherence.js` | 0 | 0.1s | `e3b0c44298fc1c14…` |

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
node scripts/ci/dev-branch-gate.js            # reexecuta e recompara o exit code de cada passo
git log -1 --format=%H -- AI_MEMORY/evidence/dev-branch-ci-8901254ecaea.md   # commit que publicou esta evidência
```

`evidenceSha256` = `469d09589fa3d8aa925eb6a940ec455d80f783869cc238adaac4d67d5ea2c8c1` (sha256 do payload sem este campo).

```json
{
  "schemaVersion": 1,
  "kind": "dev-branch-ci-evidence",
  "comando": "node scripts/ci/dev-branch-gate.js",
  "veredito": "FAIL",
  "sha": "8901254ecaea8b91912862fcf159e55c1bd83764",
  "shaCurto": "8901254ecaea",
  "branch": "dev/engineering-hardening",
  "runnerDoGithub": {
    "medido": true,
    "execucoesNaBranch": 0,
    "conclusao": "NENHUMA_EXECUCAO"
  },
  "gateEfetivo": "LOCAL (o runner do GitHub nao inicia jobs por limite de gastos da conta)",
  "passos": [
    {
      "id": "L1-cadeia-criptografica",
      "nivel": "L1",
      "descricao": "Cadeia de governança RECALCULADA dos bytes atuais (e declaração auditável)",
      "comando": "node scripts/governance/validate-governance-chain.js",
      "exitCode": 0,
      "timeout": false,
      "duracaoMs": 506,
      "sha256Saida": "02f6bc55b63102ad8fa87ca4df952b4b05e3c81fac6a807aacf70564c2625947",
      "saidaFinal": "[governance-chain] status=PASS links=10 stored=01575f228a36… recomputado=01575f228a36…\n[governance-chain] elos: canonicos=3 derivados=7 imutaveisPosSelo=3\n[governance-chain] PASS: cadeia recomputada confere com a persistida e a declaração é auditável"
    },
    {
      "id": "L1-self-proving",
      "nivel": "L1",
      "descricao": "Self-proving sobre a cadeia recalculada",
      "comando": "node scripts/governance/validate-self-proving.js",
      "exitCode": 0,
      "timeout": false,
      "duracaoMs": 314,
      "sha256Saida": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      "saidaFinal": ""
    },
    {
      "id": "L1-release-dag",
      "nivel": "L1",
      "descricao": "DAG do release sem ciclo e sem violação de ordem de fase",
      "comando": "node scripts/governance/validate-release-dag.js",
      "exitCode": 0,
      "timeout": false,
      "duracaoMs": 51,
      "sha256Saida": "301c27daf96e87f585ee70df7507f5c1fac37ab8fb37a9a61832b96ab05ca3da",
      "saidaFinal": "[release-dag] status=PASS decision=RELEASE_DAG_ACYCLIC_AND_PHASE_AWARE\n[release-dag] nós=29 artefatos=25 ciclos=0\n[release-dag] relatório: reports/release-dag-report.json"
    },
    {
      "id": "L1-decisao-canonica",
      "nivel": "L1",
      "descricao": "Decisão canônica de release (autoridade única) coerente com os artefatos",
      "comando": "node scripts/governance/assert-canonical-release-decision.js",
      "exitCode": 1,
      "timeout": false,
      "duracaoMs": 315,
      "sha256Saida": "88a310645bdee7cb3eea4d3bf1df7e179200c882325e02a5347cad15bd880ccf",
      "saidaFinal": "[canonical-decision] NAO E GO DEFINITIVO: state=NO_GO motivo=GATE_OBRIGATORIO_FALHOU:identidade\n  identidade do run: PRESENTE | relatórios: final_governance=INCOMPLETA, final_readiness=INCOMPLETA, final_proof=INCOMPLETA\n  cadeia: CADEIA_RECOMPUTADA_INTEGRA (divergências=0, raizConfere=true)\n  identidade insuficiente/divergente: final_governance:INCOMPLETA:faltantes=sourceCommit, final_readiness:INCOMPLETA:faltantes=sourceCommit, final_proof:INCOMPLETA:faltantes=sourceCommit\n  a publicação exige GO definitivo dos três relatórios + cadeia RECALCULADA íntegra + identidade PRESENTE e correspondente"
    },
    {
      "id": "L1-fila-oficial",
      "nivel": "L1",
      "descricao": "Fila oficial de hardening sem item aberto nem estado não canônico",
      "comando": "node scripts/governance/validate-hardening-queue.js",
      "exitCode": 0,
      "timeout": false,
      "duracaoMs": 40,
      "sha256Saida": "949ab72877b86fbb4d52faa2f2cd6d43193241403640fc7a1d8960ae83c73cca",
      "saidaFinal": "[hardening-queue] 89 itens — done:53 blocked_external:3 prevention_active:14 verified:13 blocked:5 pending:1\n[hardening-queue] abertos: FASE6-NOVO-CANDIDATO-POR-MUDANCA-DE-FINGERPRINT(pending)\n[hardening-queue] PASS"
    },
    {
      "id": "L1-ai-memory",
      "nivel": "L1",
      "descricao": "Memória operacional íntegra",
      "comando": "node scripts/governance/validate-ai-memory.js",
      "exitCode": 0,
      "timeout": false,
      "duracaoMs": 75,
      "sha256Saida": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      "saidaFinal": ""
    },
    {
      "id": "L1-aderencia-agente",
      "nivel": "L1",
      "descricao": "Aderência do agente à Constituição",
      "comando": "node scripts/governance/validate-agent-adherence.js",
      "exitCode": 0,
      "timeout": false,
      "duracaoMs": 51,
      "sha256Saida": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      "saidaFinal": ""
    }
  ],
  "falhas": [
    {
      "id": "L1-decisao-canonica",
      "comando": "node scripts/governance/assert-canonical-release-decision.js",
      "exitCode": 1
    }
  ]
}
```
