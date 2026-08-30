/**
 * L-06: BPMN Editor E2E Smoke
 *
 * Valida o ciclo completo do editor BPMN via Playwright com auth mockada:
 *   1. Navega até /bpmn-editor
 *   2. Carrega fixture Pizza-Store.bpmn
 *   3. Exporta BPMN XML e valida estrutura DI
 *   4. Exporta BPMN SVG e valida tag <svg>
 *   5. Converte para internal flow e valida nodes > 0
 *   6. Re-importa o internal flow e valida status
 *
 * Env vars:
 *   FRONTEND_URL               - base URL do frontend (default: http://localhost:15173)
 *   BPMN_EDITOR_EVIDENCE_PATH  - caminho de saída da evidência JSON (default: qa/l06-bpmn-editor-evidence.json)
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { runtimeAwarePath, resolveWorkspacePath } = require('../tools/system/lib/runtime-paths');

const ROOT = path.join(__dirname, '..');
const BASE_URL = process.env.FRONTEND_URL || 'http://localhost:15173';
const EVIDENCE_PATH = resolveWorkspacePath(
  ROOT,
  runtimeAwarePath(ROOT, 'qa/l06-bpmn-editor-evidence.json', 'BPMN_EDITOR_EVIDENCE_PATH'),
);
const outDir = path.join(path.dirname(EVIDENCE_PATH), 'bpmn-smoke-artifacts');
const reportPath = resolveWorkspacePath(
  ROOT,
  runtimeAwarePath(ROOT, 'qa/smoke/l06-bpmn-editor-smoke.md', 'BPMN_EDITOR_SMOKE_REPORT_PATH'),
);

const mockAgent = {
  id: 'agent-smoke',
  username: 'smoke-admin',
  role: 'admin',
  tenantId: 'demo-tenant',
  permissions: [
    { resource: 'flows', action: 'read' },
    { resource: 'flows', action: 'update' },
  ],
};

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeReport(lines) {
  ensureDir(path.dirname(reportPath));
  fs.writeFileSync(reportPath, `${lines.join('\n')}\n`, 'utf8');
}

function writeEvidence(evidence) {
  ensureDir(path.dirname(EVIDENCE_PATH));
  fs.writeFileSync(EVIDENCE_PATH, JSON.stringify(evidence, null, 2) + '\n', 'utf8');
  console.log(`[bpmn-smoke] Evidence: ${EVIDENCE_PATH}`);
}

function jsonResponse(route, status, body) {
  return route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}

async function clickWithRetry(page, getLocator, attempts = 4) {
  let lastError = null;
  for (let i = 0; i < attempts; i += 1) {
    try {
      const locator = getLocator();
      await locator.first().click({ timeout: 12000 });
      return;
    } catch (error) {
      lastError = error;
      await page.waitForTimeout(300 + (i * 200));
    }
  }
  throw lastError;
}

(async () => {
  ensureDir(outDir);

  const report = [];
  report.push('# BPMN E2E Smoke Report');
  report.push(`- Date: ${new Date().toISOString()}`);
  report.push(`- Base URL: ${BASE_URL}`);
  report.push('- Auth mode: mocked /auth/me + localStorage token');

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ acceptDownloads: true });

  // Mock auth endpoint
  await context.route(/^\/auth\/me(?:\?|$)|^https?:\/\/[^/]+\/auth\/me(?:\?|$)/, async (route) => {
    await jsonResponse(route, 200, { agent: mockAgent });
  });

  // Mock tenant endpoints so TenantGate/UserMenu don't block render
  await context.route(/^https?:\/\/[^/]+\/tenants(?:\/|\?|$)/, async (route, request) => {
    const url = new URL(request.url());
    const id = url.pathname.split('/').pop() || 'demo-tenant';
    await jsonResponse(route, 200, {
      tenant: { id, tenantId: id, name: 'Tenant Demo' },
      tenants: [{ id: 'demo-tenant', tenantId: 'demo-tenant', name: 'Tenant Demo' }],
    });
  });

  // Mock tenant capabilities (authContext chama após login; defesa em depth
  // junto com o fallback não-crítico do client.js)
  await context.route(/^https?:\/\/[^/]+\/api\/tenant\/capabilities(?:\?|$)/, async (route) => {
    await jsonResponse(route, 200, {
      capabilities: { inbox: true, caseManagement: true, caseCreationPolicy: 'manual' },
    });
  });

  // Mock tickets (UserMenu may request them)
  await context.route(/^https?:\/\/[^/]+\/tickets(?:\/|\?|$)/, async (route) => {
    await jsonResponse(route, 200, { tickets: [], total: 0 });
  });

  await context.addInitScript((agent) => {
    // Stub WebSocket to avoid auth side-effects in smoke context
    class SmokeWebSocket {
      constructor() { this.readyState = 3; }
      addEventListener() {}
      removeEventListener() {}
      send() {}
      close() {}
    }
    SmokeWebSocket.CONNECTING = 0;
    SmokeWebSocket.OPEN = 1;
    SmokeWebSocket.CLOSING = 2;
    SmokeWebSocket.CLOSED = 3;
    window.WebSocket = SmokeWebSocket;

    localStorage.setItem('auth_token', 'smoke-token');
    localStorage.setItem('auth_agent', JSON.stringify(agent));
    localStorage.setItem('auth_effective_tenant_id', agent.tenantId);
  }, mockAgent);

  const page = await context.newPage();

  const steps = {
    pageLoad: false,
    pizzaFixtureLoaded: false,
    xmlExported: false,
    svgExported: false,
    internalFlowExported: false,
    internalFlowNodeCount: 0,
    internalFlowImported: false,
  };

  const getStatus = async () => {
    const locator = page.locator('.bpmn-editor-page__status').first();
    if (!(await locator.isVisible().catch(() => false))) return null;
    return (await locator.textContent()) || null;
  };

  try {
    await page.goto(`${BASE_URL}/bpmn-editor`, { waitUntil: 'networkidle', timeout: 45000 });
    // Allow React hydration and bpmn-js canvas init
    await page.waitForTimeout(800);

    const denied = await page.locator('text=Acesso Negado').first().isVisible().catch(() => false);
    if (denied) {
      throw new Error('Acesso negado em /bpmn-editor para usuário de smoke (mock auth).');
    }

    // Wait for the topbar to appear (confirms the page rendered)
    await page.waitForSelector('.bpmn-editor-page__topbar', { timeout: 20000 });
    steps.pageLoad = true;

    await clickWithRetry(page, () => page.getByRole('button', { name: /Load Pizza-Store\.bpmn/i }));
    await page.waitForTimeout(1500);

    const pizzaStatus = await getStatus();
    report.push(`- Status after Pizza load: ${pizzaStatus || '(none)'}`);
    if (!pizzaStatus || !/Pizza-Store\.bpmn imported/i.test(pizzaStatus)) {
      throw new Error(`Status inesperado após carregar Pizza fixture: ${pizzaStatus}`);
    }
    steps.pizzaFixtureLoaded = true;

    const [xmlDownload] = await Promise.all([
      page.waitForEvent('download', { timeout: 20000 }),
      clickWithRetry(page, () => page.getByRole('button', { name: /Export BPMN \(XML\)/i })),
    ]);
    const xmlPath = path.join(outDir, 'diagram.bpmn');
    await xmlDownload.saveAs(xmlPath);
    const xml = fs.readFileSync(xmlPath, 'utf8');
    if (!/<bpmn(?:2)?:definitions/.test(xml)) {
      throw new Error('XML exportado inválido: sem <bpmn:definitions> (ou bpmn2).');
    }
    if (!/bpmndi:BPMNShape|bpmndi:BPMNEdge/.test(xml)) {
      throw new Error('XML exportado sem evidência de BPMN DI (shape/edge).');
    }
    report.push(`- XML exported: ${xmlPath}`);
    steps.xmlExported = true;

    const [svgDownload] = await Promise.all([
      page.waitForEvent('download', { timeout: 20000 }),
      clickWithRetry(page, () => page.getByRole('button', { name: /Export BPMN \(SVG\)/i })),
    ]);
    const svgPath = path.join(outDir, 'diagram.svg');
    await svgDownload.saveAs(svgPath);
    const svg = fs.readFileSync(svgPath, 'utf8');
    if (!/<svg[\s>]/i.test(svg)) {
      throw new Error('SVG exportado inválido: sem tag <svg>.');
    }
    report.push(`- SVG exported: ${svgPath}`);
    steps.svgExported = true;

    const [jsonDownload] = await Promise.all([
      page.waitForEvent('download', { timeout: 20000 }),
      clickWithRetry(page, () => page.getByRole('button', { name: /Convert to internal flow/i })),
    ]);
    const internalJsonPath = path.join(outDir, 'internal-flow.json');
    await jsonDownload.saveAs(internalJsonPath);
    const internalFlow = JSON.parse(fs.readFileSync(internalJsonPath, 'utf8'));
    if (!internalFlow || !Array.isArray(internalFlow.nodes) || internalFlow.nodes.length === 0) {
      throw new Error('Internal flow exportado inválido: nodes vazio/ausente.');
    }
    report.push(`- Internal flow exported: ${internalJsonPath}`);
    report.push(`- Internal flow nodes: ${internalFlow.nodes.length}`);
    steps.internalFlowExported = true;
    steps.internalFlowNodeCount = internalFlow.nodes.length;

    const [fileChooser] = await Promise.all([
      page.waitForEvent('filechooser', { timeout: 20000 }),
      clickWithRetry(page, () => page.getByRole('button', { name: /Import internal flow/i })),
    ]);
    await fileChooser.setFiles(internalJsonPath);
    await page.waitForTimeout(1500);

    const importStatus = await getStatus();
    report.push(`- Status after internal import: ${importStatus || '(none)'}`);
    if (!importStatus || !/Imported internal flow/i.test(importStatus)) {
      throw new Error(`Status inesperado após importar internal flow: ${importStatus}`);
    }
    steps.internalFlowImported = true;

    const screenshotPath = path.join(outDir, 'bpmn-smoke.png');
    await page.screenshot({ path: screenshotPath, fullPage: true });
    report.push(`- Screenshot: ${screenshotPath}`);
    report.push('- Result: SUCCESS');
    writeReport(report);
    writeEvidence({
      smoke: 'L-06',
      generatedAt: new Date().toISOString(),
      ok: true,
      frontendUrl: BASE_URL,
      steps,
    });
    console.log('[bpmn-smoke] OK');
    console.log(`[bpmn-smoke] Report: ${reportPath}`);
    console.log(`[bpmn-smoke] Artifacts: ${outDir}`);
  } catch (err) {
    try {
      const failShot = path.join(outDir, 'bpmn-smoke-failed.png');
      await page.screenshot({ path: failShot, fullPage: true });
    } catch {
      // no-op
    }
    const fail = [
      '# BPMN E2E Smoke Report',
      `- Date: ${new Date().toISOString()}`,
      '- Result: FAILED',
      `- Error: ${err.message}`,
    ];
    writeReport(fail);
    writeEvidence({
      smoke: 'L-06',
      generatedAt: new Date().toISOString(),
      ok: false,
      frontendUrl: BASE_URL,
      steps,
      error: err.message,
    });
    console.error(`[bpmn-smoke] FAIL: ${err.message}`);
    console.error(`[bpmn-smoke] Report: ${reportPath}`);
    process.exitCode = 1;
  } finally {
    await context.close();
    await browser.close();
  }
})();
