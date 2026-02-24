// ============================================================================
// TESTE COMPLETO DE FUNCIONALIDADES DO CRM
// Script para validar todas as funcionalidades implementadas
// ============================================================================

'use strict';

const axios = require('axios');

// Configuration
const API_BASE = process.env.API_URL || 'http://localhost:3000/api/crm';
const TENANT_KEY = process.env.TENANT_KEY || 'demo';
const AUTH_TOKEN = process.env.AUTH_TOKEN || 'test-token';

const headers = {
  'Authorization': `Bearer ${AUTH_TOKEN}`,
  'Content-Type': 'application/json',
};

// ============================================================================
// UTILITIES
// ============================================================================

const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[36m',
  bold: '\x1b[1m',
};

function log(type, message) {
  const timestamp = new Date().toISOString();
  switch (type) {
    case 'pass':
      console.log(`${colors.green}✓${colors.reset} [${timestamp}] ${message}`);
      break;
    case 'fail':
      console.log(`${colors.red}✗${colors.reset} [${timestamp}] ${message}`);
      break;
    case 'info':
      console.log(`${colors.blue}ℹ${colors.reset} [${timestamp}] ${message}`);
      break;
    case 'section':
      console.log(`\n${colors.bold}${colors.blue}=== ${message} ===${colors.reset}\n`);
      break;
  }
}

const stats = {
  passed: 0,
  failed: 0,
  tests: [],
};

async function runTest(name, fn) {
  try {
    await fn();
    log('pass', name);
    stats.passed++;
    stats.tests.push({ name, status: 'PASS' });
  } catch (error) {
    log('fail', `${name} - ${error.message}`);
    stats.failed++;
    stats.tests.push({ name, status: 'FAIL', error: error.message });
  }
}

// ============================================================================
// FASE 1: MVP & CORE CRUD
// ============================================================================

async function testPhase1() {
  log('section', 'FASE 1: MVP & CORE CRUD (33 Operations)');

  // Test Accounts
  let accountId;
  await runTest('Create Account', async () => {
    const response = await axios.post(`${API_BASE}/accounts`, {
      name: 'Test Account ' + Date.now(),
      status: 'active',
      ownerUserId: 'user-123',
    }, { headers });
    if (!response.data.ok || !response.data.account.id) throw new Error('No account ID');
    accountId = response.data.account.id;
  });

  await runTest('List Accounts', async () => {
    const response = await axios.get(`${API_BASE}/accounts?limit=10&offset=0`, { headers });
    if (!response.data.ok || !Array.isArray(response.data.accounts)) throw new Error('Invalid response');
  });

  await runTest('Get Account', async () => {
    const response = await axios.get(`${API_BASE}/accounts/${accountId}`, { headers });
    if (!response.data.ok || response.data.account.id !== accountId) throw new Error('Wrong account');
  });

  await runTest('Update Account', async () => {
    const response = await axios.put(`${API_BASE}/accounts/${accountId}`, {
      name: 'Updated Account ' + Date.now(),
    }, { headers });
    if (!response.data.ok) throw new Error('Update failed');
  });

  // Test Contacts
  let contactId;
  await runTest('Create Contact', async () => {
    const response = await axios.post(`${API_BASE}/contacts`, {
      name: 'Test Contact ' + Date.now(),
      email: `test-${Date.now()}@example.com`,
      phone: '+5511999999999',
      accountId,
    }, { headers });
    if (!response.data.ok || !response.data.contact.id) throw new Error('No contact ID');
    contactId = response.data.contact.id;
  });

  await runTest('List Contacts', async () => {
    const response = await axios.get(`${API_BASE}/contacts?limit=10`, { headers });
    if (!response.data.ok || !Array.isArray(response.data.contacts)) throw new Error('Invalid response');
  });

  await runTest('Get Contact', async () => {
    const response = await axios.get(`${API_BASE}/contacts/${contactId}`, { headers });
    if (!response.data.ok || response.data.contact.id !== contactId) throw new Error('Wrong contact');
  });

  await runTest('Update Contact', async () => {
    const response = await axios.put(`${API_BASE}/contacts/${contactId}`, {
      name: 'Updated Contact ' + Date.now(),
    }, { headers });
    if (!response.data.ok) throw new Error('Update failed');
  });

  // Test Leads
  let leadId;
  await runTest('Create Lead', async () => {
    const response = await axios.post(`${API_BASE}/leads`, {
      name: 'Test Lead ' + Date.now(),
      email: `lead-${Date.now()}@example.com`,
      status: 'unqualified',
      source: 'website',
    }, { headers });
    if (!response.data.ok || !response.data.lead.id) throw new Error('No lead ID');
    leadId = response.data.lead.id;
  });

  await runTest('List Leads', async () => {
    const response = await axios.get(`${API_BASE}/leads?limit=10`, { headers });
    if (!response.data.ok || !Array.isArray(response.data.leads)) throw new Error('Invalid response');
  });

  await runTest('Get Lead', async () => {
    const response = await axios.get(`${API_BASE}/leads/${leadId}`, { headers });
    if (!response.data.ok || response.data.lead.id !== leadId) throw new Error('Wrong lead');
  });

  await runTest('Update Lead', async () => {
    const response = await axios.put(`${API_BASE}/leads/${leadId}`, {
      status: 'qualified',
    }, { headers });
    if (!response.data.ok) throw new Error('Update failed');
  });

  // Test Pipelines
  let pipelineId;
  await runTest('Create Pipeline', async () => {
    const response = await axios.post(`${API_BASE}/pipelines`, {
      name: 'Test Pipeline ' + Date.now(),
      stages: ['Discovery', 'Proposal', 'Negotiation', 'Closed-Won'],
    }, { headers });
    if (!response.data.ok || !response.data.pipeline.id) throw new Error('No pipeline ID');
    pipelineId = response.data.pipeline.id;
  });

  await runTest('List Pipelines', async () => {
    const response = await axios.get(`${API_BASE}/pipelines?limit=10`, { headers });
    if (!response.data.ok || !Array.isArray(response.data.pipelines)) throw new Error('Invalid response');
  });

  await runTest('Get Pipeline', async () => {
    const response = await axios.get(`${API_BASE}/pipelines/${pipelineId}`, { headers });
    if (!response.data.ok) throw new Error('Get failed');
  });

  // Test Opportunities
  let opportunityId;
  await runTest('Create Opportunity', async () => {
    const response = await axios.post(`${API_BASE}/opportunities`, {
      name: 'Test Opportunity ' + Date.now(),
      value: 50000,
      pipelineId,
      accountId,
      stage: 'Discovery',
    }, { headers });
    if (!response.data.ok || !response.data.opportunity.id) throw new Error('No opportunity ID');
    opportunityId = response.data.opportunity.id;
  });

  await runTest('List Opportunities', async () => {
    const response = await axios.get(`${API_BASE}/opportunities?limit=10`, { headers });
    if (!response.data.ok || !Array.isArray(response.data.opportunities)) throw new Error('Invalid response');
  });

  await runTest('Get Opportunity', async () => {
    const response = await axios.get(`${API_BASE}/opportunities/${opportunityId}`, { headers });
    if (!response.data.ok) throw new Error('Get failed');
  });

  await runTest('Update Opportunity', async () => {
    const response = await axios.put(`${API_BASE}/opportunities/${opportunityId}`, {
      stage: 'Proposal',
      value: 60000,
    }, { headers });
    if (!response.data.ok) throw new Error('Update failed');
  });

  // Test Activities
  await runTest('Create Activity', async () => {
    const response = await axios.post(`${API_BASE}/activities`, {
      type: 'call',
      subject: 'Test Call ' + Date.now(),
      contactId,
      accountId,
      description: 'Test activity',
    }, { headers });
    if (!response.data.ok || !response.data.activity.id) throw new Error('No activity ID');
  });

  await runTest('List Activities', async () => {
    const response = await axios.get(`${API_BASE}/activities?limit=10`, { headers });
    if (!response.data.ok || !Array.isArray(response.data.activities)) throw new Error('Invalid response');
  });

  // Test Delete
  await runTest('Delete Account', async () => {
    const response = await axios.delete(`${API_BASE}/accounts/${accountId}`, { headers });
    if (!response.data.ok) throw new Error('Delete failed');
  });

  await runTest('Delete Contact', async () => {
    const response = await axios.delete(`${API_BASE}/contacts/${contactId}`, { headers });
    if (!response.data.ok) throw new Error('Delete failed');
  });

  await runTest('Delete Lead', async () => {
    const response = await axios.delete(`${API_BASE}/leads/${leadId}`, { headers });
    if (!response.data.ok) throw new Error('Delete failed');
  });

  await runTest('Delete Opportunity', async () => {
    const response = await axios.delete(`${API_BASE}/opportunities/${opportunityId}`, { headers });
    if (!response.data.ok) throw new Error('Delete failed');
  });
}

// ============================================================================
// FASE 2: ANALYTICS
// ============================================================================

async function testPhase2() {
  log('section', 'FASE 2: ANALYTICS & DASHBOARDS');

  await runTest('Get Dashboard Metrics', async () => {
    const response = await axios.get(`${API_BASE}/analytics/dashboard`, { headers });
    if (!response.data.ok || !response.data.metrics) throw new Error('No metrics');
    const m = response.data.metrics;
    if (m.accountsTotal === undefined) throw new Error('Missing accountsTotal');
    if (m.contactsTotal === undefined) throw new Error('Missing contactsTotal');
    if (m.leadsTotal === undefined) throw new Error('Missing leadsTotal');
    if (m.opportunitiesTotal === undefined) throw new Error('Missing opportunitiesTotal');
  });

  await runTest('Get Lead Metrics', async () => {
    const response = await axios.get(`${API_BASE}/analytics/leads`, { headers });
    if (!response.data.ok || !response.data.metrics) throw new Error('No metrics');
  });

  await runTest('Generate Report', async () => {
    const response = await axios.post(`${API_BASE}/analytics/reports`, {
      reportType: 'pipeline_summary',
      format: 'json',
    }, { headers });
    if (!response.data.ok) throw new Error('Report generation failed');
  });
}

// ============================================================================
// FASE 3: RBAC & SECURITY
// ============================================================================

async function testPhase3() {
  log('section', 'FASE 3: RBAC & SECURITY');

  let roleId;
  await runTest('Create Role', async () => {
    const response = await axios.post(`${API_BASE}/roles`, {
      roleName: 'test_role_' + Date.now(),
      description: 'Test Role',
      permissions: {
        'crm:accounts:*': true,
        'crm:leads:view': true,
      },
    }, { headers });
    if (!response.data.ok || !response.data.role.id) throw new Error('No role ID');
    roleId = response.data.role.id;
  });

  await runTest('List Roles', async () => {
    const response = await axios.get(`${API_BASE}/roles`, { headers });
    if (!response.data.ok || !Array.isArray(response.data.roles)) throw new Error('Invalid response');
  });

  await runTest('Assign Role to User', async () => {
    const response = await axios.post(`${API_BASE}/user-roles`, {
      userId: 'user-test',
      roleId,
    }, { headers });
    if (!response.data.ok) throw new Error('Assignment failed');
  });

  await runTest('Get Audit Logs', async () => {
    const response = await axios.get(`${API_BASE}/audit-logs?limit=10`, { headers });
    if (!response.data.ok || !Array.isArray(response.data.logs)) throw new Error('Invalid response');
  });

  // Cleanup
  await runTest('Delete Role', async () => {
    const response = await axios.delete(`${API_BASE}/roles/${roleId}`, { headers });
    if (!response.data.ok) throw new Error('Delete failed');
  });
}

// ============================================================================
// FASE 4: WEBHOOKS
// ============================================================================

async function testPhase4() {
  log('section', 'FASE 4: WEBHOOKS & INTEGRATIONS');

  let webhookId;
  await runTest('Register Webhook', async () => {
    const response = await axios.post(`${API_BASE}/webhooks`, {
      name: 'test-webhook-' + Date.now(),
      url: 'https://example.com/webhooks/crm',
      events: ['account.created', 'opportunity.updated'],
    }, { headers });
    if (!response.data.ok || !response.data.webhook.id) throw new Error('No webhook ID');
    webhookId = response.data.webhook.id;
  });

  await runTest('List Webhooks', async () => {
    const response = await axios.get(`${API_BASE}/webhooks`, { headers });
    if (!response.data.ok || !Array.isArray(response.data.webhooks)) throw new Error('Invalid response');
  });

  await runTest('Test Webhook Delivery', async () => {
    const response = await axios.post(`${API_BASE}/webhooks/${webhookId}/test`, {}, { headers });
    if (!response.data.ok) throw new Error('Test failed');
  });

  // Cleanup
  await runTest('Delete Webhook', async () => {
    const response = await axios.delete(`${API_BASE}/webhooks/${webhookId}`, { headers });
    if (!response.data.ok) throw new Error('Delete failed');
  });
}

// ============================================================================
// FASE 5: RPA AUTOMATION
// ============================================================================

async function testPhase5() {
  log('section', 'FASE 5: RPA AUTOMATION');

  // Create a test lead for scoring
  let leadId;
  await runTest('Create Lead for Scoring', async () => {
    const response = await axios.post(`${API_BASE}/leads`, {
      name: 'RPA Test Lead',
      email: 'rpa-test@company.com',
      status: 'unqualified',
      source: 'website',
      attributes: {
        companySize: 'enterprise',
        industry: 'saas',
      },
    }, { headers });
    if (!response.data.ok) throw new Error('Lead creation failed');
    leadId = response.data.lead.id;
  });

  await runTest('Score Single Lead', async () => {
    const response = await axios.post(`${API_BASE}/rpa/score/lead`, {
      leadId,
    }, { headers });
    if (!response.data.ok || !response.data.score) throw new Error('Scoring failed');
  });

  await runTest('Score Multiple Leads', async () => {
    const response = await axios.post(`${API_BASE}/rpa/score-leads`, {
      leadIds: [leadId],
    }, { headers });
    if (!response.data.ok || !Array.isArray(response.data.scores)) throw new Error('Batch scoring failed');
  });

  // Create opportunity for deal health
  let opportunityId;
  await runTest('Create Opportunity for Deal Health', async () => {
    const response = await axios.post(`${API_BASE}/opportunities`, {
      name: 'RPA Test Deal',
      value: 100000,
      stage: 'Proposal',
    }, { headers });
    if (!response.data.ok) throw new Error('Opportunity creation failed');
    opportunityId = response.data.opportunity.id;
  });

  await runTest('Calculate Deal Health', async () => {
    const response = await axios.post(`${API_BASE}/rpa/deal-health`, {
      opportunityId,
    }, { headers });
    if (!response.data.ok || response.data.health === undefined) throw new Error('Health calculation failed');
  });

  await runTest('Check Auto-Progression', async () => {
    const response = await axios.post(`${API_BASE}/rpa/auto-progression`, {
      opportunityId,
    }, { headers });
    if (!response.data.ok) throw new Error('Auto-progression check failed');
  });

  await runTest('Analyze Pipeline Risks', async () => {
    const response = await axios.get(`${API_BASE}/rpa/pipeline-risks`, { headers });
    if (!response.data.ok || !response.data.risks) throw new Error('Risk analysis failed');
  });
}

// ============================================================================
// FASE 6: DATA MIGRATION
// ============================================================================

async function testPhase6() {
  log('section', 'FASE 6: DATA MIGRATION');

  const testData = {
    entities: [
      {
        name: 'Migration Test Account ' + Date.now(),
        status: 'active',
      },
    ],
  };

  let importJobId;
  await runTest('Import Data (JSON)', async () => {
    const response = await axios.post(`${API_BASE}/data/import?format=json&importType=accounts`, testData, { headers });
    if (!response.data.ok) throw new Error('Import failed');
  });

  await runTest('Export Data (JSON)', async () => {
    const response = await axios.get(`${API_BASE}/data/export?exportType=accounts&format=json`, { headers });
    if (!response.data.ok || !response.data.data) throw new Error('Export failed');
  });

  await runTest('Get Migration Status', async () => {
    const response = await axios.get(`${API_BASE}/data/migration-status`, { headers });
    if (!response.data.ok || !response.data.status) throw new Error('Status fetch failed');
  });

  await runTest('Detect Duplicates', async () => {
    const response = await axios.get(`${API_BASE}/data/duplicates?entityType=contacts&threshold=0.8`, { headers });
    if (!response.data.ok || !Array.isArray(response.data.duplicates)) throw new Error('Duplicate detection failed');
  });
}

// ============================================================================
// MAIN TEST RUNNER
// ============================================================================

async function runAllTests() {
  console.clear();
  console.log(`${colors.bold}${colors.blue}
╔════════════════════════════════════════════════════════════╗
║         REVISÃO COMPLETA DE FUNCIONALIDADES CRM           ║
║                  R-Agent2 CRM Suite v1.0                  ║
╚════════════════════════════════════════════════════════════╝
${colors.reset}`);

  log('info', `API Base: ${API_BASE}`);
  log('info', `Tenant: ${TENANT_KEY}`);
  log('info', `Starting comprehensive test suite...`);

  try {
    // Run all phases
    await testPhase1(); // MVP & CRUD
    await testPhase2(); // Analytics
    await testPhase3(); // RBAC & Security
    await testPhase4(); // Webhooks
    await testPhase5(); // RPA
    await testPhase6(); // Data Migration

    // Print summary
    log('section', 'TEST SUMMARY');
    console.log(`${colors.green}✓ PASSED: ${stats.passed}${colors.reset}`);
    console.log(`${colors.red}✗ FAILED: ${stats.failed}${colors.reset}`);
    console.log(`${colors.bold}Total: ${stats.passed + stats.failed}${colors.reset}\n`);

    if (stats.failed === 0) {
      console.log(`${colors.green}${colors.bold}
╔════════════════════════════════════════════════════════════╗
║              🎉 ALL TESTS PASSED! 🎉                      ║
║           CRM System is Fully Functional                  ║
║          Ready for Production Deployment                  ║
╚════════════════════════════════════════════════════════════╝
${colors.reset}`);
      process.exit(0);
    } else {
      console.log(`${colors.red}${colors.bold}
╔════════════════════════════════════════════════════════════╗
║              ⚠️  SOME TESTS FAILED  ⚠️                     ║
║        Please review failures above and fix issues        ║
╚════════════════════════════════════════════════════════════╝
${colors.reset}`);
      process.exit(1);
    }
  } catch (error) {
    log('fail', `Unexpected error: ${error.message}`);
    console.error(error);
    process.exit(1);
  }
}

// Run tests
runAllTests().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
