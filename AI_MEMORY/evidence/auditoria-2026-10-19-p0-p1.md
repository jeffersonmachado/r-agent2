# Auditoria 2026-10-19 — P0/P1 corrigidos (baseline 9758f828f)

Branch `dev/engineering-hardening`. Baseline `9758f828f3fdd0fb07c08ebe591de1ace8df2ebe`.

## P0-1 — Falso PASS no gate de desenvolvimento

**Reprodução (antes):** `node scripts/ci/dev-branch-gate.js --fases A,A,A,A`
→ `veredito=PASS`, `equivalenteAValidacaoCompleta=true`, `exit=0`, zero passos.

**Causa raiz:** `fasesPedidas.length` era usado como sinal de cobertura e fases
desconhecidas eram filtradas em silêncio (`filter(hasOwnProperty)`).

**Correção (`scripts/ci/dev-branch-gate.js`):** `parseFases` recusa duplicada /
desconhecida / vazia; identidade exige SHA de 40 hex + branch; estados por fase
`PASS|FAIL|BLOCKED|NOT_EXECUTED|UNKNOWN|NOT_APPLICABLE` derivados de passos
reais; cada passo carrega `sha` + `execucaoId` + `sha256Saida`; `PASS` exige
todas as fases obrigatórias (A,B,C,D,E,F) comprovadas.

**Prova:** `--fases A,A,A,A` → `ENTRADA_INVALIDA`, exit 2, `passos: []`.
`tests/unit/governance/devBranchGatePhaseContract.test.js` → 20/20 (14 cenários
adversariais + 2 de integração + contexto único).

## P0-2 — Autorização tardia no gate agregado

**Reprodução (antes):** cadeia vazia → `PASS` (`0 === 0`, `[].every === true`);
executores rodavam antes de qualquer decisão de identidade/autorização.

**Correção (`scripts/governance/run-governance-enforcement.js`):** ordem
`IDENTIDADE → AUTORIZACAO (eligibility SELO_FINAL) → ESCOPO → CADEIA → EXECUCAO
→ EVIDENCIAS → DECISAO`; `PASSOS_OBRIGATORIOS` (13 gates) exigidos; sem digest de
saída por passo não há PASS.

**Prova:** `tests/unit/governance/governanceEnforcementOrder.test.js` → 14/14,
incluindo "zero chamadas de executor" para identidade incompleta, SHA inválido,
runId ausente e autorização negada.

## P0-3 — `RISK_ACCEPTED` dispensando controle crítico

**Reprodução (antes):** `classificarDefeitos` fazia `continue` em `RISK_ACCEPTED`
antes da severidade — P0 criptográfico aceito liberava QA Waves/selo/publicação.

**Correção (`governance/bug-closure/eligibility.js`):** P0 nunca dispensa; P1 só
com aceitação VÁLIDA (responsável + justificativa + validade futura) e fora de
`CONTROLES_CRITICOS` (CRYPTOGRAPHIC_INTEGRITY, CHAIN_INTEGRITY, AUTHORIZATION,
TENANT_ISOLATION, DATA_LOSS, CERTIFICATION_EVIDENCE); aceitação ineficaz mantém o
defeito tecnicamente aberto (`RISCO_ACEITO_INEFICAZ`).

**Prova:** `tests/unit/governance/riskAcceptedCriticalControl.test.js` → 15/15.

## P1 — CRM: persistência canônica (H21, commit b0fed3ceb)

Leads/contatos em `marketing_leads`; contas/funis/oportunidades/atividades em
`crm_records` (migration `20261019120000`); sem fallback em memória
(`500 persistence_required`). Medido: dashboard `{0,4,4,0}` → POST lead
`{0,5,5,0}` → POST conta `{1,5,5,0}` → **restart** → mantém `5` e `1` → DELETE
volta a `{0,4,4,0}`. Evidência: `AI_MEMORY/evidence/h21-crm-persistencia.md`.

## P1 — Edição de oportunidade criando duplicata

**Causa:** formulário de edição enviava payload sem `id` para `POST` (que gera id
novo). **Correção:** `PUT/PATCH /api/crm/opportunities/:id` (404 inexistente, 403
sem permissão, 400 id divergente, campos imutáveis preservados); frontend separa
`editingId` e usa `updateOpportunity`. **Prova:**
`tests/unit/crmOpportunityUpdate.test.js` → 11/11 (inclui 8 criações e 6
atualizações concorrentes sem perda/duplicata).

## P1 — WebSocket e isolamento multitenant

Servidor real (`http` + `ws` + `initializeWebSocket`) com tokens assinados:
evento do tenant A chega só em A; B não recebe; token inválido e token sem tenant
são recusados; reconexão recebe do próprio tenant.
**Prova:** `tests/unit/realtimeTenantIsolation.test.js` → 8/8.

## Validação progressiva (medida)

| Nível | Comando | Resultado |
|---|---|---|
| Suíte unitária | `npx jest tests/unit` | 1060 suites / 9031 testes / 0 falhas |
| Governança + CRM | `npx jest tests/unit/governance + CRM` | 170 suites / 1792 testes |
| L0 (gate A,B,C) | `dev-branch-gate --fases A,B,C,D` | `C PASS` em 188,3 s (exit 0) |
| L1 (gate D) | idem | `L1-cadeia-criptografica` exit 1 — cadeia divergente (H20) |
| L2/L3 | não executados | exigem autorização SELO_FINAL / ciclo de release |

## Bloqueio remanescente

`H20-CADEIA-POS-CERTIFICACAO-DIVERGENTE`: `governance/governance-chain.json`
(2026-10-17 04:21) não cobre 5 elos gravados 5h08 depois (ciclo ABANDONADO).
Recertificar exige ciclo completo de selagem — proibido nesta missão (sem
publicação). Consequência medida: `L1-cadeia-criptografica` exit 1
(`CADEIA_DIVERGENTE`, `AUTO_DECLARACAO_DE_VALIDADE_FALSA`,
`CERTIFICACAO_ULTRAPASSADA_POR_ESCRITA`).
