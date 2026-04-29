/**
 * Instruções para Usar Dados Mock (Sem API)
 * 
 * ## Problema
 * Os endpoints de projetos (/projects/:id) retornam erro 500 quando a API não está rodando.
 * 
 * ## Solução
 * Use dados mock direto no localStorage:
 * 
 * ### 1. No Console do Navegador
 * 
 * ```javascript
 * // Ativar modo mock
 * localStorage.setItem('USE_MOCK_API', 'true');
 * location.reload();
 * 
 * // Desativar modo mock
 * localStorage.removeItem('USE_MOCK_API');
 * location.reload();
 * ```
 * 
 * ### 2. Dados Mock Disponíveis
 * 
 * Os dados mock estão em: frontend/src/api/mock-data.json
 * 
 * - Projeto: "Projeto Demo" (ID: 1)
 * - Listas: Backlog, To Do, Doing, Review, Done
 * - Itens: 5 items de exemplo com diferentes tipos e status
 * - Dashboard: KPIs e métricas
 * - Timeline: Milestones e eventos agendados
 * 
 * ### 3. Arquivos Criados
 * 
 * - `/frontend/src/api/mock-data.json` - Dados mock em JSON
 * - `/frontend/src/api/mock-api.js` - Funções auxiliares
 * - `/frontend/src/api/projects-with-fallback.js` - API com fallback automático
 * - `/frontend/src/api/mock-api-init.js` - Inicialização global
 * 
 * ### 4. Como Ativar (Mais Fácil)
 * 
 * Para ativar automaticamente quando a API falha, edite:
 * `frontend/src/pages/projects/ProjectBoardPage.jsx`
 * 
 * Mude:
 * ```javascript
 * import { getProject, getProjectDashboard, listProjectItems, listProjectLists } 
 *   from '../../api/projects';
 * ```
 * 
 * Para:
 * ```javascript
 * import { getProject, getProjectDashboard, listProjectItems, listProjectLists } 
 *   from '../../api/projects-with-fallback';
 * ```
 * 
 * Faça o mesmo em:
 * - ProjectListPage.jsx
 * - ProjectDashboardPage.jsx  
 * - ProjectTimelinePage.jsx
 * 
 * ## Resultado
 * 
 * ProjectBoardPage.jsx agora carregará com dados de teste quando a API estiver indisponível!
 */

export const MOCK_API_INSTRUCTIONS = true;
