#!/usr/bin/env node
'use strict';

/**
 * Prova real no browser: a FONTE do Ask AI leva ao DOCUMENTO, e a leitura
 * respeita autorização.
 *
 * Defeito original (2026-09-14): as fontes do Ask AI passaram a apontar para
 * `/rag-documents?documentId=…`, mas a página IGNORAVA o parâmetro — clicar na
 * fonte citada abria a LISTA, não o documento. O link só é útil se abrir o
 * documento; e a URL é entrada NÃO CONFIÁVEL, então falha de leitura
 * (permissão/tenant/inexistente) precisa FECHAR o caminho, nunca abrir a tela
 * com dado não verificado.
 *
 * Esta prova cobre os três caminhos:
 *   1. carga direta com `?documentId=<id real>` → o detalhe abre e a URL é
 *      normalizada (o parâmetro sai, para não reabrir a cada fechamento);
 *   2. navegação SPA para outro documento (pushState + evento de rota, que é o
 *      que acontece ao clicar numa segunda fonte sem sair da página) → troca o
 *      documento aberto;
 *   3. id inexistente → NÃO abre detalhe, e a API responde 404 (a falha é
 *      visível, não silenciosa).
 *
 * Autenticação: reusa `tests/helpers/playwrightAuth.js` (regra do repositório).
 * Credenciais vêm do ambiente; os defaults são as credenciais de QA local
 * documentadas em AGENTS.md, não segredos de produção.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');

const { loginWithTenantSelection } = require(path.join(ROOT, 'tests/helpers/playwrightAuth'));

const BASE_URL = process.env.ASKAI_VERIFY_BASE || 'http://127.0.0.1:5173';
const USERNAME = process.env.ASKAI_VERIFY_USER || 'systemadmin';
const PASSWORD = process.env.ASKAI_VERIFY_PASSWORD || 'Admin123!';
const TENANT_ID = process.env.TEST_TENANT_ID || 'system';
const REPORT_PATH = path.join(ROOT, 'reports', 'ask-ai-source-deeplink-report.json');
// O `Dialog` do projeto renderiza o overlay como IRMÃO da caixa de conteúdo:
// o overlay (`absolute inset-0 bg-black/25`) não tem texto nenhum. Asserções de
// conteúdo precisam olhar a caixa do diálogo.
const DIALOG_SELECTOR = 'div[class*="bg-gradient-to-br"][class*="from-bg-elevated"]';
const DIALOG_TITLE = 'Detalhes do Documento';
const MODAL_WAIT_MS = 15000;
const DENY_WAIT_MS = 6000;

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
  } catch (error) {
    console.error(`[ask-ai-deeplink] falha ao escrever relatorio: ${error.message}`);
  }
}

function normalizeDocs(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.documents)) return payload.documents;
  if (Array.isArray(payload?.rows)) return payload.rows;
  if (Array.isArray(payload?.data)) return payload.data;
  return [];
}

async function overlayVisible(page) {
  try {
    return await page.locator(DIALOG_SELECTOR).first().isVisible({ timeout: 500 });
  } catch (_) {
    return false;
  }
}

async function overlayText(page) {
  try {
    return String(await page.locator(DIALOG_SELECTOR).first().innerText({ timeout: 1500 }) || '');
  } catch (_) {
    return '';
  }
}

async function main() {
  const findings = [];
  const report = {
    generatedAt: new Date().toISOString(),
    baseUrl: BASE_URL,
    tenantId: TENANT_ID,
    status: 'UNKNOWN',
  };

  const browser = await loadChromium().launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  const detailCalls = [];
  const listPayloads = [];
  page.on('response', (response) => {
    const url = response.url();
    if (/\/rag\/documents\/[^/?#]+(\?|#|$)/.test(url)) {
      detailCalls.push({ status: response.status(), url: url.replace(/^https?:\/\/[^/]+/, '') });
    }
    if (/\/rag\/documents(\?|#|$)/.test(url) && response.request().method() === 'GET') {
      response.json().then((json) => listPayloads.push(json)).catch(() => {});
    }
  });

  try {
    await loginWithTenantSelection(page, {
      targetUrl: `${BASE_URL}/rag-documents`,
      username: USERNAME,
      password: PASSWORD,
      tenantId: TENANT_ID,
    });
    report.authenticated = true;

    await page.waitForTimeout(1500);
    const docs = listPayloads.flatMap(normalizeDocs).filter((doc) => doc && doc.id);
    report.documentosListados = docs.length;
    const withTitle = docs.filter((doc) => String(doc.title || '').trim().length > 3);
    const alvo = withTitle[0];
    const outro = withTitle.find((doc) => doc.id !== alvo?.id && doc.title !== alvo?.title);
    report.documentoId = alvo?.id || null;
    report.documentoTitulo = alvo?.title || null;

    if (!alvo) {
      findings.push({
        severity: 'blocker',
        detail: `nenhum documento com titulo utilizavel foi listado (docs=${docs.length})`,
      });
    } else {
      // ---- 1) carga direta do deep link
      await page.goto(`${BASE_URL}/rag-documents?documentId=${encodeURIComponent(alvo.id)}`, {
        waitUntil: 'domcontentloaded',
      });
      await page.locator(DIALOG_SELECTOR).first()
        .waitFor({ state: 'visible', timeout: MODAL_WAIT_MS })
        .catch(() => null);
      report.deepLinkAbriuDetalhe = await overlayVisible(page);
      const texto = await overlayText(page);
      report.dialogoTitulo = texto.includes(DIALOG_TITLE);
      report.detalheContemTitulo = texto.includes(String(alvo.title).trim());
      report.urlNormalizada = !page.url().includes('documentId');
      report.detalheStatus = detailCalls.map((call) => call.status);

      if (!report.deepLinkAbriuDetalhe) {
        findings.push({ severity: 'blocker', detail: 'deep link com id real NAO abriu o detalhe' });
      } else if (!report.detalheContemTitulo) {
        findings.push({
          severity: 'blocker',
          detail: 'detalhe abriu mas nao mostra o documento do link (titulo ausente)',
        });
      }
      if (!report.urlNormalizada) {
        findings.push({ severity: 'major', detail: 'URL manteve ?documentId= apos abrir (reabre ao fechar)' });
      }

      // ---- 2) navegacao SPA para outro documento
      if (outro) {
        await page.evaluate((search) => {
          window.history.pushState({}, '', `${window.location.pathname}${search}`);
          window.dispatchEvent(new CustomEvent('router:change'));
        }, `?documentId=${encodeURIComponent(outro.id)}`);
        await page.waitForFunction(
          (args) => {
            const dialog = document.querySelector(args.selector);
            return !!dialog && String(dialog.textContent || '').includes(args.titulo);
          },
          { selector: DIALOG_SELECTOR, titulo: String(outro.title).trim() },
          { timeout: MODAL_WAIT_MS },
        ).catch(() => null);
        const textoSpa = await overlayText(page);
        report.spaTrocouDocumento = textoSpa.includes(String(outro.title).trim());
        if (!report.spaTrocouDocumento) {
          findings.push({ severity: 'major', detail: 'segunda fonte (navegacao SPA) nao abriu o outro documento' });
        }
      } else {
        report.spaTrocouDocumento = 'SKIPPED_SEM_SEGUNDO_DOCUMENTO';
      }
    }

    // ---- 3) id inexistente: falha visivel, nada aberto
    const antes = detailCalls.length;
    await page.goto(`${BASE_URL}/rag-documents?documentId=nao-existe-${Date.now()}`, {
      waitUntil: 'domcontentloaded',
    });
    await page.waitForTimeout(DENY_WAIT_MS);
    report.idInexistenteAbriuDetalhe = await overlayVisible(page);
    const novas = detailCalls.slice(antes);
    report.idInexistenteStatus = novas.map((call) => call.status);

    if (report.idInexistenteAbriuDetalhe) {
      findings.push({ severity: 'blocker', detail: 'id inexistente ABRIU detalhe (abriu tela sem dado verificado)' });
    }
    if (!novas.some((call) => call.status === 404)) {
      findings.push({
        severity: 'major',
        detail: `id inexistente nao produziu 404 observavel (status=${JSON.stringify(report.idInexistenteStatus)})`,
      });
    }
  } catch (error) {
    findings.push({ severity: 'blocker', detail: `excecao no fluxo: ${error.message}` });
    report.error = error.message;
  } finally {
    await browser.close().catch(() => {});
  }

  report.findings = findings;
  report.status = findings.some((finding) => finding.severity === 'blocker')
    ? 'FAIL'
    : (findings.length > 0 ? 'PARTIAL' : 'PASS');
  writeReport(report);

  console.log(
    `[ask-ai-deeplink] status=${report.status} detalhe=${report.deepLinkAbriuDetalhe} `
    + `spa=${report.spaTrocouDocumento} urlNormalizada=${report.urlNormalizada} relatorio=${path.relative(ROOT, REPORT_PATH)}`,
  );
  findings.forEach((finding) => console.log(`[ask-ai-deeplink] ${finding.severity}: ${finding.detail}`));
  process.exitCode = report.status === 'PASS' ? 0 : 1;
}

main().catch((error) => {
  console.error(`[ask-ai-deeplink] falha fatal: ${error.message}`);
  process.exitCode = 1;
});
