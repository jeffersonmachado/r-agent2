const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const BASE_URL = process.env.FRONTEND_URL || 'http://localhost:5173';
const USERNAME = process.env.TEST_USERNAME || 'admin';
const PASSWORD = process.env.TEST_PASSWORD || 'Admin123!';
const outDir = '/tmp/bpmn-smoke-artifacts';

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeReport(lines) {
  const reportPath = '/tmp/bpmn_smoke_report.md';
  fs.writeFileSync(reportPath, `${lines.join('\n')}\n`, 'utf8');
  return reportPath;
}

(async () => {
  ensureDir(outDir);

  const report = [];
  report.push('# BPMN E2E Smoke Report');
  report.push(`- Date: ${new Date().toISOString()}`);
  report.push(`- Base URL: ${BASE_URL}`);
  report.push(`- User: ${USERNAME}`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();

  const getStatus = async () => {
    const locator = page.locator('.bpmn-editor-page__status').first();
    if (!(await locator.isVisible().catch(() => false))) return null;
    return (await locator.textContent()) || null;
  };

  try {
    await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle', timeout: 45000 });

    await page.getByPlaceholder('Digite seu username').fill(USERNAME);
    await page.getByPlaceholder('Digite sua senha').fill(PASSWORD);
    await page.getByRole('button', { name: /Entrar/i }).click();

    // Se modal de tenant aparecer, seleciona o primeiro tenant disponível.
    const tenantModalVisible = await page.locator('text=Selecione o Tenant').first().isVisible().catch(() => false);
    if (tenantModalVisible) {
      await page.evaluate(() => {
        const allButtons = Array.from(document.querySelectorAll('button'));
        const candidate = allButtons.find((b) => {
          if (b.disabled) return false;
          const text = String(b.innerText || '').trim();
          if (!text) return false;
          if (/^(Cancelar|Acessar|Entrar|Claro|Escuro)$/i.test(text)) return false;
          return true;
        });
        if (candidate) candidate.click();
      });

      await page.getByRole('button', { name: /^Acessar$/i }).click({ timeout: 10000 });
    }

    await page.goto(`${BASE_URL}/bpmn-editor`, { waitUntil: 'networkidle', timeout: 45000 });

    const denied = await page.locator('text=Acesso Negado').first().isVisible().catch(() => false);
    if (denied) {
      throw new Error('Acesso negado em /bpmn-editor para o usuário de smoke.');
    }

    await page.getByRole('button', { name: /Load Pizza-Store\.bpmn/i }).click();
    await page.waitForTimeout(1200);
    const pizzaStatus = await getStatus();
    report.push(`- Status after Pizza load: ${pizzaStatus || '(none)'}`);

    if (!pizzaStatus || !/Pizza-Store\.bpmn imported/i.test(pizzaStatus)) {
      throw new Error(`Status inesperado após carregar Pizza fixture: ${pizzaStatus}`);
    }

    const [xmlDownload] = await Promise.all([
      page.waitForEvent('download', { timeout: 20000 }),
      page.getByRole('button', { name: /Export BPMN \(XML\)/i }).click(),
    ]);
    const xmlPath = path.join(outDir, 'diagram.bpmn');
    await xmlDownload.saveAs(xmlPath);
    const xml = fs.readFileSync(xmlPath, 'utf8');
    if (!xml.includes('<bpmn:definitions')) {
      throw new Error('XML exportado inválido: sem <bpmn:definitions>.');
    }
    if (!/bpmndi:BPMNShape|bpmndi:BPMNEdge/.test(xml)) {
      throw new Error('XML exportado sem evidência de BPMN DI (shape/edge).');
    }
    report.push(`- XML exported: ${xmlPath}`);

    const [svgDownload] = await Promise.all([
      page.waitForEvent('download', { timeout: 20000 }),
      page.getByRole('button', { name: /Export BPMN \(SVG\)/i }).click(),
    ]);
    const svgPath = path.join(outDir, 'diagram.svg');
    await svgDownload.saveAs(svgPath);
    const svg = fs.readFileSync(svgPath, 'utf8');
    if (!/<svg[\s>]/i.test(svg)) {
      throw new Error('SVG exportado inválido: sem tag <svg>.');
    }
    report.push(`- SVG exported: ${svgPath}`);

    const [jsonDownload] = await Promise.all([
      page.waitForEvent('download', { timeout: 20000 }),
      page.getByRole('button', { name: /Convert to internal flow/i }).click(),
    ]);
    const internalJsonPath = path.join(outDir, 'internal-flow.json');
    await jsonDownload.saveAs(internalJsonPath);
    const internalFlow = JSON.parse(fs.readFileSync(internalJsonPath, 'utf8'));
    if (!internalFlow || !Array.isArray(internalFlow.nodes) || internalFlow.nodes.length === 0) {
      throw new Error('Internal flow exportado inválido: nodes vazio/ausente.');
    }
    report.push(`- Internal flow exported: ${internalJsonPath}`);
    report.push(`- Internal flow nodes: ${internalFlow.nodes.length}`);

    const [fileChooser] = await Promise.all([
      page.waitForEvent('filechooser', { timeout: 20000 }),
      page.getByRole('button', { name: /Import internal flow/i }).click(),
    ]);
    await fileChooser.setFiles(internalJsonPath);
    await page.waitForTimeout(1400);

    const importStatus = await getStatus();
    report.push(`- Status after internal import: ${importStatus || '(none)'}`);
    if (!importStatus || !/Imported internal flow/i.test(importStatus)) {
      throw new Error(`Status inesperado após importar internal flow: ${importStatus}`);
    }

    report.push('- Result: SUCCESS');
    const reportPath = writeReport(report);
    console.log('BPMN smoke succeeded.');
    console.log(`Report: ${reportPath}`);
    console.log(`Artifacts: ${outDir}`);
  } finally {
    await context.close();
    await browser.close();
  }
})().catch((err) => {
  const fail = [
    '# BPMN E2E Smoke Report',
    `- Date: ${new Date().toISOString()}`,
    '- Result: FAILED',
    `- Error: ${err.message}`,
  ];
  const reportPath = writeReport(fail);
  console.error('BPMN smoke failed:', err.message);
  console.error(`Report: ${reportPath}`);
  process.exit(1);
});
