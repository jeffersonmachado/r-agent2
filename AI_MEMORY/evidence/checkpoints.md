# Checkpoints de desenvolvimento (auditoria incremental)

Registro versionado, um item por commit de desenvolvimento. Cada item traz: branch, SHA de
base, arquivos modificados, testes EXECUTADOS com exit code e hash da saída, e o problema
corrigido. Gerado por `tools/audit/checkpoint.js` — nada escrito à mão.

O commit que carrega um checkpoint é sempre:

```bash
git log -1 --format=%H -- AI_MEMORY/evidence/checkpoints.md
```

O `id` de cada item é o sha256 do bloco registrado (base + arquivos + testes + problema),
portanto o auditor pode recalculá-lo sem confiar neste arquivo.

---

## CKPT f76d90e3c7cd — auditoria: gravador de checkpoint executavel que recusa registrar a partir de teste vermelho

- **Quando**: 2026-10-16T19:20:49.375Z
- **Branch**: `dev/engineering-hardening`
- **SHA de base** (HEAD antes deste commit): `d929f40d333757b375a7541ed47f7bd3bf7e7b33`
- **id** (sha256 do conteúdo do checkpoint): `f76d90e3c7cda84ade7ddbea5f8882e0d5fe2c1ccd27d6cd7d3969bf075792f8`

**Problema corrigido:** nao havia registro verificavel por commit para auditoria incremental externa: faltava SHA de base, lista de arquivos, testes EXECUTADOS com exit code e o problema corrigido; e nada impedia registrar 'verde' com teste vermelho

**Arquivos modificados (estado no momento do checkpoint):**

- `tests/unit/audit/`
- `tools/audit/checkpoint.js`

**Testes executados (saída real, exit code real):**

| comando | exit | duração | sha256 da saída (12) |
|---|---|---|---|
| `npx jest tests/unit/audit/checkpointTool.test.js` | 0 | 3.5 s | b47c7f5b4396 |

<details><summary>últimas linhas — <code>npx jest tests/unit/audit/checkpointTool.test.js</code></summary>

```
    ✓ teste verde => escreve o checkpoint com o commit-base e os testes executados (428 ms)
    ✓ teste VERMELHO => recusa e NÃO escreve nada (impossível fabricar checkpoint verde) (309 ms)
    ✓ misto (um verde e um vermelho) => recusa: basta um vermelho (282 ms)
    ✓ sem --tests => recusa (checkpoint sem teste não é checkpoint) (208 ms)
    ✓ o arquivo de evidência real do repositorio nao e tocado por esta suite (266 ms)
Test Suites: 1 passed, 1 total
Tests:       5 passed, 5 total
Snapshots:   0 total
Time:        1.813 s, estimated 3 s
Ran all test suites matching /tests\/unit\/audit\/checkpointTool.test.js/i.
[jest-global-teardown] Engineering Runner (pid 86213) encerrado (porta liberada)
Force exiting Jest: Have you considered using `--detectOpenHandles` to detect async operations that kept running after all tests finished?
```

</details>

---
## CKPT e1765aa7a620 — auditoria: travas do ponto de entrada (audit:json-persistence PASS + auditEpoch verificavel de forma independente)

- **Quando**: 2026-10-16T19:22:36.949Z
- **Branch**: `dev/engineering-hardening`
- **SHA de base** (HEAD antes deste commit): `f47f3fc5ace11b1f39e83d0ef8b3064e96b82c70`
- **id** (sha256 do conteúdo do checkpoint): `e1765aa7a620ea14a67bb7c52356f19bcf45ef3fc48464c16ec4e00c1bee69c4`

**Problema corrigido:** o ponto de entrada nao tinha teste: nada travava a regressao que reprovou o agg8 (escrita .json fora da taxonomia) e nada provava que o payload embutido no Markdown era extraivel e que o auditEpoch podia ser RECALCULADO por um auditor independente; a dica de extracao citava cerca com a mesma marcacao do payload, quebrando parser ingenuo

**Arquivos modificados (estado no momento do checkpoint):**

- `M AI_MEMORY/evidence/AUDIT_ENTRYPOINT.md`
- `M tools/audit/generate-audit-entrypoint.js`
- `tests/unit/audit/auditEntrypointArtifact.test.js`

**Testes executados (saída real, exit code real):**

| comando | exit | duração | sha256 da saída (12) |
|---|---|---|---|
| `npx jest tests/unit/audit/` | 0 | 6.1 s | 9458a7f32112 |

<details><summary>últimas linhas — <code>npx jest tests/unit/audit/</code></summary>

```
    ✓ teste verde => escreve o checkpoint com o commit-base e os testes executados (494 ms)
    ✓ teste VERMELHO => recusa e NÃO escreve nada (impossível fabricar checkpoint verde) (268 ms)
    ✓ misto (um verde e um vermelho) => recusa: basta um vermelho (313 ms)
    ✓ sem --tests => recusa (checkpoint sem teste não é checkpoint) (204 ms)
    ✓ o arquivo de evidência real do repositorio nao e tocado por esta suite (317 ms)
Test Suites: 2 passed, 2 total
Tests:       9 passed, 9 total
Snapshots:   0 total
Time:        3.145 s, estimated 6 s
Ran all test suites matching /tests\/unit\/audit\//i.
[jest-global-teardown] Engineering Runner (pid 89513) encerrado (porta liberada)
Force exiting Jest: Have you considered using `--detectOpenHandles` to detect async operations that kept running after all tests finished?
```

</details>

---
## CKPT a39ae4670bbf — governanca: protocolo de checkpoint institucionalizado (runbook + ponteiro no AGENTS.md)

- **Quando**: 2026-10-16T19:23:42.203Z
- **Branch**: `dev/engineering-hardening`
- **SHA de base** (HEAD antes deste commit): `3bbf51ac7d7d7b547a4a2ceee40699fac5a94a61`
- **id** (sha256 do conteúdo do checkpoint): `a39ae4670bbf0ce743c041f60c74816d5902a34a5871df20e1ad93db3d019e40`

**Problema corrigido:** a disciplina de checkpoint incremental existia apenas como ferramenta: sem runbook e sem ponteiro nos arquivos que os agentes leem, ela morreria com a sessao e o proximo agente voltaria a commitar sem teste, sem SHA de base e sem registro auditavel

**Arquivos modificados (estado no momento do checkpoint):**

- `M AGENTS.md`
- `AI_MEMORY/operational-checklists/checkpoint-protocol.md`

**Testes executados (saída real, exit code real):**

| comando | exit | duração | sha256 da saída (12) |
|---|---|---|---|
| `npm run validate:agent-adherence` | 0 | 0.3 s | 1348b707e58b |
| `npm run validate:ai-memory` | 0 | 0.4 s | 1b58e3c48c8d |
| `npx jest tests/unit/audit/` | 0 | 8.0 s | 1e5b381d85f5 |

<details><summary>últimas linhas — <code>npm run validate:agent-adherence</code></summary>

```
> chatbot-engine@1.0.0 validate:agent-adherence
> node scripts/governance/validate-agent-adherence.js
```

</details>

<details><summary>últimas linhas — <code>npm run validate:ai-memory</code></summary>

```
> chatbot-engine@1.0.0 validate:ai-memory
> node scripts/governance/validate-ai-memory.js
```

</details>

<details><summary>últimas linhas — <code>npx jest tests/unit/audit/</code></summary>

```
  AUDIT_ENTRYPOINT.md — invariantes do ponto de entrada de auditoria
    ✓ o artefato existe, declara auditEpoch e traz o payload JSON embutido parseável (108 ms)
    ✓ todo proof registrado tem veredito e sha256 — nenhuma linha oca (128 ms)
    ✓ o auditEpoch é RECALCULÁVEL de forma independente a partir do payload (108 ms)
    ✓ audit:json-persistence --check segue PASS (trava da regressão do agg8) (1399 ms)
Test Suites: 2 passed, 2 total
Tests:       9 passed, 9 total
Snapshots:   0 total
Time:        4.798 s
Ran all test suites matching /tests\/unit\/audit\//i.
[jest-global-teardown] Engineering Runner (pid 91076) encerrado (porta liberada)
Force exiting Jest: Have you considered using `--detectOpenHandles` to detect async operations that kept running after all tests finished?
```

</details>

---
## CKPT 563a864596aa — auditoria: inventario executavel das 2497 branches locais (2468 do loop autonomo)

- **Quando**: 2026-10-16T19:25:16.769Z
- **Branch**: `dev/engineering-hardening`
- **SHA de base** (HEAD antes deste commit): `842cc332914a900a7f2f14d3e02bd56c1fdb1c4c`
- **id** (sha256 do conteúdo do checkpoint): `563a864596aa569b1b5c5d0ac5d3b930006612df4b54cecbcef1be2ca5bebf5e`

**Problema corrigido:** o repositorio acumulou 2497 branches locais, 2468 delas da familia engineering/missions criadas pelo loop autonomo do Engineering Router, sem nenhum inventario derivado do estado real: a decisao de podar virava chute e um auditor externo via milhares de branches sem saber o que sao

**Arquivos modificados (estado no momento do checkpoint):**

- `AI_MEMORY/evidence/branch-inventory-2026-10-16.md`
- `tests/unit/audit/branchInventory.test.js`
- `tools/audit/branch-inventory.js`

**Testes executados (saída real, exit code real):**

| comando | exit | duração | sha256 da saída (12) |
|---|---|---|---|
| `npx jest tests/unit/audit/` | 0 | 7.5 s | 27e30b12e44f |
| `node tools/audit/branch-inventory.js` | 0 | 19.9 s | 57c82ee07ffa |

<details><summary>últimas linhas — <code>npx jest tests/unit/audit/</code></summary>

```
  AUDIT_ENTRYPOINT.md — invariantes do ponto de entrada de auditoria
    ✓ o artefato existe, declara auditEpoch e traz o payload JSON embutido parseável (105 ms)
    ✓ todo proof registrado tem veredito e sha256 — nenhuma linha oca (110 ms)
    ✓ o auditEpoch é RECALCULÁVEL de forma independente a partir do payload (106 ms)
    ✓ audit:json-persistence --check segue PASS (trava da regressão do agg8) (880 ms)
Test Suites: 3 passed, 3 total
Tests:       14 passed, 14 total
Snapshots:   0 total
Time:        4.77 s, estimated 7 s
Ran all test suites matching /tests\/unit\/audit\//i.
[jest-global-teardown] Engineering Runner (pid 93829) encerrado (porta liberada)
Force exiting Jest: Have you considered using `--detectOpenHandles` to detect async operations that kept running after all tests finished?
```

</details>

<details><summary>últimas linhas — <code>node tools/audit/branch-inventory.js</code></summary>

```
[branch-inventory] locais=2497 mergeadas=2112 naoMergeadas=385
[branch-inventory] familias=13 (top: engineering/missions=2468, engineering-router/candidates=18, dev/engineering-hardening=1)
[branch-inventory] escrito: AI_MEMORY/evidence/branch-inventory-2026-10-16.md
[branch-inventory] nada foi apagado
```

</details>

---
## CKPT 09ababdcfb19 — governanca: fila oficial com os 3 entregaveis de auditoria (checkpoint, travas, inventario)

- **Quando**: 2026-10-16T19:26:30.542Z
- **Branch**: `dev/engineering-hardening`
- **SHA de base** (HEAD antes deste commit): `58ce559ef3438835222f71e6c92e1175be5b48f0`
- **id** (sha256 do conteúdo do checkpoint): `09ababdcfb19f4c5a724f2765925d6987a5b8a2f6621e5a0a637276f7ccd0cb6`

**Problema corrigido:** os entregaveis de auditoria incremental desta sessao nao existiam na fila oficial, que e a unica fonte de verdade sobre o que foi feito: sem item com commit+evidence, a proxima sessao nao saberia que o gravador de checkpoint, as travas do entrypoint e o inventario de branches existem

**Arquivos modificados (estado no momento do checkpoint):**

- `M AI_MEMORY/evidence/AUDIT_ENTRYPOINT.md`
- `M AI_MEMORY/hardening-queue.json`

**Testes executados (saída real, exit code real):**

| comando | exit | duração | sha256 da saída (12) |
|---|---|---|---|
| `node scripts/governance/validate-hardening-queue.js` | 0 | 0.1 s | e3ba56d8d232 |
| `npx jest tests/unit/audit/` | 0 | 10.6 s | 8aa174eff968 |

<details><summary>últimas linhas — <code>node scripts/governance/validate-hardening-queue.js</code></summary>

```
[hardening-queue] 78 itens — done:51 blocked_external:3 prevention_active:13 verified:7 blocked:4
[hardening-queue] abertos: (nenhum)
[hardening-queue] PASS
```

</details>

<details><summary>últimas linhas — <code>npx jest tests/unit/audit/</code></summary>

```
    ✓ familiaDe agrupa pelos dois primeiros segmentos (105 ms)
    ✓ classificar: só o fixture sandbox => sandbox_only (descartável) (102 ms)
    ✓ classificar: qualquer arquivo fora do fixture => toca_outros (exige revisão) (102 ms)
    ✓ classificar: nenhum arquivo => sem_arquivos (branch vazia em relação a main) (102 ms)
    ✓ o fixture é o artefato do sandbox do Engineering Router — não um arquivo de produto (101 ms)
Test Suites: 3 passed, 3 total
Tests:       14 passed, 14 total
Snapshots:   0 total
Time:        5.228 s
Ran all test suites matching /tests\/unit\/audit\//i.
[jest-global-teardown] Engineering Runner (pid 96840) encerrado (porta liberada)
Force exiting Jest: Have you considered using `--detectOpenHandles` to detect async operations that kept running after all tests finished?
```

</details>

---
## CKPT 89ce1f33eb54 — governanca: validacao obrigatoria verde no branch de desenvolvimento (agregado exit 0 em 6221b7cca)

- **Quando**: 2026-10-16T19:47:32.753Z
- **Branch**: `dev/engineering-hardening`
- **SHA de base** (HEAD antes deste commit): `6221b7cca3554d3de616f2a0ad8044f12d1c80b4`
- **id** (sha256 do conteúdo do checkpoint): `89ce1f33eb545d5dd73411ba8713dc397bf951488e382b73977c2f5c0a3d3048`

**Problema corrigido:** a validacao obrigatoria do PR nao tinha sido medida no HEAD do branch de desenvolvimento: sem ela nao se pode afirmar que o agente entregou codigo validado, e o veredito do agregado nao e persistido pelo proprio alias em relatorio proprio

**Arquivos modificados (estado no momento do checkpoint):**

- `M AI_MEMORY/evidence/AUDIT_ENTRYPOINT.md`

**Testes executados (saída real, exit code real):**

| comando | exit | duração | sha256 da saída (12) |
|---|---|---|---|
| `npx jest tests/unit/audit/` | 0 | 6.3 s | 7bed1949065d |
| `node scripts/governance/validate-hardening-queue.js` | 0 | 0.1 s | e3ba56d8d232 |

<details><summary>últimas linhas — <code>npx jest tests/unit/audit/</code></summary>

```
    ✓ familiaDe agrupa pelos dois primeiros segmentos (102 ms)
    ✓ classificar: só o fixture sandbox => sandbox_only (descartável) (101 ms)
    ✓ classificar: qualquer arquivo fora do fixture => toca_outros (exige revisão) (104 ms)
    ✓ classificar: nenhum arquivo => sem_arquivos (branch vazia em relação a main) (102 ms)
    ✓ o fixture é o artefato do sandbox do Engineering Router — não um arquivo de produto (103 ms)
Test Suites: 3 passed, 3 total
Tests:       14 passed, 14 total
Snapshots:   0 total
Time:        3.982 s, estimated 6 s
Ran all test suites matching /tests\/unit\/audit\//i.
[jest-global-teardown] Engineering Runner (pid 163369) encerrado (porta liberada)
Force exiting Jest: Have you considered using `--detectOpenHandles` to detect async operations that kept running after all tests finished?
```

</details>

<details><summary>últimas linhas — <code>node scripts/governance/validate-hardening-queue.js</code></summary>

```
[hardening-queue] 78 itens — done:51 blocked_external:3 prevention_active:13 verified:7 blocked:4
[hardening-queue] abertos: (nenhum)
[hardening-queue] PASS
```

</details>

---
## CKPT 8dca002650cc — fix(audit): teste nao regrava mais artefato governado + registro dos 2 achados P0/P1 da FASE B

- **Quando**: 2026-10-16T19:50:45.067Z
- **Branch**: `dev/engineering-hardening`
- **SHA de base** (HEAD antes deste commit): `60558fba49c898c9a8acbe540efc712101a6b5c5`
- **id** (sha256 do conteúdo do checkpoint): `8dca002650cc07425d46302abf6c9cedf1bb97589dddc95d26c4d2d2e8528041`

**Problema corrigido:** meu teste de unidade chamava json-persistence-audit.js --check, que grava governance/json-persistence-audit.json incondicionalmente; isso invalidou a integridade temporal do run governado (INVALID_AUTHORITATIVE_ARTIFACT). A FASE B tambem revelou que validate-governance-chain nao esta no agregado e que a cadeia so pode estar valida logo apos a certificacao, porque o proprio agregado regrava artefato coberto por ela

**Arquivos modificados (estado no momento do checkpoint):**

- `M AI_MEMORY/evidence/AUDIT_ENTRYPOINT.md`
- `M AI_MEMORY/hardening-queue.json`
- `M tests/unit/audit/auditEntrypointArtifact.test.js`

**Testes executados (saída real, exit code real):**

| comando | exit | duração | sha256 da saída (12) |
|---|---|---|---|
| `npx jest tests/unit/audit/` | 0 | 6.2 s | aa533090543e |
| `node scripts/governance/validate-hardening-queue.js` | 0 | 0.2 s | 87446097870f |

<details><summary>últimas linhas — <code>npx jest tests/unit/audit/</code></summary>

```
    ✓ familiaDe agrupa pelos dois primeiros segmentos (103 ms)
    ✓ classificar: só o fixture sandbox => sandbox_only (descartável) (103 ms)
    ✓ classificar: qualquer arquivo fora do fixture => toca_outros (exige revisão) (103 ms)
    ✓ classificar: nenhum arquivo => sem_arquivos (branch vazia em relação a main) (103 ms)
    ✓ o fixture é o artefato do sandbox do Engineering Router — não um arquivo de produto (103 ms)
Test Suites: 3 passed, 3 total
Tests:       14 passed, 14 total
Snapshots:   0 total
Time:        3.774 s, estimated 5 s
Ran all test suites matching /tests\/unit\/audit\//i.
[jest-global-teardown] Engineering Runner (pid 168133) encerrado (porta liberada)
Force exiting Jest: Have you considered using `--detectOpenHandles` to detect async operations that kept running after all tests finished?
```

</details>

<details><summary>últimas linhas — <code>node scripts/governance/validate-hardening-queue.js</code></summary>

```
[hardening-queue] 81 itens — done:52 blocked_external:3 prevention_active:13 verified:7 blocked:6
[hardening-queue] abertos: (nenhum)
[hardening-queue] PASS
```

</details>

---
## CKPT 7e30ad90b9a2 — auditoria: relatorio da FASE A/B persistido (914 testes executados, 2 achados reais abertos)

- **Quando**: 2026-10-16T19:56:09.233Z
- **Branch**: `dev/engineering-hardening`
- **SHA de base** (HEAD antes deste commit): `5e4f7408bceb1cba20e16923fa0a5dd6bf52d76f`
- **id** (sha256 do conteúdo do checkpoint): `7e30ad90b9a291d72c05d95b2b0f61a974fc590613fd222fa4133a454fa89df7`

**Problema corrigido:** a auditoria profunda exigida pela missao nao tinha artefato versionado: os resultados de 914 testes executados em 8 comandos, o inventario da branch e os 2 achados reais (cadeia criptografica fora do agregado e escrita fantasma no inventario de persistencia) existiam apenas na conversa

**Arquivos modificados (estado no momento do checkpoint):**

- `M AI_MEMORY/evidence/AUDIT_ENTRYPOINT.md`
- `AI_MEMORY/evidence/auditoria-fase-b-2026-10-16.md`

**Testes executados (saída real, exit code real):**

| comando | exit | duração | sha256 da saída (12) |
|---|---|---|---|
| `npx jest tests/unit/audit/` | 0 | 8.4 s | bdefa430ca8e |
| `node scripts/governance/validate-hardening-queue.js` | 0 | 0.1 s | 87446097870f |

<details><summary>últimas linhas — <code>npx jest tests/unit/audit/</code></summary>

```
  AUDIT_ENTRYPOINT.md — invariantes do ponto de entrada de auditoria
    ✓ o artefato existe, declara auditEpoch e traz o payload JSON embutido parseável (105 ms)
    ✓ todo proof registrado tem veredito e sha256 — nenhuma linha oca (110 ms)
    ✓ o auditEpoch é RECALCULÁVEL de forma independente a partir do payload (112 ms)
    ✓ audit:json-persistence está PASS e sem alvos UNKNOWN (trava da regressão do agg8) (108 ms)
Test Suites: 3 passed, 3 total
Tests:       14 passed, 14 total
Snapshots:   0 total
Time:        3.69 s, estimated 4 s
Ran all test suites matching /tests\/unit\/audit\//i.
[jest-global-teardown] Engineering Runner (pid 177206) encerrado (porta liberada)
Force exiting Jest: Have you considered using `--detectOpenHandles` to detect async operations that kept running after all tests finished?
```

</details>

<details><summary>últimas linhas — <code>node scripts/governance/validate-hardening-queue.js</code></summary>

```
[hardening-queue] 81 itens — done:52 blocked_external:3 prevention_active:13 verified:7 blocked:6
[hardening-queue] abertos: (nenhum)
[hardening-queue] PASS
```

</details>

---
## CKPT 400faf39548c — audit(cadeia): estado da cadeia criptografica derivado e classificado por elo (corrige analise exagerada do A2)

- **Quando**: 2026-10-16T20:17:27.073Z
- **Branch**: `dev/engineering-hardening`
- **SHA de base** (HEAD antes deste commit): `107b1b540161573eb42e3a9a08d8145f17a8142d`
- **id** (sha256 do conteúdo do checkpoint): `400faf39548c3a4b2089735ce83b56e07510306480cb49624f100167b0951067`

**Problema corrigido:** o A2 foi reportado como P0 de integridade aberto, mas a leitura do pipeline mostrou que o seal ja reconstroi/assina e verifica a cadeia bloqueantemente na fase certify; o residual real e que o agregado nao expoe o estado da cadeia e que a divergencia se confunde com adulteracao. Sem classificacao por elo, hash_mismatch em relatorio derivado vira ruido indistinguivel de adulteracao do artefato certificado

**Arquivos modificados (estado no momento do checkpoint):**

- `M AI_MEMORY/evidence/AUDIT_ENTRYPOINT.md`
- `M AI_MEMORY/evidence/auditoria-fase-b-2026-10-16.md`
- `M AI_MEMORY/hardening-queue.json`
- `M tests/unit/audit/auditEntrypointArtifact.test.js`
- `M tools/audit/generate-audit-entrypoint.js`

**Testes executados (saída real, exit code real):**

| comando | exit | duração | sha256 da saída (12) |
|---|---|---|---|
| `npx jest tests/unit/audit/` | 0 | 5.3 s | 789fc1357492 |
| `node scripts/governance/validate-hardening-queue.js` | 0 | 0.1 s | 8a9302160c17 |

<details><summary>últimas linhas — <code>npx jest tests/unit/audit/</code></summary>

```
    ✓ familiaDe agrupa pelos dois primeiros segmentos (108 ms)
    ✓ classificar: só o fixture sandbox => sandbox_only (descartável) (103 ms)
    ✓ classificar: qualquer arquivo fora do fixture => toca_outros (exige revisão) (101 ms)
    ✓ classificar: nenhum arquivo => sem_arquivos (branch vazia em relação a main) (102 ms)
    ✓ o fixture é o artefato do sandbox do Engineering Router — não um arquivo de produto (102 ms)
Test Suites: 3 passed, 3 total
Tests:       15 passed, 15 total
Snapshots:   0 total
Time:        3 s, estimated 4 s
Ran all test suites matching /tests\/unit\/audit\//i.
[jest-global-teardown] Engineering Runner (pid 203610) encerrado (porta liberada)
Force exiting Jest: Have you considered using `--detectOpenHandles` to detect async operations that kept running after all tests finished?
```

</details>

<details><summary>últimas linhas — <code>node scripts/governance/validate-hardening-queue.js</code></summary>

```
[hardening-queue] 81 itens — done:53 blocked_external:3 prevention_active:13 verified:7 blocked:5
[hardening-queue] abertos: (nenhum)
[hardening-queue] PASS
```

</details>

---
## CKPT b7dd1f078ac3 — P0: elimina falso GO com NOT_EXECUTED/UNKNOWN e exige identidade PRESENTE para certificar

- **Quando**: 2026-10-16T23:28:42.918Z
- **Branch**: `dev/engineering-hardening`
- **SHA de base** (HEAD antes deste commit): `39604807541b1c4c4c54880359d440f90982b0a9`
- **id** (sha256 do conteúdo do checkpoint): `b7dd1f078ac36adbf7f82f89b52d6a816dbf8250f751cf98f5ac6726c289588b`

**Problema corrigido:** reproduzido: clasificar() usava lista de BLOQUEIO, entao gate NOT_EXECUTED/UNKNOWN/SKIPPED/BLOCKED_EXTERNAL/WAT caiam no return CERTIFIED_GO (6 casos medidos); identidadeCoerente() pulava campo ausente e devolvia ok=true, ou seja ausencia de identidade valia como identidade (4 casos medidos, incluindo .current-run.json ausente aprovando tudo no avaliador); e o avaliador confiava no campo chain.valid GRAVADO em vez de recalcular a cadeia

**Arquivos modificados (estado no momento do checkpoint):**

- `M governance/canonical-release-decision.js`
- `M scripts/governance/assert-canonical-release-decision.js`
- `M tests/unit/governance/assertCanonicalReleaseDecision.test.js`
- `M tests/unit/governance/canonicalReleaseDecision.test.js`

**Testes executados (saída real, exit code real):**

| comando | exit | duração | sha256 da saída (12) |
|---|---|---|---|
| `npx jest tests/unit/governance/canonicalReleaseDecision.test.js tests/unit/governance/assertCanonicalReleaseDecision.test.js` | 0 | 9.1 s | 28cb12019a74 |

<details><summary>últimas linhas — <code>npx jest tests/unit/governance/canonicalReleaseDecision.test.js tests/unit/governance/assertCanonicalReleaseDecision.test.js</code></summary>

```
    ✓ runId AUSENTE no run corrente ⇒ BLOQUEIA com o campo nomeado (105 ms)
    ✓ sourceFingerprint com formato inválido ⇒ BLOQUEIA como inválido (não como ausente) (106 ms)
    ✓ relatório SEM identidade (mas run completo) ⇒ BLOQUEIA por relatório incompleto (104 ms)
    ✓ identidade divergente do run ⇒ NÃO é GO definitivo, com o campo nomeado (105 ms)
    ✓ o estado devolvido é sempre do vocabulário canônico (113 ms)
Test Suites: 2 passed, 2 total
Tests:       61 passed, 61 total
Snapshots:   0 total
Time:        6.943 s, estimated 7 s
Ran all test suites matching /tests\/unit\/governance\/canonicalReleaseDecision.test.js|tests\/unit\/governance\/assertCanonicalReleaseDecision.test.js/i.
[jest-global-teardown] Engineering Runner (pid 432578) encerrado (porta liberada)
Force exiting Jest: Have you considered using `--detectOpenHandles` to detect async operations that kept running after all tests finished?
```

</details>

---
## CKPT 67ec634fdd5a — memory(P0): causa-raiz e prevencao dos 4 padroes de falso GO registradas na fila oficial

- **Quando**: 2026-10-16T23:29:37.460Z
- **Branch**: `dev/engineering-hardening`
- **SHA de base** (HEAD antes deste commit): `494f802b4986f598f7d4737db003f444e067895b`
- **id** (sha256 do conteúdo do checkpoint): `67ec634fdd5a0f8c0daf385667742be2287daef319f9ef232aaa40aa23de6a6d`

**Problema corrigido:** as correcoes dos P0 nao estavam registradas como causa-raiz + prevencao na Engineering Memory, que e a unica fonte de verdade sobre o que foi corrigido: sem isso a proxima sessao repete os mesmos padroes (lista de bloqueio, ausencia lida como coerencia, campo valid gravado como autoridade, state discordando do veredito)

**Arquivos modificados (estado no momento do checkpoint):**

- `M AI_MEMORY/hardening-queue.json`

**Testes executados (saída real, exit code real):**

| comando | exit | duração | sha256 da saída (12) |
|---|---|---|---|
| `node scripts/governance/validate-hardening-queue.js` | 0 | 0.0 s | 4ca0753a5eff |
| `npx jest tests/unit/governance/canonicalReleaseDecision.test.js tests/unit/governance/assertCanonicalReleaseDecision.test.js` | 0 | 8.5 s | b2711c41dcda |

<details><summary>últimas linhas — <code>node scripts/governance/validate-hardening-queue.js</code></summary>

```
[hardening-queue] 85 itens — done:53 blocked_external:3 prevention_active:13 verified:11 blocked:5
[hardening-queue] abertos: (nenhum)
[hardening-queue] PASS
```

</details>

<details><summary>últimas linhas — <code>npx jest tests/unit/governance/canonicalReleaseDecision.test.js tests/unit/governance/assertCanonicalReleaseDecision.test.js</code></summary>

```
    ✓ runId AUSENTE no run corrente ⇒ BLOQUEIA com o campo nomeado (102 ms)
    ✓ sourceFingerprint com formato inválido ⇒ BLOQUEIA como inválido (não como ausente) (102 ms)
    ✓ relatório SEM identidade (mas run completo) ⇒ BLOQUEIA por relatório incompleto (103 ms)
    ✓ identidade divergente do run ⇒ NÃO é GO definitivo, com o campo nomeado (103 ms)
    ✓ o estado devolvido é sempre do vocabulário canônico (105 ms)
Test Suites: 2 passed, 2 total
Tests:       61 passed, 61 total
Snapshots:   0 total
Time:        6.714 s, estimated 7 s
Ran all test suites matching /tests\/unit\/governance\/canonicalReleaseDecision.test.js|tests\/unit\/governance\/assertCanonicalReleaseDecision.test.js/i.
[jest-global-teardown] Engineering Runner (pid 434166) encerrado (porta liberada)
Force exiting Jest: Have you considered using `--detectOpenHandles` to detect async operations that kept running after all tests finished?
```

</details>

---
## CKPT 072914193103 — P1: entrega verificada por juiz fail-closed (exit code + resultado estruturado) e fim do push no-op para main

- **Quando**: 2026-10-16T23:49:29.796Z
- **Branch**: `dev/engineering-hardening`
- **SHA de base** (HEAD antes deste commit): `77d337449a02b5426eaafb3e281b082798c2fc8d`
- **id** (sha256 do conteúdo do checkpoint): `072914193103a5047b8ef8356974a694a9f0f8cf22e07ad183cefd30be2b9b14`

**Problema corrigido:** a fase verify-delivery do selo descartava o EXIT CODE do verificador e decidia por grep de texto positivo, alem de aceitar DELIVERED_PENDING_SCORECARD (estado PRE-pacote); e commit_and_push fazia 'git push origin main' incondicional, que com o selo fora da main empurrava uma ref parada e imprimia 'push ok' sem publicar o commit da branch em uso (7 commits chore(governanca) ficaram so locais)

**Arquivos modificados (estado no momento do checkpoint):**

- `M scripts/governance/seal-release.sh`
- `scripts/governance/lib/delivery-verification.js`
- `scripts/governance/verify-delivery-strict.js`
- `tests/unit/governance/deliveryVerification.test.js`

**Testes executados (saída real, exit code real):**

| comando | exit | duração | sha256 da saída (12) |
|---|---|---|---|
| `npx jest tests/unit/governance/deliveryVerification.test.js` | 0 | 3.9 s | 5fcdb7a2962f |

<details><summary>últimas linhas — <code>npx jest tests/unit/governance/deliveryVerification.test.js</code></summary>

```
    ✓ cadeia adulterada ⇒ BLOQUEIA (103 ms)
    ✓ cadeia não verificada ⇒ BLOQUEIA (não aprovar sem integridade) (103 ms)
    ✓ gate bloqueante no relatório ⇒ BLOQUEIA (só PASS avança) (111 ms)
    ✓ gate ilegível ⇒ BLOQUEIA (100 ms)
    ✓ relatório sem gates declarados ⇒ BLOQUEIA (100 ms)
Test Suites: 1 passed, 1 total
Tests:       17 passed, 17 total
Snapshots:   0 total
Time:        1.989 s, estimated 2 s
Ran all test suites matching /tests\/unit\/governance\/deliveryVerification.test.js/i.
[jest-global-teardown] Engineering Runner (pid 460973) encerrado (porta liberada)
Force exiting Jest: Have you considered using `--detectOpenHandles` to detect async operations that kept running after all tests finished?
```

</details>

---
## CKPT 208ae7ed3c5f — memory(FASE 5): causa-raiz e prevencao da entrega por grep e do push no-op para main

- **Quando**: 2026-10-16T23:50:17.227Z
- **Branch**: `dev/engineering-hardening`
- **SHA de base** (HEAD antes deste commit): `c99ccd551f83b3a070c4d76af26c4c229aa1c7fa`
- **id** (sha256 do conteúdo do checkpoint): `208ae7ed3c5f16ec9a9143ac6931cc2f1654e6fe1610faf573f6be813eaa095c`

**Problema corrigido:** os dois defeitos de verificacao de entrega (exit descartado + grep como autoridade; push para ref fixa com 'push ok' falso) nao estavam registrados com causa-raiz e prevencao na Engineering Memory, unica fonte de verdade sobre o que foi corrigido

**Arquivos modificados (estado no momento do checkpoint):**

- `M AI_MEMORY/evidence/AUDIT_ENTRYPOINT.md`
- `M AI_MEMORY/hardening-queue.json`

**Testes executados (saída real, exit code real):**

| comando | exit | duração | sha256 da saída (12) |
|---|---|---|---|
| `node scripts/governance/validate-hardening-queue.js` | 0 | 0.0 s | a6d43bbd4e50 |
| `npx jest tests/unit/governance/deliveryVerification.test.js` | 0 | 4.6 s | 7acde2edfa5c |

<details><summary>últimas linhas — <code>node scripts/governance/validate-hardening-queue.js</code></summary>

```
[hardening-queue] 87 itens — done:53 blocked_external:3 prevention_active:13 verified:13 blocked:5
[hardening-queue] abertos: (nenhum)
[hardening-queue] PASS
```

</details>

<details><summary>últimas linhas — <code>npx jest tests/unit/governance/deliveryVerification.test.js</code></summary>

```
    ✓ cadeia adulterada ⇒ BLOQUEIA (104 ms)
    ✓ cadeia não verificada ⇒ BLOQUEIA (não aprovar sem integridade) (102 ms)
    ✓ gate bloqueante no relatório ⇒ BLOQUEIA (só PASS avança) (102 ms)
    ✓ gate ilegível ⇒ BLOQUEIA (101 ms)
    ✓ relatório sem gates declarados ⇒ BLOQUEIA (102 ms)
Test Suites: 1 passed, 1 total
Tests:       17 passed, 17 total
Snapshots:   0 total
Time:        2.186 s
Ran all test suites matching /tests\/unit\/governance\/deliveryVerification.test.js/i.
[jest-global-teardown] Engineering Runner (pid 462478) encerrado (porta liberada)
Force exiting Jest: Have you considered using `--detectOpenHandles` to detect async operations that kept running after all tests finished?
```

</details>

---
