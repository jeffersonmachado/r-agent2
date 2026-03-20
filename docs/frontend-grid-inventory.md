# Inventario Frontend: Grids

## Componentes de grid identificados

## 1) `DataGrid` (legado funcional) — DESCONTINUADO ✅
- Arquivo base: `frontend/src/components/DataGrid.jsx`
- Perfil: tabela simples com sort local e paginacao local.
- Caracteristicas:
  - API direta por props (`columns`, `rows`, `onRowClick`).
  - Sem camada nativa de filtros, selecao multipla, estado persistido.
- Referencias externas detectadas (fora da propria implementacao): 0. **Migracao concluida (ARC-010).**
- Consumidores principais (em uso): **nenhum — todos migrados.**
- Consumidores migrados (descontinuados):
  - ~~`frontend/src/pages/PbxRoutesPage.jsx`~~ ✅ Migrado (ARC-010 wave 2)
  - ~~`frontend/src/pages/PbxExtensionsPage.jsx`~~ ✅ Migrado (ARC-010 wave 2)
  - ~~`frontend/src/pages/SolutionsPage.jsx`~~ ✅ Migrado (ARC-010 wave 2)
  - ~~`frontend/src/pages/PbxModulePage.jsx`~~ ✅ Migrado (ARC-010 wave 3) — 2x DataGrid
  - ~~`frontend/src/pages/PbxPage.jsx`~~ ✅ Migrado (ARC-010 wave 3) — 5x DataGrid

## 2) `platform-grid` (candidato canonico)
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
- **Migracao completa:** `DataGrid` nao possui mais consumidores externos.
- `platform-grid` e o unico componente de grid em uso nas paginas da aplicacao.

## Recomendacao de canonizacao
1. Definir `platform-grid` como padrao para novas telas CRUD.
2. Criar adapter de compatibilidade para migrar telas `DataGrid` gradualmente.
3. Migrar por lotes de menor risco primeiro (ex.: `NodeMarketplacePage` e `PbxTrunksPage`) antes dos hotspots maiores da familia PBX.
4. Congelar criacao de novos usos de `DataGrid` apos publicacao do guideline.

## Criterios de sucesso da migracao de grid
- Paridade de comportamento (sort/paginacao/click/estados) por tela migrada.
- Nenhuma regressao de UX para desktop/mobile.
- Reducao de duplicacao de implementacao de tabela/paginacao/filtros nas paginas.
