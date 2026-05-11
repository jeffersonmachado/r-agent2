# Próximas ações (plano incremental de melhorias de QA)

Objetivo: fortalecer QA com **mudanças pequenas**, **verificáveis** e **reversíveis**, sem reestruturar o projeto inteiro.

## Fase 1 (1 PR) — Cobrir “buracos” no CI sem mexer na lógica atual

### 1) Rodar testes do frontend no CI

- **Mudança mínima**: adicionar um job dedicado no GitHub Actions para `cd frontend && npm ci && npm test`.
- **Artefatos**:
  - publicar `frontend/test-results/junit.xml`
  - (opcional) publicar `frontend/coverage/` quando rodar com `--coverage`
- **Critério de aceitação**:
  - PR que quebra testes do frontend falha no CI
  - artifact JUnit disponível para download

### 2) Rodar testes do RAG service no CI

- **Mudança mínima**: adicionar job `setup-python` + `pip install -r rag-service/requirements.txt` + `pytest`.
- **Artefatos**:
  - publicar `rag-service/htmlcov/`
  - (opcional) publicar `--junitxml=rag-service/test-results/junit.xml`
- **Critério de aceitação**:
  - PR que quebra endpoints/testes do RAG falha no CI
  - artifacts disponíveis (coverage/JUnit)

## Fase 2 (1 PR) — Alinhar o que é “gate” de validação

### 3) Decidir o papel de `system:validate` vs `test:system`

Hoje:
- `system:validate` = contratos + `unit + flow + stress + rpa`
- `test:system` = contratos/governança/anti-bypass/runtime/organizacional/rate-limit

Opções (escolher uma):
- **A) “Oficial = tudo”**: `system:validate` também roda `npm run test:system`
  - Pro: um único comando realmente “completo”
  - Contra: pode aumentar tempo do CI
- **B) “Oficial = smoke + E2E” e “Sistêmico = gate separado”**: manter como está e adicionar um job `npm run test:system` no CI
  - Pro: clareza e paralelismo
  - Contra: ainda são dois “gates” diferentes

Critério de aceitação:
- documentação e CI deixam explícito quais suites são bloqueantes

## Fase 3 (1–2 PRs) — Lint/format com adoção gradual

### 4) JavaScript/Node: ESLint + Prettier (ou equivalente)

- **Mudança mínima**:
  - adicionar dependências e configuração base
  - criar scripts novos no package raiz: `lint`, `format`, `format:check`
  - rodar no CI como job separado
- **Adoção gradual**:
  - começar com regras leves + `--max-warnings=0` só quando a base estiver limpa
- **Estado atual**:
  - o `package.json` raiz ainda nao expoe `lint`, `format` ou `format:check`
  - os gates existentes hoje sao baseados em testes e validacoes como `npm run test`, `npm run test:system`, `npm run frontend:test`, `npm run qa` e `npm run system:validate`

### 5) Python: ruff (lint/format) e (opcional) mypy

- **Mudança mínima**:
  - adicionar `ruff` como dev dependency (ou `requirements-dev.txt`)
  - rodar `ruff check` e `ruff format --check` no CI

## Fase 4 — Cobertura e qualidade “com meta”

### 6) Publicar e/ou impor cobertura por threshold

- Começar publicando cobertura como artifact (sem falhar build).
- Depois impor thresholds em módulos críticos (engine/core, auth/rbac), com metas explícitas.

## Fase 5 — Feedback mais rápido no dev local (opcional)

### 7) Pre-commit hooks (Husky / pre-commit)

- Começar criando `format:check` e `lint` no package raiz; ate la, limitar os hooks a validacoes que ja existem de fato, como JSON/schema e checks leves de shell.
- Manter hooks rápidos (segundos), deixar suites pesadas só no CI.

