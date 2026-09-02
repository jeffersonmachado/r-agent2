'use strict';

/**
 * operationalStepRegistry.js
 *
 * SINGLE SOURCE OF TRUTH para metadados operacionais de steps.
 *
 * Define para CADA step:
 *   - stepId: identificador único e consistente do step
 *   - actionType: tipo de ação executada (tipo semântico)
 *   - mutationExpected: boolean - step deve gerar mutações de backend?
 *   - expectedMutations: array de mutations esperadas (se mutationExpected=true)
 *   - expectedSideEffects: array de side effects esperados
 *   - snapshotRequired: boolean - snapshot incremental obrigatório?
 *   - snapshotScope: 'global' | 'entity' - que entidades capturar?
 *   - entityScope: array<string> - entidades específicas a capturar
 *   - proofRequirements: array<string> - tipos de prova exigida
 *   - networkProofRequired: boolean - prova de network event obrigatória?
 *   - networkEndpoints: array<string> - endpoints esperados (regex patterns)
 *   - expectedNetworkEvents: array<{method, path}> - endpoints em formato legível/canonical
 *
 * Uso:
 *   const stepSpec = OPERATIONAL_STEP_REGISTRY.get('step_reply_ticket');
 *   if (!stepSpec) throw new Error('Unknown stepId');
 *
 * Validação:
 *   - Cada stepId deve aparecer uma ÚNICA vez no registry
 *   - Cada actionType deve ser único dentro de um flow
 *   - Cada mutationExpected=true DEVE ter expectedMutations não-vazio
 *   - snapshotRequired deve ser true se mutationExpected=true
 *   - networkProofRequired deve ser true se mutationExpected=true
 */

/**
 * SUPPORT TICKET FLOW (support_ticket_flow)
 *
 * Jornada operacional completa de suporte:
 *   1. Agente acessa módulo de suporte
 *   2. Lista tickets disponíveis
 *   3. Abre ticket específico
 *   4. Responde ticket (MUTAÇÃO)
 *   5. Muda status (MUTAÇÃO)
 *   6. Valida UI do ticket
 *   7. Valida estado backend
 */
const SUPPORT_TICKET_FLOW = {
  step_access_support_module: {
    stepId: 'step_access_support_module',
    actionType: 'navigate',
    journeyId: 'support_ticket_flow',
    mutationExpected: false,
    expectedMutations: [],
    expectedSideEffects: [],
    snapshotRequired: false,
    snapshotScope: 'global',
    entityScope: [],
    proofRequirements: ['browser_navigation'],
    networkProofRequired: false,
    networkEndpoints: [],
  },

  step_wait_ticket_list: {
    stepId: 'step_wait_ticket_list',
    actionType: 'wait_for_list',
    journeyId: 'support_ticket_flow',
    mutationExpected: false,
    expectedMutations: [],
    expectedSideEffects: [],
    snapshotRequired: false,
    snapshotScope: 'global',
    entityScope: [],
    proofRequirements: ['dom_element_presence'],
    networkProofRequired: false,
    networkEndpoints: [],
  },

  step_open_ticket: {
    stepId: 'step_open_ticket',
    actionType: 'click_open',
    journeyId: 'support_ticket_flow',
    mutationExpected: false,
    expectedMutations: [],
    expectedSideEffects: [],
    snapshotRequired: false,
    snapshotScope: 'global',
    entityScope: [],
    proofRequirements: ['browser_click', 'dom_element_presence'],
    networkProofRequired: false,
    networkEndpoints: [],
  },

  step_takeover_ticket: {
    stepId: 'step_takeover_ticket',
    actionType: 'takeover_ticket',
    journeyId: 'support_ticket_flow',
    mutationExpected: true,
    expectedMutations: ['ticket_status_changed'],
    expectedSideEffects: ['audit_log_created'],
    snapshotRequired: true,
    snapshotScope: 'entity',
    entityScope: ['ticket.status', 'audit'],
    proofRequirements: ['incremental_snapshot', 'network_proof', 'observed_mutations'],
    networkProofRequired: true,
    networkEndpoints: [
      { method: 'POST', pathPattern: /\/tickets\/[^/]+\/takeover(?:\?|$)/, status: [200, 201] },
    ],
    expectedNetworkEvents: [
      { method: 'POST', path: '/tickets/:id/takeover' },
    ],
  },

  step_reply_ticket: {
    stepId: 'step_reply_ticket',
    actionType: 'type_and_send',
    journeyId: 'support_ticket_flow',
    mutationExpected: true,
    expectedMutations: ['message_created'],
    expectedSideEffects: ['audit_log_created'],
    snapshotRequired: true,
    snapshotScope: 'entity',
    entityScope: ['ticket', 'messages', 'audit'],
    proofRequirements: ['incremental_snapshot', 'network_proof', 'observed_mutations'],
    networkProofRequired: true,
    networkEndpoints: [
      { method: 'POST', pathPattern: /\/(api\/tickets\/[^/]+\/reply|tickets\/[^/]+\/(reply|message))(?:\?|$)/, status: [200, 201] },
    ],
    expectedNetworkEvents: [
      { method: 'POST', path: '/tickets/:id/reply' },
      { method: 'POST', path: '/tickets/:id/message' },
    ],
  },

  step_whatsapp_read_status: {
    stepId: 'step_whatsapp_read_status',
    actionType: 'webhook_status',
    journeyId: 'support_ticket_flow',
    mutationExpected: false,
    expectedMutations: [],
    expectedSideEffects: [],
    snapshotRequired: false,
    snapshotScope: 'global',
    entityScope: [],
    proofRequirements: ['network_proof'],
    networkProofRequired: false,
    networkEndpoints: [],
  },

  step_assert_whatsapp_delivery: {
    stepId: 'step_assert_whatsapp_delivery',
    actionType: 'assert_delivery_state',
    journeyId: 'support_ticket_flow',
    mutationExpected: false,
    expectedMutations: [],
    expectedSideEffects: [],
    snapshotRequired: false,
    snapshotScope: 'global',
    entityScope: [],
    proofRequirements: ['state_assertion'],
    networkProofRequired: false,
    networkEndpoints: [],
  },

  step_change_status: {
    stepId: 'step_change_status',
    actionType: 'change_status',
    journeyId: 'support_ticket_flow',
    mutationExpected: true,
    expectedMutations: ['ticket_status_changed'],
    expectedSideEffects: ['audit_log_created'],
    snapshotRequired: true,
    snapshotScope: 'entity',
    entityScope: ['ticket.status', 'audit'],
    proofRequirements: ['incremental_snapshot', 'network_proof', 'observed_mutations'],
    networkProofRequired: true,
    networkEndpoints: [
      { method: 'PATCH|POST', pathPattern: /\/(api\/tickets\/[^/]+\/(status|change-status)|tickets\/[^/]+\/close)(?:\?|$)/, status: [200, 201] },
    ],
    expectedNetworkEvents: [
      { method: 'PATCH', path: '/tickets/:id/status' },
      { method: 'POST', path: '/tickets/:id/close' },
    ],
  },

  step_assert_ticket_ui: {
    stepId: 'step_assert_ticket_ui',
    actionType: 'assert_ui_state',
    journeyId: 'support_ticket_flow',
    mutationExpected: false,
    expectedMutations: [],
    expectedSideEffects: [],
    snapshotRequired: false,
    snapshotScope: 'global',
    entityScope: [],
    proofRequirements: ['dom_assertion'],
    networkProofRequired: false,
    networkEndpoints: [],
  },

  step_assert_ticket_backend: {
    stepId: 'step_assert_ticket_backend',
    actionType: 'assert_backend_state',
    journeyId: 'support_ticket_flow',
    mutationExpected: false,
    expectedMutations: [],
    expectedSideEffects: [],
    snapshotRequired: false,
    requiresIncrementalDiff: false,
    requiresMutationLinkage: false,
    requiresProvenance: false,
    snapshotScope: 'global',
    entityScope: [],
    proofRequirements: ['state_assertion'],
    networkProofRequired: false,
    networkEndpoints: [],
  },
};

/**
 * FITNESS CUSTOMER CHECKIN FLOW (fitness_customer_checkin)
 *
 * Jornada operacional de checkin em fitness:
 *   1. Cliente acessa módulo de check-in
 *   2. Identifica cliente via credencial (SEM mutação backend ainda)
 *   3. Valida membership no backend (asserção, SEM mutação)
 *   4. Submete check-in (MUTAÇÃO: attendance_created)
 *   5. Confirma attendance no backend (asserção, SEM mutação adicional)
 *
 * NOTA: step_identify_customer NÃO gera attendance_created.
 * A mutação attendance_created APENAS ocorre em step_submit_checkin.
 */
const FITNESS_CUSTOMER_CHECKIN_FLOW = {
  step_access_checkin_module: {
    stepId: 'step_access_checkin_module',
    actionType: 'navigate',
    journeyId: 'fitness_customer_checkin',
    mutationExpected: false,
    expectedMutations: [],
    expectedSideEffects: [],
    snapshotRequired: false,
    snapshotScope: 'global',
    entityScope: [],
    proofRequirements: ['browser_navigation'],
    networkProofRequired: false,
    networkEndpoints: [],
  },

  step_identify_customer: {
    stepId: 'step_identify_customer',
    actionType: 'identify_customer',
    journeyId: 'fitness_customer_checkin',
    mutationExpected: false,
    expectedMutations: [],
    expectedSideEffects: [],
    snapshotRequired: false,
    snapshotScope: 'global',
    entityScope: [],
    proofRequirements: ['browser_input_fill', 'dom_assertion'],
    networkProofRequired: false,
    networkEndpoints: [],
  },

  step_validate_membership: {
    stepId: 'step_validate_membership',
    actionType: 'validate_membership',
    journeyId: 'fitness_customer_checkin',
    mutationExpected: false,
    expectedMutations: [],
    expectedSideEffects: [],
    snapshotRequired: false,
    snapshotScope: 'global',
    entityScope: [],
    proofRequirements: ['state_assertion', 'dom_element_presence'],
    networkProofRequired: false,
    networkEndpoints: [],
  },

  step_submit_checkin: {
    stepId: 'step_submit_checkin',
    actionType: 'checkin_submit',
    journeyId: 'fitness_customer_checkin',
    mutationExpected: true,
    expectedMutations: ['attendance_created'],
    expectedSideEffects: ['access_decision_created', 'access_event_created', 'crm_journey_updated'],
    snapshotRequired: true,
    snapshotScope: 'entity',
    entityScope: ['attendance', 'access_decision', 'access_event', 'crm_journey'],
    proofRequirements: ['incremental_snapshot', 'network_proof', 'observed_mutations'],
    networkProofRequired: true,
    networkEndpoints: [
      { method: 'POST', pathPattern: /\/(api\/fitness\/checkin|api\/access-control\/decisions\/resolve)(?:\?|$)/, status: [200, 201] },
    ],
    expectedNetworkEvents: [
      { method: 'POST', path: '/fitness/checkin' },
      { method: 'POST', path: '/access-control/decisions/resolve' },
    ],
  },

  step_confirm_attendance: {
    stepId: 'step_confirm_attendance',
    actionType: 'assert_attendance',
    journeyId: 'fitness_customer_checkin',
    mutationExpected: false,
    expectedMutations: [],
    expectedSideEffects: [],
    snapshotRequired: false,
    requiresIncrementalDiff: false,
    requiresMutationLinkage: false,
    requiresProvenance: false,
    snapshotScope: 'entity',
    entityScope: ['attendance', 'access_event'],
    proofRequirements: ['state_assertion', 'backend_record_verification'],
    networkProofRequired: false,
    networkEndpoints: [],
  },
};

/**
 * FOOD ORDER STATUS FLOW (food_order_status_flow)
 *
 * Jornada operacional minima de pedidos:
 *   1. Operador acessa o modulo de pedidos
 *   2. Atualiza status real do pedido (MUTACAO)
 *   3. Valida persistencia do pedido no backend
 */
const FOOD_ORDER_STATUS_FLOW = {
  step_access_orders_module: {
    stepId: 'step_access_orders_module',
    actionType: 'navigate',
    journeyId: 'food_order_status_flow',
    mutationExpected: false,
    expectedMutations: [],
    expectedSideEffects: [],
    snapshotRequired: false,
    snapshotScope: 'global',
    entityScope: [],
    proofRequirements: ['browser_navigation'],
    networkProofRequired: false,
    networkEndpoints: [],
  },

  step_update_order_status: {
    stepId: 'step_update_order_status',
    actionType: 'update_order_status',
    journeyId: 'food_order_status_flow',
    mutationExpected: true,
    expectedMutations: ['order_status_changed'],
    expectedSideEffects: ['event_ledger_recorded'],
    snapshotRequired: true,
    snapshotScope: 'entity',
    entityScope: ['order', 'event_ledger'],
    proofRequirements: ['incremental_snapshot', 'network_proof', 'observed_mutations'],
    networkProofRequired: true,
    networkEndpoints: [
      { method: 'PUT', pathPattern: /\/orders\/[^/]+\/status(?:\?|$)/, status: [200, 201] },
    ],
    expectedNetworkEvents: [
      { method: 'PUT', path: '/orders/:orderId/status' },
    ],
  },

  step_assert_order_backend: {
    stepId: 'step_assert_order_backend',
    actionType: 'assert_backend_state',
    journeyId: 'food_order_status_flow',
    mutationExpected: false,
    expectedMutations: [],
    expectedSideEffects: [],
    snapshotRequired: false,
    requiresIncrementalDiff: false,
    requiresMutationLinkage: false,
    requiresProvenance: false,
    snapshotScope: 'global',
    entityScope: [],
    proofRequirements: ['state_assertion'],
    networkProofRequired: false,
    networkEndpoints: [],
  },
};

/**
 * BAKERY ENCOMENDA FLOW (bakery_encomenda_flow)
 *
 * Jornada operacional minima de encomendas de padaria:
 *   1. Operador acessa o modulo de pedidos
 *   2. Confirma encomenda real (MUTACAO)
 *   3. Valida persistencia da encomenda no backend
 */
const BAKERY_ENCOMENDA_FLOW = {
  step_access_bakery_orders_module: {
    stepId: 'step_access_bakery_orders_module',
    actionType: 'navigate',
    journeyId: 'bakery_encomenda_flow',
    mutationExpected: false,
    expectedMutations: [],
    expectedSideEffects: [],
    snapshotRequired: false,
    snapshotScope: 'global',
    entityScope: [],
    proofRequirements: ['browser_navigation'],
    networkProofRequired: false,
    networkEndpoints: [],
  },

  step_update_bakery_order_status: {
    stepId: 'step_update_bakery_order_status',
    actionType: 'update_order_status',
    journeyId: 'bakery_encomenda_flow',
    mutationExpected: true,
    expectedMutations: ['order_status_changed'],
    expectedSideEffects: ['event_ledger_recorded'],
    snapshotRequired: true,
    snapshotScope: 'entity',
    entityScope: ['order', 'event_ledger'],
    proofRequirements: ['incremental_snapshot', 'network_proof', 'observed_mutations'],
    networkProofRequired: true,
    networkEndpoints: [
      { method: 'PUT', pathPattern: /\/orders\/[^/]+\/status(?:\?|$)/, status: [200, 201] },
    ],
    expectedNetworkEvents: [
      { method: 'PUT', path: '/orders/:orderId/status' },
    ],
  },

  step_assert_bakery_order_backend: {
    stepId: 'step_assert_bakery_order_backend',
    actionType: 'assert_backend_state',
    journeyId: 'bakery_encomenda_flow',
    mutationExpected: false,
    expectedMutations: [],
    expectedSideEffects: [],
    snapshotRequired: false,
    requiresIncrementalDiff: false,
    requiresMutationLinkage: false,
    requiresProvenance: false,
    snapshotScope: 'global',
    entityScope: [],
    proofRequirements: ['state_assertion'],
    networkProofRequired: false,
    networkEndpoints: [],
  },
};

/**
 * MARKET NODE PUBLISH FLOW (market_node_publish_flow)
 *
 * Jornada operacional minima de mercado:
 *   1. Operador acessa o mercado de nodes
 *   2. Publica node real no marketplace tenant (MUTACAO)
 *   3. Valida persistencia do node no catalogo backend
 */
const MARKET_NODE_PUBLISH_FLOW = {
  step_access_node_marketplace: {
    stepId: 'step_access_node_marketplace',
    actionType: 'navigate',
    journeyId: 'market_node_publish_flow',
    mutationExpected: false,
    expectedMutations: [],
    expectedSideEffects: [],
    snapshotRequired: false,
    snapshotScope: 'global',
    entityScope: [],
    proofRequirements: ['browser_navigation'],
    networkProofRequired: false,
    networkEndpoints: [],
  },

  step_publish_marketplace_node: {
    stepId: 'step_publish_marketplace_node',
    actionType: 'publish_node',
    journeyId: 'market_node_publish_flow',
    mutationExpected: true,
    expectedMutations: ['node_published'],
    expectedSideEffects: ['catalog_updated'],
    snapshotRequired: true,
    snapshotScope: 'entity',
    entityScope: ['node_marketplace'],
    proofRequirements: ['incremental_snapshot', 'network_proof', 'observed_mutations'],
    networkProofRequired: true,
    networkEndpoints: [
      { method: 'POST', pathPattern: /\/api\/node-marketplace\/publish(?:\?|$)/, status: [200, 201] },
    ],
    expectedNetworkEvents: [
      { method: 'POST', path: '/api/node-marketplace/publish' },
    ],
  },

  step_assert_marketplace_backend: {
    stepId: 'step_assert_marketplace_backend',
    actionType: 'assert_backend_state',
    journeyId: 'market_node_publish_flow',
    mutationExpected: false,
    expectedMutations: [],
    expectedSideEffects: [],
    snapshotRequired: false,
    requiresIncrementalDiff: false,
    requiresMutationLinkage: false,
    requiresProvenance: false,
    snapshotScope: 'global',
    entityScope: [],
    proofRequirements: ['state_assertion'],
    networkProofRequired: false,
    networkEndpoints: [],
  },
};

/**
 * CLINIC CALENDAR BLOCK FLOW (clinic_calendar_block_flow)
 *
 * Jornada operacional minima de clinica:
 *   1. Operador acessa agenda/calendario
 *   2. Cria indisponibilidade real no calendario do recurso (MUTACAO)
 *   3. Valida persistencia do bloco no backend
 */
const CLINIC_CALENDAR_BLOCK_FLOW = {
  step_access_clinic_calendar: {
    stepId: 'step_access_clinic_calendar',
    actionType: 'navigate',
    journeyId: 'clinic_calendar_block_flow',
    mutationExpected: false,
    expectedMutations: [],
    expectedSideEffects: [],
    snapshotRequired: false,
    snapshotScope: 'global',
    entityScope: [],
    proofRequirements: ['browser_navigation'],
    networkProofRequired: false,
    networkEndpoints: [],
  },

  step_create_calendar_block: {
    stepId: 'step_create_calendar_block',
    actionType: 'create_calendar_block',
    journeyId: 'clinic_calendar_block_flow',
    mutationExpected: true,
    expectedMutations: ['calendar_block_created'],
    expectedSideEffects: ['calendar_updated'],
    snapshotRequired: true,
    snapshotScope: 'entity',
    entityScope: ['calendar_block'],
    proofRequirements: ['incremental_snapshot', 'network_proof', 'observed_mutations'],
    networkProofRequired: true,
    networkEndpoints: [
      { method: 'POST', pathPattern: /\/api\/calendar\/resource\/[^/]+\/blocks(?:\?|$)/, status: [200, 201] },
    ],
    expectedNetworkEvents: [
      { method: 'POST', path: '/api/calendar/resource/:resourceId/blocks' },
    ],
  },

  step_assert_clinic_calendar_backend: {
    stepId: 'step_assert_clinic_calendar_backend',
    actionType: 'assert_backend_state',
    journeyId: 'clinic_calendar_block_flow',
    mutationExpected: false,
    expectedMutations: [],
    expectedSideEffects: [],
    snapshotRequired: false,
    requiresIncrementalDiff: false,
    requiresMutationLinkage: false,
    requiresProvenance: false,
    snapshotScope: 'global',
    entityScope: [],
    proofRequirements: ['state_assertion'],
    networkProofRequired: false,
    networkEndpoints: [],
  },
};

/**
 * BOOKING FLOW (booking_flow)
 *
 * Jornada operacional minima de agendamento workspace:
 *   1. Operador acessa o modulo de workspace
 *   2. Cria booking real de recurso (MUTACAO)
 *   3. Valida persistencia do booking no backend
 */
const BOOKING_FLOW = {
  step_access_booking_workspace: {
    stepId: 'step_access_booking_workspace',
    actionType: 'navigate',
    journeyId: 'booking_flow',
    mutationExpected: false,
    expectedMutations: [],
    expectedSideEffects: [],
    snapshotRequired: false,
    snapshotScope: 'global',
    entityScope: [],
    proofRequirements: ['browser_navigation'],
    networkProofRequired: false,
    networkEndpoints: [],
  },

  step_create_resource_booking: {
    stepId: 'step_create_resource_booking',
    actionType: 'create_booking',
    journeyId: 'booking_flow',
    mutationExpected: true,
    expectedMutations: ['booking_created'],
    expectedSideEffects: ['booking_created'],
    snapshotRequired: true,
    snapshotScope: 'entity',
    entityScope: ['booking'],
    proofRequirements: ['incremental_snapshot', 'network_proof', 'observed_mutations'],
    networkProofRequired: true,
    networkEndpoints: [
      { method: 'POST', pathPattern: /\/resource-bookings(?:\?|$)/, status: [200, 201] },
    ],
    expectedNetworkEvents: [
      { method: 'POST', path: '/resource-bookings' },
    ],
  },

  step_assert_booking_backend: {
    stepId: 'step_assert_booking_backend',
    actionType: 'assert_backend_state',
    journeyId: 'booking_flow',
    mutationExpected: false,
    expectedMutations: [],
    expectedSideEffects: [],
    snapshotRequired: false,
    requiresIncrementalDiff: false,
    requiresMutationLinkage: false,
    requiresProvenance: false,
    snapshotScope: 'global',
    entityScope: [],
    proofRequirements: ['state_assertion'],
    networkProofRequired: false,
    networkEndpoints: [],
  },
};

/**
 * PAYMENT CHARGE FLOW (payment_charge_flow)
 *
 * Jornada operacional minima de pagamento:
 *   1. Operador acessa o modulo operacional
 *   2. Cria cobranca real de membership (MUTACAO)
 *   3. Confirma pagamento via webhook (MUTACAO)
 *   4. Valida persistencia no backend
 */
const PAYMENT_CHARGE_FLOW = {
  step_access_payments_module: {
    stepId: 'step_access_payments_module',
    actionType: 'navigate',
    journeyId: 'payment_charge_flow',
    mutationExpected: false,
    expectedMutations: [],
    expectedSideEffects: [],
    snapshotRequired: false,
    snapshotScope: 'global',
    entityScope: [],
    proofRequirements: ['browser_navigation'],
    networkProofRequired: false,
    networkEndpoints: [],
  },

  step_create_membership_charge: {
    stepId: 'step_create_membership_charge',
    actionType: 'create_payment',
    journeyId: 'payment_charge_flow',
    mutationExpected: true,
    expectedMutations: ['payment_created'],
    expectedSideEffects: ['notification_sent'],
    snapshotRequired: true,
    snapshotScope: 'entity',
    entityScope: ['billing', 'notifications'],
    proofRequirements: ['incremental_snapshot', 'network_proof', 'observed_mutations'],
    networkProofRequired: true,
    networkEndpoints: [
      { method: 'POST', pathPattern: /\/api\/fitness\/membership\/[^/]+\/charge(?:\?|$)/, status: [200, 201] },
    ],
    expectedNetworkEvents: [
      { method: 'POST', path: '/api/fitness/membership/:id/charge' },
    ],
  },

  step_confirm_membership_payment: {
    stepId: 'step_confirm_membership_payment',
    actionType: 'confirm_payment',
    journeyId: 'payment_charge_flow',
    mutationExpected: true,
    expectedMutations: ['payment_status_changed'],
    // O webhook de confirmação notifica o membro (recibo) — observado no diff
    // incremental como events.notifications.count/sent incrementados.
    expectedSideEffects: ['notification_sent'],
    snapshotRequired: true,
    snapshotScope: 'entity',
    entityScope: ['billing', 'notifications'],
    proofRequirements: ['incremental_snapshot', 'network_proof', 'observed_mutations'],
    networkProofRequired: true,
    networkEndpoints: [
      { method: 'POST', pathPattern: /\/billing\/webhook(?:\?|$)/, status: [200, 201] },
    ],
    expectedNetworkEvents: [
      { method: 'POST', path: '/billing/webhook' },
    ],
  },

  step_assert_payment_backend: {
    stepId: 'step_assert_payment_backend',
    actionType: 'assert_backend_state',
    journeyId: 'payment_charge_flow',
    mutationExpected: false,
    expectedMutations: [],
    expectedSideEffects: [],
    snapshotRequired: false,
    requiresIncrementalDiff: false,
    requiresMutationLinkage: false,
    requiresProvenance: false,
    snapshotScope: 'global',
    entityScope: [],
    proofRequirements: ['state_assertion'],
    networkProofRequired: false,
    networkEndpoints: [],
  },
};

/**
 * AGENDAMENTO FLOW (agendamento)
 *
 * Jornada operacional de agendamento (vertical fitness):
 *   1. Operador acessa o workspace (navegação, SEM mutação)
 *   2. Abre o rail Construtor → Execução → Tarefas (SEM mutação)
 *   3. Cria tarefa real "Aula experimental QA" (MUTAÇÃO: task_created → tabela tasks)
 *   4. Abre o modal de agendamento da tarefa criada (SEM mutação)
 *   5. Preenche e confirma o agendamento (toast "Agendamento criado")
 *
 * NOTA: a ÚNICA mutação persistente em banco é a criação da tarefa
 * (POST /api/tasks → tabela tasks). O agendamento em si é gravado no
 * scheduleService (em memória) e NÃO é contabilizável por snapshot de banco;
 * por isso o contrato de estado exige apenas db.task.count:incremented.
 */
const AGENDAMENTO_FLOW = {
  step_agendamento_access_workspace: {
    stepId: 'step_agendamento_access_workspace',
    actionType: 'navigate',
    journeyId: 'agendamento',
    mutationExpected: false,
    expectedMutations: [],
    expectedSideEffects: [],
    snapshotRequired: false,
    snapshotScope: 'global',
    entityScope: [],
    proofRequirements: ['browser_navigation'],
    networkProofRequired: false,
    networkEndpoints: [],
  },

  step_agendamento_open_builder: {
    stepId: 'step_agendamento_open_builder',
    actionType: 'open_builder_rail',
    journeyId: 'agendamento',
    mutationExpected: false,
    expectedMutations: [],
    expectedSideEffects: [],
    snapshotRequired: false,
    snapshotScope: 'global',
    entityScope: [],
    proofRequirements: ['browser_click', 'dom_element_presence'],
    networkProofRequired: false,
    networkEndpoints: [],
  },

  step_agendamento_open_tasks: {
    stepId: 'step_agendamento_open_tasks',
    actionType: 'open_tasks_module',
    journeyId: 'agendamento',
    mutationExpected: false,
    expectedMutations: [],
    expectedSideEffects: [],
    snapshotRequired: false,
    snapshotScope: 'global',
    entityScope: [],
    proofRequirements: ['browser_click', 'dom_element_presence'],
    networkProofRequired: false,
    networkEndpoints: [],
  },

  step_agendamento_create_task: {
    stepId: 'step_agendamento_create_task',
    actionType: 'create_task',
    journeyId: 'agendamento',
    mutationExpected: true,
    expectedMutations: ['task_created'],
    expectedSideEffects: ['task_created'],
    snapshotRequired: true,
    snapshotScope: 'entity',
    entityScope: ['task', 'audit'],
    proofRequirements: ['incremental_snapshot', 'network_proof', 'observed_mutations'],
    networkProofRequired: true,
    networkEndpoints: [
      { method: 'POST', pathPattern: /\/api\/tasks(?:\?|$)/, status: [200, 201] },
    ],
    expectedNetworkEvents: [
      { method: 'POST', path: '/api/tasks' },
    ],
  },

  step_agendamento_open_schedule: {
    stepId: 'step_agendamento_open_schedule',
    actionType: 'open_schedule_modal',
    journeyId: 'agendamento',
    mutationExpected: false,
    expectedMutations: [],
    expectedSideEffects: [],
    snapshotRequired: false,
    snapshotScope: 'global',
    entityScope: [],
    proofRequirements: ['browser_click', 'dom_element_presence'],
    networkProofRequired: false,
    networkEndpoints: [],
  },

  step_agendamento_confirm_schedule: {
    stepId: 'step_agendamento_confirm_schedule',
    actionType: 'assert_ui_state',
    journeyId: 'agendamento',
    mutationExpected: false,
    expectedMutations: [],
    expectedSideEffects: [],
    snapshotRequired: false,
    requiresIncrementalDiff: false,
    requiresMutationLinkage: false,
    requiresProvenance: false,
    snapshotScope: 'entity',
    entityScope: ['task'],
    proofRequirements: ['state_assertion', 'dom_element_presence'],
    networkProofRequired: false,
    networkEndpoints: [],
  },
};

/**
 * Registry consolidado: stepId → stepSpec
 */
const OPERATIONAL_STEP_REGISTRY = new Map([
  // Support flow
  ...Object.entries(SUPPORT_TICKET_FLOW).map(([, spec]) => [spec.stepId, spec]),
  // Fitness flow
  ...Object.entries(FITNESS_CUSTOMER_CHECKIN_FLOW).map(([, spec]) => [spec.stepId, spec]),
  // Food flow
  ...Object.entries(FOOD_ORDER_STATUS_FLOW).map(([, spec]) => [spec.stepId, spec]),
  // Bakery flow
  ...Object.entries(BAKERY_ENCOMENDA_FLOW).map(([, spec]) => [spec.stepId, spec]),
  // Market flow
  ...Object.entries(MARKET_NODE_PUBLISH_FLOW).map(([, spec]) => [spec.stepId, spec]),
  // Clinic flow
  ...Object.entries(CLINIC_CALENDAR_BLOCK_FLOW).map(([, spec]) => [spec.stepId, spec]),
  // Booking flow
  ...Object.entries(BOOKING_FLOW).map(([, spec]) => [spec.stepId, spec]),
  // Payment flow
  ...Object.entries(PAYMENT_CHARGE_FLOW).map(([, spec]) => [spec.stepId, spec]),
  // Agendamento flow
  ...Object.entries(AGENDAMENTO_FLOW).map(([, spec]) => [spec.stepId, spec]),
]);

/**
 * Índice por actionType (dentro de um flow)
 */
const ACTION_TYPE_REGISTRY = new Map([
  // Support flow
  ...Object.entries(SUPPORT_TICKET_FLOW).map(([, spec]) =>
    [`${spec.journeyId}:${spec.actionType}`, spec]
  ),
  // Fitness flow
  ...Object.entries(FITNESS_CUSTOMER_CHECKIN_FLOW).map(([, spec]) =>
    [`${spec.journeyId}:${spec.actionType}`, spec]
  ),
  // Food flow
  ...Object.entries(FOOD_ORDER_STATUS_FLOW).map(([, spec]) =>
    [`${spec.journeyId}:${spec.actionType}`, spec]
  ),
  // Bakery flow
  ...Object.entries(BAKERY_ENCOMENDA_FLOW).map(([, spec]) =>
    [`${spec.journeyId}:${spec.actionType}`, spec]
  ),
  // Market flow
  ...Object.entries(MARKET_NODE_PUBLISH_FLOW).map(([, spec]) =>
    [`${spec.journeyId}:${spec.actionType}`, spec]
  ),
  // Clinic flow
  ...Object.entries(CLINIC_CALENDAR_BLOCK_FLOW).map(([, spec]) =>
    [`${spec.journeyId}:${spec.actionType}`, spec]
  ),
  // Booking flow
  ...Object.entries(BOOKING_FLOW).map(([, spec]) =>
    [`${spec.journeyId}:${spec.actionType}`, spec]
  ),
  // Payment flow
  ...Object.entries(PAYMENT_CHARGE_FLOW).map(([, spec]) =>
    [`${spec.journeyId}:${spec.actionType}`, spec]
  ),
  // Agendamento flow
  ...Object.entries(AGENDAMENTO_FLOW).map(([, spec]) =>
    [`${spec.journeyId}:${spec.actionType}`, spec]
  ),
]);

/**
 * Índice por journeyId
 */
const JOURNEY_STEPS_REGISTRY = {
  support_ticket_flow: SUPPORT_TICKET_FLOW,
  fitness_customer_checkin: FITNESS_CUSTOMER_CHECKIN_FLOW,
  food_order_status_flow: FOOD_ORDER_STATUS_FLOW,
  bakery_encomenda_flow: BAKERY_ENCOMENDA_FLOW,
  market_node_publish_flow: MARKET_NODE_PUBLISH_FLOW,
  clinic_calendar_block_flow: CLINIC_CALENDAR_BLOCK_FLOW,
  booking_flow: BOOKING_FLOW,
  payment_charge_flow: PAYMENT_CHARGE_FLOW,
  agendamento: AGENDAMENTO_FLOW,
};

const REGISTERED_JOURNEY_IDS = new Set(Object.keys(JOURNEY_STEPS_REGISTRY));

function resolveJourneyId(journeyId = '') {
  const normalized = String(journeyId || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return REGISTERED_JOURNEY_IDS.has(normalized) ? normalized : '';
}

function getRegisteredJourneyIds() {
  return Array.from(REGISTERED_JOURNEY_IDS);
}

/**
 * Obtém especificação de step pelo stepId.
 *
 * @param {string} stepId
 * @returns {object|null} stepSpec ou null se não encontrado
 */
function getStepSpec(stepId) {
  if (!stepId) return null;
  return OPERATIONAL_STEP_REGISTRY.get(String(stepId).trim()) || null;
}

/**
 * Obtém contrato operacional completo por stepId.
 * Alias explícito para reforçar a semântica de uso do registry.
 *
 * @param {string} stepId
 * @returns {object|null}
 */
function getOperationalStepContract(stepId) {
  return getStepSpec(stepId);
}

/**
 * Obtém especificação de step pelo actionType dentro de um flow específico.
 *
 * @param {string} journeyId
 * @param {string} actionType
 * @returns {object|null} stepSpec ou null
 */
function getStepSpecByActionType(journeyId, actionType) {
  if (!journeyId || !actionType) return null;
  const key = `${String(journeyId).trim()}:${String(actionType).trim()}`;
  return ACTION_TYPE_REGISTRY.get(key) || null;
}

/**
 * Obtém TODOS os steps de uma jornada específica.
 *
 * @param {string} journeyId
 * @returns {object} { stepId: stepSpec, ... } ou {}
 */
function getJourneySteps(journeyId) {
  if (!journeyId) return {};
  return JOURNEY_STEPS_REGISTRY[String(journeyId).trim()] || {};
}

/**
 * Verifica se um step DEVE gerar mutações.
 * BASEADO EXCLUSIVAMENTE no registry, nunca em heurística.
 *
 * @param {string|object} stepIdOrSpec
 * @returns {boolean}
 */
function isMutationExpectedStep(stepIdOrSpec) {
  if (!stepIdOrSpec) return false;

  let spec;
  if (typeof stepIdOrSpec === 'string') {
    spec = getStepSpec(stepIdOrSpec);
  } else if (typeof stepIdOrSpec === 'object') {
    // Se passou um step object, tenta pelo stepId
    spec = getStepSpec(stepIdOrSpec.id || stepIdOrSpec.stepId);
  } else {
    return false;
  }

  if (!spec) return false;
  return spec.mutationExpected === true;
}

/**
 * Verifica se snapshot incremental é OBRIGATÓRIO para step.
 *
 * @param {string|object} stepIdOrSpec
 * @returns {boolean}
 */
function isSnapshotRequiredStep(stepIdOrSpec) {
  if (!stepIdOrSpec) return false;

  let spec;
  if (typeof stepIdOrSpec === 'string') {
    spec = getStepSpec(stepIdOrSpec);
  } else if (typeof stepIdOrSpec === 'object') {
    spec = getStepSpec(stepIdOrSpec.id || stepIdOrSpec.stepId);
  } else {
    return false;
  }

  if (!spec) return false;
  return spec.snapshotRequired === true;
}

/**
 * Obtém escopo de entidades a capturar para um step.
 *
 * @param {string|object} stepIdOrSpec
 * @returns {string} 'global' | 'entity'
 */
function getSnapshotScopeForStep(stepIdOrSpec) {
  if (!stepIdOrSpec) return 'global';

  let spec;
  if (typeof stepIdOrSpec === 'string') {
    spec = getStepSpec(stepIdOrSpec);
  } else if (typeof stepIdOrSpec === 'object') {
    spec = getStepSpec(stepIdOrSpec.id || stepIdOrSpec.stepId);
  } else {
    return 'global';
  }

  return spec?.snapshotScope || 'global';
}

/**
 * Obtém lista de entidades a capturar para um step.
 *
 * @param {string|object} stepIdOrSpec
 * @returns {string[]} array de nomes de entidades
 */
function getEntityScopeForStep(stepIdOrSpec) {
  if (!stepIdOrSpec) return [];

  let spec;
  if (typeof stepIdOrSpec === 'string') {
    spec = getStepSpec(stepIdOrSpec);
  } else if (typeof stepIdOrSpec === 'object') {
    spec = getStepSpec(stepIdOrSpec.id || stepIdOrSpec.stepId);
  } else {
    return [];
  }

  return Array.isArray(spec?.entityScope) ? spec.entityScope : [];
}

/**
 * Obtém expectedMutations para um step.
 *
 * @param {string|object} stepIdOrSpec
 * @returns {string[]}
 */
function getExpectedMutationsForStep(stepIdOrSpec) {
  if (!stepIdOrSpec) return [];

  let spec;
  if (typeof stepIdOrSpec === 'string') {
    spec = getStepSpec(stepIdOrSpec);
  } else if (typeof stepIdOrSpec === 'object') {
    spec = getStepSpec(stepIdOrSpec.id || stepIdOrSpec.stepId);
  } else {
    return [];
  }

  return Array.isArray(spec?.expectedMutations) ? spec.expectedMutations : [];
}

/**
 * Obtém expectedSideEffects para um step.
 *
 * @param {string|object} stepIdOrSpec
 * @returns {string[]}
 */
function getExpectedSideEffectsForStep(stepIdOrSpec) {
  if (!stepIdOrSpec) return [];

  let spec;
  if (typeof stepIdOrSpec === 'string') {
    spec = getStepSpec(stepIdOrSpec);
  } else if (typeof stepIdOrSpec === 'object') {
    spec = getStepSpec(stepIdOrSpec.id || stepIdOrSpec.stepId);
  } else {
    return [];
  }

  return Array.isArray(spec?.expectedSideEffects) ? spec.expectedSideEffects : [];
}

/**
 * Obtém requirements de prova para um step.
 *
 * @param {string|object} stepIdOrSpec
 * @returns {string[]}
 */
function getProofRequirementsForStep(stepIdOrSpec) {
  if (!stepIdOrSpec) return [];

  let spec;
  if (typeof stepIdOrSpec === 'string') {
    spec = getStepSpec(stepIdOrSpec);
  } else if (typeof stepIdOrSpec === 'object') {
    spec = getStepSpec(stepIdOrSpec.id || stepIdOrSpec.stepId);
  } else {
    return [];
  }

  return Array.isArray(spec?.proofRequirements) ? spec.proofRequirements : [];
}

/** * Verifica se step exige comprovação de rede (network proof).
 *
 * @param {string|object} stepIdOrSpec
 * @returns {boolean}
 */
function isNetworkProofRequired(stepIdOrSpec) {
  if (!stepIdOrSpec) return false;
  let spec;
  if (typeof stepIdOrSpec === 'string') {
    spec = getStepSpec(stepIdOrSpec);
  } else if (typeof stepIdOrSpec === 'object') {
    spec = getStepSpec(stepIdOrSpec.id || stepIdOrSpec.stepId);
  } else {
    return false;
  }
  return spec?.networkProofRequired === true;
}

/**
 * Obtém expectedNetworkEvents canônicos (formato legível) para um step.
 * Retorna array de {method, path}.
 *
 * Para matching runtime usar networkEndpoints (pathPattern RegExp).
 *
 * @param {string|object} stepIdOrSpec
 * @returns {Array<{method: string, path: string}>}
 */
function getExpectedNetworkEventsForStep(stepIdOrSpec) {
  if (!stepIdOrSpec) return [];
  let spec;
  if (typeof stepIdOrSpec === 'string') {
    spec = getStepSpec(stepIdOrSpec);
  } else if (typeof stepIdOrSpec === 'object') {
    spec = getStepSpec(stepIdOrSpec.id || stepIdOrSpec.stepId);
  } else {
    return [];
  }
  if (Array.isArray(spec?.expectedNetworkEvents)) return spec.expectedNetworkEvents;
  // Fallback: derive from networkEndpoints if not declared
  if (Array.isArray(spec?.networkEndpoints)) {
    return spec.networkEndpoints.map((e) => ({ method: String(e.method || ''), path: String(e.pathPattern || '') }));
  }
  return [];
}

/**
 * Seleciona o network event correto dos eventos capturados, usando o contrato
 * do registry (networkEndpoints patterns) em vez de simplesmente o primeiro 2xx.
 *
 * Para uso em provenance: retorna o PRIMEIRO event que bate com algum endpoint
 * esperado do contrato. Se nenhum bater, retorna null (falha de causalidade).
 *
 * @param {string} stepId
 * @param {Array<{method, url, status}>} networkEvents
 * @returns {{ method, url, status }|null}
 */
function matchExpectedNetworkEvent(stepId, networkEvents = []) {
  const spec = getStepSpec(stepId);
  if (!spec) return null;
  if (!spec.networkProofRequired) return null;
  if (!Array.isArray(spec.networkEndpoints) || spec.networkEndpoints.length === 0) return null;

  for (const event of networkEvents) {
    if (event?.type !== 'response' && event?.method == null) continue;
    const status = Number(event?.status || 0);
    for (const endpoint of spec.networkEndpoints) {
      const eventMethod = String(event?.method || '').toUpperCase();
      const expectedMethods = String(endpoint.method || '')
        .toUpperCase()
        .split('|')
        .map((method) => method.trim())
        .filter(Boolean);
      const methodMatch = expectedMethods.length === 0
        ? false
        : expectedMethods.includes(eventMethod);
      const pathMatch = endpoint.pathPattern instanceof RegExp
        ? endpoint.pathPattern.test(String(event?.url || ''))
        : String(event?.url || '').includes(String(endpoint.pathPattern || ''));
      const statusMatch = !Array.isArray(endpoint.status) || endpoint.status.includes(status);
      if (methodMatch && pathMatch && statusMatch) {
        return { method: event.method, url: event.url, status: event.status };
      }
    }
  }
  return null; // nenhum event correspondeu ao contrato
}

/** * Valida consistência de um step contra o registry.
 *
 * Retorna:
 *   - { valid: true } se OK
 *   - { valid: false, errors: [...] } se problemas
 *
 * @param {object} step
 * @returns {object}
 */
function validateStepConsistency(step = {}) {
  const errors = [];

  const stepId = step.id || step.stepId;
  if (!stepId) {
    errors.push('step missing id/stepId');
    return { valid: false, errors };
  }

  const spec = getOperationalStepContract(stepId);
  if (!spec) {
    errors.push(`stepId "${stepId}" not found in registry`);
    return { valid: false, errors };
  }

  // Verificar actionType
  const actionType = step.actionType || step.action || step.type;
  if (actionType && actionType !== spec.actionType) {
    errors.push(
      `actionType mismatch: got "${actionType}", registry expects "${spec.actionType}"`
    );
  }

  // mutationExpected deve vir exclusivamente do registry
  if (Object.prototype.hasOwnProperty.call(step, 'mutationExpected') && step.mutationExpected !== spec.mutationExpected) {
    errors.push(
      `mutationExpected mismatch: got "${step.mutationExpected}", registry expects "${spec.mutationExpected}"`
    );
  }

  return errors.length === 0
    ? { valid: true }
    : { valid: false, errors };
}

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  // Registries
  OPERATIONAL_STEP_REGISTRY,
  ACTION_TYPE_REGISTRY,
  JOURNEY_STEPS_REGISTRY,

  // Flow definitions
  SUPPORT_TICKET_FLOW,
  FITNESS_CUSTOMER_CHECKIN_FLOW,
  FOOD_ORDER_STATUS_FLOW,
  BAKERY_ENCOMENDA_FLOW,
  MARKET_NODE_PUBLISH_FLOW,
  CLINIC_CALENDAR_BLOCK_FLOW,
  BOOKING_FLOW,
  PAYMENT_CHARGE_FLOW,
  AGENDAMENTO_FLOW,

  // Query API
  getStepSpec,
  getOperationalStepContract,
  getStepSpecByActionType,
  getJourneySteps,
  resolveJourneyId,
  getRegisteredJourneyIds,

  // Semantic helpers
  isMutationExpectedStep,
  isSnapshotRequiredStep,
  getSnapshotScopeForStep,
  getEntityScopeForStep,
  getExpectedMutationsForStep,
  getExpectedSideEffectsForStep,
  getProofRequirementsForStep,
  getExpectedNetworkEventsForStep,
  isNetworkProofRequired,
  matchExpectedNetworkEvent,

  // Validation
  validateStepConsistency,
};
