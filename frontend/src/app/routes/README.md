# App Routes

`AppRouter.jsx` atua apenas como orquestrador.

Estrutura atual:

- `publicRoutes.jsx`: storefront, kiosk, panel e station
- `workspaceRoutes.jsx`: dashboard, editor, support e workspaces operacionais
- `adminRoutes.jsx`: módulos administrativos e OCC
- `knowledgeRoutes.jsx`: knowledge/RAG/RPA/QA
- `technicalRoutes.jsx`: status técnico, canais e dashboard dev
- `crmRoutes.jsx`: shell CRM
- `pbxRoutes.jsx`: páginas PBX específicas e módulo PBX genérico
- `routeTitles.js`: resolução de título de página por prefixo
- `matchers.js`: helpers de match reutilizados

Lógica global que não é roteamento:

- `../runtime/appRuntime.js`: título do documento, suppressions globais e auto-toggle de filtros

Regra de convivência:

- novos grupos de rotas devem entrar em um arquivo de domínio/contexto
- `AppRouter.jsx` não deve voltar a acumular listas extensas de `isX`
