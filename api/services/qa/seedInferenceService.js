const logger = require('../../utils/logger');

/**
 * Gera seeds automaticamente para uma capability
 * Cobre: happy path, edge cases, failure paths, stress paths
 */

const SEED_TEMPLATES = {
  happy_path: {
    name: 'happy_path_{capability}',
    description: 'Fluxo feliz: operação bem-sucedida com dados válidos',
    priority: 'critical',
  },
  empty_input: {
    name: 'edge_empty_input_{capability}',
    description: 'Validação de entrada vazia',
    priority: 'high',
  },
  invalid_format: {
    name: 'edge_invalid_format_{capability}',
    description: 'Validação de formato inválido',
    priority: 'high',
  },
  max_length: {
    name: 'edge_max_length_{capability}',
    description: 'Teste com máximo de caracteres',
    priority: 'medium',
  },
  special_chars: {
    name: 'edge_special_chars_{capability}',
    description: 'Teste com caracteres especiais/SQL injection',
    priority: 'high',
  },
  concurrent_access: {
    name: 'stress_concurrent_{capability}',
    description: 'Múltiplos acessos simultâneos',
    priority: 'medium',
  },
  timeout_condition: {
    name: 'failure_timeout_{capability}',
    description: 'Simulação de timeout/delay',
    priority: 'high',
  },
  dependency_missing: {
    name: 'failure_missing_dep_{capability}',
    description: 'Dependência externa indisponível',
    priority: 'high',
  },
  permission_denied: {
    name: 'failure_no_permission_{capability}',
    description: 'Usuário sem permissão',
    priority: 'high',
  },
  data_conflict: {
    name: 'failure_conflict_{capability}',
    description: 'Conflito de dados (race condition)',
    priority: 'medium',
  },
};

/**
 * Domain-specific seed data
 */
const DOMAIN_SEEDS = {
  support_ticket: {
    operational_strict: {
      journeyId: 'support_ticket_flow',
      provisioning: {
        guaranteedTicketProvisioning: true,
        requireOpenTicket: true,
        requireConversation: true,
      },
      expectedOperationalActions: [
        'access_support_module',
        'list_tickets',
        'open_ticket',
        'reply_ticket',
        'change_ticket_status',
      ],
      expectedSideEffects: ['ticket_status_changed', 'crm_updated', 'audit_log_created', 'notification_sent'],
      ticketId: 'TICKET-STRICT-001',
      agentId: 'AGENT-STRICT-001',
      reply: 'Resposta operacional validada com persistência e auditoria.',
      attachments: [],
    },
    happy_path: {
      ticketId: 'TICKET-001',
      agentId: 'AGENT-001',
      reply: 'Tudo bem, deixa comigo!',
      attachments: [],
    },
    empty_input: {
      ticketId: 'TICKET-001',
      agentId: 'AGENT-001',
      reply: '',
    },
    invalid_format: {
      ticketId: 'invalid_id',
      agentId: 'invalid_agent',
      reply: 'test',
    },
    permission_denied: {
      ticketId: 'TICKET-001',
      agentId: 'UNAUTHORIZED_AGENT',
      reply: 'test',
    },
    timeout_condition: {
      ticketId: 'TICKET-001',
      agentId: 'AGENT-001',
      reply: 'test',
      networkDelay: 5000,
    },
  },
  crm_contact: {
    happy_path: {
      firstName: 'John',
      lastName: 'Doe',
      email: 'john@example.com',
      phone: '+55 11 99999-9999',
    },
    empty_input: {
      firstName: '',
      lastName: '',
      email: '',
    },
    invalid_format: {
      firstName: 'John',
      lastName: 'Doe',
      email: 'not-an-email',
      phone: 'not-a-phone',
    },
    max_length: {
      firstName: 'A'.repeat(1000),
      lastName: 'B'.repeat(1000),
      email: 'c@example.com',
    },
    special_chars: {
      firstName: 'John<script>alert(1)</script>',
      lastName: 'Doe" OR "1"="1',
      email: "admin'--",
    },
  },
  fitness_checkin: {
    operational_strict: {
      journeyId: 'fitness_customer_checkin',
      provisioning: {
        requireCrmCustomer: true,
        requireActiveMembership: true,
        requireValidCredential: true,
        requireRealDeviceEvidence: true,
      },
      expectedOperationalActions: [
        'identify_customer',
        'validate_membership',
        'validate_credential',
        'evaluate_access_decision',
        'create_access_event',
        'create_attendance',
        'update_crm',
      ],
      expectedSideEffects: ['access_decision_allow', 'attendance_recorded', 'crm_presence_updated'],
      memberId: 'MEM-STRICT-001',
      contactId: 'CONT-STRICT-001',
      deviceId: 'DEV-STRICT-001',
      deviceEvidence: 'device_real_candidate',
      accessDecision: 'ALLOW',
    },
    happy_path: {
      memberId: 'MEM-001',
      contactId: 'CONT-001',
      deviceId: 'DEV-001',
    },
    empty_input: {
      memberId: '',
      contactId: '',
      deviceId: '',
    },
    invalid_format: {
      memberId: 'invalid',
      contactId: 'invalid',
      deviceId: 'invalid',
    },
    permission_denied: {
      memberId: 'MEM-EXPIRED',
      contactId: 'CONT-001',
      deviceId: 'DEV-001',
    },
  },
  billing_charge: {
    happy_path: {
      subscriptionId: 'SUB-001',
      amount: 99.99,
      currency: 'BRL',
    },
    empty_input: {
      subscriptionId: '',
      amount: 0,
      currency: '',
    },
    invalid_format: {
      subscriptionId: 'invalid',
      amount: -100,
      currency: 'INVALID',
    },
    timeout_condition: {
      subscriptionId: 'SUB-001',
      amount: 99.99,
      currency: 'BRL',
      networkDelay: 10000,
    },
  },
  turnstile_access: {
    happy_path: {
      accessDecision: 'ALLOW',
      deviceId: 'DEV-001',
      contactId: 'CONT-001',
    },
    invalid_format: {
      accessDecision: 'MAYBE',
      deviceId: 'invalid',
      contactId: 'invalid',
    },
    permission_denied: {
      accessDecision: 'DENY',
      reason: 'ACCESS_DENIED',
    },
  },
};

/**
 * Infere domain-specific seeds para uma capability
 */
function inferDomainSpecificSeeds(capability = {}, availableSeeds = DOMAIN_SEEDS) {
  const capName = capability.name || capability.id || '';
  const capLower = capName.toLowerCase();
  const capCompact = capLower.replace(/[^a-z0-9]/g, '');

  // Find matching domain
  for (const [domain, seeds] of Object.entries(availableSeeds)) {
    const normalizedDomain = domain.replace(/[^a-z0-9]/g, '');
    const domainTokens = domain.split('_').filter(Boolean);
    const hasTokenMatch = domainTokens.some((token) => capLower.includes(token));
    if (capCompact.includes(normalizedDomain) || hasTokenMatch) {
      return Object.entries(seeds).map(([seedType, data]) => ({
        type: seedType,
        data,
        domain,
        inferred: true,
      }));
    }
  }

  return [];
}

/**
 * Gera seeds completos para uma capability
 */
function generateSeedsForCapability(capability = {}) {
  const capId = capability.id || capability.name || '';
  const seeds = [];

  // 1. Tentar domain-specific seeds
  const domainSeeds = inferDomainSpecificSeeds(capability);
  if (domainSeeds.length > 0) {
    seeds.push(...domainSeeds);
  }

  // 2. Se não encontrou, gerar templates genéricos
  if (seeds.length === 0) {
    for (const [templateKey, template] of Object.entries(SEED_TEMPLATES)) {
      seeds.push({
        name: template.name.replace('{capability}', capId),
        type: templateKey,
        description: template.description,
        priority: template.priority,
        data: {},
        inferred: true,
      });
    }
  }

  return seeds;
}

/**
 * Gera mapa de seeds por capability
 */
function generateSeedsMap(capabilities = []) {
  const map = {};

  for (const capability of capabilities) {
    const capId = capability.id || capability.name;
    map[capId] = generateSeedsForCapability(capability);
  }

  return map;
}

/**
 * Classifica seeds por cobertura de path
 */
function classifySeedsByPath(seeds = []) {
  return {
    happy_path: seeds.filter((s) => s.type === 'happy_path' || s.type?.includes('happy')),
    edge_cases: seeds.filter((s) => s.type?.includes('edge')),
    failure_paths: seeds.filter((s) => s.type?.includes('failure')),
    stress_paths: seeds.filter((s) => s.type?.includes('stress')),
  };
}

/**
 * Prioriza seeds para execução imediata
 */
function prioritizeSeeds(seeds = []) {
  return seeds.sort((a, b) => {
    const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
    const aPriority = priorityOrder[a.priority] ?? 999;
    const bPriority = priorityOrder[b.priority] ?? 999;
    return aPriority - bPriority;
  });
}

module.exports = {
  generateSeedsForCapability,
  generateSeedsMap,
  classifySeedsByPath,
  prioritizeSeeds,
  inferDomainSpecificSeeds,
};
