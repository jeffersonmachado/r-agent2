#!/usr/bin/env node
'use strict';

/**
 * Populate Agent OS: Knowledge Graph + Marketplace Agents
 * 
 * Usage: node scripts/populate-agent-os.js
 * 
 * Steps:
 * 1. Login as systemadmin
 * 2. Install and publish all 10 marketplace agents
 * 3. Create KG nodes for agents, journeys, customers
 * 4. Create KG edges (relationships)
 */

const BASE = 'http://localhost:3001';
const USERNAME = 'systemadmin';
const PASSWORD = 'Admin123!';

async function api(path, options = {}) {
  const url = `${BASE}${path}`;
  const headers = { 'Content-Type': 'application/json', ...options.headers };
  const res = await fetch(url, { ...options, headers });
  const data = await res.json();
  if (!res.ok) throw new Error(`${res.status} ${path}: ${data.error || data.message || 'unknown'}`);
  return data;
}

async function login() {
  const data = await api('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username: USERNAME, password: PASSWORD }),
  });
  return data.token;
}

// ============================================================
// Step 1: Install & Publish Marketplace Agents
// ============================================================
const MARKETPLACE_AGENTS = [
  'sdr-agent', 'crm-agent', 'support-agent', 'scheduling-agent',
  'collection-agent', 'campaign-agent', 'knowledge-agent',
  'qa-agent', 'discovery-agent', 'dev-agent',
];

async function installAndPublishAgents(token) {
  const headers = { Authorization: `Bearer ${token}` };
  const results = [];

  for (const slug of MARKETPLACE_AGENTS) {
    console.log(`  Installing: ${slug}...`);
    
    // Step 1: Install from marketplace
    const installData = await api('/api/agent-marketplace/install', {
      method: 'POST', headers, body: JSON.stringify({ slug }),
    });
    const agentId = installData.agent.id;
    
    // Step 2: Configure
    await api('/api/agent-factory/configure', {
      method: 'POST', headers,
      body: JSON.stringify({
        id: agentId,
        capabilities: installData.agent.capabilities || [],
        tools: installData.agent.tools || [],
        knowledgeSources: installData.agent.knowledgeSources || [],
      }),
    });

    // Step 3: Validate (QA Wave GO)
    await api('/api/agent-factory/validate', {
      method: 'POST', headers,
      body: JSON.stringify({ id: agentId, qaWaveResult: 'GO' }),
    });

    // Step 4: Approve
    await api('/api/agent-factory/approve', {
      method: 'POST', headers,
      body: JSON.stringify({ id: agentId, riskLevel: slug.includes('qa') || slug.includes('dev') ? 'low' : 'low', auditEnabled: true }),
    });

    // Step 5: Publish
    const pubData = await api('/api/agent-factory/publish', {
      method: 'POST', headers, body: JSON.stringify({ id: agentId }),
    });

    const agent = pubData.agent;
    results.push({ slug, id: agent.id, name: agent.name, classification: agent.classification });
    console.log(`    ✅ Published: ${agent.name} (${agent.classification})`);
  }

  return results;
}

// ============================================================
// Step 2: Create Knowledge Graph Nodes
// ============================================================
async function createKGNodes(token, agents) {
  const headers = { Authorization: `Bearer ${token}` };
  const nodes = [];
  
  console.log('\n  Creating Knowledge Graph nodes...');

  // Agent nodes
  for (const agent of agents) {
    const data = await api('/api/knowledge-graph/node', {
      method: 'POST', headers,
      body: JSON.stringify({
        type: 'Agent',
        label: agent.name,
        externalRef: agent.id,
        externalType: 'corporate_agent',
        properties: { slug: agent.slug, classification: agent.classification },
      }),
    });
    nodes.push({ ...data.node, agentSlug: agent.slug });
    console.log(`    Node: Agent/${agent.name}`);
  }

  // Journey nodes
  const journeys = [
    { type: 'Journey', label: 'Lead Conversion', domain: 'sales' },
    { type: 'Journey', label: 'Appointment Scheduling', domain: 'service' },
    { type: 'Journey', label: 'Fitness Check-in', domain: 'fitness' },
    { type: 'Journey', label: 'Customer Support', domain: 'support' },
    { type: 'Journey', label: 'Billing', domain: 'finance' },
    { type: 'Journey', label: 'Collection', domain: 'finance' },
    { type: 'Journey', label: 'Retention', domain: 'success' },
  ];

  const journeyNodes = [];
  for (const j of journeys) {
    const data = await api('/api/knowledge-graph/node', {
      method: 'POST', headers,
      body: JSON.stringify({
        type: j.type, label: j.label,
        properties: { domain: j.domain },
      }),
    });
    journeyNodes.push(data.node);
    console.log(`    Node: ${j.type}/${j.label}`);
  }

  // Customer node (demo)
  const custData = await api('/api/knowledge-graph/node', {
    method: 'POST', headers,
    body: JSON.stringify({
      type: 'Customer', label: 'Demo Customer',
      properties: { name: 'Maria Silva', email: 'maria@example.com', phone: '+5511999999999' },
    }),
  });
  const customerNode = custData.node;
  console.log(`    Node: Customer/Demo Customer`);

  // Conversation node
  const convData = await api('/api/knowledge-graph/node', {
    method: 'POST', headers,
    body: JSON.stringify({
      type: 'Conversation', label: 'WhatsApp Conversation #1',
      properties: { channel: 'whatsapp', status: 'completed' },
    }),
  });
  console.log(`    Node: Conversation/WhatsApp #1`);

  return { nodes, journeyNodes, customerNode, conversationNode: convData.node };
}

// ============================================================
// Step 3: Create Knowledge Graph Edges
// ============================================================
async function createKGEdges(token, { nodes, journeyNodes, customerNode, conversationNode }) {
  const headers = { Authorization: `Bearer ${token}` };
  let edgeCount = 0;

  console.log('\n  Creating Knowledge Graph edges...');

  // Helper
  const edge = async (sourceId, targetId, relationship, weight = 1.0) => {
    await api('/api/knowledge-graph/edge', {
      method: 'POST', headers,
      body: JSON.stringify({ sourceNodeId: sourceId, targetNodeId: targetId, relationship, weight }),
    });
    edgeCount++;
  };

  // Agent → Journey relationships
  const agentJourneyMap = {
    'sdr-agent': ['Lead Conversion'],
    'crm-agent': ['Lead Conversion', 'Customer Support', 'Retention'],
    'support-agent': ['Customer Support', 'Collection'],
    'scheduling-agent': ['Appointment Scheduling', 'Fitness Check-in'],
    'collection-agent': ['Billing', 'Collection'],
    'campaign-agent': ['Lead Conversion', 'Retention'],
    'knowledge-agent': ['Customer Support', 'Lead Conversion'],
    'qa-agent': ['Lead Conversion', 'Appointment Scheduling', 'Customer Support', 'Billing'],
    'discovery-agent': ['Retention', 'Lead Conversion'],
    'dev-agent': ['Lead Conversion', 'Customer Support'],
  };

  for (const agentNode of nodes) {
    const journeys = agentJourneyMap[agentNode.agentSlug] || [];
    for (const jName of journeys) {
      const jNode = journeyNodes.find(j => j.label === jName);
      if (jNode) {
        await edge(agentNode.id, jNode.id, 'covers');
      }
    }
  }
  console.log(`    Agent→Journey: ${edgeCount} edges`);

  // Customer → Conversation
  await edge(customerNode.id, conversationNode.id, 'participated_in');
  console.log(`    Customer→Conversation: 1 edge`);

  // Conversation → Journey (mapped to Customer Support)
  const supportJourney = journeyNodes.find(j => j.label === 'Customer Support');
  if (supportJourney) {
    await edge(conversationNode.id, supportJourney.id, 'belongs_to');
    console.log(`    Conversation→Journey: 1 edge`);
  }

  // Journey dependencies
  const leadConv = journeyNodes.find(j => j.label === 'Lead Conversion');
  const retention = journeyNodes.find(j => j.label === 'Retention');
  if (leadConv && retention) {
    await edge(leadConv.id, retention.id, 'feeds_into', 0.7);
    console.log(`    Journey→Journey: 1 edge`);
  }

  console.log(`    Total edges created: ${edgeCount + 3}`);
}

// ============================================================
// Step 4: Log governance events
// ============================================================
async function logGovernanceEvents(token, agents) {
  const headers = { Authorization: `Bearer ${token}` };
  console.log('\n  Logging governance events...');

  for (const agent of agents) {
    await api('/api/ai-governance/event', {
      method: 'POST', headers,
      body: JSON.stringify({
        agentId: agent.id,
        eventType: 'publish',
        description: `Agent ${agent.name} published via marketplace`,
        riskLevel: 'low',
        cost: 0,
      }),
    });
  }
  console.log(`    ✅ ${agents.length} governance events logged`);
}

// ============================================================
// Main
// ============================================================
async function main() {
  console.log('🚀 Populating Agent OS...\n');

  // Login
  console.log('1. Authenticating...');
  const token = await login();
  console.log('   ✅ Authenticated\n');

  // Install & publish agents
  console.log('2. Installing & publishing marketplace agents...');
  const agents = await installAndPublishAgents(token);
  console.log(`   ✅ ${agents.length} agents published\n`);

  // Create KG nodes
  console.log('3. Creating Knowledge Graph nodes...');
  const kgData = await createKGNodes(token, agents);
  console.log(`   ✅ ${kgData.nodes.length + kgData.journeyNodes.length + 2} nodes created\n`);

  // Create KG edges
  console.log('4. Creating Knowledge Graph edges...');
  await createKGEdges(token, kgData);
  console.log('   ✅ Edges created\n');

  // Log governance
  console.log('5. Logging governance events...');
  await logGovernanceEvents(token, agents);
  console.log('   ✅ Done\n');

  // Summary
  console.log('═══════════════════════════════════════');
  console.log('  POPULATION COMPLETE');
  console.log('═══════════════════════════════════════');
  console.log(`  Agents published:  ${agents.length}`);
  console.log(`  KG Nodes:          ${kgData.nodes.length + kgData.journeyNodes.length + 2}`);
  console.log(`  Governance events: ${agents.length}`);
  console.log('═══════════════════════════════════════');
}

main().catch(err => {
  console.error('❌ Population failed:', err.message);
  process.exit(1);
});
