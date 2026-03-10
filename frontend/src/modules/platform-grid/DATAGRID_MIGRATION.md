# DataGrid Legacy Strategy

`DataGrid` permanece no frontend apenas como camada de compatibilidade sobre `PlatformGrid`.

## Estado atual

Usos diretos mapeados em `2026-03-07`:

- migração imediata concluída nesta rodada:
  - `frontend/src/pages/SolutionsPage.jsx`
  - `frontend/src/pages/NodeMarketplacePage.jsx`
- ainda em compatibilidade controlada:
  - `frontend/src/pages/PbxExtensionsPage.jsx`
  - `frontend/src/pages/PbxRoutesPage.jsx`
  - `frontend/src/pages/PbxTrunksPage.jsx`
  - `frontend/src/pages/PbxModulePage.jsx`
  - `frontend/src/pages/PbxPage.jsx`

## Critérios

- migrar imediatamente:
  - telas simples de lista local
  - tabelas com filtros leves e poucas ações por linha
  - casos onde `DataGrid` só encapsula ordenação/paginação local
- migrar depois:
  - telas PBX com múltiplas grades na mesma página
  - telas com modais pesados, estados acoplados ou múltiplos blocos tabulares
  - fluxos que ainda dependem de revisão estrutural maior do workspace

## Regra de convivência

- novas telas nao devem adotar `DataGrid`
- `DataGrid` continua permitido apenas para preservar compatibilidade durante a migração incremental
- a API pública de `DataGrid` deve continuar mínima e estável enquanto houver consumidores legados
- evoluções novas de listagem devem acontecer em `PlatformGrid`

## Caminho de aposentadoria

1. migrar páginas simples e isoladas
2. migrar telas PBX menores (`PbxExtensionsPage`, `PbxRoutesPage`, `PbxTrunksPage`)
3. tratar `PbxModulePage` e `PbxPage` por último, porque concentram múltiplos grids e maior acoplamento operacional
4. remover `DataGrid` só quando não houver consumidores restantes
