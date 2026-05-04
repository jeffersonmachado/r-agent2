'use strict';

const ALLOWED_STEP_TYPES = [
  'send_message',
  'validate_intent',
  'provide_data',
  'validate_response',
  'check_availability',
  'select_slot',
  'create_booking',
  'create_payment',
  'validate_backend',
  'validate_sla',
  'validate_context',
  'validate_flow_transition',
  'validate_access_release',
  'wait_for_event',
  'trigger_channel_event',
];

const FORBIDDEN_STEP_TYPES = [
  'click',
  'click_button',
  'fill_input',
  'xpath',
  'selector',
  'css',
  'css_selector',
  'dom_action',
  'selenium_action',
  'open_modal',
  'click_dropdown',
];

const ALLOWED_ADAPTERS = [
  'whatsapp',
  'chat',
  'pbx',
  'api',
  'db',
  'aiIntentService',
  'ragService',
  'schedulingService',
  'paymentService',
  'accessControlService',
  'flowEngine',
  'meshValidator',
  'eventMesh',
  'semanticValidator',
];

const ALLOWED_CHANNELS = ['whatsapp', 'chat', 'pbx', 'api'];
const ALLOWED_SCENARIO_SOURCES = ['ai_inferred', 'manual', 'imported', 'replay_regression'];

/**
 * Status do ciclo de vida de cenários:
 * - draft        : rascunho manual em elaboração
 * - draft_ai     : rascunho gerado por IA — requer aprovação antes de executar
 * - reviewed     : revisado, aguardando aprovação final
 * - approved     : aprovado — pode ser executado
 * - active       : ativo em produção (pós-aprovação com replay confirmado)
 * - regression   : modo regressão — executado em toda release
 * - disabled     : desativado temporariamente
 * - rejected     : rejeitado durante revisão — não executa
 * - deprecated   : obsoleto — mantido apenas para histórico
 *
 * Regra: APENAS status ['approved', 'active', 'regression'] podem ser executados.
 */
const ALLOWED_SCENARIO_STATUS = [
  'draft',
  'draft_ai',
  'reviewed',
  'approved',
  'active',
  'regression',
  'disabled',
  'rejected',
  'deprecated',
];

/** Status que permitem execução de cenário */
const EXECUTABLE_SCENARIO_STATUS = ['approved', 'active', 'regression'];

const ALLOWED_SEED_SOURCES = ['ai_generated', 'manual', 'from_replay'];
const ALLOWED_RISK_PRIORITY = ['low', 'medium', 'high', 'critical'];

const KNOWN_BACKEND_ENTITIES = [
  'booking',
  'payment',
  'lead',
  'access',
  'availability',
  'schedule',
  'customer',
  'conversation',
];

module.exports = {
  ALLOWED_STEP_TYPES,
  FORBIDDEN_STEP_TYPES,
  ALLOWED_ADAPTERS,
  ALLOWED_CHANNELS,
  ALLOWED_SCENARIO_SOURCES,
  ALLOWED_SCENARIO_STATUS,
  EXECUTABLE_SCENARIO_STATUS,
  ALLOWED_SEED_SOURCES,
  ALLOWED_RISK_PRIORITY,
  KNOWN_BACKEND_ENTITIES,
};
