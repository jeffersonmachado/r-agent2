'use strict';

/**
 * Validação em BROWSER REAL da tela Configuração → IA: consulta de saldo por provedor e o botão
 * de RETESTE da credencial já salva.
 *
 * Uso: node tests/smoke/ai-provider-balance-browser.js
 *
 * Reutiliza o helper compartilhado `tests/helpers/playwrightAuth.js` (regra do projeto: nunca
 * reimplementar login/seleção de tenant no teste). Percorre o que um usuário faz: abrir a
 * configuração → aba IA → ler o resultado do último teste de cada credencial → clicar em
 * "Retestar" e conferir que o teste da chave SALVA roda de novo (sem redigitar a chave) e que o
 * badge continua coerente com o resultado medido.
 *
 * Princípio das asserções: elas NUNCA exigem que o provedor esteja saudável (a API de terceiros
 * pode estar fora — o Moonshot devolveu 521 durante a escrita deste teste). O que se exige é
 * COERÊNCIA: quem tem saldo consultável mostra valor; quem não tem mostra o motivo; quem falhou
 * não fica exibindo saldo velho; quem não tem chave salva não oferece reteste.
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
const EVIDENCE_BASENAME = '2026-09-29-config-ia-saldo-por-provider';

const TEM_VALOR = /US\$|R\$/;
const EH_ERRO = /Erro ao testar|Token inválido|Sem saldo/i;

const results = {
  startedAt: new Date().toISOString(),
  baseUrl: BASE_URL,
  journey: 'config-ia-saldo-e-reteste-por-provider',
  steps: [],
  consoleErrors: [],
  toastErrors: [],
  networkFailures: [],
  providerRows: [],
  retestCalls: [],
  retestTarget: null,
  retestBadgeAfter: null,
  passed: 0,
  failed: 0,
};

function record(name, condition, detail = '') {
  const status = condition ? 'PASS' : 'FAIL';
  results.steps.push({ name, status, detail, at: new Date().toISOString() });
  if (status === 'PASS') results.passed += 1; else results.failed += 1;
  console.log(`[${status}] ${name}${detail ? ` — ${detail}` : ''}`);
}

/**
 * Lê cada linha de provedor ANCORADA no botão de reteste (`data-testid="retest-provider-<key>"`),
 * que é a única fonte do id do provedor no DOM — a varredura anterior, ancorada no badge, subia até
 * um container que também continha o cabeçalho do tenant e produzia uma linha falsa.
 */
function readProviderRows() {
  const isCredentialBadge = (span) => {
    const cls = String(span.className || '');
    return cls.includes('rounded') && cls.includes('text-xs');
  };
  const out = [];
  for (const button of Array.from(document.querySelectorAll('[data-testid^="retest-provider-"]'))) {
    const key = String(button.getAttribute('data-testid') || '').replace('retest-provider-', '');
    let node = button.parentElement;
    while (node && node !== document.body && !/modelo:/.test(String(node.innerText || ''))) {
      node = node.parentElement;
    }
    const row = node && node !== document.body ? node : null;
    if (!row) continue;
    const badge = Array.from(row.querySelectorAll('span')).find(isCredentialBadge) || null;
    out.push({
      key,
      label: String(row.innerText || '').split('\n')[0].trim(),
      badgeText: badge ? String(badge.innerText || '').replace(/\s+/g, ' ').trim() : null,
      badgeTitle: badge ? badge.getAttribute('title') || null : null,
      retestDisabled: Boolean(button.disabled),
    });
  }
  return out;
}

async function main() {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  const page = await context.newPage();

  page.on('console', (msg) => {
    if (msg.type() === 'error') results.consoleErrors.push(msg.text());
  });
  page.on('response', async (response) => {
    let pathname = '';
    try {
      pathname = new URL(response.url()).pathname;
    } catch (_) {
      return;
    }
    if (!/\/ai-credentials\/test$/.test(pathname)) return;
    let body = null;
    try {
      body = await response.json();
    } catch (_) { /* resposta sem JSON */ }
    results.retestCalls.push({
      method: response.request().method(),
      status: response.status(),
      valid: body?.valid ?? null,
      balanceStatus: body?.balanceStatus ?? null,
    });
  });
  page.on('requestfailed', (req) => {
    const error = req.failure()?.errorText || '';
    // `net::ERR_ABORTED` é a navegação cancelada pelo próprio redirect pós-login — não é falha de
    // rede da tela.
    if (/ERR_ABORTED/.test(error)) return;
    results.networkFailures.push({ url: req.url(), error: error || null });
  });

  try {
    await loginWithTenantSelection(page, {
      targetUrl: `${BASE_URL}/config`,
      username: USERNAME,
      password: PASSWORD,
      tenantId: TENANT,
    });
    record('login com seleção de tenant', true);

    // Aba IA (botão com ícone 🤖 + label IA) — mesma navegação do usuário.
    await page.waitForFunction(
      () => Array.from(document.querySelectorAll('button')).some((b) => String(b.innerText || '').replace(/\s+/g, '') === '🤖IA'),
      null,
      { timeout: 30000 },
    );
    record('tela de configuração acessível', (await page.locator('h1:has-text("Configuração")').count()) > 0, page.url());

    // Clique com retry: entre o botão aparecer e o clique a página pode re-renderizar (carga de
    // providers/config), então uma única tentativa é frágil.
    let clicouAba = false;
    for (let attempt = 0; attempt < 20 && !clicouAba; attempt += 1) {
      // eslint-disable-next-line no-await-in-loop
      clicouAba = await page.evaluate(() => {
        const norm = (text) => String(text || '').replace(/\s+/g, '');
        const target = Array.from(document.querySelectorAll('button'))
          .find((b) => norm(b.textContent) === '🤖IA' || norm(b.innerText) === '🤖IA');
        if (!target) return false;
        target.click();
        return true;
      });
      if (!clicouAba) await page.waitForTimeout(300); // eslint-disable-line no-await-in-loop
    }
    record('aba IA acessível', clicouAba);

    await page.waitForFunction(
      () => document.querySelectorAll('[data-testid^="retest-provider-"]').length > 0,
      null,
      { timeout: 30000 },
    ).catch(() => {});

    const rows = await page.evaluate(readProviderRows);
    results.providerRows = rows;
    const byKey = (key) => rows.find((r) => r.key === key) || null;
    const textOf = (key) => (byKey(key) || {}).badgeText || null;

    // 1. A tela prova a consulta real: ao menos um provedor mostra um valor de saldo.
    const comValor = rows.filter((r) => r.badgeText && /saldo/i.test(r.badgeText) && TEM_VALOR.test(r.badgeText));
    record(
      'ao menos um provedor exibe o saldo real consultado na tela',
      comValor.length > 0,
      comValor.map((r) => `${r.label}: ${r.badgeText}`).join(' | ') || 'nenhum provedor com valor',
    );

    // 2. Provedor que NÃO expõe saldo por API: sem número, com o motivo no tooltip. Esse estado é
    //    estável (depende do provedor não ter endpoint, não da saúde dele no momento).
    const openai = byKey('openai');
    record(
      'provedor sem saldo consultável (OpenAI) não inventa número e explica o motivo',
      Boolean(openai && openai.badgeText && /saldo/i.test(openai.badgeText) && !TEM_VALOR.test(openai.badgeText)),
      openai ? `${openai.badgeText} | title=${String(openai.badgeTitle || '').slice(0, 120)}` : 'linha da OpenAI não encontrada',
    );
    record(
      'tooltip traz a razão real do provedor (não apenas "sem saldo")',
      Boolean(openai && openai.badgeTitle && /session key|api\.usage\.read|admin/i.test(openai.badgeTitle)),
      openai && openai.badgeTitle ? openai.badgeTitle.slice(0, 140) : 'sem tooltip',
    );

    // 3. Regra anti-valor-velho: quem está em estado de erro/inválido NÃO exibe valor de saldo.
    const emErro = rows.filter((r) => r.badgeText && EH_ERRO.test(r.badgeText));
    record(
      'credencial em erro/inválida não exibe saldo (nunca valor velho na tela)',
      emErro.every((r) => !TEM_VALOR.test(r.badgeText)),
      emErro.map((r) => `${r.label}: ${r.badgeText}`).join(' | ') || 'nenhuma credencial em erro',
    );

    // 4. Reteste só existe quando há chave salva.
    const semChave = rows.filter((r) => r.badgeText && /Sem chave/i.test(r.badgeText));
    record(
      'provedor sem chave salva tem o reteste indisponível',
      semChave.length > 0 && semChave.every((r) => r.retestDisabled === true),
      semChave.map((r) => `${r.key}=${r.retestDisabled}`).join(', ') || 'nenhum provedor sem chave',
    );

    const comCredencial = rows.filter((r) => r.retestDisabled === false);
    record(
      'botão Retestar habilitado nos provedores COM chave salva',
      comCredencial.length > 0,
      `${comCredencial.length} provedor(es): ${comCredencial.map((r) => r.key).join(', ')}`,
    );

    await page.screenshot({ path: path.join(EVIDENCE_DIR, `${EVIDENCE_BASENAME}.png`), fullPage: true });

    // ── Reteste da chave salva ───────────────────────────────────────────────────────────────
    // Alvo preferencial: provedor mostrando saldo agora (caminho feliz quando o provedor está no
    // ar). Se nenhum estiver, o primeiro com credencial serve — as asserções abaixo são sobre
    // coerência com o resultado medido, não sobre o provedor estar saudável.
    const target = comCredencial.find((r) => r.badgeText && /saldo/i.test(r.badgeText) && TEM_VALOR.test(r.badgeText))
      || comCredencial[0]
      || null;
    results.retestTarget = target ? target.key : null;

    const callsBefore = results.retestCalls.length;
    if (target) {
      await page.locator(`[data-testid="retest-provider-${target.key}"]`).click();
      // Sinal de DOM (não espera fixa): o botão fica desabilitado durante o reteste e volta a
      // habilitar quando a chamada real ao provedor termina.
      await page.waitForFunction(
        (selector) => {
          const el = document.querySelector(selector);
          return Boolean(el) && el.disabled === false;
        },
        `[data-testid="retest-provider-${target.key}"]`,
        { timeout: 30000 },
      ).catch(() => {});
    }

    const retestCall = results.retestCalls.slice(callsBefore)[0] || null;
    record(
      'Retestar dispara o teste da credencial SALVA (sem redigitar a chave)',
      Boolean(retestCall && retestCall.method === 'POST' && retestCall.status === 200),
      retestCall
        ? `${target ? target.key : '?'}: http=${retestCall.status} valid=${retestCall.valid} balanceStatus=${retestCall.balanceStatus}`
        : 'nenhuma chamada observada',
    );

    const rowsAfter = await page.evaluate(readProviderRows);
    const after = target ? rowsAfter.find((r) => r.key === target.key) || null : null;
    results.retestBadgeAfter = after ? after.badgeText : null;

    const esperaSaldo = Boolean(retestCall && retestCall.valid === true && retestCall.balanceStatus === 'available');
    const coerente = Boolean(after && (esperaSaldo
      ? /saldo/i.test(after.badgeText) && TEM_VALOR.test(after.badgeText)
      : !TEM_VALOR.test(after.badgeText)));
    record(
      'badge reflete o resultado MEDIDO do reteste',
      coerente,
      `${target ? target.key : '?'} -> ${after ? after.badgeText : 'badge não encontrado'} (medido: valid=${retestCall ? retestCall.valid : '?'} balanceStatus=${retestCall ? retestCall.balanceStatus : '?'})`,
    );

    const falhouNoReteste = Boolean(retestCall && retestCall.valid === false);
    record(
      'reteste que falha coloca a credencial em erro na tela (sem saldo velho)',
      !falhouNoReteste || Boolean(after && !/saldo/i.test(after.badgeText) && EH_ERRO.test(after.badgeText)),
      after ? after.badgeText : 'badge não encontrado',
    );

    // `Toast [error]` é o log do PRÓPRIO app quando mostra um toast de erro ao operador — é
    // comportamento esperado (a mensagem aparece na tela), não erro de JavaScript da página.
    results.toastErrors = results.consoleErrors.filter((text) => /Toast \[error\]/.test(text));
    const jsErrors = results.consoleErrors.filter((text) => !/Toast \[error\]/.test(text));
    record('sem erros de JavaScript no console', jsErrors.length === 0, jsErrors.join(' | ').slice(0, 200) || '0');
    record('sem falhas de rede', results.networkFailures.length === 0, String(results.networkFailures.length));
  } catch (error) {
    record('execução da jornada', false, error.message);
  } finally {
    results.finishedAt = new Date().toISOString();
    results.status = results.failed === 0 ? 'PASS' : 'FAIL';
    fs.writeFileSync(
      path.join(EVIDENCE_DIR, `${EVIDENCE_BASENAME}.json`),
      `${JSON.stringify(results, null, 2)}\n`,
      'utf8',
    );
    await browser.close().catch(() => {});
  }

  console.log(`\n${results.status}: ${results.passed} PASS / ${results.failed} FAIL`);
  if (results.status !== 'PASS') process.exitCode = 1;
}

main();
