'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');

function readJson(p) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (_) { return null; } }
function writeJson(p, d) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(d, null, 2) + '\n'); }

// ── Todos os cenários necessários para 100% ─────────────────────────
function buildAllScenarios() {
  const contracts = readJson(path.join(ROOT, 'config', 'journey-contracts.json'));
  const preconditions = readJson(path.join(ROOT, 'config', 'journey-preconditions.json'));
  const capDeps = readJson(path.join(ROOT, 'config', 'capability-dependencies.json'));

  const scenarios = [];

  // Para cada jornada de negócio
  for (const [journeyId, journey] of Object.entries(contracts.journeys || {})) {
    const domain = mapJourneyToDomain(journeyId);
    const preconds = preconditions[journeyId] || { required: [], optional: [] };

    // 1. Cenário E2E principal
    scenarios.push(buildE2EScenario(journeyId, journey, domain));

    // 2. Cenário para CADA capability requerida
    for (const cap of journey.requiredCapabilities) {
      scenarios.push(buildCapabilityScenario(cap, journeyId, domain, capDeps));
    }

    // 3. Cenário para CADA precondition obrigatória
    for (const precond of (preconds.required || [])) {
      scenarios.push(buildPreconditionScenario(precond, journeyId, domain));
    }
  }

  // 4. Cenários para capabilities sem jornada (omnichannel, email, etc.)
  const allCaps = new Set();
  for (const j of Object.values(contracts.journeys || {})) {
    for (const c of j.requiredCapabilities) allCaps.add(c);
  }
  for (const cap of allCaps) {
    // Garantir que cada cap tem seu próprio cenário de validação
    const hasCapScenario = scenarios.some(s => s.id === `cap-${cap}`);
    if (!hasCapScenario) {
      const owner = findCapabilityOwner(cap, contracts);
      scenarios.push(buildCapabilityScenario(cap, owner, mapJourneyToDomain(owner), capDeps));
    }
  }

  return scenarios;
}

function mapJourneyToDomain(journeyId) {
  const m = {
    fitness_customer_checkin: 'fitness',
    omnichannel_engagement: 'omnichannel',
    support_ticket_flow: 'core',
    booking_flow: 'core',
    payment_charge_flow: 'core',
    bakery_encomenda_flow: 'bakery',
    bakery_balcao_retirada: 'bakery',
    bakery_producao_fornada: 'bakery',
    bakery_estoque_perdas: 'bakery',
    bakery_reativacao_cliente: 'bakery',
  };
  return m[journeyId] || 'core';
}

function findCapabilityOwner(cap, contracts) {
  for (const [jid, j] of Object.entries(contracts.journeys || {})) {
    if (j.requiredCapabilities.includes(cap)) return jid;
  }
  return 'core';
}

// ── Templates ────────────────────────────────────────────────────────
function buildE2EScenario(journeyId, journey, domain) {
  const templates = {
    support_ticket_flow: {
      name: 'Fluxo Completo de Ticket de Suporte',
      steps: [
        { type: 'send_message', category: 'CLIENT_ACTION', desc: 'Cliente envia "Preciso de ajuda"', expected: { intentDetected: 'support_request' } },
        { type: 'validate_intent', category: 'AI_DECISION', desc: 'IA cria ticket de suporte', expected: { ticketCreated: true, status: 'open' } },
        { type: 'wait_for_event', category: 'SYSTEM_EVENT', desc: 'Agente é notificado', expected: { agentNotified: true } },
        { type: 'send_message', category: 'HUMAN_ACTION', desc: 'Agente responde ao cliente', expected: { replySent: true } },
        { type: 'validate_flow_transition', category: 'VALIDATION', desc: 'Ticket fechado', expected: { ticketStatus: 'closed' } },
      ],
    },
    fitness_customer_checkin: {
      name: 'Check-in Completo de Aluno',
      steps: [
        { type: 'trigger_channel_event', category: 'CLIENT_ACTION', desc: 'Aluno apresenta QR code', expected: { customerIdentified: true } },
        { type: 'validate_backend', category: 'VALIDATION', desc: 'Valida matrícula ativa', expected: { membershipActive: true } },
        { type: 'validate_access_release', category: 'SYSTEM_EVENT', desc: 'Catraca libera acesso', expected: { accessGranted: true } },
        { type: 'validate_backend', category: 'VALIDATION', desc: 'Registra presença', expected: { attendanceRecorded: true } },
      ],
    },
    omnichannel_engagement: {
      name: 'Engajamento Omnichannel',
      steps: [
        { type: 'trigger_channel_event', category: 'CLIENT_ACTION', desc: 'Cliente inicia via WhatsApp', expected: { channel: 'whatsapp' } },
        { type: 'validate_intent', category: 'AI_DECISION', desc: 'IA sugere handoff', expected: { handoffSuggested: true } },
        { type: 'send_message', category: 'BOT_ACTION', desc: 'Bot transfere para agente', expected: { transferInitiated: true } },
        { type: 'send_message', category: 'HUMAN_ACTION', desc: 'Agente atende via chat web', expected: { agentConnected: true } },
        { type: 'validate_flow_transition', category: 'VALIDATION', desc: 'Histórico preservado entre canais', expected: { historyIntact: true } },
      ],
    },
    booking_flow: {
      name: 'Fluxo de Agendamento',
      steps: [
        { type: 'send_message', category: 'CLIENT_ACTION', desc: 'Cliente solicita agendamento', expected: { intentDetected: 'booking' } },
        { type: 'check_availability', category: 'AI_DECISION', desc: 'IA consulta agenda', expected: { slotsFound: true } },
        { type: 'select_slot', category: 'CLIENT_ACTION', desc: 'Cliente escolhe horário', expected: { slotSelected: true } },
        { type: 'create_booking', category: 'SYSTEM_EVENT', desc: 'Agendamento criado', expected: { bookingCreated: true } },
        { type: 'validate_backend', category: 'VALIDATION', desc: 'CRM e calendário atualizados', expected: { crmUpdated: true } },
      ],
    },
    payment_charge_flow: {
      name: 'Fluxo de Cobrança',
      steps: [
        { type: 'validate_backend', category: 'SYSTEM_EVENT', desc: 'Fatura gerada', expected: { invoiceGenerated: true } },
        { type: 'send_message', category: 'BOT_ACTION', desc: 'Link de pagamento enviado', expected: { paymentLinkSent: true } },
        { type: 'create_payment', category: 'CLIENT_ACTION', desc: 'Cliente paga via PIX', expected: { paymentProcessed: true } },
        { type: 'validate_backend', category: 'VALIDATION', desc: 'Ledger atualizado', expected: { ledgerUpdated: true } },
      ],
    },
  };

  const t = templates[journeyId] || { name: `E2E: ${journeyId}`, steps: [{ type: 'validate_backend', category: 'VALIDATION', desc: `Validar ${journeyId}`, expected: { ok: true } }] };

  return {
    id: `business-e2e-${journeyId}`,
    waveId: `wave-business-${journeyId}`,
    vertical: domain,
    journey: journeyId,
    name: t.name,
    source: 'auto-generated-e2e',
    status: 'draft_ai',
    channels: ['whatsapp'],
    risk: 'critical',
    priority: 'critical',
    steps: t.steps.map((s, i) => ({
      id: `step_e2e_${journeyId}_${i + 1}`,
      order: i + 1,
      type: s.type,
      category: s.category,
      adapter: 'api',
      description: s.desc,
      expected: s.expected,
      timeoutMs: 20000,
    })),
    validations: { requireBackendValidation: true, requireReplay: true },
    assertions: journey.requiredCapabilities.map(c => `${c}: validado`),
    requiredCapabilities: journey.requiredCapabilities,
    confidence: journey.confidence,
    trainingEnabled: true,
    trainingDifficulty: 'intermediate',
    trainingDuration: '10min',
    trainingPrerequisites: ['Acesso à plataforma RAP'],
    trainingObjectives: journey.requiredCapabilities.map(c => `Validar ${c.replace(/_/g, ' ')}`),
  };
}

function buildCapabilityScenario(cap, journeyId, domain, capDeps) {
  const deps = (capDeps?.dependencies || {})[cap]?.dependsOn || [];
  const capName = cap.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

  return {
    id: `cap-${cap}`,
    waveId: `wave-cap-${journeyId}`,
    vertical: domain,
    journey: journeyId,
    name: `Validação: ${capName}`,
    source: 'auto-generated-cap',
    status: 'draft_ai',
    channels: ['api'],
    risk: 'high',
    priority: 'high',
    steps: [
      {
        id: `step_cap_${cap}_1`, order: 1,
        type: 'validate_backend', category: 'VALIDATION', adapter: 'api',
        description: `Validar capability ${capName}`,
        expected: { capabilityValid: true, status: 'operational' },
        timeoutMs: 15000,
      },
      ...(deps.length > 0 ? [{
        id: `step_cap_${cap}_2`, order: 2,
        type: 'validate_backend', category: 'VALIDATION', adapter: 'api',
        description: `Validar dependências: ${deps.map(d => d.replace(/_/g, ' ')).join(', ')}`,
        expected: { dependenciesValid: true, deps: deps },
        timeoutMs: 15000,
      }] : []),
    ],
    validations: { requireBackendValidation: true, requireReplay: true },
    assertions: [
      `Capability ${capName} operacional`,
      ...deps.map(d => `Dependência ${d.replace(/_/g, ' ')} validada`),
    ],
    requiredCapabilities: [cap],
    confidence: 0.9,
    trainingEnabled: true,
    trainingDifficulty: 'beginner',
    trainingDuration: '3min',
    trainingPrerequisites: ['Acesso à plataforma RAP'],
    trainingObjectives: [`Validar capability ${capName}`],
  };
}

function buildPreconditionScenario(precond, journeyId, domain) {
  const precondName = precond.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

  return {
    id: `precond-${journeyId}-${precond}`,
    waveId: `wave-precond-${journeyId}`,
    vertical: domain,
    journey: journeyId,
    name: `Precondição: ${precondName}`,
    source: 'auto-generated-precond',
    status: 'draft_ai',
    channels: ['api'],
    risk: 'high',
    priority: 'high',
    steps: [{
      id: `step_precond_${precond}_1`, order: 1,
      type: 'validate_backend', category: 'VALIDATION', adapter: 'api',
      description: `Verificar precondição: ${precondName}`,
      expected: { preconditionMet: true, serviceAvailable: true },
      timeoutMs: 10000,
    }],
    validations: { requireBackendValidation: true },
    assertions: [`Precondição ${precondName} atendida`],
    trainingEnabled: true,
    trainingDifficulty: 'beginner',
    trainingDuration: '2min',
    trainingPrerequisites: [],
    trainingObjectives: [`Validar precondição ${precondName}`],
  };
}

// ── Main ─────────────────────────────────────────────────────────────
function run() {
  console.log('[qa-waves-100pct] Gerando cenários para 100% de cobertura de negócio...\n');

  const scenarioStorePath = path.join(ROOT, 'qa', 'qa-waves', 'scenario-store.json');

  let store = readJson(scenarioStorePath);
  if (!store) store = { scenarios: [], version: 1 };
  if (!Array.isArray(store.scenarios)) {
    store = { scenarios: Array.isArray(store) ? store : [], version: 1 };
  }

  const newScenarios = buildAllScenarios();
  const existingIds = new Set(store.scenarios.map(s => s.id));

  let added = 0, skipped = 0;
  for (const s of newScenarios) {
    if (existingIds.has(s.id)) {
      skipped++;
    } else {
      store.scenarios.push(s);
      existingIds.add(s.id);
      added++;
    }
  }

  // Backup + salvar
  const backupPath = scenarioStorePath.replace('.json', `.backup-${Date.now()}.json`);
  fs.copyFileSync(scenarioStorePath, backupPath);

  writeJson(scenarioStorePath, store);

  // Contar por tipo
  const e2e = newScenarios.filter(s => s.source === 'auto-generated-e2e').length;
  const caps = newScenarios.filter(s => s.source === 'auto-generated-cap').length;
  const preconds = newScenarios.filter(s => s.source === 'auto-generated-precond').length;

  console.log(`📊 Cenários gerados:`);
  console.log(`   E2E de negócio:           ${e2e}`);
  console.log(`   Capabilities individuais:  ${caps}`);
  console.log(`   Precondições:              ${preconds}`);
  console.log(`   Total gerado:              ${newScenarios.length}`);
  console.log(`   Adicionados:               ${added}`);
  console.log(`   Já existiam:               ${skipped}`);
  console.log(`📦 Scenario store:            ${store.scenarios.length} cenários`);
  console.log(`💾 Backup:                    ${path.basename(backupPath)}`);

  console.log(`\n✅ Para ver na UI: http://localhost:5173/dev/qa-waves`);
  console.log(`📊 Para validar:  npm run validate:business-needs\n`);

  return 0;
}

if (require.main === module) {
  process.exit(run());
}

module.exports = { run, buildAllScenarios };
