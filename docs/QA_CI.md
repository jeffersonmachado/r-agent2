# QA no CI/CD (workflows e artefatos)

Este documento detalha **o que roda em cada workflow** e **quais artefatos** são publicados.

## Visão geral (tabela rápida)

| Workflow | Arquivo | Quando roda | O que valida/testa | Artefatos |
|---|---|---|---|---|
| CI principal | `.github/workflows/ci.yml` | Push/PR em `main`/`develop` | `npm run system:validate` (contratos + `test:unit` + `test:flow` + `test:stress` + `test:rpa`) | `tests/rpa/reports/` |
| Pipeline completo | `.github/workflows/full-pipeline.yml` | Push/PR em `main` + manual | Mesmo `system:validate` + build do frontend | `tests/rpa/{reports,replay,screenshots}` + `frontend/dist` |
| Code quality | `.github/workflows/code-quality.yml` | Push/PR + manual | `node --check` em `.js`, valida JSON, `npm audit` | Não publica artifacts |
| RPA E2E (dedicado) | `.github/workflows/rpa-ci.yml` | Mudanças em `tests/rpa/**` + manual | Seeds via `node tests/rpa/cli.js ci <seed>` | `tests/rpa/replay/*.json`, `tests/rpa/screenshots/*.png` |
| RPA seed plataforma | `.github/workflows/rpa-seed.yml` | Manual + schedule + push (paths) | `node tests/rpa/seedPlatformRPA.js` (seed) | `tests/rpa/reports/*.json`, `tests/rpa/screenshots/*.png`, `tests/rpa/replay/*.json` |
| Deploy (com gate de QA) | `.github/workflows/deploy.yml` | Push em `main`/tags + manual | `system:validate` + `frontend build` antes de build Docker | Não publica artifacts de testes |
| Notificações | `.github/workflows/notify.yml` | `workflow_run` (falha) | Notifica (Slack/email placeholders) | N/A |

## Detalhe por workflow

### CI principal — `ci.yml`

- **Arquivo**: `.github/workflows/ci.yml`
- **Trigger**: push/PR em `main` e `develop`
- **Job**: `test` (matrix Node `20.19.0` e `22.12.0`)
- **Passos relevantes**:
  - `npm ci`
  - `npx playwright install chromium --with-deps`
  - Sobe frontend Vite (`frontend/npm ci` + `npm run start -- --host 0.0.0.0 --port 5173 --strictPort`) e aguarda `http://127.0.0.1:5173`
  - Executa **validação oficial**: `npm run system:validate`
  - Mata o Vite (`kill $VITE_PID || true`)
- **Artifacts**:
  - Upload sempre (`if: always()`): `tests/rpa/reports/` como `rpa-reports-${node-version}` (retenção 7 dias)

### Pipeline completo — `full-pipeline.yml`

- **Arquivo**: `.github/workflows/full-pipeline.yml`
- **Trigger**: push/PR em `main` + `workflow_dispatch`
- **Jobs**:
  - `validation`: mesma lógica do CI principal (Vite + `npm run system:validate`)
    - Upload sempre:
      - `tests/rpa/reports/*.json` como `rpa-reports` (7 dias)
      - `tests/rpa/replay/*.json` e `tests/rpa/screenshots/*.png` como `rpa-artifacts` (7 dias)
  - `build` (depende de `validation`): `cd frontend && npm ci && npm run build`
    - Upload do build: `frontend/dist` como `frontend-build` (retenção 1 dia)
  - `summary`: escreve resumo no `GITHUB_STEP_SUMMARY`

### Code quality — `code-quality.yml`

- **Arquivo**: `.github/workflows/code-quality.yml`
- **Trigger**: push/PR em `main`/`develop` + `workflow_dispatch`
- **Jobs**:
  - `code-check` (placeholder de lint):
    - `npm ci`
    - `node --check` em `.js` (com `continue-on-error: true`)
    - valida JSON via `node -e "JSON.parse(...)"` (com `continue-on-error: true`)
    - lista top 20 maiores `.js` por linhas
  - `security-scan`:
    - `npm ci`
    - `npm audit --audit-level=moderate` (com `continue-on-error: true`)
- **Artifacts**: não publica.
- **Importante**: hoje esse workflow é **não-bloqueante** (por design), serve mais como “sanity check”.

### RPA dedicado — `rpa-ci.yml`

- **Arquivo**: `.github/workflows/rpa-ci.yml`
- **Trigger**:
  - push/PR em `main`/`develop` **apenas** quando muda `tests/rpa/**`
  - manual (`workflow_dispatch`)
- **Job**: `rpa-e2e` (matrix de seeds: `example-login`, `demo-login-completo`, `seed-platform-login`)
- **Comandos**:
  - `npm ci`
  - `npx playwright install chromium --with-deps`
  - `node tests/rpa/cli.js ci ${{ matrix.seed }}`
- **Artifacts**:
  - replay: `tests/rpa/replay/*.json` (always)
  - screenshots: `tests/rpa/screenshots/*.png` (apenas em failure)

### Seed plataforma via RPA — `rpa-seed.yml`

- **Arquivo**: `.github/workflows/rpa-seed.yml`
- **Trigger**: manual + cron diário 02:00 + push em `main` (paths `tests/rpa/recordings/**`, `tests/rpa/seedPlatformRPA.js`)
- **Job**: `seed-platform`
- **Comandos**:
  - `npm ci`
  - `npx playwright install chromium --with-deps`
  - (opcional) `npm run start:api &` + `sleep 10` (`continue-on-error: true`)
  - `node tests/rpa/seedPlatformRPA.js`
- **Artifacts** (always):
  - `tests/rpa/reports/*.json` (retenção 30 dias)
  - `tests/rpa/screenshots/*.png` (retenção 7 dias, ignore se vazio)
  - `tests/rpa/replay/*.json` (retenção 30 dias, ignore se vazio)

### Deploy — `deploy.yml`

- **Arquivo**: `.github/workflows/deploy.yml`
- **Trigger**: push em `main`, tags `v*`, manual
- **Gate de qualidade**:
  - Job `pre-deploy` executa **Vite + `npm run system:validate`** e depois `frontend build`
- **Build**:
  - `build-docker` constrói imagens `api`, `frontend`, `rag-service`
- **Deploy**:
  - Placeholder (sem script real)

### Notificações — `notify.yml`

- **Arquivo**: `.github/workflows/notify.yml`
- **Trigger**: `workflow_run` (quando conclui) para workflows: `"CI - Testes e Validação"`, `"RPA - Testes E2E (CI)"`, `"Deploy"`
- **Comportamento**:
  - Só roda o job `notify` quando a conclusão **não** é `success`
  - Slack/email são placeholders e rodam com `continue-on-error: true`

