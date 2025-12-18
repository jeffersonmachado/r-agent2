/**
 * Registro de handlers de nós.
 *
 * Decisão importante:
 * - Usamos um registro explícito de handlers por "type" de nó.
 * - Isso facilita a extensão da engine: novos tipos de nós
 *   são adicionados apenas registrando um novo handler,
 *   sem precisar alterar o core da execução.
 */

/**
 * @typedef {import('./flowTypes').NodeHandler} NodeHandler
 */

class NodeRegistry {
  constructor() {
    /** @type {Map<string, NodeHandler>} */
    this._handlers = new Map();
  }

  /**
   * Registra um handler para um tipo de nó.
   *
   * @param {string} type
   * @param {NodeHandler} handler
   */
  register(type, handler) {
    if (this._handlers.has(type)) {
      throw new Error(`Node type already registered: ${type}`);
    }
    this._handlers.set(type, handler);
  }

  /**
   * Obtém o handler para um tipo de nó.
   *
   * @param {string} type
   * @returns {NodeHandler}
   */
  get(type) {
    const handler = this._handlers.get(type);
    if (!handler) {
      throw new Error(`No handler registered for node type: ${type}`);
    }
    return handler;
  }
}

module.exports = {
  NodeRegistry,
};


