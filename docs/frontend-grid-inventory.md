# Inventario Frontend: Grids

## Componentes de grid identificados

## 1) `DataGrid` (legado removido) — ELIMINADO ✅
- Arquivos removidos em 2026-03-20: `frontend/src/components/DataGrid.jsx` e `frontend/src/components/DataGrid.css`.
- Status: sem consumidores, sem implementacao ativa e fora do bundle do frontend.
- Ultima funcao historica: tabela simples com sort local e paginacao local.
- Migracao concluida por `ARC-010`; remocao final concluida por `ARC-095`.
- Consumidores migrados (historico de corte):
  - ~~`frontend/src/pages/PbxRoutesPage.jsx`~~ ✅ Migrado (ARC-010 wave 2)
  - ~~`frontend/src/pages/PbxExtensionsPage.jsx`~~ ✅ Migrado (ARC-010 wave 2)
  - ~~`frontend/src/pages/SolutionsPage.jsx`~~ ✅ Migrado (ARC-010 wave 2)
  - ~~`frontend/src/pages/PbxModulePage.jsx`~~ ✅ Migrado (ARC-010 wave 3) — 2x DataGrid
  - ~~`frontend/src/pages/PbxPage.jsx`~~ ✅ Migrado (ARC-010 wave 3) — 5x DataGrid

## 2) `platform-grid` (canonico)
- Modulo: `frontend/src/modules/platform-grid/`
- Export principal: `frontend/src/modules/platform-grid/index.js`
- Recursos presentes:
  - toolbar, filtros, paginacao, estados de loading/empty.
  - selecao de linhas.
  - modo client/server por contrato de props.
  - hooks utilitarios e mapeamento de query/state.
- Observacao estrutural:
  - pasta `components/` contem wrappers de reexport (`export { ... } from '../...'`).
- Adocao externa atual (fora do proprio modulo): em forte crescimento.
  - Uso funcional identificado: `frontend/src/pages/NodeMarketplacePage.jsx`.
  - Uso funcional identificado: `frontend/src/pages/PbxTrunksPage.jsx` ✅ (ARC-010 wave 1).
  - Uso funcional identificado: `frontend/src/pages/PbxRoutesPage.jsx` ✅ (ARC-010 wave 2).
  - Uso funcional identificado: `frontend/src/pages/PbxExtensionsPage.jsx` ✅ (ARC-010 wave 2).
  - Uso funcional identificado: `frontend/src/pages/SolutionsPage.jsx` ✅ (ARC-010 wave 2).
  - Uso funcional identificado: `frontend/src/pages/PbxModulePage.jsx` ✅ (ARC-010 wave 3).
  - Uso funcional identificado: `frontend/src/pages/PbxPage.jsx` ✅ (ARC-010 wave 3).

## Diagnostico
- `DataGrid` foi removido do frontend ativo em 2026-03-20 apos validacao de zero referencias externas.
- `platform-grid` e o unico componente de grid em uso nas paginas da aplicacao.
- Imports canonicos permanecem centralizados em `frontend/src/modules/platform-grid/index.js`.

## Recomendacao de canonizacao
1. Manter `platform-grid` como padrao obrigatorio para novas telas CRUD.
2. Preservar `frontend/src/modules/platform-grid/index.js` como unico ponto de import externo.
3. Tratar qualquer reintroducao de grid paralelo como regressao arquitetural.
4. Validar via build e guardrails antes de qualquer alteracao estrutural no modulo.

## Criterios de sucesso da migracao de grid
- Paridade de comportamento (sort/paginacao/click/estados) por tela migrada.
- Nenhuma regressao de UX para desktop/mobile.
- Reducao de duplicacao de implementacao de tabela/paginacao/filtros nas paginas.
