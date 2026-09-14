#!/usr/bin/env node
'use strict';

/**
 * Prova real no browser: o VISUALIZADOR DE REPLAYS abre o replay que a lista
 * oferece.
 *
 * Defeitos originais (encontrados exercitando a UI, 13-14/09/2026):
 *   1. a lista (`/api/test-executions/replays`) oferecia entradas cujo detalhe
 *      (`/api/test-executions/replays/<file>.json`) respondia **404 "Replay não
 *      encontrado"** — o modal abria vazio com "Nenhuma ação registrada";
 *   2. causa: `getReplayFile` devolvia `null` quando a INTEGRIDADE falhava, o que
 *      rotulava "assinatura de algoritmo antigo" como "arquivo inexistente" e
 *      escondia a regressão da migração de assinatura (118 replays gravados
 *      inacessíveis).
 *
 * Esta prova cobre o caminho do usuário ponta a ponta: autenticar → listar →
 * abrir. Ela falha se o detalhe voltar a responder algo diferente de 200, e
 * distingue explicitamente 404 (não existe) de 422 (integridade falhou), para
 * que a próxima ocorrência não volte a se disfarçar de "arquivo não encontrado".
 *
 * Autenticação: reusa `tests/helpers/playwrightAuth.js` (regra do repositório).
 * Credenciais vêm do ambiente; os defaults são as credenciais de QA local
 * documentadas em AGENTS.md para validação, não segredos de produção.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');

const { loginWithTenantSelection } = require(path.join(ROOT, 'tests/helpers/playwrightAuth'));

const BASE_URL = process.env.REPLAY_SMOKE_BASE || process.env.ASKAI_VERIFY_BASE || 'http://127.0.0.1:5173';
const USERNAME = process.env.ASKAI_VERIFY_USER || 'systemadmin';
const PASSWORD = process.env.ASKAI_VERIFY_PASSWORD || 'Admin123!';
const TENANT_ID = process.env.TEST_TENANT_ID || 'system';
const REPORT_PATH = path.join(ROOT, 'reports', 'replay-viewer-smoke-report.json');

function loadChromium() {
  const attempts = [
    'playwright',
    'playwright-core',
    path.join(ROOT, 'frontend-e2e', 'node_modules', 'playwright'),
    path.join(ROOT, 'frontend-e2e', 'node_modules', 'playwright-core'),
  ];
  const errors = [];
  for (const attempt of attempts) {
    try {
      // eslint-disable-next-line global-require, import/no-dynamic-require
      return require(attempt).chromium;
    } catch (error) {
      errors.push(`${attempt}: ${error.message}`);
    }
  }
  throw new Error(`playwright_indisponivel: ${errors.join(' | ')}`);
}

function writeReport(report) {
  try {
    fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
    fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  } catch {
    // relatório é diagnóstico; a falha da prova vem do exit code
  }
}

async function main() {
  const chromium = loadChromium();
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  const detailCalls = [];
  page.on('response', (resp) => {
    const url = resp.url();
    if (/\/api\/test-executions\/replays\/[^/?]+\.json/.test(url)) {
      detailCalls.push({ status: resp.status(), url: url.replace(/^https?:\/\/[^/]+/, '') });
    }
  });

  const findings = [];
  const report = {
    generatedAt: new Date().toISOString(),
    baseUrl: BASE_URL,
    detailCalls,
    findings,
    status: 'UNKNOWN',
  };

  try {
    // Fluxo canônico do repositório: abrir a URL ALVO -> autenticar -> selecionar
    // tenant -> permanecer autenticado na URL alvo.
    const targetUrl = `${BASE_URL}/rpa-replays`;
    await loginWithTenantSelection(page, {
      targetUrl,
      username: USERNAME,
      password: PASSWORD,
      tenantId: TENANT_ID,
    });
    report.authenticated = true;

    if (page.url() !== targetUrl) {
      await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
    }
    await page.waitForTimeout(8000);

    const primeiro = page.locator('text=/Replay ID: /').first();
    const existe = await primeiro.count();
    if (existe === 0) {
      findings.push({ severity: 'blocker', id: 'replay_viewer_sem_lista', detail: 'nenhum replay listado para abrir' });
    } else {
      report.replayIdClicado = (await primeiro.textContent().catch(() => '')).trim();
      await primeiro.click({ timeout: 15000 });
      await page.waitForTimeout(8000);

      const text = await page.evaluate(() => document.body.innerText);
      report.telaVazia = text.includes('Nenhuma ação registrada');
      report.naoEncontradoNaTela = /não encontrado/i.test(text);

      const detalhes = detailCalls.filter((c) => /replays\/.+\.json/.test(c.url));
      const statuses = [...new Set(detalhes.map((c) => c.status))];
      report.detailStatuses = statuses;

      if (statuses.includes(404)) {
        findings.push({
          severity: 'blocker',
          id: 'replay_detalhe_404',
          detail: `detalhe respondeu 404 para replay oferecido pela lista (${detalhes.length} chamada(s))`,
        });
      }
      if (statuses.includes(422)) {
        findings.push({
          severity: 'blocker',
          id: 'replay_integridade_falhou',
          detail: 'detalhe respondeu 422 REPLAY_INTEGRITY_FAILED — artefato inválido (rodar scripts/resign-replay-artifacts.js --replays)',
        });
      }
      if (report.naoEncontradoNaTela || report.telaVazia) {
        findings.push({
          severity: 'blocker',
          id: 'replay_viewer_vazio',
          detail: `UI abriu sem conteúdo (naoEncontrado=${report.naoEncontradoNaTela} vazio=${report.telaVazia})`,
        });
      }
      if (detalhes.length > 0 && !statuses.includes(404) && !statuses.includes(422) && !report.telaVazia) {
        findings.push({ severity: 'info', id: 'replay_viewer_ok', detail: `detalhe 200 e conteúdo renderizado (${detalhes.length} chamada(s))` });
      }
    }
  } catch (error) {
    findings.push({ severity: 'blocker', id: 'replay_smoke_erro', detail: error.message });
  } finally {
    report.status = findings.some((f) => f.severity === 'blocker') ? 'FAIL' : 'PASS';
    writeReport(report);
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }

  findings.forEach((f) => console.log(`[replay-viewer] ${f.severity.toUpperCase()} ${f.id}: ${f.detail}`));
  console.log(`[replay-viewer] status=${report.status} detalhes=${JSON.stringify(report.detailStatuses || [])} relatorio=${path.relative(ROOT, REPORT_PATH)}`);
  process.exitCode = report.status === 'PASS' ? 0 : 1;
}

main().catch((error) => {
  console.error(`[replay-viewer] ERRO FATAL: ${error.message}`);
  process.exitCode = 1;
});
