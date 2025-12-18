/**
 * Arquitetura de plugins de nós.
 *
 * Regras de design:
 * - O core da engine NÃO depende de plugins:
 *   - Este módulo é opcional e apenas ajuda a organizar plugins.
 *   - O runner/executeStep continuam recebendo um NodeRegistry externo.
 * - Plugins são registrados dinamicamente:
 *   - Em tempo de inicialização da aplicação ou em hot-reload controlado.
 * - Plugins podem adicionar tipos de nós:
 *   - Cada plugin registra um ou mais node types com seus handlers.
 * - Segurança por tenant:
 *   - Cada plugin declara explicitamente em quais tenants pode ser usado.
 *   - Mantemos um NodeRegistry isolado por tenant.
 */

const { NodeRegistry } = require('./nodeRegistry');

/**
 * @typedef {import('./flowTypes').ConversationState} ConversationState
 * @typedef {import('./flowTypes').FlowNode} FlowNode
 * @typedef {import('./flowTypes').EngineStepOutput} EngineStepOutput
 * @typedef {import('./nodeRegistry').NodeHandler} NodeHandler
 */

/**
 * Representa o manifesto mínimo de um plugin de nós.
 *
 * Decisões:
 * - id: identificador estável do plugin (para logs, auditoria).
 * - allowedTenants: lista de tenants nos quais o plugin pode ser usado.
 *   - Pode ser ["*"] para indicar "qualquer tenant" (configurado pelo
 *     operador da plataforma, não pelo próprio tenant).
 * - nodes: lista de tipos de nó fornecidos pelo plugin.
 *
 * @typedef {Object} NodePlugin
 * @property {string} id
 * @property {string[]} allowedTenants
 * @property {Array<{ type: string, handler: NodeHandler }>} nodes
 */

/**
 * Mapa interno de registries por tenant.
 *
 * @type {Map<string, NodeRegistry>}
 */
const tenantRegistries = new Map();

/**
 * Obtém (ou cria) o NodeRegistry para um tenant específico.
 *
 * @param {string} tenantId
 * @returns {NodeRegistry}
 */
function getOrCreateTenantRegistry(tenantId) {
  let registry = tenantRegistries.get(tenantId);
  if (!registry) {
    registry = new NodeRegistry();
    tenantRegistries.set(tenantId, registry);
  }
  return registry;
}

/**
 * Verifica se um plugin pode ser usado em um tenant específico.
 *
 * Regras:
 * - Se allowedTenants contém "*", consideramos permitido para todos.
 * - Caso contrário, o tenantId deve estar explicitamente listado.
 *
 * @param {NodePlugin} plugin
 * @param {string} tenantId
 * @returns {boolean}
 */
function isPluginAllowedForTenant(plugin, tenantId) {
  if (!Array.isArray(plugin.allowedTenants)) return false;
  if (plugin.allowedTenants.includes('*')) return true;
  return plugin.allowedTenants.includes(tenantId);
}

/**
 * Registra um plugin para um tenant específico.
 *
 * Segurança:
 * - Apenas registra o plugin se ele estiver autorizado para o tenant.
 * - Se não estiver autorizado, lança erro (para que o backend trate).
 *
 * Importante:
 * - Vários plugins podem registrar o mesmo tipo de nó para o mesmo
 *   tenant? Decisão: NÃO. Mantemos a regra de NodeRegistry:
 *   - Um type só pode ser registrado uma vez; conflitos devem ser
 *     resolvidos pela aplicação antes de chegar aqui.
 *
 * @param {string} tenantId
 * @param {NodePlugin} plugin
 * @returns {NodeRegistry} registry atualizado para o tenant
 */
function registerPluginForTenant(tenantId, plugin) {
  if (!isPluginAllowedForTenant(plugin, tenantId)) {
    throw new Error(
      `Plugin "${plugin.id}" não está autorizado para o tenant "${tenantId}".`,
    );
  }

  const registry = getOrCreateTenantRegistry(tenantId);

  for (const nodeDef of plugin.nodes || []) {
    if (!nodeDef || !nodeDef.type || typeof nodeDef.handler !== 'function') continue;
    registry.register(nodeDef.type, nodeDef.handler);
  }

  return registry;
}

/**
 * Obtém o NodeRegistry preparado para um tenant.
 *
 * Observação:
 * - Este registry já deve ter sido populado via registerPluginForTenant
 *   e/ou registro manual de tipos básicos de nós.
 *
 * @param {string} tenantId
 * @returns {NodeRegistry|null}
 */
function getRegistryForTenant(tenantId) {
  return tenantRegistries.get(tenantId) || null;
}

/**
 * Limpa todos os registries (usado principalmente em testes).
 */
function clearAllTenantRegistries() {
  tenantRegistries.clear();
}

module.exports = {
  registerPluginForTenant,
  getRegistryForTenant,
  clearAllTenantRegistries,
  _internal: {
    getOrCreateTenantRegistry,
    isPluginAllowedForTenant,
  },
};


