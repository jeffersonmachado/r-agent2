'use strict';

/**
 * Vertical Operations Loader
 * 
 * Centraliza integração entre:
 * - ServiceOperationsKernel (orquestrador)
 * - VerticalOperationsAdapters (especializadores)
 * - VerticalTemplateRegistry (configuração)
 * 
 * Uso:
 * const loader = new VerticalOperationsLoader(kernel);
 * const bakeryAdapter = loader.getAdapter('bakery');
 * await bakeryAdapter.ingestBakeryEvent({ type: 'bakery:order.created', ... });
 */

const { createVerticalAdapter: createVerticalAdapterFactory } = require('./index');
const VerticalTemplateRegistry = require('../autonomous-scheduling/VerticalTemplateRegistry');
const { PizzeriaOperationsAdapterV2 } = require('./pizzeria/PizzeriaOperationsAdapterV2');
const { ClinicOperationsAdapterV2 } = require('./clinic/ClinicOperationsAdapterV2');
const { MarketOperationsAdapterV2 } = require('./market/MarketOperationsAdapterV2');

class VerticalOperationsLoader {
  constructor(kernel) {
    if (!kernel) {
      throw new Error('VerticalOperationsLoader requires ServiceOperationsKernel instance');
    }
    this.kernel = kernel;
    this.adapterCache = {};
    this.supportedVerticals = ['bakery', 'pizzeria', 'clinic', 'market'];
  }

  /**
   * Obter adapter de vertical (com cache)
   */
  getAdapter(verticalName) {
    if (!verticalName) {
      throw new Error('Vertical name is required');
    }

    if (!this.supportedVerticals.includes(verticalName)) {
      throw new Error(`Unknown vertical: ${verticalName}`);
    }

    if (!this.adapterCache[verticalName]) {
      if (verticalName === 'pizzeria') {
        this.adapterCache[verticalName] = new PizzeriaOperationsAdapterV2(this.kernel);
      } else if (verticalName === 'clinic') {
        this.adapterCache[verticalName] = new ClinicOperationsAdapterV2(this.kernel);
      } else if (verticalName === 'market') {
        this.adapterCache[verticalName] = new MarketOperationsAdapterV2(this.kernel);
      } else {
        this.adapterCache[verticalName] = createVerticalAdapterFactory(verticalName, this.kernel);
      }
    }

    return this.adapterCache[verticalName];
  }

  async createVerticalAdapter(verticalName) {
    return this.getAdapter(verticalName);
  }

  /**
   * Ingerir evento de vertical com template defaults
   */
  async ingestVerticalEvent(verticalName, { type, payload, tenantId, source }) {
    const adapter = this.getAdapter(verticalName);

    // Recuperar template defaults para a vertical
    const { getPreset } = VerticalTemplateRegistry;
    const template = getPreset(verticalName);

    // Normalizar payload com template defaults
    const normalizedPayload = {
      ...template.runtimeDefaults,
      ...payload,
      vertical: verticalName,
    };

    // Ingerir via adapter
    return adapter.ingestBakeryEvent?.({ type, payload: normalizedPayload, tenantId }) ||
           adapter.ingestPizzeriaEvent?.({ type, payload: normalizedPayload, tenantId }) ||
           adapter.ingestClinicEvent?.({ type, payload: normalizedPayload, tenantId }) ||
           adapter.ingestMarketEvent?.({ type, payload: normalizedPayload, tenantId }) ||
           this.kernel.ingestEvent({ type, payload: normalizedPayload, tenantId, source });
  }

  /**
   * Gerar decisões verticalizadas
   */
  async generateVerticalDecisions(verticalName, { tenantId, eventType, eventPayload }) {
    const adapter = this.getAdapter(verticalName);
    const template = VerticalTemplateRegistry.getPreset(verticalName);

    return adapter.generateBakeryDecisions?.({ tenantId, eventType, eventPayload }) ||
           adapter.generatePizzeriaDecisions?.({ tenantId, eventType, eventPayload }) ||
           adapter.generateClinicDecisions?.({ tenantId, eventType, eventPayload }) ||
           adapter.generateMarketDecisions?.({ tenantId, eventType, eventPayload });
  }

  /**
   * Obter estado operacional de vertical
   */
  async getVerticalOperationalState(verticalName, { tenantId }) {
    const adapter = this.getAdapter(verticalName);

    return adapter.getBakeryOperationalState?.({ tenantId }) ||
           adapter.getPizzeriaOperationalState?.({ tenantId }) ||
           adapter.getClinicOperationalState?.({ tenantId }) ||
           adapter.getMarketOperationalState?.({ tenantId });
  }

  /**
   * Listar quick actions de vertical
   */
  async listVerticalQuickActions(verticalName, { tenantId, context }) {
    const adapter = this.getAdapter(verticalName);

    return adapter.listBakeryQuickActions?.({ tenantId, context }) ||
           adapter.listPizzeriaQuickActions?.({ tenantId, context }) ||
           adapter.listClinicQuickActions?.({ tenantId, context }) ||
           adapter.listMarketQuickActions?.({ tenantId, context }) ||
           [];
  }

  /**
   * Listar playbooks de vertical
   */
  async listVerticalPlaybooks(verticalName, { tenantId, scenario }) {
    const adapter = this.getAdapter(verticalName);

    return adapter.listBakeryPlaybooks?.({ tenantId, scenario }) ||
           adapter.listPizzeriaPlaybooks?.({ tenantId, scenario }) ||
           adapter.listClinicPlaybooks?.({ tenantId, scenario }) ||
           adapter.listMarketPlaybooks?.({ tenantId, scenario }) ||
           [];
  }

  /**
   * Obter template/presets de vertical
   */
  getVerticalTemplate(verticalName) {
    return VerticalTemplateRegistry.getPreset(verticalName);
  }

  getVerticalPreset(verticalName) {
    return {
      name: verticalName,
      ...this.getVerticalTemplate(verticalName),
    };
  }

  /**
   * Listar todas as verticais suportadas com seus templates
   */
  listAllVerticals() {
    const presets = VerticalTemplateRegistry.listPresets();
    return presets.map((preset) => ({
      ...preset,
      adapter: this.adapterCache[preset.key] || null,
    }));
  }

  /**
   * Executar ação vertical
   */
  async executeVerticalAction(verticalName, { tenantId, actionId, actionType, parameters }) {
    const adapter = this.getAdapter(verticalName);

    return adapter.executeBakeryAction?.({ tenantId, actionId, actionType, parameters }) ||
           adapter.executePizzeriaAction?.({ tenantId, actionId, actionType, parameters }) ||
           adapter.executeClinicAction?.({ tenantId, actionId, actionType, parameters }) ||
           adapter.executeMarketAction?.({ tenantId, actionId, actionType, parameters });
  }

  /**
   * Registrar outcome de vertical
   */
  async recordVerticalOutcome(verticalName, { tenantId, eventId, decisionId, actionId, result, metrics }) {
    const adapter = this.getAdapter(verticalName);

    return adapter.recordBakeryOutcome?.({ tenantId, eventId, decisionId, actionId, result, metrics }) ||
           adapter.recordPizzeriaOutcome?.({ tenantId, eventId, decisionId, actionId, result, metrics }) ||
           adapter.recordClinicOutcome?.({ tenantId, eventId, decisionId, actionId, result, metrics }) ||
           adapter.recordMarketOutcome?.({ tenantId, eventId, decisionId, actionId, result, metrics });
  }

  /**
   * Invalidar cache de adapter (para testes)
   */
  invalidateCache(verticalName = null) {
    if (verticalName) {
      delete this.adapterCache[verticalName];
    } else {
      this.adapterCache = {};
    }
  }
}

module.exports = {
  VerticalOperationsLoader,
};
