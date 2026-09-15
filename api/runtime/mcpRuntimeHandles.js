'use strict';

/**
 * MCP Runtime Handles — ponte entre a composição de startup (que cria o MCP
 * Client Hub e registra os proxies no Canonical Tool Registry) e a superfície
 * de administração (rotas enable/disable), que pertencem a módulos distintos.
 *
 * Sem este registro, `POST /mcp/connections/:id/disable` persistia o estado
 * mas o runtime seguia executando os proxies até o restart — revogação que
 * depende de restart não é revogação.
 *
 * O conteúdo é o par VIVO `{ hub, toolRegistry }` da composição mais recente.
 * Ausência de handles (MCP Client não iniciado) é estado legítimo: a
 * persistência continua autoridade e o restart reconcilia.
 */

let handles = null;

function setMcpRuntimeHandles(value) {
  handles = value && value.hub && value.toolRegistry
    ? { hub: value.hub, toolRegistry: value.toolRegistry }
    : null;
}

function getMcpRuntimeHandles() {
  return handles;
}

module.exports = { setMcpRuntimeHandles, getMcpRuntimeHandles };
