# Screen Catalog RPA

- Executa smoke de cobertura para as telas mapeadas em `frontend/src/main.jsx`.
- Perfis suportados:
  - `public`
  - `admin`
  - `super_admin`

## Como executar

- Catálogo completo: `npm run test:rpa:screens`
- Sobre a stack local/teste:
  - `TEST_FRONTEND_URL=http://localhost:5173 TEST_API_URL=http://localhost:3001 npm run test:rpa:screens`

## Evidências

- JSON: `tests/rpa/reports/screen-catalog-*.json`
- Markdown: `tests/rpa/reports/screen-catalog-*.md`
- Latest: `tests/rpa/reports/screen-catalog-latest.md`

## Observações

- O catálogo cobre as rotas de tela estáticas do sistema.
- Rotas parametrizadas/detalhe não entram automaticamente aqui; elas podem exigir massa específica e smoke dedicado.
