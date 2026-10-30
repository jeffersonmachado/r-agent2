# Runbook de certificação — o que só o dono pode fazer

**Status:** operacional. Cada passo abaixo é executável e verificável. O diagnóstico vem de
`npm run cert:ladder` (escada ordenada, com `PASS`/`FAIL`/`BLOCKED` e o pré-requisito que faltou) —
`BLOCKED` nunca significa `PASS`.

Estado medido em 2026-10-30 (`dev` `c76d52b8c`): `PASS=3, FAIL=1, BLOCKED=6, certificavel=false`.
O único `FAIL` é **âncoras**; todo o resto está bloqueado em cascata por ele.

```
OK   fila                    npm run validate:hardening-queue
OK   memoria                 npm run validate:ai-memory
OK   dag                     npm run validate:release-dag
FALHA ancoras                node scripts/governance/provision-closure-anchors.js --check
BLOQ  fechamentos            npm run validate:bug-closure-status
BLOQ  execucao-autoritativa  RELEASE_AUTHORITATIVE=1 node scripts/governance/run-release-suites.js
BLOQ  required-tests         npm run validate:required-tests
BLOQ  waves                 wave:db-integrity + wave:api-surface + wave:page-surface
BLOQ  cobertura              npm run validate:coverage-gate
BLOQ  agregado               npm run validate:governance-enforcement
```

---

## Passo 1 — Pins versionados (código, revisável)

`governance/bug-closure/trusted-authorities.js` compara a âncora recebida com pins **hardcoded**.
Hoje os dois arrays estão **vazios**, então mesmo com os segredos corretos o resultado é
`SEM_PIN_VERSIONADO`.

1. Gere os dois pares Ed25519 (um para **fechar defeito**, outro para **aprovar missão**).
2. Derive o fingerprint de cada chave pública:
   `node scripts/governance/provision-closure-anchors.js --key <publica.pem> --out <arquivo-fora-do-repo>`
3. Cole os dois fingerprints em `PINNED_AUTHORITY_FINGERPRINTS` / `PINNED_APPROVAL_FINGERPRINTS`.
4. Commit (é mudança de política, portanto revisável — não é segredo).

> Sem este passo, os segredos do passo 2 não têm com o que concordar.

## Passo 2 — Segredos no cofre do orquestrador (nunca na árvore)

| Nome | Conteúdo |
|---|---|
| `RAP_CLOSURE_TRUST_ANCHOR_SHA256` | sha256 do SPKI DER da chave que **fecha defeito** |
| `RAP_APPROVAL_TRUST_ANCHOR_SHA256` | sha256 do SPKI DER da chave que **aprova missão** |
| `RAP_CLOSURE_INVENTORY_SHA256` | digest canônico de `[id, severity, state]` da fila |
| `RAP_RELEASE_ATTESTATION_PRIVATE_KEY` | Ed25519 (PEM/base64) usada pelo workflow de release |
| `RAP_RELEASE_ATTESTATION_PUBLIC_KEY` | contraparte pública do item acima |

`RAP_CLOSURE_INVENTORY_SHA256` **muda sempre que a fila muda legitimamente** — toda alteração
aprovada exige reprovisionar. O valor atual sai de `--check` (o script mostra o digest oficial).

Verificação: `node scripts/governance/provision-closure-anchors.js --check`
(imprime presença/ausência e coerência; **nunca** imprime o valor do segredo).

## Passo 3 — Assinar as provas de fechamento

Para cada item em `VERIFIED`/`RESOLVED`, a prova válida precisa de: teste real com exit 0, SHA atual,
fingerprint do código, livro de transições e assinatura de autoridade com `mayCloseDefects`.

- Os 48 itens que ganharam suíte no backfill já têm `regressionTest` executado e verde.
- Os **11** restantes estão em `FECHAMENTOS-SEM-SUITE-DE-REGRESSAO`: escrever a suíte, reabrir
  (`VERIFIED -> OPEN`) ou aceitar risco declarado. **Não há quarta opção** — e reclassificar sem prova
  é o que a fila proíbe.

Verificação: `npm run validate:bug-closure-status` deve sair de `FECHAMENTO_NAO_PROVADO 157` para 0.

## Passo 4 — Execução autoritativa (o guard libera sozinho)

```
RELEASE_AUTHORITATIVE=1 node scripts/governance/run-release-suites.js
```
Só roda quando o passo 3 passar (hoje recusa com `L2_L3_EXTENSIVO ... FECHAMENTO_SEM_PROVA_VALIDA`).
Produz `reports/release-suite-execution.json`.

## Passo 5 — Testes obrigatórios

```
npm run validate:required-tests
```
Hoje: `NOT_EXECUTED: 68` — todos por ausência do registro do passo 4, não por falta de teste.

## Passo 6 — Waves frescas

```
# depois que o passo 3 liberar o guard QA_WAVES_COMPLETA:
gh workflow run wave-reports.yml --ref dev/engineering-hardening
```
Hoje as três evidências estão com 230 h (limite 168 h) e o gate degrada `VALIDATED -> STALE`.

## Passo 7 — Veredito

```
npm run cert:ladder          # diagnóstico ordenado
npm run validate:governance-enforcement
```
`certificavel=true` exige **zero** `FAIL` e **zero** `BLOCKED`.

---

## Regras que este runbook não permite

- **Não** existe atalho que transforme `BLOCKED` em `PASS`; a escada foi escrita para que isso seja
  impossível por construção (teste `tests/unit/governance/certificationLadder.test.js`).
- **Não** se liga override de política (`QA_WAVES_COMPLETA` continua `certifica: true`).
- **Não** se reutiliza evidência de outro SHA/run: o registro autoritativo é por execução.
- Segredos **nunca** vão para a árvore, para log ou para relatório.
