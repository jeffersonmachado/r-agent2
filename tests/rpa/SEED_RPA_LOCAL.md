# Seed/RPA Local

## Como executar

- Smoke UI apenas: `npm run test:rpa:seed:smoke`
- Seed funcional completo: `npm run test:rpa:seed`
- Seed/RPA usando a stack de teste docker: `npm run test:stack:rpa:seed`
- Alias direto legado: `node tests/rpa/seedPlatformRPA.js`
- Versão com resumo agregado: `node tests/rpa/seedPlatformCompleto.js --yes`
- Testes unitários do motor/RPA: `npm run test:rpa:jest -- --runInBand`

## Pré-requisitos reais

- Frontend acessível em `tests/rpa/rpaConfig.js` ou `TEST_FRONTEND_URL`
- API acessível em `tests/rpa/rpaConfig.js` ou `TEST_API_URL`
- PostgreSQL acessível para o seed funcional completo
- Browser do Playwright instalado ou Chromium/Chrome disponível no sistema

## Escopos

- Unit tests do engine
  Validam runner, asserts, replay, auto-login e fallback de browser sem depender da stack completa.
- Smoke RPA
  Valida tela de login e rotas autenticadas críticas via Playwright.
- Seed funcional da plataforma
  Cria filas, departamentos, agentes e fluxos pela API autenticada, de forma idempotente.

## O que foi corrigido nesta rodada

- `tests/rpa/seedPlatformRPA.js` deixou de depender de cinco arquivos inexistentes.
- Os seeds `seed-platform-*.json` passaram a existir e refletir as rotas atuais da UI.
- O runner agora evita auto-login em seeds públicos/externos.
- O launch do Playwright ganhou fallback para browser do sistema com mensagem útil.
- O seed principal agora faz pré-check de frontend, API e PostgreSQL antes de tentar execução funcional.

## Evidências

- Relatórios de execução: `tests/rpa/reports/seed-platform-*.json`
- Relatórios markdown: `tests/rpa/reports/seed-platform-*.md`
- Último relatório consolidado: `tests/rpa/reports/seed-platform-latest.md`

## Como gravar novos seeds

- Grave um seed novo com `node tests/rpa/gravar-seed-rpa.js <nome> <url>`
- Prefira asserts de URL, `name` e `data-testid`
- Evite depender de textos voláteis ou layout visual para validação crítica
