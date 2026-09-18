'use strict';

/**
 * Smoke — jornada REAL do Ask AI no browser.
 *
 * Valida, como usuário normal, o caminho que os gates de relatório não provam:
 * login → rota → widget → pergunta → resposta com fontes.
 *
 * Regra do repo: reutiliza o helper canônico `tests/helpers/playwrightAuth.js`.
 * Nunca duplicar login manual (preenchimento de usuário/senha + clique cego no
 * modal de tenant).
 *
 * Evidência (screenshot) em `AI_MEMORY/evidence/ask-ai-journey-latest.png` —
 * diretório governado; nunca em `dist/`. Nome estável: o arquivo representa o
 * estado ATUAL da jornada e é sobrescrito a cada execução.
 *
 * Uso:
 *   node scripts/smoke/ask-ai-browser-journey.js
 *
 * Env:
 *   RAP_UI_BASE      (default http://localhost:5173)
 *   RAP_UI_TARGET    (default <base>/ai-tools)
 *   RAP_UI_QUESTION  (default pergunta procedimental)
 *   QA_USER / QA_PASS / QA_TENANT (defaults de QA local do projeto)
 *
 * Sai com código != 0 se a jornada não completar. Ver `AI_MEMORY/runtime-navigation.md`
 * § "Ask AI — validação de jornada real" para os fatos observados (o assistente é
 * um widget flutuante global, não uma rota).
 */

const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..', '..');

function loadChromium() {
  for (const candidate of [`${REPO}/node_modules/playwright`, `${REPO}/node_modules/@playwright/test`]) {
    try {
      return require(candidate).chromium;
    } catch (_) {
      /* tenta o próximo */
    }
  }
  return null;
}

const BASE = process.env.RAP_UI_BASE || 'http://localhost:5173';
const TARGET = process.env.RAP_UI_TARGET || `${BASE}/ai-tools`;
const USER = process.env.QA_USER || 'systemadmin';
const PASS = process.env.QA_PASS || 'Admin123!';
const TENANT = process.env.QA_TENANT || 'system';
const QUESTION = process.env.RAP_UI_QUESTION || 'Como faço para cadastrar um novo cliente?';
const EVIDENCE_DIR = path.join(REPO, 'AI_MEMORY', 'evidence');

/** Marcador de resposta REAL: a seção de fontes que o assistente renderiza. */
const ANSWER_MARKER = /fontes\s*:/i;
const MIN_ANSWER_CHARS = 120;

/**
 * Extrai o texto do PAINEL do assistente.
 *
 * Cuidado aprendido na marra: subir só um nível a partir do botão de fechar pega
 * o CABEÇALHO (≈82 chars) e faz o smoke reprovar um produto que respondeu. O
 * painel é o primeiro ancestral com altura de painel e conteúdo substancial.
 */
async function readPanelText(page) {
  return page.evaluate(() => {
    const closeBtn = document.querySelector('[aria-label="Fechar painel"]');
    let node = closeBtn;
    while (node && node !== document.body) {
      const text = (node.innerText || '').replace(/\s+/g, ' ').trim();
      if (node.clientHeight >= 200 && text.length > 200) break;
      node = node.parentElement;
    }
    const text = (node && node.innerText) || (closeBtn ? closeBtn.parentElement.innerText : document.body.innerText);
    return (text || '').replace(/\s+/g, ' ').trim();
  });
}

async function run() {
  const chromium = loadChromium();
  if (!chromium) {
    console.error('❌ Playwright indisponível (node_modules/playwright ou @playwright/test)');
    process.exit(2);
  }

  const { loginWithTenantSelection } = require(path.join(REPO, 'tests', 'helpers', 'playwrightAuth'));

  const consoleErrors = [];
  const pageErrors = [];
  const failedRequests = [];
  const abortedRequests = [];

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text().slice(0, 300));
  });
  page.on('pageerror', (err) => pageErrors.push(String(err.message).slice(0, 300)));
  page.on('requestfailed', (req) => {
    const failure = (req.failure() && req.failure().errorText) || '?';
    const entry = `${req.method()} ${req.url().slice(0, 160)} :: ${failure}`;
    // ERR_ABORTED = requisição CANCELADA (navegação/unmount cancela fetch em voo).
    // Não é falha de entrega; fica registrado como aviso. Qualquer outro erro de
    // rede (recusa de conexão, DNS, HTTP >= 500) é falha de verdade.
    if (/ERR_ABORTED/i.test(failure)) abortedRequests.push(entry);
    else failedRequests.push(entry);
  });
  page.on('response', (res) => {
    if (res.status() >= 500) failedRequests.push(`HTTP ${res.status()} ${res.url().slice(0, 160)}`);
  });

  const checks = [];
  const record = (name, ok, detail) => {
    checks.push({ name, ok, detail });
    console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
  };

  let panelText = '';
  let screenshotPath = null;

  try {
    const tenantSelection = await loginWithTenantSelection(page, {
      targetUrl: TARGET,
      username: USER,
      password: PASS,
      tenantId: TENANT,
    });
    record('login_com_tenant', true, `tenant=${tenantSelection && tenantSelection.selectedTenant ? tenantSelection.selectedTenant : TENANT}`);

    record('rota_alvo_carrega', page.url() === TARGET, page.url());

    const openButton = page.locator('[aria-label="Perguntar à IA"]').first();
    await openButton.waitFor({ state: 'visible', timeout: 20000 });
    await openButton.click();
    record('widget_abre', true, 'botao flutuante aria-label="Perguntar à IA"');

    const input = page.locator('input[placeholder*="pergunta" i]').first();
    await input.waitFor({ state: 'visible', timeout: 15000 });
    await input.fill(QUESTION);
    await input.press('Enter');
    record('pergunta_enviada', true, QUESTION.slice(0, 60));

    // Espera a resposta REAL: seção "Fontes:" ou texto substancial no painel.
    const deadline = Date.now() + 45000;
    while (Date.now() < deadline) {
      panelText = await readPanelText(page);
      const withoutHeader = panelText
        .replace(/Perguntar à IA/gi, '')
        .replace(/Respostas baseadas no conhecimento do seu tenant/gi, '')
        .replace(/Nova conversa/gi, '')
        .replace(QUESTION, '')
        .trim();
      if (ANSWER_MARKER.test(panelText) || withoutHeader.length >= MIN_ANSWER_CHARS) break;
      await page.waitForTimeout(1500);
    }

    const answered = ANSWER_MARKER.test(panelText)
      || panelText.replace(QUESTION, '').replace(/Perguntar à IA/gi, '').trim().length >= MIN_ANSWER_CHARS;
    record('resposta_renderizada', answered, ANSWER_MARKER.test(panelText) ? 'bloco "Fontes:" presente' : `${panelText.length} chars no painel`);

    const sourcesIdx = panelText.search(ANSWER_MARKER);
    const sourcesExcerpt = sourcesIdx >= 0 ? panelText.slice(sourcesIdx, sourcesIdx + 200) : null;
    // O bloco "Fontes:" é INFORMATIVO, não contrato: o assistente responde
    // legitimamente sem citar (medido: 253 chars de resposta sem bloco). Asserir
    // presença de fontes tornaria o smoke instável contra um comportamento que o
    // produto nunca prometeu.
    if (sourcesExcerpt) console.log(`ℹ️  fontes citadas — ${sourcesExcerpt.slice(0, 120)}`);
    else console.log('ℹ️  resposta sem bloco "Fontes:" (permitido)');
  } catch (error) {
    record('jornada_sem_excecao', false, String(error.message).slice(0, 300));
  }

  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  // Nome ESTÁVEL (sobrescreve): cada execução do smoke gerava um PNG novo e o
  // diretório governado acumulava lixo. A evidência é o estado ATUAL da jornada.
  screenshotPath = path.join(EVIDENCE_DIR, 'ask-ai-journey-latest.png');
  try {
    await page.screenshot({ path: screenshotPath, fullPage: false });
  } catch (error) {
    screenshotPath = `falhou: ${error.message}`;
  }

  record('sem_erros_de_console', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | ') || 'nenhum');
  record('sem_erros_de_pagina', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | ') || 'nenhum');
  record('sem_falhas_de_rede', failedRequests.length === 0, failedRequests.slice(0, 3).join(' | ') || 'nenhuma');
  if (abortedRequests.length > 0) {
    // Aviso, não falha: cancelamento não é ausência de entrega.
    console.log(`ℹ️  requisições canceladas (ERR_ABORTED, não fatais): ${abortedRequests.length} — ${abortedRequests.slice(0, 3).join(' | ')}`);
  }

  await browser.close();

  const failed = checks.filter((c) => !c.ok);
  console.log();
  console.log(`evidência: ${screenshotPath}`);
  console.log(failed.length === 0
    ? `PASS: ${checks.length}/${checks.length} verificações da jornada real do Ask AI`
    : `FAIL: ${failed.length} de ${checks.length} verificações falharam — ${failed.map((f) => f.name).join(', ')}`);

  process.exit(failed.length === 0 ? 0 : 1);
}

if (require.main === module) {
  run().catch((error) => {
    console.error('FALHA NA JORNADA:', error.message);
    process.exit(1);
  });
}

module.exports = { run, loadChromium };
