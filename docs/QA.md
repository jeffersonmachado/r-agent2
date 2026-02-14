# QA no Projeto (visão consolidada)

Este documento consolida **o que existe hoje** de QA no repositório: **testes**, **validações**, **pipelines**, **artefatos** e **como rodar localmente**.

## Comando oficial (canônico)

- **Validação oficial do sistema**: `npm run system:validate`
  - Implementação: [`tools/system/validate.js`](tools/system/validate.js)
  - **Etapa 1**: valida contratos (existência + JSON parse)
    - `contracts/generation.interface.json`
    - `contracts/qa/qa.contract.json`
  - **Etapa 2**: executa QA em ordem fixa:
    - `npm run test:unit`
    - `npm run test:flow`
    - `npm run test:stress`
    - `npm run test:rpa`

## Testes Node.js (Jest) — engine/api/tests/qa/lib

- **Config principal**: [`jest.config.cjs`](jest.config.cjs)
  - `testTimeout: 10000`, `bail: 1`, `setupFilesAfterEnv: tests/setup.js`
  - `roots`: `engine/`, `api/`, `tests/`, `qa/`, `lib/`

- **Comandos principais** (scripts em [`package.json`](package.json)):
  - **Unit**: `npm run test:unit` → `tests/unit`
  - **Flow (validação estrutural)**: `npm run test:flow` → `tests/flow`
  - **Stress**: `npm run test:stress` → `tests/stress`
  - **Rate limit**: `npm run test:rate-limit` → `tests/rate-limit`
  - **Sistêmicos (contratos/governança/anti-bypass/runtime/organizacional/stress/rate-limit)**: `npm run test:system`
  - **Tudo (Jest)**: `npm run test:all`

- **Documentação de testes determinísticos**: [`tests/README.md`](tests/README.md)
- **Guia de testes sistêmicos**: [`tests/TESTES_SISTEMICOS.md`](tests/TESTES_SISTEMICOS.md)

## RPA/E2E (Playwright + harness próprio)

- **Execução padrão**: `npm run test:rpa`
  - Script: `node tools/rpa/run-all.js` (ver [`package.json`](package.json))
- **Suite (Jest)**: `npm run test:rpa:jest` → `jest tests/rpa`
- **Código**: [`tests/rpa/`](tests/rpa/)
- **Artefatos**:
  - `tests/rpa/reports/` (relatórios JSON)
  - `tests/rpa/replay/` (replays)
  - `tests/rpa/screenshots/` (screenshots em falha)

## QA incremental por impacto (gates por escopo)

- **Runner**: [`qa/qaRunner.js`](qa/qaRunner.js)
  - Detecta arquivos alterados via `git diff` e usa `impact-map.json` para decidir escopos.
  - Executa checks por escopo (ex.: contracts/prompts/wrappers) e gera `qa/qa-result.json`.
  - Observação: isso é **diferente** do `system:validate` (que executa bateria fixa).

## Frontend (React/Vite/Vitest)

- **Execução**: `cd frontend && npm test`
- **Config**: [`frontend/vitest.config.mjs`](frontend/vitest.config.mjs)
  - Ambiente: `happy-dom`
  - Reporters: `verbose` e `junit`
  - **JUnit**: `frontend/test-results/junit.xml`
  - Coverage (quando rodar com `--coverage`): provider v8, reporters text/json/html

## RAG service (Python/FastAPI/Pytest)

- **Dependências**: [`rag-service/requirements.txt`](rag-service/requirements.txt)
- **Config do pytest**: [`rag-service/pytest.ini`](rag-service/pytest.ini)
- **Execução**:

```bash
cd rag-service
pip install -r requirements.txt
pytest
```

- **Coverage HTML** (config padrão do `pytest.ini`): `rag-service/htmlcov/`
- **Docs**: `rag-service/tests/README.md` e [`docs/COMO_TESTAR_RAG.md`](docs/COMO_TESTAR_RAG.md)

## CI/CD: onde QA roda e quais artefatos saem

- **CI principal**: [`.github/workflows/ci.yml`](.github/workflows/ci.yml)
  - Instala deps, instala Playwright, sobe o Vite e roda `npm run system:validate`.
  - Upload: `tests/rpa/reports/` como artifact.

- **Pipeline completo**: [`.github/workflows/full-pipeline.yml`](.github/workflows/full-pipeline.yml)
  - Mesma estratégia do CI (validação oficial) + build do frontend.
  - Upload: artifacts RPA (reports/replay/screenshots) e build `frontend/dist`.

- **RPA dedicado**: [`.github/workflows/rpa-ci.yml`](.github/workflows/rpa-ci.yml)
  - Executa seeds via `node tests/rpa/cli.js ci <seed>` e publica replay/screenshots.

- **Code quality (sanity checks)**: [`.github/workflows/code-quality.yml`](.github/workflows/code-quality.yml)
  - `node --check` em `.js`, valida JSON e `npm audit`.
  - Observação: jobs estão com `continue-on-error: true` (não bloqueante).

Para o detalhamento workflow-a-workflow (jobs, comandos e artefatos), veja [`docs/QA_CI.md`](docs/QA_CI.md).

Gaps priorizados e impacto: [`docs/QA_GAPS.md`](docs/QA_GAPS.md).

Plano incremental de melhorias (opcional): [`docs/QA_NEXT_ACTIONS.md`](docs/QA_NEXT_ACTIONS.md).

## Como rodar localmente (checklist curto)

```bash
# do root
npm ci
npx playwright install chromium --with-deps

# validação oficial (contratos + unit + flow + stress + rpa)
npm run system:validate

# testes sistêmicos (opcional, mas recomendado)
npm run test:system

# frontend unit tests
cd frontend && npm ci && npm test

# rag service
cd rag-service && pip install -r requirements.txt && pytest
```

## Notas e artefatos de auditoria

- Cobertura e lacunas mapeadas: [`ANALISE_COBERTURA_TESTES.md`](ANALISE_COBERTURA_TESTES.md)
- Pós-teste e evidências organizadas: [`qa/POS_TESTE_COMPLETO.md`](qa/POS_TESTE_COMPLETO.md)

