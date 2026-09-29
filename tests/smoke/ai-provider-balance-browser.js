'use strict';

/**
 * Validação em BROWSER REAL da consulta de saldo por provedor na tela Configuração → IA.
 *
 * Uso: node tests/smoke/ai-provider-balance-browser.js
 *
 * Reutiliza o helper compartilhado `tests/helpers/playwrightAuth.js` (regra do projeto: nunca
 * reimplementar login/seleção de tenant no teste). Percorre o que um usuário faz: abrir a
 * configuração → aba IA → ler o resultado que o último teste real deixou em cada credencial.
 *
 * O que precisa ser verdade na tela:
 *  - provedor com saldo consultável (DeepSeek, Kimi) mostra "Válida · saldo <valor>";
 *  - provedor que não expõe saldo por API (OpenAI) NÃO mostra número, mas diz o motivo
 *    (o comentário do código antigo afirmava que Kimi não tinha endpoint — agora a tela precisa
 *    refletir a medição real, não a suposição);
 *  - provedor sem resultado de saldo (chave inválida) não exibe saldo nenhum.
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

const results = {
  startedAt: new Date().toISOString(),
  baseUrl: BASE_URL,
  journey: 'config-ia-saldo-por-provider',
  steps: [],
  consoleErrors: [],
  networkFailures: [],
  providerBadges: [],
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
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  const page = await context.newPage();

  page.on('console', (msg) => {
    if (msg.type() === 'error') results.consoleErrors.push(msg.text());
  });
  page.on('requestfailed', (req) => {
    const error = req.failure()?.errorText || '';
    // `net::ERR_ABORTED` é a navegação cancelada pelo próprio redirect pós-login — não é falha
    // de rede da tela.
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
    record('login com seleção de tenant', 'PASS');

    // Aba IA (botão com ícone 🤖 + label IA) — mesma navegação do usuário. O botão só existe
    // depois que a tela de configuração monta, então espera explicitamente por ele.
    await page.waitForFunction(
      () => Array.from(document.querySelectorAll('button')).some((b) => String(b.innerText || '').replace(/\s+/g, '') === '🤖IA'),
      null,
      { timeout: 30000 },
    );
    const heading = await page.locator('h1:has-text("Configuração")').count();
    record('tela de configuração acessível', heading > 0 ? 'PASS' : 'FAIL', page.url());

    const clicked = await page.evaluate(() => {
      const target = Array.from(document.querySelectorAll('button'))
        .find((b) => String(b.innerText || '').replace(/\s+/g, '') === '🤖IA');
      if (!target) return false;
      target.click();
      return true;
    });
    record('aba IA acessível', clicked ? 'PASS' : 'FAIL');

    // A lista só mostra o badge depois que o status das credenciais é carregado.
    await page.waitForFunction(
      () => /saldo/i.test(document.body.innerText),
      null,
      { timeout: 30000 },
    ).catch(() => {});

    // Badges de credencial por provedor: texto visível + tooltip (onde fica o motivo). O badge é
    // um <span> dentro de um wrapper próprio, então a linha do provedor é achada subindo até o
    // ancestral que contém "modelo:".
    const badges = await page.evaluate(() => {
      const isBadge = (el) => {
        const cls = String(el.className || '');
        return el.tagName === 'SPAN' && cls.includes('rounded') && cls.includes('text-xs');
      };
      const out = [];
      for (const span of Array.from(document.querySelectorAll('span')).filter(isBadge)) {
        let node = span;
        let row = null;
        while (node && node !== document.body) {
          if (/modelo:/.test(String(node.innerText || ''))) { row = node; break; }
          node = node.parentElement;
        }
        const provider = row ? String(row.innerText || '').split('\n')[0].trim() : '';
        if (!provider) continue;
        out.push({ provider, text: String(span.innerText || '').replace(/\s+/g, ' ').trim(), title: span.getAttribute('title') || null });
      }
      return out;
    });
    results.providerBadges = badges;

    const badgeFor = (needle) => badges.find((b) => b.provider.toLowerCase().includes(needle));
    const kimi = badgeFor('kimi');
    const deepseek = badgeFor('deepseek');
    const openai = badgeFor('openai');
    const qwen = badgeFor('qwen');

    record(
      'provedor com saldo consultável (Kimi) exibe o valor na tela',
      Boolean(kimi && /saldo/i.test(kimi.text) && /US\$|R\$/.test(kimi.text)) ? 'PASS' : 'FAIL',
      kimi ? kimi.text : 'badge do Kimi não encontrado',
    );

    record(
      'provedor com saldo consultável (DeepSeek) exibe o valor na tela',
      Boolean(deepseek && /saldo/i.test(deepseek.text) && /US\$|R\$/.test(deepseek.text)) ? 'PASS' : 'FAIL',
      deepseek ? deepseek.text : 'badge do DeepSeek não encontrado',
    );

    record(
      'provedor que não expõe saldo (OpenAI) não inventa número e explica o motivo',
      Boolean(openai && /saldo/i.test(openai.text) && !/US\$|R\$/.test(openai.text)) ? 'PASS' : 'FAIL',
      openai ? `${openai.text} | title=${String(openai.title || '').slice(0, 120)}` : 'badge da OpenAI não encontrado',
    );

    record(
      'tooltip traz a razão real do provedor (não apenas "sem saldo")',
      Boolean(openai && openai.title && /session key|api\.usage\.read|admin/i.test(openai.title)) ? 'PASS' : 'FAIL',
      openai && openai.title ? openai.title.slice(0, 140) : 'sem tooltip',
    );

    record(
      'credencial inválida (Qwen) não exibe saldo nenhum',
      Boolean(qwen && !/saldo/i.test(qwen.text)) ? 'PASS' : 'FAIL',
      qwen ? qwen.text : 'badge do Qwen não encontrado',
    );

    await page.screenshot({ path: path.join(EVIDENCE_DIR, '2026-09-29-config-ia-saldo-por-provider.png'), fullPage: true });

    record('sem erros de console', results.consoleErrors.length === 0 ? 'PASS' : 'FAIL', String(results.consoleErrors.length));
    record('sem falhas de rede', results.networkFailures.length === 0 ? 'PASS' : 'FAIL', String(results.networkFailures.length));
  } catch (error) {
    record('execução da jornada', 'FAIL', error.message);
  } finally {
    results.finishedAt = new Date().toISOString();
    results.status = results.failed === 0 ? 'PASS' : 'FAIL';
    fs.writeFileSync(
      path.join(EVIDENCE_DIR, '2026-09-29-config-ia-saldo-por-provider.json'),
      `${JSON.stringify(results, null, 2)}\n`,
      'utf8',
    );
    await browser.close().catch(() => {});
  }

  console.log(`\n${results.status}: ${results.passed} PASS / ${results.failed} FAIL`);
  if (results.status !== 'PASS') process.exitCode = 1;
}

main();
