'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');

function readJson(filePath) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch (_) { return null; }
}

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n');
}

// ── Templates E2E de negócio por jornada ───────────────────────────
const BUSINESS_E2E_TEMPLATES = {
  support_ticket_flow: {
    name: 'Fluxo Completo de Ticket de Suporte',
    channels: ['whatsapp', 'webchat'],
    risk: 'critical',
    priority: 'critical',
    steps: [
      { type: 'send_message', category: 'CLIENT_ACTION', adapter: 'api', order: 1,
        description: 'Cliente envia mensagem "Preciso de ajuda com meu pedido"', 
        expected: { messageReceived: true, intentDetected: 'support_request' } },
      { type: 'validate_intent', category: 'AI_DECISION', adapter: 'api', order: 2,
        description: 'IA classifica intenção como suporte e cria ticket', 
        expected: { ticketCreated: true, ticketStatus: 'open', priority: 'normal' } },
      { type: 'wait_for_event', category: 'SYSTEM_EVENT', adapter: 'api', order: 3,
        description: 'Sistema notifica agente disponível sobre novo ticket', 
        expected: { agentNotified: true, ticketAssigned: true } },
      { type: 'send_message', category: 'HUMAN_ACTION', adapter: 'api', order: 4,
        description: 'Agente responde "Seu pedido #1234 está em trânsito, previsão amanhã"', 
        expected: { replySent: true, messageDelivered: true } },
      { type: 'validate_backend', category: 'VALIDATION', adapter: 'api', order: 5,
        description: 'Valida que ticket foi atualizado com resposta e status', 
        expected: { ticketUpdated: true, lastReply: 'agent', slaOk: true } },
      { type: 'send_message', category: 'CLIENT_ACTION', adapter: 'api', order: 6,
        description: 'Cliente responde "Obrigado, resolvido!"', 
        expected: { messageReceived: true, satisfactionPositive: true } },
      { type: 'validate_flow_transition', category: 'VALIDATION', adapter: 'api', order: 7,
        description: 'Ticket é fechado automaticamente após confirmação do cliente', 
        expected: { ticketStatus: 'closed', resolutionTime: 'within_sla' } },
    ],
    validations: { requireBackendValidation: true, requireReplay: true, requireScreenshots: true },
    assertions: [
      'Ticket criado com sucesso',
      'IA classificou intenção corretamente',
      'Agente notificado e atribuído',
      'Resposta enviada e entregue ao cliente',
      'Ticket fechado dentro do SLA',
    ],
  },

  fitness_customer_checkin: {
    name: 'Check-in Completo de Aluno Fitness',
    channels: ['whatsapp', 'app'],
    risk: 'critical',
    priority: 'critical',
    steps: [
      { type: 'trigger_channel_event', category: 'CLIENT_ACTION', adapter: 'api', order: 1,
        description: 'Aluno chega na unidade e apresenta QR code no totem', 
        expected: { customerIdentified: true, membershipFound: true } },
      { type: 'validate_backend', category: 'VALIDATION', adapter: 'api', order: 2,
        description: 'Sistema valida matrícula ativa e sem pendências', 
        expected: { membershipActive: true, noPendingPayments: true, planValid: true } },
      { type: 'validate_access_release', category: 'SYSTEM_EVENT', adapter: 'api', order: 3,
        description: 'Catraca libera acesso após validação bem-sucedida', 
        expected: { accessGranted: true, turnstileReleased: true, timestamp: 'now' } },
      { type: 'validate_backend', category: 'VALIDATION', adapter: 'api', order: 4,
        description: 'Registro de presença é salvo no sistema', 
        expected: { attendanceRecorded: true, checkinTime: 'now', crmUpdated: true } },
    ],
    validations: { requireBackendValidation: true, requireReplay: true, requireScreenshots: true },
    assertions: [
      'Aluno identificado com sucesso',
      'Matrícula validada sem pendências',
      'Catraca liberada',
      'Presença registrada',
      'CRM atualizado',
    ],
  },

  omnichannel_engagement: {
    name: 'Engajamento Omnichannel Completo',
    channels: ['whatsapp', 'webchat', 'pbx', 'email'],
    risk: 'high',
    priority: 'high',
    steps: [
      { type: 'trigger_channel_event', category: 'CLIENT_ACTION', adapter: 'api', order: 1,
        description: 'Cliente inicia conversa via WhatsApp', 
        expected: { channel: 'whatsapp', conversationCreated: true } },
      { type: 'validate_intent', category: 'AI_DECISION', adapter: 'api', order: 2,
        description: 'IA processa mensagem e sugere handoff para agente humano', 
        expected: { intentDetected: true, handoffSuggested: true } },
      { type: 'send_message', category: 'BOT_ACTION', adapter: 'api', order: 3,
        description: 'Bot transfere para agente: "Um momento, vou transferir para um especialista"', 
        expected: { transferInitiated: true, queueAssigned: true } },
      { type: 'send_message', category: 'HUMAN_ACTION', adapter: 'api', order: 4,
        description: 'Agente atende via chat web e resolve a solicitação', 
        expected: { agentConnected: true, conversationActive: true } },
      { type: 'validate_flow_transition', category: 'VALIDATION', adapter: 'api', order: 5,
        description: 'Valida que histórico da conversa foi preservado entre canais', 
        expected: { historyIntact: true, allChannelsLinked: true, crmUpdated: true } },
    ],
    validations: { requireBackendValidation: true, requireReplay: true, requireScreenshots: true },
    assertions: [
      'Conversa iniciada via WhatsApp',
      'Handoff WhatsApp → Chat Web bem-sucedido',
      'Histórico preservado entre canais',
      'CRM atualizado com jornada completa',
    ],
  },

  booking_flow: {
    name: 'Fluxo Completo de Agendamento',
    channels: ['whatsapp', 'webchat'],
    risk: 'high',
    priority: 'high',
    steps: [
      { type: 'send_message', category: 'CLIENT_ACTION', adapter: 'api', order: 1,
        description: 'Cliente solicita "Quero agendar corte de cabelo para sexta"', 
        expected: { intentDetected: 'booking_request', serviceIdentified: true } },
      { type: 'check_availability', category: 'AI_DECISION', adapter: 'api', order: 2,
        description: 'IA consulta agenda e sugere horários disponíveis', 
        expected: { slotsFound: true, availableSlots: '3+' } },
      { type: 'select_slot', category: 'CLIENT_ACTION', adapter: 'api', order: 3,
        description: 'Cliente escolhe "Sexta 14h"', 
        expected: { slotSelected: true, timeConfirmed: true } },
      { type: 'create_booking', category: 'SYSTEM_EVENT', adapter: 'api', order: 4,
        description: 'Sistema cria agendamento e envia confirmação', 
        expected: { bookingCreated: true, confirmationSent: true, reminderScheduled: true } },
      { type: 'validate_backend', category: 'VALIDATION', adapter: 'api', order: 5,
        description: 'Valida que agendamento aparece no CRM e calendário', 
        expected: { crmUpdated: true, calendarSynced: true, notificationSent: true } },
    ],
    validations: { requireBackendValidation: true, requireReplay: true, requireScreenshots: true },
    assertions: [
      'Disponibilidade consultada',
      'Horário selecionado pelo cliente',
      'Agendamento criado',
      'Confirmação enviada',
      'CRM e calendário atualizados',
    ],
  },

  payment_charge_flow: {
    name: 'Fluxo Completo de Cobrança e Pagamento',
    channels: ['whatsapp', 'webchat'],
    risk: 'critical',
    priority: 'high',
    steps: [
      { type: 'validate_backend', category: 'SYSTEM_EVENT', adapter: 'api', order: 1,
        description: 'Sistema identifica cobrança pendente e gera fatura', 
        expected: { invoiceGenerated: true, amountCorrect: true, dueDate: 'today+7' } },
      { type: 'send_message', category: 'BOT_ACTION', adapter: 'api', order: 2,
        description: 'Bot envia link de pagamento: "Sua fatura de R$ 99,90 vence em 7 dias"', 
        expected: { paymentLinkSent: true, messageDelivered: true } },
      { type: 'create_payment', category: 'CLIENT_ACTION', adapter: 'api', order: 3,
        description: 'Cliente clica no link e realiza pagamento via PIX', 
        expected: { paymentProcessed: true, status: 'paid', method: 'pix' } },
      { type: 'validate_backend', category: 'VALIDATION', adapter: 'api', order: 4,
        description: 'Sistema confirma baixa no ledger e atualiza status da assinatura', 
        expected: { ledgerUpdated: true, subscriptionActive: true, receiptGenerated: true } },
    ],
    validations: { requireBackendValidation: true, requireReplay: true, requireScreenshots: true },
    assertions: [
      'Fatura gerada com valor correto',
      'Link de pagamento enviado',
      'Pagamento processado via PIX',
      'Ledger atualizado',
      'Recibo gerado',
    ],
  },
};

// ── Main ─────────────────────────────────────────────────────────────
function run() {
  console.log('[qa-waves-business-e2e] Gerando cenários E2E de negócio...\n');

  const contractsPath = path.join(ROOT, 'config', 'journey-contracts.json');
  const scenarioStorePath = path.join(ROOT, 'qa', 'qa-waves', 'scenario-store.json');

  const contracts = readJson(contractsPath);
  if (!contracts || !contracts.journeys) {
    console.log('⚠️  journey-contracts.json não encontrado ou inválido');
    return 1;
  }

  let store = readJson(scenarioStorePath);
  if (!store) store = { scenarios: [], version: 1 };

  if (!Array.isArray(store.scenarios)) {
    // Formato antigo: array direto
    store = { scenarios: Array.isArray(store) ? store : [], version: 1 };
  }

  const existingIds = new Set(store.scenarios.map(s => s.id));
  const generated = [];
  const skipped = [];

  for (const [journeyId, journey] of Object.entries(contracts.journeys)) {
    const scenarioId = `business-e2e-${journeyId}`;

    if (existingIds.has(scenarioId)) {
      skipped.push({ journey: journeyId, reason: 'já existe' });
      continue;
    }

    const template = BUSINESS_E2E_TEMPLATES[journeyId];
    if (!template) {
      skipped.push({ journey: journeyId, reason: 'sem template E2E definido' });
      continue;
    }

    const domainMap = {
      fitness_customer_checkin: 'fitness',
      omnichannel_engagement: 'omnichannel',
      support_ticket_flow: 'core',
      booking_flow: 'core',
      payment_charge_flow: 'core',
    };

    const scenario = {
      id: scenarioId,
      waveId: `wave-business-${journeyId}`,
      vertical: domainMap[journeyId] || 'core',
      journey: journeyId,
      name: template.name,
      source: 'auto-generated-e2e',
      status: 'draft_ai',
      channels: template.channels || ['whatsapp'],
      risk: template.risk || 'high',
      priority: template.priority || 'high',
      steps: template.steps.map((s, i) => ({
        id: `step_${journeyId}_${String(i + 1).padStart(3, '0')}`,
        order: s.order || i + 1,
        type: s.type,
        category: s.category,
        adapter: s.adapter || 'api',
        description: s.description,
        expected: s.expected,
        timeoutMs: 20000,
      })),
      validations: template.validations || { requireBackendValidation: true, requireReplay: true },
      assertions: template.assertions || [],
      requiredCapabilities: journey.requiredCapabilities || [],
      confidence: journey.confidence || 0.8,
      trainingEnabled: true,
      trainingDifficulty: journeyId.includes('fitness') ? 'intermediate' : journeyId.includes('payment') ? 'advanced' : 'beginner',
      trainingDuration: '10min',
      trainingPrerequisites: ['Acesso à plataforma RAP'],
      trainingObjectives: template.assertions || [],
    };

    store.scenarios.push(scenario);
    generated.push({ journey: journeyId, scenarioId, steps: template.steps.length });
  }

  // Backup + salvar
  const backupPath = scenarioStorePath.replace('.json', `.backup-${Date.now()}.json`);
  if (generated.length > 0) {
    fs.copyFileSync(scenarioStorePath, backupPath);
    writeJson(scenarioStorePath, store);
  }

  console.log(`✅ Cenários E2E gerados:  ${generated.length}`);
  for (const g of generated) {
    console.log(`   🆕 ${g.scenarioId.padEnd(40)} ${g.steps} steps → ${g.journey}`);
  }
  console.log(`⏭️  Pulos:                ${skipped.length}`);
  for (const s of skipped) {
    console.log(`   ⏭️  ${s.journey.padEnd(35)} ${s.reason}`);
  }
  console.log(`📦 Scenario store:       ${store.scenarios.length} cenários`);
  console.log(`💾 Backup:               ${path.basename(backupPath)}`);
  console.log(`\n📄 ${scenarioStorePath}`);

  // Também gerar o operational snapshot para a API
  console.log(`\n📊 Para visualizar em /dev/qa-waves, execute:`);
  console.log(`   curl -X POST http://127.0.0.1:3001/api/qa-waves/operational/recompute`);

  return 0;
}

if (require.main === module) {
  process.exit(run());
}

module.exports = { run, BUSINESS_E2E_TEMPLATES };
