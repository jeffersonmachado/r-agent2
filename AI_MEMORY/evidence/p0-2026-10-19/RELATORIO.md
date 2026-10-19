# P0-01 e P0-02 — correção e prova (2026-10-19)

Baseline auditada: `511ae5249d906eca21d2cb1f818b110e09ca896f` (branch `dev/engineering-hardening`).
PostgreSQL usado: **16.15** (container descartável `crm-p0-pg`, imagem `postgres:16-alpine`,
`127.0.0.1:55432/crm_p0_test`). Nenhum banco de produção tocado.

## P0-01 — gate aprovava fase com cobertura parcial

**Reprodução (código efetivamente auditado, `git show 511ae5249:scripts/ci/dev-branch-gate.js`):**

```
avaliarEstadosPorFase({ fasesPedidas:['D'], resultados:[1 passo exit 0], contexto })
→ [{"fase":"D","estado":"PASS","passosReais":1}]
```

A fase D define **7** passos obrigatórios. Um único resultado aprovado bastava.

**Causa raiz:** o avaliador só inspecionava os resultados PRESENTES (digest, sha, runId, exit).
Nunca comparava com o conjunto obrigatório da definição — ausência não tem linha, então
"o que existe está ok" virou "a fase está completa".

**Correção:** `scripts/ci/phase-step-contract.js` compara ESPERADOS (definição congelada no
código) × EXECUTADOS × APROVADOS × EVIDÊNCIAS. Rejeita: ausente, duplicado, desconhecido,
estado não aprovado, digest ausente, vínculo sha/runId ausente ou divergente, timeout,
exit `null` (sinal), exit ≠ 0, evidência ausente/inexistente/**adulterada** e ordem inválida
declarada. Estado novo `INCOMPLETE` nunca aprova. `decidirVeredito` o trata como não-cumprido.

**Prova:** `tests/unit/governance/phaseStepContract.test.js` — 24 cenários (23 inválidos
rejeitados + conjunto legítimo aprovado + caso negativo por adulteração de arquivo).

## P0-02 — CRM permitia sobrescrever e transferir registro entre tenants

**Reprodução (PostgreSQL real):** `p002-baseline-vulneravel.log`

```
ANTES  (tenant A): {"id":"opp-1","tenant_key":"tenant-a","payload":{"name":"Contrato sigiloso de A","value":950000}}
DEPOIS (ataque B): {"id":"opp-1","tenant_key":"tenant-b","payload":{"name":"SEQUESTRADO POR B","value":1}}
RESULTADO: VULNERAVEL — tenant_key transferido para tenant-b
```

**Causa raiz:** `gravarRegistro` fazia `Model.upsert({ id, tenant_key, entity, payload })`; a PK de
`crm_records` é apenas `id`, então o Sequelize emite `INSERT ... ON CONFLICT (id) DO UPDATE`
— inclusive do `tenant_key`. Criação e atualização eram a MESMA operação e a condição de
tenant não existia no SQL de escrita.

**Correção:** `api/services/crm/crmRecordStore.js`

| Operação | SQL | Falha |
|---|---|---|
| criar | `INSERT` puro, `tenant_key` do contexto autenticado | colisão → `409 id_indisponivel` |
| ler | `WHERE id AND tenant_key AND entity` | ausente → `null` (404) |
| atualizar | `UPDATE ... WHERE id AND tenant_key AND entity` | 0 linhas → `null` (404), nunca cria |
| remover | `DELETE WHERE id AND tenant_key AND entity` | 0 linhas → `404` |

`payload` não pode forjar `id`, `tenantId`, `tenant_key`, `tenantKey` nem `entity`.
Migration `20261019130000-crm-records-tenant-guard.js` instala trigger `BEFORE UPDATE`
que recusa mudança de `tenant_key` (defesa em profundidade; aplicada no banco de dev).

**Prova:** `tests/integration/crmTenantIsolation.postgres.test.js` — 22 cenários em Postgres
real com SQL independente antes/depois (`pg-matriz-22-cenarios.log`), mais
`tests/unit/crmNoUpsertRegression.test.js` (trava estática: `upsert` proibido e `WHERE` com tenant).

**Bloqueio pós-correção (`p002-corrigido-bloqueia.log`):**

```
ATAQUE REJEITADO: id_indisponivel - id indisponível: opp-1
UPDATE por tenant-b retornou: null
DEPOIS (SQL): {"id":"opp-1","tenant_key":"tenant-a","payload":{"name":"Contrato sigiloso de A","value":950000}}
RESULTADO: ISOLADO — registro de A intacto
```

## Jornada real (API viva, tenant `system`) — `jornada-http-crm.log`

| Passo | HTTP | Resultado |
|---|---|---|
| criar oportunidade | 200 | registro criado |
| recriar com o MESMO id | **409** | `id_indisponivel` (antes: sobrescrevia silenciosamente) |
| atualizar via PUT | 200 | mesmo id, nome/valor atualizados |
| listar | 200 | registro presente e atualizado |
| métricas | 200 | `totalOpportunities` e `totalValue` coerentes |
| restart da API + GET | 200 | dado persiste; SQL confirma `tenant_key=system`, payload sem `tenantId` |

## Níveis executados (diagnóstico, sem publicação)

| Nível | Comando | Resultado |
|---|---|---|
| B (direcionados) | 6 testes adversariais pelo gate | exit 0 em todos |
| L0 | `npm test` | **1063 suites / 9066 testes / 0 falhas**, exit 0 |
| L1 | 7 gates de governança | 4 PASS; 3 FAIL pré-existentes (cadeia, self-proving, decisão canônica — H20) |
| L2 | `npm run test:system` | 97/98 PASS; 1 FAIL (`finalStatusProjection`, impedimento externo) |
| L3 | `run-governance-enforcement` | `BLOCKED passos=0/64` — sem identidade de run (fail-closed) |

O gate `dev-branch-gate --fases A,B,C,D,E,F` fica `BLOQUEADO_POR_DEFEITOS` com
`TESTE_DIRECIONADO_PENDENTE` para dois P1 abertos que são impedimentos externos
(exigem ciclo de selagem). O bloqueio NÃO foi contornado: os níveis acima foram
executados como diagnóstico e estão registrados como tal.
