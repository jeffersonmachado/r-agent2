# Gaps de QA (prioridade e impacto)

Este documento lista lacunas (“gaps”) observadas entre **o que existe** e **o que normalmente se espera** de uma esteira de QA consistente (local + CI).

## Gaps prioritários (alto impacto)

- **Frontend (Vitest) não roda no CI principal**
  - **Estado atual**: existe suite Vitest e JUnit (`frontend/test-results/junit.xml`), mas os workflows principais rodam `npm run system:validate` (Node/Jest + RPA) e não executam `cd frontend && npm test`.
  - **Impacto**: regressões de UI/estado/hooks podem passar sem alerta em PR (principalmente quando a mudança é só no `frontend/`).

- **RAG service (Pytest) não roda nos workflows**
  - **Estado atual**: `rag-service/tests/` + `pytest.ini` + `pytest-cov`, porém nenhum workflow executa `pytest`.
  - **Impacto**: regressões no serviço de RAG (endpoints, aprendizado adaptativo, etc.) não são bloqueadas por CI.

- **“Validação oficial” vs. “testes sistêmicos” não estão acoplados**
  - **Estado atual**: `system:validate` roda `unit + flow + stress + rpa`, mas não roda `npm run test:system` (contratos/governança/anti-bypass/runtime/organizacional/rate-limit).
  - **Impacto**: o CI pode ficar “verde” mesmo que invariantes sistêmicas falhem, dependendo de quais suites estão sendo consideradas como gate.

## Gaps de qualidade de código (médio/alto impacto)

- **Lint/format/typecheck ausentes**
  - **Estado atual**: não vi ESLint/Prettier no root nem ruff/black/mypy no Python; o workflow `code-quality.yml` faz checks superficiais.
  - **Impacto**: inconsistência de estilo, bugs simples (ex.: variáveis não usadas), e degradação incremental da base sem feedback rápido.

- **Workflow de “code quality” é não-bloqueante**
  - **Estado atual**: `continue-on-error: true` em passos críticos (syntax check, JSON check, `npm audit`).
  - **Impacto**: problemas detectados não impedem merge; vira só “informativo”.

## Gaps de observabilidade/artefatos (médio impacto)

- **Artefatos de teste não padronizados no CI**
  - **Estado atual**: RPA publica artifacts; frontend gera JUnit localmente, mas não é publicado; RAG gera `htmlcov/` localmente, mas não é publicado.
  - **Impacto**: debugging em CI fica mais lento (sem JUnit/coverage centralizados).

- **Cobertura sem enforcement por threshold**
  - **Estado atual**: existem análises/relatórios (ex.: `ANALISE_COBERTURA_TESTES.md`), porém não vi gates por percentual mínimo.
  - **Impacto**: cobertura pode cair ao longo do tempo sem percepção.

## Gaps de ergonomia (baixo/médio impacto)

- **Sem hooks de pre-commit**
  - **Estado atual**: não há `.husky/` nem `.pre-commit-config.yaml`.
  - **Impacto**: feedback só chega no CI; ciclos mais lentos.

