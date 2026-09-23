# ENGINEERING_ROUTER_V1_SEAL_REPORT.md

Derivado de `ENGINEERING_ROUTER_V1_SEAL_REPORT.json` e do audit envelope real em
`dist/engineering-router-v1-audit-envelope/`, verificado offline contra um ZIP de release
real (`scripts/generate-zip.sh`). Nenhum campo abaixo foi escrito manualmente sem
corresponder a um valor real do JSON/envelope.

## Identidade

- HEAD: `08d9f3622832c427a895d77b8ec3ddd138b10b59`
- sourceFingerprint: `04280aa266c022750969878ab02675211f7fa97fd759a8e55b06399d2d1b0344`
- runId: `08d9f3622832c427a895d77b8ec3ddd138b10b59`

## Backlog SEALFIX (autoridade única do seal — nunca confundida com ER-V1-FINAL-001..010 nem
ER-V1-SEAL-001..005, ambos já fechados e preservados só como lineage)

| Item | Título | Commit | Status |
|---|---|---|---|
| ER-V1-SEALFIX-001 | Artifact-to-Source Binding | `aca93434` | PASS |
| ER-V1-SEALFIX-002 | Real Container Deployment | `08d9f362` | PASS |
| ER-V1-SEALFIX-003 | Runner Trust Boundary | `54128514` | PASS |
| ER-V1-SEALFIX-004 | Phase-Aware Durable Resume | `f3d1e006` | PASS |

## Certificação

- Structural: **PASS** — 209 checks, 0 falhas.
- Runtime: **RUNTIME_PASS** — 25/25 itens, 0 falhas.
- Pilot: 4 itens reais (loop RED→FIX→REVIEW→GREEN), todos PASS.
- Deployment E2E (Docker real, dois containers separados): 4/4 GREEN.
- Durable resume (crash real simulado, 5 cenários via API pública `runTask`): 5/5 GREEN.
- Runner trust boundary (11 testes adversariais): 11/11 GREEN.
- Artifact-to-source binding (12 testes obrigatórios): 12/12 GREEN.
- Offline verifier: **PASS**, 160 checks, 0 falhas — rodado contra um ZIP de release real
  extraído (binding completo código↔fingerprint verificável, nunca dependente de `.git`/DB/rede).
- Regressão: suíte completa do Engineering Router em modo serial — 51/51 suítes, 364/364 testes.
  `npm run test:unit` (projeto inteiro): 852/853 suítes, 6549/6551 testes.

## Decisão

```
ENGINEERING_ROUTER_V1_SEALED = true
```

Todas as 15 condições da seção "CONDIÇÃO DE SEAL" da missão FINAL_RELEASE_CLOSURE estão
comprovadas com evidência real regenerada nesta sessão, sem nenhuma edição manual de
hash/proof/report.
