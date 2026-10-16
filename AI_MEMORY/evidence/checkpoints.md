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
