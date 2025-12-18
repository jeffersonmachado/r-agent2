/**
 * Tipos JSDoc auxiliares usados no frontend.
 * Estes tipos existem apenas para documentação e auto-complete.
 */

/**
 * @typedef {Object} EngineFlowNode
 * @property {string} id
 * @property {string} type
 * @property {Object<string, any>} [config]
 * @property {string|null} [next]
 */

/**
 * @typedef {Object} EngineFlowDefinition
 * @property {string} tenantId
 * @property {string} id
 * @property {string} name
 * @property {number} version
 * @property {EngineFlowNode[]} nodes
 * @property {Object<string, any>} [metadata]
 */

/**
 * Erro de validação já mapeado para UI.
 *
 * @typedef {Object} ValidationErrorUi
 * @property {string} code
 * @property {string} message
 * @property {('info'|'warning'|'error')} severity
 * @property {string[]} [nodeIds]
 * @property {Object<string, any>} [details]
 */

/**
 * Resultado de simulação simplificado para UI.
 *
 * @typedef {Object} SimulationResultUi
 * @property {{ id: string, version: number, versionHash: string }} compiledFlowInfo
 * @property {Array<{ index: number, stateBefore: any, stateAfter: any, output: any, events: any[] }>} steps
 * @property {any[]} events
 * @property {any} replay
 */

export {};


