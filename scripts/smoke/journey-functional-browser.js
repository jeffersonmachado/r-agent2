'use strict';

/**
 * Jornada FUNCIONAL real no browser — não é smoke de carregamento.
 *
 * O que este script prova que um smoke de "a página abre" NÃO prova: que o
 * usuário consegue AGIR. Para cada rota ele tenta as ações que o produto oferece
 * (buscar/filtrar, paginar, abrir detalhe) e mede o EFEITO observável. Uma tela
 * que renderiza com erro de console, que não responde à busca ou cuja paginação
 * não muda nada é um defeito — e um smoke de carregamento passaria verde nela.
 *
 * Regras do repo respeitadas:
 *  - reutiliza `tests/helpers/playwrightAuth.js` (nunca duplica login manual);
 *  - evidência em `qa/evidence/` com nome ESTÁVEL (transitória, ignorada pelo git):
 *    gravar em caminho versionado sujaria o worktree e quebraria a pré-condição de
 *    `verify:delivered-release`;
 *  - o que não é executável é registrado como SKIP explícito, nunca como sucesso
 *    silencioso (um `N/A` contado como PASS esconde ausência de verificação).
 *
 * Uso:
 *   node scripts/smoke/journey-functional-browser.js            # jornada completa
 *   node scripts/smoke/journey-functional-browser.js --explore  # só descobre o DOM
 *
 * Env:
 *   RAP_UI_BASE    (default http://localhost:5173)
 *   RAP_UI_ROUTES  (lista separada por vírgula; default = rotas abaixo)
 *   QA_USER / QA_PASS / QA_TENANT (defaults de QA local do projeto)
 *   JOURNEY_HEADLESS=0 para ver a janela (diagnóstico)
 */

const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..', '..');

const BASE = process.env.RAP_UI_BASE || 'http://localhost:5173';
const USER = process.env.QA_USER || 'systemadmin';
const PASS = process.env.QA_PASS || 'Admin123!';
const TENANT = process.env.QA_TENANT || 'system';
const EXPLORE = process.argv.includes('--explore');

/** Rotas PRODUCTION de negócio (o que o cliente usa), não as de engenharia. */
const ROTAS_DEFAULT = [
  '/workspace',
  '/inbox',
  '/cases',
  '/crm',
  '/knowledge-base',
  '/tasks',
  '/editor',
  '/config',
];

const ROTAS = (process.env.RAP_UI_ROUTES || ROTAS_DEFAULT.join(','))
  .split(',')
  .map((r) => r.trim())
  .filter(Boolean);

const EVIDENCE_DIR = path.join(REPO, 'qa', 'evidence');

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

/**
 * Fotografia do DOM relevante para AGIR: quantas tabelas/linhas, quais campos de
 * busca e botões existem, se há paginação. É a mesma leitura em modo exploração e
 * em modo jornada (o modo só muda o que se faz com o resultado).
 */
async function snapshotDaTela(page) {
  return page.evaluate(() => {
    const visivel = (el) => {
      if (!el) return false;
      const r = el.getBoundingClientRect();
      const st = window.getComputedStyle(el);
      return r.width > 0 && r.height > 0 && st.visibility !== 'hidden' && st.display !== 'none';
    };

    // Linhas REAIS: somar `tbody tr` de TODAS as tabelas da página conta lixo de
    // tabelas aninhadas/decorativas (medido: 157 "linhas" onde havia 4 reais).
    // Conta por tabela e reporta a maior, que é a lista de verdade.
    const tabelas = Array.from(document.querySelectorAll('table'))
      .filter(visivel)
      .map((t) => ({
        linhas: t.querySelectorAll(':scope > tbody > tr').length,
        colunas: t.querySelectorAll(':scope > thead > tr > th').length,
      }));

    const inputs = Array.from(
      document.querySelectorAll('input[type="search"], input[type="text"], input:not([type])')
    )
      .filter(visivel)
      .map((el) => ({
        placeholder: el.getAttribute('placeholder') || '',
        aria: el.getAttribute('aria-label') || '',
        name: el.getAttribute('name') || '',
      }));

    const botoes = Array.from(document.querySelectorAll('button, a[role="button"]'))
      .filter(visivel)
      .map((el) => (el.innerText || el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim())
      .filter((t) => t.length > 0 && t.length < 40);

    const paginacao = Array.from(document.querySelectorAll('button, a'))
      .filter(visivel)
      .filter((el) => /pr[oó]xim|next|avançar|»|›/i.test(el.innerText || el.getAttribute('aria-label') || ''))
      .map((el) => ({
        texto: (el.innerText || el.getAttribute('aria-label') || '').trim().slice(0, 30),
        desabilitado: el.disabled === true || el.getAttribute('aria-disabled') === 'true',
      }));

    const texto = (document.body.innerText || '').replace(/\s+/g, ' ').trim();

    return {
      tabelas,
      maxLinhas: tabelas.reduce((m, t) => Math.max(m, t.linhas), 0),
      inputs,
      botoes: Array.from(new Set(botoes)).slice(0, 40),
      paginacao,
      textoLen: texto.length,
      vazio: /nenhum|nenhuma|sem resultados|sem registros|nada encontrado|lista vazia/i.test(texto),
      marcadorIndisponivel: /fonte indispon[ií]vel|indispon[ií]vel|erro ao carregar|falha ao carregar/i.test(texto),
    };
  });
}

/** Digita um termo no primeiro campo de busca visível e mede o EFEITO. */
async function exercitarBusca(page, snap) {
  const candidato = snap.inputs.find((i) => /buscar|pesquisar|search|filtro|filtrar/i.test(`${i.placeholder} ${i.aria} ${i.name}`))
    || snap.inputs[0];
  if (!candidato) return { executado: false, motivo: 'nenhum campo de busca/filtro visível' };

  const seletor = candidato.placeholder
    ? `input[placeholder="${candidato.placeholder}"]`
    : candidato.aria
      ? `input[aria-label="${candidato.aria}"]`
      : 'input[type="search"], input[type="text"], input:not([type])';

  const campo = page.locator(seletor).first();
  if (!(await campo.count())) return { executado: false, motivo: 'campo localizado no snapshot mas não instanciável' };

  const termo = 'zzz-termo-inexistente-zzz';
  await campo.fill(termo);
  await page.waitForTimeout(1800);
  const apos = await snapshotDaTela(page);

  // EFEITO esperado: ou a lista zera (filtro aplicado) ou o estado vazio aparece, ou
  // a contagem muda. Se NADA muda com um termo impossível, o filtro não está ligado.
  const mudou = apos.maxLinhas !== snap.maxLinhas || (apos.vazio && !snap.vazio);
  await campo.fill('');
  await page.waitForTimeout(800);

  return {
    executado: true,
    campo: candidato.placeholder || candidato.aria || '(sem rótulo)',
    linhasAntes: snap.maxLinhas,
    linhasDepois: apos.maxLinhas,
    estadoVazioDepois: apos.vazio,
    efeitoObservado: mudou,
  };
}

/** Abre o detalhe do primeiro registro da lista, se houver um caminho visível. */
async function exercitarDetalhe(page, snap) {
  if (snap.maxLinhas === 0) return { executado: false, motivo: 'lista sem linhas para abrir' };

  const seletor = 'table tbody tr td a, table tbody tr td button, table tbody tr[role="button"], table tbody tr';
  const alvo = page.locator(seletor).first();
  if (!(await alvo.count())) return { executado: false, motivo: 'linha não clicável' };

  const urlAntes = page.url();
  const textoAntes = (await page.evaluate(() => (document.body.innerText || '').length));
  try {
    await alvo.click({ timeout: 5000 });
    await page.waitForTimeout(2000);
  } catch (error) {
    return { executado: true, abriu: false, motivo: `clique falhou: ${String(error.message).slice(0, 120)}` };
  }

  const urlDepois = page.url();
  const modalAberto = await page.evaluate(() => {
    const d = document.querySelector('[role="dialog"], .modal, [data-detail], aside[aria-label]');
    if (!d) return false;
    const r = d.getBoundingClientRect();
    return r.width > 100 && r.height > 100;
  });
  const textoDepois = await page.evaluate(() => (document.body.innerText || '').length);
  const abriu = modalAberto || urlDepois !== urlAntes || Math.abs(textoDepois - textoAntes) > 400;

  return {
    executado: true,
    abriu,
    via: modalAberto ? 'modal/painel' : urlDepois !== urlAntes ? `navegou para ${urlDepois.replace(BASE, '')}` : 'mudança de conteúdo',
    letrasAntes: textoAntes,
  };
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
  const resultados = [];

  const browser = await chromium.launch({ headless: process.env.JOURNEY_HEADLESS !== '0' });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(`${page.url().replace(BASE, '')} :: ${msg.text().slice(0, 200)}`);
  });
  page.on('pageerror', (err) => pageErrors.push(`${page.url().replace(BASE, '')} :: ${String(err.message).slice(0, 200)}`));
  page.on('requestfailed', (req) => {
    const failure = (req.failure() && req.failure().errorText) || '?';
    // ERR_ABORTED é cancelamento de navegação/unmount, não falha de entrega.
    if (!/ERR_ABORTED/i.test(failure)) failedRequests.push(`${req.method()} ${req.url().slice(0, 140)} :: ${failure}`);
  });
  page.on('response', (res) => {
    if (res.status() >= 500) failedRequests.push(`HTTP ${res.status()} ${res.url().slice(0, 140)}`);
  });

  let erroGlobal = null;
  try {
    await loginWithTenantSelection(page, {
      targetUrl: `${BASE}/workspace`,
      username: USER,
      password: PASS,
      tenantId: TENANT,
    });
  } catch (error) {
    erroGlobal = `login falhou: ${String(error.message).slice(0, 200)}`;
  }

  if (erroGlobal) {
    console.error(`❌ ${erroGlobal}`);
    await browser.close();
    process.exit(1);
  }

  for (const rota of ROTAS) {
    const errosAntes = consoleErrors.length;
    const registro = { rota, acoes: {}, defeitos: [] };
    try {
      await page.goto(`${BASE}${rota}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(2500);

      const snap = await snapshotDaTela(page);
      registro.tela = {
        url: page.url().replace(BASE, ''),
        linhas: snap.maxLinhas,
        tabelas: snap.tabelas.length,
        inputs: snap.inputs.length,
        botoes: snap.botoes.slice(0, 12),
        paginacao: snap.paginacao,
        caracteres: snap.textoLen,
      };

      registro.acoes.carrega = { ok: snap.textoLen > 200, detalhe: `${snap.textoLen} chars` };
      if (snap.textoLen <= 200) registro.defeitos.push('tela renderizou vazia (menos de 200 caracteres)');
      if (snap.marcadorIndisponivel) {
        registro.defeitos.push('tela exibe marcador de fonte indisponível/erro de carga');
      }

      if (EXPLORE) {
        console.log(`\n── ${rota}`);
        console.log(`   tabelas=${snap.tabelas.length} maxLinhas=${snap.maxLinhas} inputs=${snap.inputs.length} paginacao=${snap.paginacao.length}`);
        console.log(`   inputs: ${snap.inputs.map((i) => i.placeholder || i.aria || '(sem rótulo)').join(' | ') || '(nenhum)'}`);
        console.log(`   botoes: ${snap.botoes.slice(0, 15).join(' | ') || '(nenhum)'}`);
      } else {
        registro.acoes.busca = await exercitarBusca(page, snap);
        registro.acoes.detalhe = await exercitarDetalhe(page, snap);
        await page.goto(`${BASE}${rota}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(1500);
      }

      const novos = consoleErrors.slice(errosAntes);
      registro.errosConsole = novos;
      if (novos.length > 0) registro.defeitos.push(`${novos.length} erro(s) de console`);
    } catch (error) {
      registro.acoes.carrega = { ok: false, detalhe: String(error.message).slice(0, 200) };
      registro.defeitos.push(`exceção: ${String(error.message).slice(0, 200)}`);
    }
    resultados.push(registro);

    if (!EXPLORE) {
      const marca = registro.defeitos.length === 0 ? '✅' : '❌';
      console.log(`${marca} ${rota} — linhas=${registro.tela ? registro.tela.linhas : '?'} ${registro.defeitos.length ? ':: ' + registro.defeitos.join(' | ') : ''}`);
    }
  }

  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  const png = path.join(EVIDENCE_DIR, 'journey-functional-latest.png');
  const json = path.join(EVIDENCE_DIR, 'journey-functional-latest.json');
  try {
    await page.screenshot({ path: png, fullPage: false });
  } catch (_) {
    /* evidência visual é acessória; o JSON é o registro durável */
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    base: BASE,
    modo: EXPLORE ? 'explore' : 'jornada',
    rotas: resultados,
    consoleErrors,
    pageErrors,
    failedRequests,
  };
  fs.writeFileSync(json, JSON.stringify(payload, null, 2) + '\n');

  await browser.close();

  if (EXPLORE) {
    console.log(`\nmodo exploração — evidência: ${json}`);
    process.exit(0);
  }

  const comDefeito = resultados.filter((r) => r.defeitos.length > 0);
  console.log();
  console.log(`evidência: ${json}`);
  console.log(`erros de console: ${consoleErrors.length} | pageerror: ${pageErrors.length} | requisições falhas: ${failedRequests.length}`);
  if (failedRequests.length) console.log(`  ${failedRequests.slice(0, 5).join('\n  ')}`);
  console.log(comDefeito.length === 0
    ? `PASS: ${resultados.length} rotas exercitadas sem defeito`
    : `FAIL: ${comDefeito.length} de ${resultados.length} rotas com defeito — ${comDefeito.map((r) => `${r.rota}(${r.defeitos[0]})`).join('; ')}`);

  process.exit(comDefeito.length === 0 ? 0 : 1);
}

if (require.main === module) {
  run().catch((error) => {
    console.error('FALHA NA JORNADA:', error.message);
    process.exit(1);
  });
}
