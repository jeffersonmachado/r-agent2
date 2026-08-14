'use strict';

/**
 * Indexa TODAS as verticais (Fitness, Beauty) e seus contratos de negócio na RAG.
 * 
 * Uso: node scripts/rag-index-verticals.js [--dry-run]
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const RAG_BASE = process.env.RAG_BASE_URL || 'http://10.10.2.30:8001';
const RAG_TOKEN = process.env.RAG_INTERNAL_TOKEN || '';
const ROOT = path.resolve(__dirname, '..');

// ─── Helpers ────────────────────────────────────────────────────────────────

function postJSON(urlPath, body) {
  if (!String(RAG_TOKEN).trim()) {
    return Promise.reject(new Error('RAG_INTERNAL_TOKEN não configurado'));
  }
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, RAG_BASE);
    const data = JSON.stringify(body);
    const mod = url.protocol === 'https:' ? https : http;
    const opts = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
        'X-RAG-Internal-Token': RAG_TOKEN
      }
    };
    const req = mod.request(opts, (res) => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(body) });
        } catch {
          resolve({ status: res.statusCode, data: body });
        }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function readFileSafe(filePath) {
  try { return fs.readFileSync(filePath, 'utf-8'); } catch { return null; }
}

function readJSON(filePath) {
  const raw = readFileSafe(filePath);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

// ─── Document Builders ──────────────────────────────────────────────────────

function buildVerticalOverview(vertical, info) {
  return {
    document: {
      id: `vertical-${vertical}-overview-2026-08`,
      tenantId: 'system',
      domain: 'OPERATIONAL',
      classification: 'business-context',
      sensitivity: 'internal',
      content: `# Vertical: ${info.name}\n\n${info.description}\n\n` +
        `## Modelos de Negócio\n${info.businessModels.join('\n')}\n\n` +
        `## KPIs Principais\n${info.kpis.join('\n')}\n\n` +
        `## Jornadas\n${info.journeys.map(j => `- ${j.id}: ${j.desc}`).join('\n')}\n\n` +
        `## Integrações\n${info.integrations.join('\n')}`,
      metadata: { vertical, category: 'overview', version: '1.0', generatedAt: new Date().toISOString() },
      permissions: { readRoles: ['super_admin', 'auditor', 'agent'], readTenants: ['system'] }
    }
  };
}

function buildVerticalAPIRoutes(vertical, routes) {
  return {
    document: {
      id: `vertical-${vertical}-api-routes-2026-08`,
      tenantId: 'system',
      domain: 'OPERATIONAL',
      classification: 'api-reference',
      sensitivity: 'internal',
      content: `# API Routes: ${vertical.toUpperCase()}\n\n` +
        routes.map(r => `## ${r.method} ${r.path}\n${r.description}\nParams: ${r.params || 'none'}\nResponse: ${r.response || 'JSON'}`).join('\n\n'),
      metadata: { vertical, category: 'api-routes', version: '1.0', generatedAt: new Date().toISOString() },
      permissions: { readRoles: ['super_admin', 'auditor'], readTenants: ['system'] }
    }
  };
}

function buildVerticalJourneys(vertical, journeys) {
  const content = journeys.map(j => 
    `## Jornada: ${j.id}\n` +
    `Descrição: ${j.description}\n` +
    `Pré-condições: ${j.preconditions?.join(', ') || 'none'}\n` +
    `Steps: ${j.steps?.map(s => `  ${s.order}. ${s.action} → ${s.expectedOutcome}`).join('\n') || 'none'}\n` +
    `Pós-condições: ${j.postconditions?.join(', ') || 'none'}`
  ).join('\n\n');

  return {
    document: {
      id: `vertical-${vertical}-journeys-2026-08`,
      tenantId: 'system',
      domain: 'OPERATIONAL',
      classification: 'business-process',
      sensitivity: 'internal',
      content: `# Jornadas: ${vertical.toUpperCase()}\n\n${content}`,
      metadata: { vertical, category: 'journeys', version: '1.0', generatedAt: new Date().toISOString() },
      permissions: { readRoles: ['super_admin', 'auditor', 'agent'], readTenants: ['system'] }
    }
  };
}

function buildVerticalBusinessNeeds(vertical, needs) {
  return {
    document: {
      id: `vertical-${vertical}-business-needs-2026-08`,
      tenantId: 'system',
      domain: 'OPERATIONAL',
      classification: 'business-requirements',
      sensitivity: 'internal',
      content: `# Necessidades de Negócio: ${vertical.toUpperCase()}\n\n${needs}`,
      metadata: { vertical, category: 'business-needs', version: '1.0', generatedAt: new Date().toISOString() },
      permissions: { readRoles: ['super_admin', 'auditor'], readTenants: ['system'] }
    }
  };
}

// ─── Data ───────────────────────────────────────────────────────────────────

const VERTICALS = {
  fitness: {
    name: 'Fitness (Academias)',
    description: 'Vertical de gestão de academias: controle de acesso, matrículas, frequência, risk de churn, billing e jornada do aluno.',
    businessModels: [
      '- Membership: planos mensais/trimestrais/anuais com renovação automática',
      '- Pay-per-use: check-in avulso com créditos',
      '- Session Bundles: pacotes de aulas (personal trainer, yoga, spinning)',
      '- Corporate: convênios empresa com billing centralizado'
    ],
    kpis: [
      '- Taxa de ocupação (check-ins/dia vs capacidade)',
      '- Frequência semanal média por aluno',
      '- Churn rate mensal',
      '- LTV (Lifetime Value) por membership',
      '- Taxa de conversão lead → matrícula',
      '- No-show rate por horário/professor'
    ],
    journeys: [
      { id: 'fitness_new_customer', desc: 'Cadastro de novo aluno com matrícula e primeiro acesso' },
      { id: 'fitness_active_customer', desc: 'Aluno ativo: check-in diário, aulas, renovações' },
      { id: 'fitness_customer_checkin', desc: 'Check-in presencial com validação de acesso e membership' },
      { id: 'fitness-matricula-leads', desc: 'Conversão de lead em matrícula ativa com campanha' },
      { id: 'fitness_churn_risk', desc: 'Detecção e prevenção de churn com follow-up automático' },
      { id: 'fitness_membership_renewal', desc: 'Renovação de membership com grace period' },
      { id: 'fitness_block_followup', desc: 'Follow-up pós-bloqueio de acesso por inadimplência' },
      { id: 'fitness_low_frequency', desc: 'Alerta de baixa frequência com sugestão de aulas' }
    ],
    integrations: [
      '- WhatsApp Business API: notificações de check-in, lembrete de aula, cobrança',
      '- Catraca/Controle de acesso físico: POST /api/fitness/attendance/check-in',
      '- Webhook de pagamento: atualização automática de membership status',
      '- Dashboard operacional: métricas em tempo real por unidade'
    ],
    apiRoutes: [
      { method: 'POST', path: '/api/fitness/attendance/check-in', description: 'Registrar check-in do aluno na catraca', params: 'subjectId, unitId, accessType', response: 'AccessDecision {allowed, reason, membershipStatus}' },
      { method: 'POST', path: '/api/fitness/attendance/check-out', description: 'Registrar saída do aluno', params: 'subjectId, unitId', response: 'AttendanceRecord' },
      { method: 'GET', path: '/api/fitness/subject/:id/attendance', description: 'Histórico de frequência do aluno', params: 'subjectId, dateFrom, dateTo', response: '[AttendanceRecord]' },
      { method: 'GET', path: '/api/fitness/subject/:id/access-status', description: 'Status de elegibilidade de acesso', params: 'subjectId', response: '{eligible, reason, membershipStatus, planType}' },
      { method: 'GET', path: '/api/fitness/subject/:id/churn-risk', description: 'Score de risco de churn', params: 'subjectId', response: '{riskScore, factors[], recommendations[]}' },
      { method: 'GET', path: '/api/fitness/subject/:id/timeline', description: 'Timeline operacional do aluno', params: 'subjectId', response: '[TimelineEvent]' },
      { method: 'GET', path: '/api/fitness/metrics', description: 'KPIs agregados por tenant', params: 'tenantId, unitId, dateFrom, dateTo', response: '{occupancy, frequency, churnRate, ltv, conversionRate}' },
      { method: 'GET', path: '/api/fitness/memberships', description: 'Listar memberships do tenant', params: 'tenantId, status, planType', response: '[Membership]' },
      { method: 'GET', path: '/api/fitness/membership/:id', description: 'Detalhe da membership', params: 'membershipId', response: 'Membership {status, planType, startDate, endDate, billing}' },
      { method: 'PATCH', path: '/api/fitness/membership/:id/billing', description: 'Atualizar status de billing', params: 'membershipId, billingStatus', response: 'Membership' },
      { method: 'PATCH', path: '/api/fitness/membership/:id/details', description: 'Atualizar datas/plano', params: 'membershipId, startDate, endDate, planType', response: 'Membership' },
      { method: 'POST', path: '/api/fitness/membership/:id/grace-period', description: 'Iniciar período de graça', params: 'membershipId, days', response: '{graceUntil, status}' },
      { method: 'POST', path: '/api/fitness/membership/:id/renew', description: 'Processar renovação', params: 'membershipId, planType, duration', response: 'Membership {status: active}' },
      { method: 'GET', path: '/api/fitness/students/search', description: 'Buscar alunos', params: 'q, unitId, status', response: '[Student]' },
      { method: 'GET', path: '/api/fitness/student/:id/detail', description: 'Detalhe completo do aluno', params: 'id', response: 'Student {profile, membership, attendance, timeline}' },
      { method: 'POST', path: '/api/fitness/journey/event', description: 'Emitir evento de jornada', params: 'subjectId, eventType, payload', response: 'JourneyEvent' },
      { method: 'GET', path: '/api/fitness/intelligence/:subjectId', description: 'Insights IA do aluno', params: 'subjectId', response: '{recommendations, riskFactors, nextBestAction}' }
    ],
    businessNeeds: `## Dores do Cliente
1. Controle de acesso manual → automatizar com catraca + API
2. Cobrança manual de mensalidades → integrar com gateway de pagamento
3. Perda de alunos sem aviso prévio → churn prediction + follow-up automático
4. Baixa frequência sem intervenção → alertas proativos e sugestão de aulas
5. Falta de visibilidade operacional → dashboard em tempo real

## Funcionalidades Core
- Check-in/check-out via catraca com validação de membership
- Gestão de memberships (planos, billing, grace period, renovação)
- Detecção de churn com score de risco e recomendações
- Integração WhatsApp para notificações e follow-up
- Dashboard de métricas (ocupação, frequência, churn, LTV)

## Fluxo de Caixa
- Recorrência mensal via membership (fonte principal)
- Aulas avulsas e personal trainer (receita adicional)
- Corporate: contratos anuais com empresas

## Requisitos Regulatórios
- LGPD: consentimento para dados de saúde e frequência
- Controle de acesso: registro de entrada/saída obrigatório
- Nota fiscal: integração com prefeitura para ISS`
  },
  beauty: {
    name: 'Beauty (Salões de Beleza)',
    description: 'Vertical de gestão de salões: agendamento, campanhas, leads, pagamentos, jornada do cliente e fidelidade.',
    businessModels: [
      '- Serviços avulsos: agendamento e pagamento por serviço',
      '- Pacotes (Bundles): combos de serviços com desconto',
      '- Programa de fidelidade: pontos por serviço e indicação',
      '- Campanhas: prospecção de leads com jornada de conversão'
    ],
    kpis: [
      '- Taxa de ocupação de agenda por profissional',
      '- Ticket médio por cliente',
      '- Taxa de retorno (rebooking rate)',
      '- Taxa de conversão lead → cliente',
      '- No-show rate',
      '- NPS por serviço/profissional'
    ],
    journeys: [
      { id: 'beauty_new_customer', desc: 'Cadastro de novo cliente com primeira visita' },
      { id: 'beauty_booking', desc: 'Agendamento de serviço com confirmação e lembrete' },
      { id: 'beauty-campanha-lead-pagamento', desc: 'Campanha de lead com jornada até pagamento' },
      { id: 'beauty_no_show', desc: 'Tratamento de no-show com follow-up' },
      { id: 'beauty_reactivation', desc: 'Reativação de clientes inativos' },
      { id: 'beauty_loyalty', desc: 'Programa de fidelidade e recompensas' }
    ],
    integrations: [
      '- WhatsApp Business API: confirmação de agendamento, lembrete 24h/1h, follow-up pós-serviço',
      '- Gateway de pagamento: checkout integrado no agendamento',
      '- Google Calendar: sincronização de agenda do profissional',
      '- Dashboard operacional: métricas em tempo real por unidade/profissional'
    ],
    apiRoutes: [
      { method: 'GET', path: '/api/beauty/agenda', description: 'Agenda do profissional/unidade', params: 'professionalId, unitId, date', response: '[Appointment]' },
      { method: 'POST', path: '/api/beauty/agenda', description: 'Criar agendamento', params: 'customerId, professionalId, serviceId, datetime', response: 'Appointment' },
      { method: 'GET', path: '/api/beauty/customers/search', description: 'Buscar clientes', params: 'q, phone, email', response: '[Customer]' },
      { method: 'GET', path: '/api/beauty/customers/:id/detail', description: 'Detalhe do cliente', params: 'id', response: 'Customer {profile, appointments, payments, loyalty}' },
      { method: 'GET', path: '/api/beauty/campaigns', description: 'Listar campanhas ativas', params: 'tenantId', response: '[Campaign]' },
      { method: 'POST', path: '/api/beauty/campaigns', description: 'Criar campanha', params: 'name, target, template, channels', response: 'Campaign' },
      { method: 'GET', path: '/api/beauty/leads', description: 'Listar leads', params: 'tenantId, campaignId, status', response: '[Lead]' },
      { method: 'POST', path: '/api/beauty/leads/convert', description: 'Converter lead em cliente', params: 'leadId, customerData', response: 'Customer' },
      { method: 'GET', path: '/api/beauty/payments', description: 'Listar pagamentos', params: 'tenantId, customerId, status', response: '[Payment]' },
      { method: 'POST', path: '/api/beauty/payments', description: 'Registrar pagamento', params: 'customerId, appointmentId, amount, method', response: 'Payment' },
      { method: 'GET', path: '/api/beauty/journey/:customerId', description: 'Jornada do cliente', params: 'customerId', response: '[JourneyEvent]' },
      { method: 'POST', path: '/api/beauty/journey/event', description: 'Emitir evento de jornada', params: 'customerId, eventType, payload', response: 'JourneyEvent' },
      { method: 'GET', path: '/api/beauty/reminders', description: 'Lembretes pendentes', params: 'tenantId, date', response: '[Reminder]' },
      { method: 'GET', path: '/api/beauty/bundles', description: 'Pacotes de serviço', params: 'tenantId', response: '[Bundle]' },
      { method: 'GET', path: '/api/beauty/loyalty/:customerId', description: 'Status de fidelidade', params: 'customerId', response: '{points, tier, rewards}' },
      { method: 'GET', path: '/api/beauty/intelligence/:customerId', description: 'Insights IA do cliente', params: 'customerId', response: '{recommendations, upsellSuggestions, bestSchedule}' },
      { method: 'GET', path: '/api/beauty/metrics', description: 'Métricas agregadas', params: 'tenantId, unitId, dateFrom, dateTo', response: '{occupancy, ticket, rebooking, conversion, noShow, nps}' },
      { method: 'GET', path: '/api/beauty/services', description: 'Catálogo de serviços', params: 'tenantId, category', response: '[Service]' }
    ],
    businessNeeds: `## Dores do Cliente
1. Agenda manual com conflitos → agendamento online integrado
2. No-show sem follow-up → lembrete automático 24h/1h + follow-up pós-falta
3. Perda de leads sem nutrição → campanha multicanal com jornada de conversão
4. Clientes inativos sem reativação → programa de fidelidade + campanhas de reativação
5. Falta de upsell → recomendação inteligente de serviços complementares

## Funcionalidades Core
- Agendamento online com escolha de profissional, serviço e horário
- Campanhas de marketing com jornada de lead → cliente
- Lembretes automáticos (24h, 1h antes) com confirmação
- Programa de fidelidade com pontos e recompensas
- Recomendações inteligentes de upsell e cross-sell

## Fluxo de Caixa
- Serviços avulsos (receita principal)
- Pacotes/bundles pré-pagos (fluxo antecipado)
- Indicação de clientes (aquisição orgânica)

## Requisitos Regulatórios
- LGPD: consentimento para dados de contato e preferências
- Vigilância sanitária: registro de produtos e procedimentos
- Nota fiscal: integração com prefeitura para ISS`
  },
  clinic: {
    name: 'Clinic (Clínicas & Saúde)',
    description: 'Vertical de gestão de clínicas: agendamento de consultas, prontuário, tickets, jornada do paciente e calendário médico.',
    businessModels: [
      '- Consulta particular: agendamento e pagamento por consulta',
      '- Convênio: integração com operadoras de saúde (TISS/TUSS)',
      '- Pacotes: check-up preventivo, acompanhamento gestacional',
      '- Telemedicina: consulta online com vídeo chamada'
    ],
    kpis: [
      '- Taxa de ocupação da agenda médica por profissional',
      '- Tempo médio de espera (sala de espera)',
      '- Taxa de no-show (falta em consultas)',
      '- Taxa de retorno (reconsulta)',
      '- Ticket médio por paciente',
      '- Satisfação NPS por profissional/especialidade'
    ],
    journeys: [
      { id: 'clinic_default_journey', desc: 'Jornada padrão: agendamento → confirmação → consulta → retorno' },
      { id: 'clinic_calendar_block_flow', desc: 'Fluxo de bloqueio/liberação de horários na agenda médica' },
      { id: 'clinic-ticket-manutencao', desc: 'Abertura e acompanhamento de ticket de manutenção' },
      { id: 'business-clinic-flow-ticket', desc: 'Fluxo de negócio: ticket clínico com etapas de triagem e resolução' },
      { id: 'business-clinic-scr-01', desc: 'Cenário 01: script de atendimento com coleta de sintomas e encaminhamento' }
    ],
    integrations: [
      '- WhatsApp Business API: confirmação de consulta, lembrete 24h/1h, resultado de exames',
      '- TISS (Troca de Informações em Saúde Suplementar): integração com operadoras',
      '- Google Calendar: sincronização bidirecional da agenda do médico',
      '- Gateway de pagamento: checkout integrado no agendamento',
      '- PEP (Prontuário Eletrônico do Paciente): integração com sistemas legados'
    ],
    apiRoutes: [
      { method: 'POST', path: '/api/clinic/appointment', description: 'Criar agendamento de consulta', params: 'patientId, doctorId, datetime, speciality, type', response: 'Appointment {id, status, confirmationCode}' },
      { method: 'GET', path: '/api/clinic/agenda/:doctorId', description: 'Agenda do médico por data', params: 'doctorId, date, unitId', response: '[Slot {time, available, patient}]' },
      { method: 'PATCH', path: '/api/clinic/appointment/:id', description: 'Atualizar consulta (remarcar, cancelar)', params: 'id, action, newDateTime', response: 'Appointment' },
      { method: 'GET', path: '/api/clinic/patients/search', description: 'Buscar pacientes', params: 'q, cpf, phone, email', response: '[Patient {id, name, lastVisit}]' },
      { method: 'GET', path: '/api/clinic/patient/:id/detail', description: 'Detalhe do paciente + prontuário', params: 'id', response: 'Patient {profile, history, appointments, exams}' },
      { method: 'GET', path: '/api/clinic/metrics', description: 'KPIs da clínica', params: 'tenantId, unitId, dateFrom, dateTo', response: '{occupancy, noShowRate, avgWaitTime, ticketMedio, nps}' },
      { method: 'GET', path: '/api/clinic/dashboard', description: 'Dashboard operacional', params: 'tenantId', response: '{todayAppointments, waitingRoom, completedToday, alerts}' },
      { method: 'POST', path: '/api/clinic/journey/event', description: 'Emitir evento na jornada do paciente', params: 'patientId, eventType, payload', response: 'JourneyEvent' },
      { method: 'GET', path: '/api/clinic/intelligence/:patientId', description: 'Insights IA do paciente', params: 'patientId', response: '{riskFactors, reminders, followUpSuggestions}' }
    ],
    businessNeeds: `## Dores do Cliente
1. Agenda manual com overbooking → agendamento online com bloqueio inteligente
2. No-show elevado → lembrete automático 24h/1h + confirmação via WhatsApp
3. Prontuário físico desorganizado → prontuário eletrônico integrado
4. Falta de follow-up pós-consulta → lembrete automático de retorno e exames
5. Gestão financeira manual → integração TISS com operadoras + billing automático
6. Sala de espera lotada → gestão de fila com tempo estimado e notificações

## Funcionalidades Core
- Agenda médica com bloqueio de horários por especialidade/profissional
- Confirmação de consulta via WhatsApp (template aprovado)
- Prontuário eletrônico com histórico de consultas e exames
- Gestão de fila de espera com senha e tempo estimado
- Integração TISS para faturamento de convênios

## Fluxo de Caixa
- Consultas particulares (receita principal)
- Convênios com repasse mensal (TISS)
- Pacotes de check-up (receita antecipada)
- Telemedicina (receita adicional)

## Requisitos Regulatórios
- LGPD: dados de saúde são sensíveis — consentimento explícito obrigatório
- CFM: prontuário eletrônico deve seguir resolução CFM 1.821/07
- ANS: integração TISS obrigatória para clínicas com convênio
- Vigilância Sanitária: alvará e registro de estabelecimento`
  }
};

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  console.log(`🔍 RAG Vertical Indexer ${dryRun ? '(DRY RUN)' : ''}`);
  console.log(`   RAG: ${RAG_BASE}\n`);

  if (!dryRun && !String(RAG_TOKEN).trim()) {
    throw new Error('RAG_INTERNAL_TOKEN não configurado');
  }

  let totalDocs = 0;
  let successDocs = 0;
  const failures = [];

  for (const [vertical, info] of Object.entries(VERTICALS)) {
    console.log(`\n📦 Vertical: ${vertical.toUpperCase()}`);

    // 1. Overview
    const overview = buildVerticalOverview(vertical, info);
    totalDocs++;
    if (!dryRun) {
      const res = await postJSON('/rag/index', overview);
      if (res.status === 200) {
        successDocs++;
        console.log(`   ✅ overview (${res.data.chunksCreated} chunks)`);
      } else {
        failures.push({ vertical, doc: 'overview', status: res.status, error: JSON.stringify(res.data).slice(0, 100) });
        console.log(`   ❌ overview: ${res.status} ${JSON.stringify(res.data).slice(0, 80)}`);
      }
    } else {
      console.log(`   📝 overview (${overview.document.content.length} chars)`);
    }

    // 2. API Routes
    const routes = buildVerticalAPIRoutes(vertical, info.apiRoutes);
    totalDocs++;
    if (!dryRun) {
      const res = await postJSON('/rag/index', routes);
      if (res.status === 200) {
        successDocs++;
        console.log(`   ✅ api-routes (${res.data.chunksCreated} chunks)`);
      } else {
        failures.push({ vertical, doc: 'api-routes', status: res.status, error: JSON.stringify(res.data).slice(0, 100) });
        console.log(`   ❌ api-routes: ${res.status}`);
      }
    } else {
      console.log(`   📝 api-routes (${routes.document.content.length} chars)`);
    }

    // 3. Journeys
    const journeys = buildVerticalJourneys(vertical, info.journeys);
    totalDocs++;
    if (!dryRun) {
      const res = await postJSON('/rag/index', journeys);
      if (res.status === 200) {
        successDocs++;
        console.log(`   ✅ journeys (${res.data.chunksCreated} chunks)`);
      } else {
        failures.push({ vertical, doc: 'journeys', status: res.status, error: JSON.stringify(res.data).slice(0, 100) });
        console.log(`   ❌ journeys: ${res.status}`);
      }
    } else {
      console.log(`   📝 journeys (${journeys.document.content.length} chars)`);
    }

    // 4. Business Needs
    const needs = buildVerticalBusinessNeeds(vertical, info.businessNeeds);
    totalDocs++;
    if (!dryRun) {
      const res = await postJSON('/rag/index', needs);
      if (res.status === 200) {
        successDocs++;
        console.log(`   ✅ business-needs (${res.data.chunksCreated} chunks)`);
      } else {
        failures.push({ vertical, doc: 'business-needs', status: res.status, error: JSON.stringify(res.data).slice(0, 100) });
        console.log(`   ❌ business-needs: ${res.status}`);
      }
    } else {
      console.log(`   📝 business-needs (${needs.document.content.length} chars)`);
    }
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log(`📊 Resultado: ${successDocs}/${totalDocs} docs indexados`);
  if (failures.length > 0) {
    console.log(`❌ Falhas:`);
    failures.forEach(f => console.log(`   - ${f.vertical}/${f.doc}: ${f.status} ${f.error}`));
  }
  console.log(`${'='.repeat(60)}`);
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
