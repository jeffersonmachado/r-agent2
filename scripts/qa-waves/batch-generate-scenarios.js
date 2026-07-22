'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');

const ROOT = path.resolve(__dirname, '..', '..');
const API_BASE = process.env.QA_API_BASE || 'http://127.0.0.1:3001';
const QA_USER = process.env.QA_USER || 'systemadmin';
const QA_PASS = process.env.QA_PASS || 'Admin123!';
const QA_TENANT = process.env.QA_TENANT || 'system';

let AUTH_TOKEN = null;

function readJson(filePath) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch (_) { return null; }
}

function authHeaders() {
  const headers = { 'Content-Type': 'application/json' };
  if (AUTH_TOKEN) {
    headers['Authorization'] = 'Bearer ' + AUTH_TOKEN;
  }
  return headers;
}

async function apiLogin() {
  const res = await apiPostNoAuth('/auth/login', {
    username: QA_USER,
    password: QA_PASS,
    tenantId: QA_TENANT,
  });
  if (res.status === 200 && res.body && res.body.token) {
    AUTH_TOKEN = res.body.token;
    console.log('🔑 Autenticado como ' + QA_USER + '@' + QA_TENANT);
    return true;
  }
  console.log('❌ Falha na autenticação: ' + res.status + ' ' + JSON.stringify(res.body).slice(0, 200));
  return false;
}

function apiPostNoAuth(endpoint, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const url = new URL(endpoint, API_BASE);
    const req = http.request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
    }, (res) => {
      let buf = '';
      res.on('data', (chunk) => { buf += chunk; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(buf) }); }
        catch (_) { resolve({ status: res.statusCode, body: buf }); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function apiPost(endpoint, body) {
  return apiPostWithRetry(endpoint, body, 0);
}

async function apiPostWithRetry(endpoint, body, retries) {
  if (retries > 2) {
    return { status: 401, body: { error: 'max_retries' } };
  }
  return new Promise((resolve) => {
    const data = JSON.stringify(body);
    const url = new URL(endpoint, API_BASE);
    const headers = authHeaders();
    headers['Content-Length'] = Buffer.byteLength(data);
    const req = http.request(url, { method: 'POST', headers }, async (res) => {
      let buf = '';
      res.on('data', (chunk) => { buf += chunk; });
      res.on('end', async () => {
        let parsed;
        try { parsed = JSON.parse(buf); } catch (_) { parsed = buf; }
        if (res.statusCode === 401 && retries < 2) {
          console.log('  🔄 Sessão expirada, reautenticando...');
          await apiLogin();
          const retryRes = await apiPostWithRetry(endpoint, body, retries + 1);
          resolve(retryRes);
        } else {
          resolve({ status: res.statusCode, body: parsed });
        }
      });
    });
    req.on('error', (err) => resolve({ status: 0, body: { error: err.message } }));
    req.write(data);
    req.end();
  });
}

async function apiGet(endpoint) {
  return apiGetWithRetry(endpoint, 0);
}

async function apiGetWithRetry(endpoint, retries) {
  if (retries > 2) {
    return { status: 401, body: { error: 'max_retries' } };
  }
  return new Promise((resolve) => {
    const url = new URL(endpoint, API_BASE);
    const req = http.request(url, { method: 'GET', headers: authHeaders() }, async (res) => {
      let buf = '';
      res.on('data', (chunk) => { buf += chunk; });
      res.on('end', async () => {
        let parsed;
        try { parsed = JSON.parse(buf); } catch (_) { parsed = buf; }
        if (res.statusCode === 401 && retries < 2) {
          console.log('  🔄 Sessão expirada, reautenticando...');
          await apiLogin();
          const retryRes = await apiGetWithRetry(endpoint, retries + 1);
          resolve(retryRes);
        } else {
          resolve({ status: res.statusCode, body: parsed });
        }
      });
    });
    req.on('error', (err) => resolve({ status: 0, body: { error: err.message } }));
    req.end();
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function checkApiHealth() {
  try {
    const res = await apiGet('/auth/me');
    return res.status < 500;
  } catch (_) {
    return false;
  }
}

async function generateScenario(vertical, journey, context = {}) {
  console.log(`  🤖 Gerando cenário: ${vertical}/${journey}...`);
  const res = await apiPost('/api/qa-waves/intelligence/generate-scenario', {
    vertical,
    journey,
    stage: 'full',
    gap: 'missing_e2e_scenario',
    context: { channels: ['whatsapp'], risk: 'high', ...context },
  });
  if (res.status === 503) {
    console.log(`  ⚠️  AI_UNAVAILABLE — RAG service offline? Pulando ${vertical}/${journey}`);
    return null;
  }
  if (res.status >= 400) {
    console.log(`  ❌ Erro (${res.status}): ${JSON.stringify(res.body).slice(0, 200)}`);
    return null;
  }
  console.log(`  ✅ Draft criado: ${res.body.draftId || res.body.id || 'unknown'}`);
  return res.body;
}

async function generateSeeds(scenarioId, quantity = 5) {
  console.log(`  🌱 Gerando ${quantity} seeds para ${scenarioId}...`);
  const res = await apiPost('/api/qa-waves/intelligence/generate-seeds', {
    scenarioId,
    quantity,
    scenarioContext: {},
  });
  if (res.status >= 400) {
    console.log(`  ⚠️  Seeds falhou (${res.status})`);
    return null;
  }
  console.log(`  ✅ Seeds gerados`);
  return res.body;
}

async function validateScenario(scenarioId) {
  const store = readJson(path.join(ROOT, 'qa', 'qa-waves', 'scenario-store.json'));
  const scenario = (store?.scenarios || []).find(s => s.id === scenarioId);
  if (!scenario) return { valid: false, errors: ['scenario_not_found'] };

  const res = await apiPost('/api/qa-waves/validate-scenario', scenario);
  if (res.status >= 400) {
    console.log(`  ❌ Validação falhou (${res.status})`);
    return { valid: false, errors: [res.body] };
  }
  return res.body;
}

async function approveScenario(scenarioId) {
  // Cenários já materializados no store são aprovados via save-scenario
  // (transição de status). O endpoint intelligence/approve-scenario atua
  // apenas sobre drafts de ai-drafts.json.
  const store = readJson(path.join(ROOT, 'qa', 'qa-waves', 'scenario-store.json'));
  const scenario = (store?.scenarios || []).find(s => s.id === scenarioId);
  if (!scenario) {
    console.log(`  ❌ Cenário não encontrado no store: ${scenarioId}`);
    return false;
  }
  const res = await apiPost('/api/qa-waves/save-scenario', {
    ...scenario,
    status: 'approved',
    reviewedBy: 'batch-generator',
    approvedAt: new Date().toISOString(),
  });
  if (res.status >= 400) {
    console.log(`  ❌ Aprovação falhou (${res.status}): ${JSON.stringify(res.body).slice(0, 200)}`);
    return false;
  }
  return true;
}

async function main() {
  console.log('══════════════════════════════════════════════');
  console.log('  QA Waves — Batch de Geração de Cenários');
  console.log('══════════════════════════════════════════════');
  console.log('');

  // ─── Check API health ─────────────────────────────────────────────────
  console.log('🔍 Verificando API...');
  const healthy = await checkApiHealth();
  if (!healthy) {
    console.log('❌ API não está acessível em', API_BASE);
    console.log('   Inicie com: npm run dev:api');
    process.exit(1);
  }
  console.log('✅ API respondendo');

  // ─── Authenticate ────────────────────────────────────────────────────
  const loggedIn = await apiLogin();
  if (!loggedIn) {
    console.log('❌ Use QA_USER/QA_PASS/QA_TENANT env vars ou verifique credenciais');
    process.exit(1);
  }
  console.log('');

  // ─── Load scenario store ──────────────────────────────────────────────
  const store = readJson(path.join(ROOT, 'qa', 'qa-waves', 'scenario-store.json'));
  if (!store) {
    console.log('❌ scenario-store.json não encontrado');
    process.exit(1);
  }
  const scenarios = store.scenarios || [];

  // ─── CLASSIFY ─────────────────────────────────────────────────────────
  const skeletons = scenarios.filter(s => !Array.isArray(s.steps) || s.steps.length === 0);
  const draftAI = scenarios.filter(s =>
    Array.isArray(s.steps) && s.steps.length > 0 && s.status === 'draft_ai'
  );

  console.log(`📊 Cenários encontrados: ${scenarios.length}`);
  console.log(`   🦴 Esqueletos (sem passos): ${skeletons.length}`);
  console.log(`   🤖 draft_ai (com passos, pendente revisão): ${draftAI.length}`);
  console.log(`   ✅ Aprovados: ${scenarios.filter(s => s.status === 'approved').length}`);
  console.log('');

  // ─── PHASE 1: Generate skeletons (needs AI/RAG) ──────────────────────
  const phase2Only = process.argv.includes('--phase2-only');
  if (phase2Only) {
    console.log('⏭️  --phase2-only: pulando FASE 1 (geração de esqueletos)');
    console.log('');
  }
  console.log('━'.repeat(50));
  console.log('FASE 1: Gerando esqueletos (requer RAG service)');
  console.log('━'.repeat(50));
  console.log('');

  let skeletonResults = { generated: 0, failed: 0, skipped: 0 };
  for (const skel of phase2Only ? [] : skeletons) {
    console.log(`📝 ${skel.id} (${skel.vertical}/${skel.journey})`);
    const result = await generateScenario(skel.vertical, skel.journey);
    if (result === null) {
      skeletonResults.skipped++;
    } else if (result) {
      skeletonResults.generated++;
      // Generate seeds
      await generateSeeds(skel.id, 5);
    } else {
      skeletonResults.failed++;
    }
    console.log('');
    await sleep(1000); // Rate limit
  }

  console.log(`FASE 1 resultado: ${skeletonResults.generated} gerados, ${skeletonResults.failed} falhas, ${skeletonResults.skipped} pulados`);
  console.log('');

  // ─── PHASE 2: Validate and approve draft_ai ──────────────────────────
  console.log('━'.repeat(50));
  console.log('FASE 2: Validando e aprovando draft_ai');
  console.log('━'.repeat(50));
  console.log('');

  let phase2Results = { validated: 0, approved: 0, rejected: 0, errors: 0 };
  for (const draft of draftAI) {
    console.log(`🔍 ${draft.id} (${draft.vertical}/${draft.journey}, ${draft.steps.length} passos)`);

    const validation = await validateScenario(draft.id);
    if (validation && validation.valid) {
      phase2Results.validated++;
      const approved = await approveScenario(draft.id);
      if (approved) {
        phase2Results.approved++;
        console.log(`  ✅ Aprovado`);
      } else {
        phase2Results.errors++;
      }
    } else {
      phase2Results.rejected++;
      const errors = validation?.errors || ['validation_failed'];
      const rendered = errors.map((e) => (typeof e === 'object' && e !== null ? (e.message || e.code || JSON.stringify(e)) : String(e)));
      console.log(`  ❌ Rejeitado: ${rendered.join(', ')}`);
    }
    console.log('');
    await sleep(500);
  }

  console.log(`FASE 2 resultado: ${phase2Results.validated} validados, ${phase2Results.approved} aprovados, ${phase2Results.rejected} rejeitados, ${phase2Results.errors} erros`);
  console.log('');

  // ─── SUMMARY ──────────────────────────────────────────────────────────
  console.log('═'.repeat(50));
  console.log('RESUMO FINAL');
  console.log('═'.repeat(50));
  console.log(`Esqueletos: ${skeletonResults.generated} gerados, ${skeletonResults.failed} falhas, ${skeletonResults.skipped} pulados`);
  console.log(`draft_ai: ${phase2Results.validated} validados, ${phase2Results.approved} aprovados, ${phase2Results.rejected} rejeitados`);
  console.log('');
  console.log('Próximos passos:');
  console.log('  1. Corrigir cenários rejeitados manualmente');
  console.log('  2. Rodar: npm run qa:waves:diagrams && npm run qa:waves:runbooks');
  console.log('  3. Executar wave: curl -X POST .../api/qa-waves/executions');
  console.log('  4. Rodar QA Mesh: npm run qa:mesh');
  console.log('  5. Validar governança: npm run validate:qa-governance');
}

if (require.main === module) {
  main().catch((err) => {
    console.error('❌ Erro fatal:', err.message);
    process.exit(1);
  });
}

module.exports = { main };
