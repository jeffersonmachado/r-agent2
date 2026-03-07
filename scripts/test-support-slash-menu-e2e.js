#!/usr/bin/env node
'use strict';

const { chromium } = require('playwright');

const API = process.env.TEST_API_URL || 'http://localhost:3001';
const WEB = process.env.TEST_WEB_URL || 'http://localhost:5173';

async function req(path, { method = 'GET', token, body } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let payload = {};
  try { payload = text ? JSON.parse(text) : {}; } catch { payload = { raw: text }; }
  return { ok: res.ok, status: res.status, payload };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function onlyDigits(value) {
  return String(value || '').replace(/\D+/g, '');
}

function isE2EQuickReplyTitle(title) {
  return /^Slash E2E \d+$/i.test(String(title || '').trim());
}

async function cleanupE2EQuickReplies(token, report = null) {
  if (!token) return;
  try {
    const listed = await req('/quick-replies?activeOnly=false&search=Slash%20E2E', { token });
    const quickReplies = Array.isArray(listed.payload?.quickReplies) ? listed.payload.quickReplies : [];
    const e2eReplies = quickReplies.filter((qr) => isE2EQuickReplyTitle(qr?.title));
    for (const qr of e2eReplies) {
      if (!qr?.id) continue;
      await req(`/quick-replies/${encodeURIComponent(qr.id)}`, { method: 'DELETE', token });
    }
    if (report) {
      report.checks.push({ item: 'cleanup quick replies e2e', ok: true, count: e2eReplies.length });
    }
  } catch (err) {
    if (report) {
      report.failures.push({ message: 'cleanup_quick_replies_failed', detail: err?.message || String(err) });
    }
  }
}

async function loginFallback() {
  const candidates = [
    ['admin', 'admin123'],
    ['admin', 'Admin123!'],
    ['systemadmin', 'Admin123!'],
    ['systemadmin', 'admin123'],
  ];
  for (const [username, password] of candidates) {
    const r = await req('/auth/login', { method: 'POST', body: { username, password } });
    if (r.ok && r.payload?.token) {
      const me = await req('/auth/me', { token: r.payload.token });
      return { token: r.payload.token, agent: me.payload?.agent || r.payload.agent || null, username };
    }
  }
  throw new Error('login_failed');
}

async function main() {
  const report = {
    startedAt: new Date().toISOString(),
    web: WEB,
    api: API,
    checks: [],
    failures: [],
    browserConsole: [],
    browserErrors: [],
    ok: false,
  };

  let browser;
  let token = null;
  try {
    const auth = await loginFallback();
    token = auth.token;
    const agent = auth.agent || { id: null, username: auth.username, tenantId: 'system' };

    const ts = Date.now();
    let ticketId = null;
    const testCustomerName = `TESTE - Slash E2E ${ts}`;
    const create = await req('/tickets', {
      method: 'POST',
      token,
      body: {
        phoneNumber: `55119${String(ts).slice(-8)}`,
        queue: 'default',
        customerName: testCustomerName,
        initialMessage: `slash e2e ${ts}`,
      },
    });
    if (create.ok && create.payload?.id) ticketId = create.payload.id;
    if (!ticketId) {
      const inbox = await req('/inbox/conversations?limit=50&offset=0', { token });
      const arr = Array.isArray(inbox.payload?.tickets) ? inbox.payload.tickets : [];
      const candidate = arr.find((t) => t && t.status !== 'closed') || arr[0];
      ticketId = candidate?.id || null;
    }
    assert(ticketId, 'ticket_not_found');
    await req(`/inbox/conversations/${encodeURIComponent(ticketId)}/assign`, { method: 'POST', token, body: {} });

    // Valida criação de contato no CRM para o ticket de teste
    const expectedPhoneDigits = onlyDigits(`55119${String(ts).slice(-8)}`);
    let crmTicketData = null;
    const crmDeadline = Date.now() + 15000;
    while (Date.now() < crmDeadline) {
      const crmRes = await req(`/api/tickets/${encodeURIComponent(ticketId)}/crm`, { token });
      if (crmRes.ok && crmRes.payload?.data?.contact) {
        crmTicketData = crmRes.payload.data;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 1200));
    }

    const crmContact = crmTicketData?.contact || null;
    const crmContactName = String(crmContact?.name || '').trim();
    const crmContactPhone = onlyDigits(crmContact?.phone || '');
    const crmContactCreated = !!crmContact?.id;
    report.checks.push({ item: 'crm contato criado', ok: crmContactCreated });
    if (!crmContactCreated) {
      report.failures.push({ message: 'crm_contact_not_created', ticketId });
    } else {
      const crmNameMatches = crmContactName === testCustomerName;
      const crmPhoneMatches = crmContactPhone.endsWith(expectedPhoneDigits);
      report.checks.push({ item: 'crm contato nome', ok: crmNameMatches });
      report.checks.push({ item: 'crm contato telefone', ok: crmPhoneMatches });
      if (!crmNameMatches) {
        report.failures.push({
          message: 'crm_contact_name_mismatch',
          expected: testCustomerName,
          received: crmContactName,
          contactId: crmContact.id,
        });
      }
      if (!crmPhoneMatches) {
        report.failures.push({
          message: 'crm_contact_phone_mismatch',
          expectedEndsWith: expectedPhoneDigits,
          received: crmContactPhone,
          contactId: crmContact.id,
        });
      }
    }

    // Remove resíduos de execuções anteriores para não poluir o menu "/" com itens de teste.
    await cleanupE2EQuickReplies(token, report);

    const qrTitle = `Slash E2E ${ts}`;
    const qrCreate = await req('/quick-replies', {
      method: 'POST',
      token,
      body: { title: qrTitle, message: 'Mensagem E2E {{nome}}', category: 'smoke', tags: ['smoke'], active: true },
    });
    const createdQuickReplyId = qrCreate.payload?.id || null;
    report.checks.push({ item: 'quick reply e2e criada', ok: !!createdQuickReplyId });
    if (!createdQuickReplyId) {
      report.failures.push({ message: 'quick_reply_e2e_create_failed', status: qrCreate.status, payload: qrCreate.payload });
    }

    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    await context.addInitScript(({ authToken, authAgent }) => {
      localStorage.setItem('auth_token', authToken);
      localStorage.setItem('auth_agent', JSON.stringify(authAgent));
      if (authAgent?.tenantId) {
        localStorage.setItem('auth_effective_tenant_id', String(authAgent.tenantId));
      }
    }, { authToken: token, authAgent: agent });

    const page = await context.newPage();
    page.on('console', (msg) => {
      const text = msg.text();
      if (/falhas|delivery-failures|support-slash-menu|erro/i.test(text)) {
        report.browserConsole.push(text.slice(0, 300));
      }
    });
    page.on('pageerror', (err) => {
      report.browserErrors.push(String(err && err.message ? err.message : err).slice(0, 400));
    });
    await page.goto(`${WEB}/support`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForSelector("h1:has-text('Atendimento')", { timeout: 30000 });

    await page.locator('.support-ticket-card').first().click();
    const textarea = page.locator('#send-message-textarea');
    await textarea.waitFor({ timeout: 15000 });

    const openSlash = async (value = '/') => {
      await textarea.click({ timeout: 5000 });
      await textarea.fill(value);
      try {
        await page.waitForSelector('.support-slash-menu', { timeout: 10000 });
      } catch (err) {
        const firstTicket = page.locator('.support-ticket-card').first();
        if (await firstTicket.count()) {
          await firstTicket.click({ timeout: 5000 });
          await textarea.waitFor({ timeout: 10000 });
          await textarea.click({ timeout: 5000 });
          await textarea.fill(value);
          await page.waitForSelector('.support-slash-menu', { timeout: 10000 });
        } else {
          throw err;
        }
      }
    };

    const slashCommandItem = (label, descHint = null) => {
      let locator = page.locator(`.support-slash-menu .support-slash-menu-item[data-slash-kind="command"][data-slash-title="${label}"]`);
      if (descHint) {
        locator = locator.filter({ hasText: descHint });
      }
      return locator.first();
    };

    const slashQuickReplyItem = (title) => {
      return page.locator(`.support-slash-menu .support-slash-menu-item[data-slash-kind="quick-reply"][data-slash-title="${title}"]`).first();
    };

    const clickSlash = async (label, descHint = null) => {
      const item = slashCommandItem(label, descHint);
      await item.evaluate((el) => {
        el.click();
      });
      report.checks.push({ item: label, ok: true });
    };

    await openSlash('/');
    for (const [cmd, desc] of [
      ['/devolver', 'Devolver atendimento ao bot'],
      ['/pausar', 'Pausar atendimento'],
      ['/falhas', 'falhas'],
      ['/fechar', 'Fechar ticket atual'],
      ['/resposta-rapida', 'respostas rápidas'],
      ['/emoji', 'seletor de emojis'],
      ['/anexo', 'Selecionar mídia'],
      ['/limpar', 'Limpar mensagem'],
    ]) {
      await slashCommandItem(cmd, desc).waitFor({ timeout: 8000 });
      report.checks.push({ item: `${cmd} visivel`, ok: true });
    }

    if (process.env.SKIP_FALHAS !== '1') {
      const failuresRequestPromise = page.waitForRequest((req) => {
        const url = req.url();
        return url.includes('/delivery-failures') && req.method() === 'GET';
      }, { timeout: 15000 }).catch(() => null);
      await clickSlash('/falhas', 'falhas');
      const failuresRequest = await failuresRequestPromise;
      const falhasRequested = !!failuresRequest;
      report.checks.push({ item: '/falhas requisita delivery-failures', ok: falhasRequested });
      if (!falhasRequested) {
        report.failures.push({ message: 'slash_falhas_no_delivery_request' });
      }
      const falhasUiOpened = await page.waitForFunction(() => {
        const title = document.querySelector('#delivery-failures-title');
        if (title && /falhas de entrega/i.test(title.textContent || '')) return true;
        return window.location.pathname.includes('/failed-messages');
      }, { timeout: 4000 }).then(() => true).catch(() => false);
      report.checks.push({ item: '/falhas abre UI', ok: falhasUiOpened });
      if (falhasUiOpened) {
        const closeBtn = page.locator('.support-modal-content button:has-text("Fechar")').first();
        if (await closeBtn.count()) {
          await closeBtn.click({ timeout: 5000 }).catch(() => {});
        } else {
          await page.locator('.support-modal-overlay').first().click({ position: { x: 5, y: 5 } }).catch(() => {});
        }
        await page.locator('.support-modal-overlay').first().waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
      }
    }

    await openSlash('/');
    await clickSlash('/emoji', 'seletor de emojis');
    await page.waitForSelector('.support-emoji-picker', { timeout: 10000 });
    report.checks.push({ item: '/emoji abre picker', ok: true });

    await openSlash('/');
    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser', { timeout: 10000 }),
      clickSlash('/anexo', 'Selecionar mídia'),
    ]);
    report.checks.push({ item: '/anexo abre filechooser', ok: !!chooser });

    await openSlash('/texto para limpar');
    await clickSlash('/limpar', 'Limpar mensagem');
    assert((await textarea.inputValue()) === '', 'slash_limpar_failed');
    report.checks.push({ item: '/limpar limpa campo', ok: true });

    await openSlash('/');
    await clickSlash('/resposta-rapida', 'respostas rápidas');
    await openSlash(`/${qrTitle}`);
    const qrItem = slashQuickReplyItem(qrTitle);
    const qrExists = await qrItem.count();
    if (qrExists) {
      await qrItem.evaluate((el) => { el.click(); });
      const inserted = await page.waitForFunction(() => {
        const el = document.querySelector('#send-message-textarea');
        const val = String(el && 'value' in el ? el.value : '');
        return val.includes('Mensagem E2E');
      }, { timeout: 5000 }).then(() => true).catch(() => false);
      report.checks.push({ item: 'quick reply via /', ok: inserted });
      if (!inserted) report.failures.push({ message: 'quick_reply_not_inserted' });
    } else {
      report.checks.push({ item: 'quick reply via /', ok: false });
      report.failures.push({ message: 'quick_reply_not_found_in_menu' });
    }

    const safeRun = async (label, descHint, fn) => {
      try {
        await fn();
      } catch (error) {
        report.checks.push({ item: label, ok: false });
        report.failures.push({ message: `${label}_failed`, stack: error?.message || String(error) });
      }
    };

    await safeRun('/devolver', 'Devolver atendimento ao bot', async () => {
      await openSlash('/');
      await clickSlash('/devolver', 'Devolver atendimento ao bot');
      await page.waitForTimeout(1200);
    });
    await safeRun('/assumir', 'modo humano', async () => {
      await openSlash('/');
      await clickSlash('/assumir', 'modo humano');
      await page.waitForTimeout(1200);
    });
    await safeRun('/pausar', 'Pausar atendimento', async () => {
      await openSlash('/');
      await clickSlash('/pausar', 'Pausar atendimento');
      await page.waitForTimeout(1200);
    });
    await safeRun('/retomar', 'Retomar atendimento humano', async () => {
      await openSlash('/');
      await clickSlash('/retomar', 'Retomar atendimento humano');
    });
    await safeRun('/fechar', 'Fechar ticket atual', async () => {
      await openSlash('/');
      await clickSlash('/fechar', 'Fechar ticket atual');
      await page.waitForFunction(() => {
        const byHeading = Array.from(document.querySelectorAll('h1,h2,h3,[role="dialog"]'))
          .some((el) => /fechar ticket|encerrar ticket/i.test(el.textContent || ''));
        return byHeading;
      }, { timeout: 15000 });
      report.checks.push({ item: '/fechar abre modal', ok: true });
    });

    report.ok = report.failures.length === 0 && report.checks.every((c) => c && c.ok === true);
  } catch (error) {
    report.failures.push({ message: error?.message || String(error), stack: error?.stack || null });
    report.ok = false;
  } finally {
    await cleanupE2EQuickReplies(token, report);
    if (browser) await browser.close().catch(() => {});
  }

  console.log(JSON.stringify(report, null, 2));
  process.exit(report.ok ? 0 : 1);
}

main();
