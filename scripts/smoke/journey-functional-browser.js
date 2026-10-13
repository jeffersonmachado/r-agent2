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

    // MEDIÇÃO CORRIGIDA (2026-10-13): NENHUMA das rotas de negócio do produto usa
    // `<table>` — as listas são divs/cards. Medir só tabela dizia "0 linhas" em
    // todas as telas, o que é indistinguível de "lista vazia" e tornaria a jornada
    // cega. Conta os contêineres de lista mais comuns e reporta o MAIOR, que é a
    // lista principal; e só conta o que tem TEXTO (senão containers vazios de
    // layout inflam o número).
    const SELETORES_LISTA = ['[role="row"]', 'li', 'article', '[data-testid*="item"]', '[data-testid*="row"]', '.card'];
    const itensPorSeletor = {};
    for (const sel of SELETORES_LISTA) {
      itensPorSeletor[sel] = Array.from(document.querySelectorAll(sel))
        .filter(visivel)
        .filter((el) => ((el.innerText || '').trim().length > 1)).length;
    }
    const itensLista = Object.values(itensPorSeletor).reduce((m, n) => Math.max(m, n), 0);
    const melhorSeletor = Object.entries(itensPorSeletor).sort((a, b) => b[1] - a[1])[0] || ['-', 0];

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

    // MEDIÇÃO DE EFEITO (corrigida em 2026-10-13): contar `li`/`card`/`role=row`
    // como "itens da lista" mede o MENU lateral em vez da lista da tela — o
    // `/crm` filtrou de verdade (1922 -> 1170 chars) e a jornada acusou "busca não
    // filtra" porque `li` seguiu 9 (são os `li` do menu). Falso positivo de
    // detector é tão perigoso quanto falso negativo: esconde o defeito real no
    // ruído. O efeito passa a ser medido por mudança de TEXTO VISÍVEL e de
    // tamanho, que é o que o usuário percebe.
    const visivelTxt = (el) => {
      const r = el.getBoundingClientRect();
      const st = window.getComputedStyle(el);
      return r.width > 4 && r.height > 4 && st.visibility !== 'hidden' && st.display !== 'none';
    };
    const textos = new Set();
    for (const el of document.querySelectorAll('button, a, h1, h2, h3, h4, label, [role="menuitem"], [role="tab"], th, td, li, p, span')) {
      if (!visivelTxt(el)) continue;
      const t = (el.innerText || '').replace(/\s+/g, ' ').trim();
      if (t.length > 1 && t.length < 60) textos.add(t);
    }

    return {
      tabelas,
      itensPorSeletor,
      itensLista,
      melhorSeletor,
      maxLinhas: Math.max(
        tabelas.reduce((m, t) => Math.max(m, t.linhas), 0),
        itensLista
      ),
      textos: [...textos],
      camposVisiveis: Array.from(document.querySelectorAll('input, textarea, select')).filter(visivelTxt).length,
      menuDeOpcoesVisivel: Array.from(document.querySelectorAll('[role="menu"], [role="listbox"], [aria-expanded="true"]')).some(visivelTxt),
      inputs,
      botoes: Array.from(new Set(botoes)).slice(0, 40),
      paginacao,
      textoLen: texto.length,
      vazio: /nenhum|nenhuma|sem resultados|sem registros|nada encontrado|lista vazia/i.test(texto),
      marcadorIndisponivel: /fonte indispon[ií]vel|indispon[ií]vel|erro ao carregar|falha ao carregar/i.test(texto),
      chips: Array.from(document.querySelectorAll('button, [role="tab"], [role="radio"]'))
        .filter(visivel)
        .map((el) => (el.innerText || '').replace(/\s+/g, ' ').trim())
        .filter((t) => t.length > 1 && t.length <= 24)
        .slice(0, 25),
    };
  });
}

/**
 * Efeito OBSERVÁVEL de uma ação, medido por mudança de tela — a mesma leitura que
 * o usuário faz. É o critério único de "a ação funcionou", válido para busca,
 * filtro e abertura de formulário (modal, menu, painel inline ou navegação).
 */
function compararTelas(antes, depois) {
  const setAntes = new Set(antes.textos || []);
  const novos = (depois.textos || []).filter((t) => !setAntes.has(t));
  const deltaChars = depois.textoLen - antes.textoLen;
  const deltaCampos = depois.camposVisiveis - antes.camposVisiveis;
  const proporcional = antes.textoLen > 0 ? Math.abs(deltaChars) / antes.textoLen : 0;
  return {
    mudou: novos.length > 0 || proporcional > 0.08 || deltaCampos !== 0 || !!depois.menuDeOpcoesVisivel,
    novosTextos: novos.slice(0, 8),
    deltaChars,
    deltaCampos,
  };
}

/** Digita um termo no primeiro campo de busca visível e mede o EFEITO. */
async function exercitarBusca(page, snap) {
  // A busca do MENU aparece em TODAS as rotas e não filtra conteúdo: usá-la faria
  // a jornada "provar" um filtro que não é o da tela. Excluída explicitamente.
  const doMenu = (i) => /buscar no menu/i.test(`${i.placeholder} ${i.aria}`);
  // Só vale como BUSCA o campo que se ANUNCIA como busca/filtro. Sem este
  // critério o fallback pegava qualquer input da tela (medido: "Session ID (ex:
  // sess-123)" no editor, que é carga de sessão) e a jornada acusava "busca não
  // filtra" num campo que nunca foi filtro — falso positivo que esconde defeito
  // real no meio do ruído.
  const ehBusca = (i) => /buscar|pesquisar|search|filtrar|filtro/i.test(`${i.placeholder} ${i.aria} ${i.name}`);
  const candidato = snap.inputs.filter((i) => !doMenu(i)).find(ehBusca);
  if (!candidato) return { executado: false, motivo: 'a tela não oferece campo de busca/filtro de conteúdo' };

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

  // EFEITO esperado: a tela muda — a lista filtra (reduz), ou passa a mostrar o
  // estado vazio. Se NADA muda com um termo impossível, o filtro não está ligado.
  const efeito = compararTelas(snap, apos);
  const mudou = efeito.mudou || (apos.vazio && !snap.vazio);
  await campo.fill('');
  await page.waitForTimeout(800);

  return {
    executado: true,
    campo: candidato.placeholder || candidato.aria || '(sem rótulo)',
    linhasAntes: snap.maxLinhas,
    linhasDepois: apos.maxLinhas,
    charsAntes: snap.textoLen,
    charsDepois: apos.textoLen,
    estadoVazioDepois: apos.vazio,
    efeitoObservado: mudou,
  };
}

/**
 * Clica um chip de filtro da tela (ex.: "Ativos", "Em risco") e mede o efeito.
 *
 * Só considera chips de FILTRO de verdade: os grupos de menu da lateral também
 * são `<button>` e clicá-los só abre/fecha a navegação — o que faria a jornada
 * "provar" uma filtragem que nunca ocorreu.
 */
async function exercitarFiltroChip(page, snap) {
  // Grupos de menu da lateral e rótulos de usuário também são `<button>`: clicá-los
  // só abre/fecha navegação e a jornada "provaria" uma filtragem que não ocorreu.
  // A âncora `^` era insuficiente: "SA 99+ Super Admin ▼" começa com "SA " e
  // escapava de `^super admin` — o filtro acabava tentando clicar no menu de
  // usuário. Agora casa em QUALQUER posição.
  const doMenu = /recolher menu|atalhos|super admin|\bsa \d|atendimento|canais|modelagem|execu|assistentes|monitoramento|an[aá]lises|administra|governan|suporte da|relacionamento|construtor|espa[çc]o de trabalho|^crm$|^conhecimento$|^dev$|^admin$|^ops$/i;
  const candidato = snap.chips.find((t) => !doMenu.test(t) && !/^[<>‹›←→]/.test(t) && t.length <= 20);
  if (!candidato) return { executado: false, motivo: 'nenhum chip de filtro identificável' };

  const alvo = page.getByRole('button', { name: candidato }).first();
  if (!(await alvo.count())) return { executado: false, motivo: `chip "${candidato}" não instanciável` };

  try {
    await alvo.click({ timeout: 5000 });
    await page.waitForTimeout(1800);
  } catch (error) {
    return { executado: true, chip: candidato, aplicou: false, motivo: String(error.message).slice(0, 120) };
  }

  const apos = await snapshotDaTela(page);
  const efeito = compararTelas(snap, apos);
  return {
    executado: true,
    chip: candidato,
    itensAntes: snap.maxLinhas,
    itensDepois: apos.maxLinhas,
    deltaChars: efeito.deltaChars,
    novosTextos: efeito.novosTextos.slice(0, 4),
    aplicou: efeito.mudou,
  };
}

/**
 * Abre o formulário de criação e FECHA sem submeter.
 *
 * Por que abrir e não criar: criar deixaria lixo no tenant de QA e o próximo run
 * mediria um estado diferente do que mediu agora — a jornada precisa ser
 * repetível. O que se prova aqui é o que costuma quebrar: o modal abre, tem
 * campos utilizáveis e fecha sem erro de console.
 */
async function exercitarModalDeCriacao(page, snap) {
  const doMenu = /^(recolher menu|atalhos|atendimento|canais|modelagem|execu|assistentes|monitoramento|an|lises|administra|governan|suporte da|super admin|atualizar|recarregar|salvar|descartar|reiniciar)/i;
  const candidato = snap.botoes.find((t) => /^(novo|nova|criar|adicionar|\+)/i.test(t) && !doMenu.test(t));
  if (!candidato) return { executado: false, motivo: 'nenhum botão de criação visível' };

  const alvo = page.getByRole('button', { name: candidato, exact: false }).first();
  if (!(await alvo.count())) return { executado: false, motivo: `botão "${candidato}" não instanciável` };

  const urlAntesModal = page.url();
  let erroClique = null;
  try {
    await alvo.click({ timeout: 5000 });
  } catch (error) {
    // Engolir o erro do clique cegava o diagnóstico: a ação era reportada como
    // "não produz efeito" tanto quando o produto não reagia QUANTO quando o
    // próprio clique falhava (elemento coberto, fora da viewport, detached).
    erroClique = String(error.message).slice(0, 160);
  }
  await page.waitForTimeout(2500);

  // "Abrir" não é só modal: um botão de criação pode abrir um MENU de opções,
  // revelar um formulário INLINE ou navegar para a tela de criação. Exigir
  // `[role=dialog]/.modal/form` com tamanho > 100px acusava defeito em botão que
  // FUNCIONAVA — medido no browser em 2026-10-13: "Criar entidade rápida"
  // (/workspace) revelou formulário inline com "Cliente Workspace 174706 /
  // Telefone ...," "Criar tarefa" (/tasks) abriu modal com "Informe um título" e
  // "Novo" (/editor) abriu "Criar Novo Fluxo / Selecione um modelo" com a lista
  // de modelos. O critério passa a ser o efeito percebido na tela.
  const depois = await snapshotDaTela(page);
  const efeito = compararTelas(snap, depois);
  const navegou = page.url() !== urlAntesModal;
  const abriu = efeito.mudou || navegou;

  // Fecha sem submeter: Escape primeiro; se resistir, botão de cancelar/fechar.
  await page.keyboard.press('Escape');
  await page.waitForTimeout(900);
  const fechou = await page.evaluate(() => {
    const visivel = (el) => {
      if (!el) return false;
      const r = el.getBoundingClientRect();
      return r.width > 100 && r.height > 100;
    };
    return !Array.from(document.querySelectorAll('[role="dialog"], .modal')).some(visivel);
  });

  return {
    executado: true,
    botao: candidato,
    abriu,
    erroClique,
    via: erroClique
      ? `clique falhou: ${erroClique}`
      : navegou
        ? `navegou para ${page.url().replace(BASE, '')}`
        : depois.menuDeOpcoesVisivel
          ? 'menu/dropdown'
          : efeito.deltaCampos !== 0
            ? `formulário inline (${efeito.deltaCampos >= 0 ? '+' : ''}${efeito.deltaCampos} campos)`
            : `conteúdo mudou (${efeito.deltaChars} chars)`,
    novosTextos: efeito.novosTextos.slice(0, 5),
    fechouSemSubmeter: fechou,
  };
}

/** Abre o detalhe do primeiro registro da lista, se houver um caminho visível. */
async function exercitarDetalhe(page, snap) {
  if (snap.maxLinhas === 0) return { executado: false, motivo: 'lista sem itens para abrir' };

  const seletor = 'table tbody tr td a, table tbody tr td button, table tbody tr[role="button"], table tbody tr, [role="row"][tabindex], li[role="button"] a, [data-testid*="item"] a, [data-testid*="item"] button, .card a, .card button, li a, li button';
  const alvo = page.locator(seletor).first();
  if (!(await alvo.count())) return { executado: false, motivo: 'item não clicável' };

  const urlAntes = page.url();
  const textoAntes = (await page.evaluate(() => (document.body.innerText || '').length));
  try {
    await alvo.click({ timeout: 5000 });
    await page.waitForTimeout(2000);
  } catch (error) {
    return { executado: true, abriu: false, motivo: `clique falhou: ${String(error.message).slice(0, 120)}` };
  }

  const depois = await snapshotDaTela(page);
  const efeito = compararTelas(snap, depois);
  const urlDepois = page.url();
  const modalAberto = await page.evaluate(() => {
    const d = document.querySelector('[role="dialog"], .modal, [data-detail], aside[aria-label]');
    if (!d) return false;
    const r = d.getBoundingClientRect();
    return r.width > 100 && r.height > 100;
  });
  const abriu = modalAberto || urlDepois !== urlAntes || efeito.mudou;

  return {
    executado: true,
    abriu,
    via: modalAberto ? 'modal/painel' : urlDepois !== urlAntes ? `navegou para ${urlDepois.replace(BASE, '')}` : `mudança de conteúdo (${efeito.deltaChars} chars)`,
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
        viaLista: snap.melhorSeletor[0],
        tabelas: snap.tabelas.length,
        inputs: snap.inputs.length,
        botoes: snap.botoes.slice(0, 12),
        chips: snap.chips.slice(0, 10),
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
        console.log(`   itens=${snap.maxLinhas} (via ${snap.melhorSeletor[0]}) inputs=${snap.inputs.length} chips=${snap.chips.length} paginacao=${snap.paginacao.length} chars=${snap.textoLen}`);
        console.log(`   inputs: ${snap.inputs.map((i) => i.placeholder || i.aria || '(sem rótulo)').join(' | ') || '(nenhum)'}`);
        console.log(`   chips: ${snap.chips.slice(0, 12).join(' | ') || '(nenhum)'}`);
      } else {
        // Cada ação roda sobre a tela RECÉM-carregada; recarrega antes da próxima
        // para que o efeito medido seja da ação e não do estado deixado pela anterior.
        registro.acoes.busca = await exercitarBusca(page, snap);
        await page.goto(`${BASE}${rota}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(1500);
        const snap2 = await snapshotDaTela(page);
        registro.acoes.filtroChip = await exercitarFiltroChip(page, snap2);
        await page.goto(`${BASE}${rota}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(1500);
        const snap3 = await snapshotDaTela(page);
        registro.acoes.modalCriacao = await exercitarModalDeCriacao(page, snap3);
        await page.goto(`${BASE}${rota}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(1500);
        const snap4 = await snapshotDaTela(page);
        registro.acoes.detalhe = await exercitarDetalhe(page, snap4);

        // Veredito das AÇÕES (não do carregamento): a tela oferecia a ação e ela
        // não produziu efeito? Isso é defeito. Ação inexistente é SKIP registrado,
        // nunca sucesso silencioso.
        const b = registro.acoes.busca;
        if (b.executado && !b.efeitoObservado) registro.defeitos.push(`busca "${b.campo}" não filtra (${b.linhasAntes} -> ${b.linhasDepois} itens)`);
        const f = registro.acoes.filtroChip;
        if (f.executado && !f.aplicou) registro.defeitos.push(`filtro "${f.chip}" não altera a lista (${f.itensAntes} -> ${f.itensDepois})`);
        const m = registro.acoes.modalCriacao;
        if (m.executado && !m.abriu) registro.defeitos.push(`botão "${m.botao}" não produz efeito (nem modal, nem menu, nem navegação)`);
        if (m.executado && m.abriu && m.fechouSemSubmeter === false) registro.defeitos.push(`formulário de "${m.botao}" não fecha sem submeter`);
        const d = registro.acoes.detalhe;
        if (d.executado && d.abriu === false) registro.defeitos.push('item da lista não abre detalhe');
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
