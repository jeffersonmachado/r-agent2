'use strict';

/**
 * Validação em BROWSER REAL do ciclo de Engineering Missions (jornada completa de usuário).
 *
 * Uso: node tests/smoke/engineering-missions-browser.js
 *
 * Reutiliza o helper compartilhado `tests/helpers/playwrightAuth.js` (regra do projeto: nunca
 * reimplementar login/tenant no teste). Percorre exatamente o que um usuário faz:
 *   abrir a tela → digitar a missão em linguagem natural → enriquecer → revisar o que foi
 *   acrescentado (com fonte e motivo) → aprovar → conferir histórico.
 *
 * Evidência (JSON + screenshot) vai para `AI_MEMORY/evidence/` — nunca para `dist/`.
 */

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const { loginWithTenantSelection } = require('../helpers/playwrightAuth');

const BASE_URL = process.env.TEST_BASE_URL || 'http://127.0.0.1:5173';
const USERNAME = process.env.TEST_USERNAME || 'systemadmin';
const PASSWORD = process.env.TEST_PASSWORD || 'Admin123!';
const TENANT = process.env.TEST_TENANT_ID || 'system';
const EVIDENCE_DIR = path.join(__dirname, '..', '..', 'AI_MEMORY', 'evidence');

const MISSION_TEXT = 'Corrija definitivamente a importação do EVO e deixe tudo verde.';

const results = {
  startedAt: new Date().toISOString(),
  baseUrl: BASE_URL,
  journey: 'engineering-missions',
  steps: [],
  consoleErrors: [],
  networkFailures: [],
  passed: 0,
  failed: 0,
};

function record(name, status, detail = '') {
  results.steps.push({ name, status, detail, at: new Date().toISOString() });
  if (status === 'PASS') results.passed += 1; else results.failed += 1;
  console.log(`[${status}] ${name}${detail ? ` — ${detail}` : ''}`);
}

async function main() {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  const page = await context.newPage();

  page.on('console', (msg) => {
    if (msg.type() === 'error') results.consoleErrors.push(msg.text());
  });
  page.on('requestfailed', (req) => {
    results.networkFailures.push({ url: req.url(), error: req.failure()?.errorText || null });
  });

  try {
    await loginWithTenantSelection(page, {
      targetUrl: `${BASE_URL}/workspace`,
      username: USERNAME,
      password: PASSWORD,
      tenantId: TENANT,
    });
    record('login com seleção de tenant', 'PASS');

    // 1. Abrir a tela de missões (DEVELOPMENT).
    await page.goto(`${BASE_URL}/dev/engineering/missions`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForSelector('textarea', { timeout: 20000 });
    // O layout ("Central Dev") tem o próprio h1 — o alvo é o heading DESTA página.
    const headingCount = await page.locator('h1:has-text("Engineering Missions")').count();
    record('tela de missões acessível por URL direta', headingCount > 0 ? 'PASS' : 'FAIL', page.url());

    // 2. Painel de política de autoaprovação visível (configuração é parte da interface).
    const policyVisible = await page.locator('text=Política de autoaprovação').count();
    record('painel de política de autoaprovação presente', policyVisible > 0 ? 'PASS' : 'FAIL');

    // 3. Digitar a missão em linguagem natural e enriquecer.
    await page.locator('textarea').first().fill(MISSION_TEXT);
    await page.locator('button:has-text("Enriquecer missão")').click();
    await page.waitForURL(/\/dev\/engineering\/missions\/[^/]+$/, { timeout: 90000 });
    await page.waitForSelector('text=Diff do enriquecimento', { timeout: 30000 });
    record('enriquecimento executado pela UI', 'PASS', page.url());

    // 4. Missão ORIGINAL preservada literalmente na tela.
    const originalShown = await page.locator(`text=${MISSION_TEXT}`).count();
    record('missão original exibida sem alteração', originalShown > 0 ? 'PASS' : 'FAIL');

    // 5. Enriquecimento exibido com categoria, fonte e motivo (provenance).
    const policySection = await page.locator('text=Obrigatório por política').count();
    const inferredSection = await page.locator('text=Inferido do contexto').count();
    const sourceShown = await page.locator('text=fonte:').count();
    const reasonShown = await page.locator('text=motivo:').count();
    record(
      'preview mostra categorias do enriquecimento',
      (policySection > 0 || inferredSection > 0) ? 'PASS' : 'FAIL',
      `policy=${policySection} inferred=${inferredSection}`,
    );
    record('provenance exibida (fonte + motivo)', (sourceShown > 0 && reasonShown > 0) ? 'PASS' : 'FAIL', `fonte=${sourceShown} motivo=${reasonShown}`);

    // 6. Status AWAITING_APPROVAL antes de aprovar (não pode mentir "aprovado").
    const awaiting = await page.locator('text=AWAITING_APPROVAL').count();
    record('status AWAITING_APPROVAL exibido antes da aprovação', awaiting > 0 ? 'PASS' : 'FAIL');

    await page.screenshot({ path: path.join(EVIDENCE_DIR, '2026-09-24-engineering-mission-preview.png'), fullPage: true });

    // 7. Aprovar pela interface.
    await page.locator('button:has-text("Aprovar missão")').click();
    await page.waitForSelector('text=APPROVED', { timeout: 30000 });
    record('aprovação humana pela interface', 'PASS');

    // 8. Histórico de versões e de decisões visível (auditoria na própria tela).
    const versionsVisible = await page.locator('text=Histórico de versões').count();
    const decisionsVisible = await page.locator('text=Histórico de decisões').count();
    record('histórico de versões e decisões visível', (versionsVisible > 0 && decisionsVisible > 0) ? 'PASS' : 'FAIL');

    // 9. Relatório de auditoria abre com a missão original e o trace.
    await page.locator('button:has-text("Relatório de auditoria")').click();
    await page.waitForSelector('text=Relatório de auditoria', { timeout: 30000 });
    await page.waitForTimeout(1200);
    const reportHasOriginal = await page.locator(`text=${MISSION_TEXT}`).count();
    record('relatório de auditoria contém a missão original', reportHasOriginal > 0 ? 'PASS' : 'FAIL');

    await page.screenshot({ path: path.join(EVIDENCE_DIR, '2026-09-24-engineering-mission-approved.png'), fullPage: true });

    // 10. Revisão (Meta Reviewer §23 + Adversarial §24) executável pela interface.
    await page.locator('button:has-text("Rodar revisão completa")').click();
    await page.waitForSelector('text=Adversarial Review', { timeout: 120000 });
    await page.waitForTimeout(1500);
    const metaStatusVisible = await page.locator('text=Meta Review · status').count();
    record('Meta Review executado pela UI com status visível', metaStatusVisible > 0 ? 'PASS' : 'FAIL');
    const notVerifiableVisible = await page.locator('text=como tornar verificável').count();
    record('itens NOT_VERIFIABLE são declarados (nunca PASS cego)', notVerifiableVisible > 0 ? 'PASS' : 'FAIL');
    const invariantFindingsVisible = await page.locator('li:has-text("MR-")').count();
    record('findings objetivos do Meta Review listados', invariantFindingsVisible > 0 ? 'PASS' : 'FAIL', `${invariantFindingsVisible} finding(s) com id MR-*`);
    const adversarialCovered = await page.locator('text=ataques cobertos').count();
    record('Adversarial Review mostra cobertura do catálogo', adversarialCovered > 0 ? 'PASS' : 'FAIL');

    await page.screenshot({ path: path.join(EVIDENCE_DIR, '2026-09-24-engineering-mission-review.png'), fullPage: true });

    // 11. Autoavaliação contínua (§45) — mede de dados persistidos, com nulos explícitos.
    await page.goto(`${BASE_URL}/dev/engineering/missions`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('text=Autoavaliação contínua', { timeout: 30000 });
    await page.locator('button:has-text("Calcular")').first().click();
    await page.waitForSelector('text=missões analisadas', { timeout: 60000 });
    const assessmentRendered = await page.locator('text=taxa aprovação humana').count();
    record('autoavaliação calculada e exibida', assessmentRendered > 0 ? 'PASS' : 'FAIL');
    await page.screenshot({ path: path.join(EVIDENCE_DIR, '2026-09-24-engineering-mission-self-assessment.png'), fullPage: true });

    // O passo de revisão DELIBERADAMENTE provoca um resultado bloqueante (a missão desta jornada
    // foi aprovada mas não executou a task, então os gates aparecem MISSING e GREEN é recusado) —
    // o toast de erro do próprio app é a notificação ESPERADA desse resultado, não um defeito de
    // página. Ele é separado e contado; o critério segue rígido para qualquer outro erro.
    const unexpectedConsoleErrors = results.consoleErrors.filter((text) => !/\[ERROR\] Toast \[error\]/.test(text));
    results.expectedToastErrors = results.consoleErrors.length - unexpectedConsoleErrors.length;
    record('sem erros de console inesperados', unexpectedConsoleErrors.length === 0 ? 'PASS' : 'FAIL', unexpectedConsoleErrors.slice(0, 3).join(' | '));
    // `ERR_ABORTED` é cancelamento de requisição por navegação (o componente que pediu /auth/me
    // desmontou) — não é falha de rede da aplicação. Qualquer outro erro de rede conta.
    const realNetworkFailures = results.networkFailures.filter((f) => f.error !== 'net::ERR_ABORTED');
    results.abortedRequests = results.networkFailures.length - realNetworkFailures.length;
    record('sem falhas de rede', realNetworkFailures.length === 0 ? 'PASS' : 'FAIL', realNetworkFailures.slice(0, 3).map((f) => `${f.url} (${f.error})`).join(' | '));
  } catch (err) {
    record('jornada completa', 'FAIL', err.message);
    await page.screenshot({ path: path.join(EVIDENCE_DIR, '2026-09-24-engineering-mission-failure.png'), fullPage: true }).catch(() => {});
  } finally {
    results.finishedAt = new Date().toISOString();
    results.url = page.url();
    const outFile = path.join(EVIDENCE_DIR, '2026-09-24-engineering-missions-browser.json');
    fs.writeFileSync(outFile, JSON.stringify(results, null, 2));
    console.log(`\nEvidência: ${outFile}`);
    console.log(`Passou: ${results.passed} | Falhou: ${results.failed}`);
    await browser.close();
    if (results.failed > 0) process.exit(1);
  }
}

main();
