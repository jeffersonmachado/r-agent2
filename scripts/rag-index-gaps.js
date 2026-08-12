'use strict';

/**
 * Indexa TODOS os gaps de conhecimento na RAG:
 * - Verticais restantes: core, food, market, services
 * - Agent OS + Cognitive Core + Agent Runtime + MCP
 * - PBX/IVR + Omnichannel + Arquitetura
 * - Learning Core + QA Waves + Operational Rules + Replay Governance
 */

const fs = require('fs');
const path = require('path');
const http = require('http');

const RAG_BASE = process.env.RAG_BASE_URL || 'http://10.10.2.30:8002';
const ROOT = process.env.RAG_REPO_ROOT || '/opt/results/ria/r-agent2';

function postJSON(urlPath, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, RAG_BASE);
    const data = JSON.stringify(body);
    const opts = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
      },
    };
    const req = http.request(opts, (res) => {
      let b = '';
      res.on('data', (c) => (b += c));
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(b) });
        } catch {
          resolve({ status: res.statusCode, data: b });
        }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function readMem(file) {
  try {
    return fs.readFileSync(path.join(ROOT, 'AI_MEMORY', file), 'utf-8');
  } catch {
    return null;
  }
}

function makeDoc(id, content, category, extra = {}) {
  return {
    document: {
      id,
      tenantId: 'system',
      domain: 'OPERATIONAL',
      classification: category,
      sensitivity: 'internal',
      content,
      metadata: { category, version: '1.0', generatedAt: new Date().toISOString(), ...extra },
      permissions: { readRoles: ['super_admin', 'auditor', 'agent'], readTenants: ['system'] },
    },
  };
}

// ─── Documentos ─────────────────────────────────────────────────────────────

const DOCS = [];

// 1. Vertical Core — journeys
const coreJourneys = [
  'support_ticket_flow: abertura, triagem, atendimento e resolução de tickets',
  'booking_flow: agendamento com confirmação e lembretes',
  'payment_charge_flow: cobrança com retry e fallback',
  'campaigns_flow: campanhas multicanal com segmentação',
  'inbox_flow: caixa de entrada unificada com fila',
  'cognitive_assistant_flow: assistente com pipeline cognitivo',
  'billing_flow: faturamento, assinaturas e membership',
  'whatsapp_connections_flow: conexão e gestão de canais WhatsApp',
  'agent_factory_flow: criação, configuração, validação e publicação de agentes',
  'agent_orchestrator_flow: orquestração de intents entre agentes',
  'knowledge_graph_flow: consulta e upsert no grafo de conhecimento',
  'journey_registry_flow: registro e seed de jornadas',
  'rap_learn_flow: detecção de regressão, classificação e promoção',
  'ai_governance_flow: audit trail, decision log e compliance',
  'rbac_access_control_flow: controle de acesso por papel',
  'mfa_flow: autenticação multi-fator',
  'sso_scim_flow: SSO e provisionamento SCIM',
  'backup_restore_flow: backup e recuperação',
  'automations_flow: automações de fluxo',
  'projects_flow: gestão de projetos',
  'tasks_flow: gestão de tarefas',
  'physical_queue_flow: fila física com senha',
  'kitchen_dispatch_flow: despacho de cozinha (food)',
  'knowledge_base_flow: artigos e FAQ',
  'analytics_flow: métricas e relatórios',
  'templates_flow: templates de WhatsApp e solução',
  'departments_flow: departamentos e equipes',
  'queues_flow: filas de atendimento',
  'close_reasons_flow: motivos de fechamento',
  'handover_flow: handoff humano',
  'web_scraping_flow: raspagem de sites',
  'bulk_messaging_flow: disparos em massa',
  'failed_messages_flow: falhas de entrega',
];
DOCS.push(
  makeDoc(
    'vertical-core-journeys-2026-08',
    `# Vertical Core — Jornadas\n\nA vertical Core contém as jornadas de negócio centrais da plataforma (não-verticals específicas).\n\n${coreJourneys
      .map((j) => `- ${j}`)
      .join('\n')}\n\nCada jornada tem contrato, pré-condições, steps e cenários no QA Mesh.`,
    'business-process',
    { vertical: 'core' }
  )
);

// 2. Vertical Food
DOCS.push(
  makeDoc(
    'vertical-food-2026-08',
    `# Vertical: Food (Restaurantes/Delivery)\n\n## Jornadas\n- food_customer_journey: cliente faz pedido, acompanha preparo e recebe\n- food_order_flow: pedido → cozinha → despacho → entrega\n\n## KPIs\n- Tempo médio de preparo\n- Taxa de cancelamento\n- Ticket médio por pedido\n- Tempo de entrega\n\n## Integrações\n- WhatsApp (cardápio, pedido, status)\n- Kitchen Display System (despacho de cozinha)\n- Gateway de pagamento\n- Delivery partners`,
    'business-context',
    { vertical: 'food' }
  )
);

// 3. Vertical Market
DOCS.push(
  makeDoc(
    'vertical-market-2026-08',
    `# Vertical: Market (Marketplace)\n\n## Jornadas\n- market_default_journey: publicação de produto, pedido, venda\n\n## Funcionalidades\n- Cadastro de produtos\n- Pedidos e carrinho\n- Vendedores (sellers)\n- Comissão e repasse\n\n## Integrações\n- Gateway de pagamento\n- Logística/entrega\n- Notificações via WhatsApp`,
    'business-context',
    { vertical: 'market' }
  )
);

// 4. Vertical Services
DOCS.push(
  makeDoc(
    'vertical-services-2026-08',
    `# Vertical: Services (Serviços)\n\n## Jornadas\n- services_default_journey: orçamento → contratação → execução → pagamento\n\n## Funcionalidades\n- Catálogo de serviços\n- Orçamento e proposta\n- Agendamento\n- Avaliação pós-serviço\n\n## Integrações\n- WhatsApp (proposta, acompanhamento)\n- Pagamento\n- Agenda`,
    'business-context',
    { vertical: 'services' }
  )
);

// 5. Agent OS (a partir do AI_MEMORY)
const agentOs = readMem('agent-os.md');
if (agentOs) {
  DOCS.push(makeDoc('platform-agent-os-2026-08', agentOs, 'architecture', { domain: 'agent-os' }));
}

// 6. Architecture (a partir do AI_MEMORY)
const architecture = readMem('architecture.md');
if (architecture) {
  DOCS.push(makeDoc('platform-architecture-2026-08', architecture, 'architecture', { domain: 'platform' }));
}

// 7. PBX/IVR
const pbx = readMem('pbx-ivr.md');
if (pbx) {
  DOCS.push(makeDoc('platform-pbx-ivr-2026-08', pbx, 'architecture', { domain: 'pbx' }));
}

// 8. Omnichannel
const omni = readMem('omnichannel.md');
if (omni) {
  DOCS.push(makeDoc('platform-omnichannel-2026-08', omni, 'business-process', { domain: 'omnichannel' }));
}

// 9. Learning Core
const learning = readMem('learning-core.md');
if (learning) {
  DOCS.push(makeDoc('platform-learning-core-2026-08', learning, 'architecture', { domain: 'learning' }));
}

// 10. QA Waves
const qaWaves = readMem('qa-waves.md');
if (qaWaves) {
  DOCS.push(makeDoc('platform-qa-waves-2026-08', qaWaves, 'governance', { domain: 'qa' }));
}

// 11. Operational Rules
const opRules = readMem('operational-rules.md');
if (opRules) {
  DOCS.push(makeDoc('platform-operational-rules-2026-08', opRules, 'governance', { domain: 'operations' }));
}

// 12. Replay Governance
const replay = readMem('replay-governance.md');
if (replay) {
  DOCS.push(makeDoc('platform-replay-governance-2026-08', replay, 'governance', { domain: 'replay' }));
}

// 13. RAG Rules
const ragRules = readMem('rag-rules.md');
if (ragRules) {
  DOCS.push(makeDoc('platform-rag-rules-2026-08', ragRules, 'architecture', { domain: 'rag' }));
}

// 14. Self-Proving Rules
const selfProving = readMem('self-proving-rules.md');
if (selfProving) {
  DOCS.push(makeDoc('platform-self-proving-2026-08', selfProving, 'governance', { domain: 'self-proving' }));
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  console.log(`🔍 RAG Gaps Indexer ${dryRun ? '(DRY RUN)' : ''}`);
  console.log(`   RAG: ${RAG_BASE}`);
  console.log(`   ${DOCS.length} documentos\n`);

  let ok = 0;
  const failures = [];

  for (const doc of DOCS) {
    const id = doc.document.id;
    const size = doc.document.content.length;
    if (dryRun) {
      console.log(`   📝 ${id} (${size} chars)`);
      continue;
    }
    try {
      const res = await postJSON('/rag/index', doc);
      if (res.status === 200) {
        ok++;
        console.log(`   ✅ ${id} (${res.data.chunksCreated} chunks)`);
      } else {
        failures.push({ id, status: res.status, error: JSON.stringify(res.data).slice(0, 120) });
        console.log(`   ❌ ${id}: ${res.status} ${JSON.stringify(res.data).slice(0, 80)}`);
      }
    } catch (err) {
      failures.push({ id, status: 'ERR', error: err.message });
      console.log(`   ❌ ${id}: ${err.message}`);
    }
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log(`📊 Resultado: ${ok}/${DOCS.length} docs indexados`);
  if (failures.length) {
    console.log('❌ Falhas:');
    failures.forEach((f) => console.log(`   - ${f.id}: ${f.status} ${f.error}`));
  }
  console.log(`${'='.repeat(60)}`);
}

main().catch((err) => {
  console.error('FATAL:', err.message);
  process.exit(1);
});
