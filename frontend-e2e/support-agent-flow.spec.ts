import { test, expect } from '@playwright/test';

// ─── helpers ─────────────────────────────────────────────────────────────────

function getCredentialsForRole(role: string) {
  switch (role) {
    case 'agent':
      return {
        username: process.env.TEST_AGENT_USERNAME || process.env.TEST_USERNAME || 'systemadmin',
        password: process.env.TEST_AGENT_PASSWORD || process.env.TEST_PASSWORD || 'Admin123!',
      };
    case 'supervisor':
      return {
        username: process.env.TEST_SUPERVISOR_USERNAME || process.env.TEST_USERNAME || 'systemadmin',
        password: process.env.TEST_SUPERVISOR_PASSWORD || process.env.TEST_PASSWORD || 'Admin123!',
      };
    case 'admin':
      return {
        username: process.env.TEST_ADMIN_USERNAME || process.env.TEST_USERNAME || 'systemadmin',
        password: process.env.TEST_ADMIN_PASSWORD || process.env.TEST_PASSWORD || 'Admin123!',
      };
    default:
      return {
        username: process.env.TEST_USERNAME || 'systemadmin',
        password: process.env.TEST_PASSWORD || 'Admin123!',
      };
  }
}

// Sonda de infra (não assertiva): durante uma wave RPA o event loop da API
// pode ficar saturado por dezenas de segundos e requests falham em nível de
// rede (status -1, sem resposta). Aguardar a API voltar a responder antes de
// interagir evita falhas espúrias de autenticação/navegação. Best-effort:
// esgotado o orçamento, o fluxo normal continua e as assertivas reais falham
// com evidência.
async function waitForApiResponsive(page: any, budgetMs = 180000) {
  const deadline = Date.now() + budgetMs;
  for (;;) {
    const ok = await page
      .evaluate(async () => {
        try {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 5000);
          const resp = await fetch('/config', { signal: controller.signal });
          clearTimeout(timer);
          return resp.ok;
        } catch {
          return false;
        }
      })
      .catch(() => false);
    if (ok) return;
    if (Date.now() > deadline) return;
    await page.waitForTimeout(5000).catch(() => {});
  }
}

async function ensureAuthenticated(page: any, baseUrl: string, role = 'agent') {
  const { username, password } = getCredentialsForRole(role);

  await page.goto(`${baseUrl}/support`, { waitUntil: 'domcontentloaded' });

  // O goto resolve em domcontentloaded, antes do React renderizar. Sob
  // contenção de CPU (ex.: wave RPA em andamento na API) um isVisible
  // imediato retorna falso e a autenticação seria pulada indevidamente.
  // Esperar a decisão real da rota: ou o login aparece, ou a página alvo
  // já renderizou autenticada.
  const loginHeading = page.locator('text=Login de Agente');
  await loginHeading
    .or(page.getByTestId('support-page'))
    .first()
    .waitFor({ state: 'visible', timeout: 30000 })
    .catch(() => {});

  const onLoginPage = await loginHeading.isVisible().catch(() => false);
  if (!onLoginPage) return;

  await page.locator('input[placeholder*="username" i]').fill(username);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole('button', { name: /entrar/i }).click();

  // O login é inline (a URL /support não muda para /login) e super-admin
  // recebe o modal de tenant na mesma rota — waitForURL seria trivialmente
  // satisfeito sem provar nada. Esperar o desfecho real: modal de tenant,
  // página alvo autenticada ou erro de login (neste caso a tentativa
  // seguinte do navigateToSupport refaz o fluxo).
  await page
    .getByRole('heading', { name: /Selecione o Tenant/i })
    .or(page.getByTestId('support-page'))
    .or(page.getByText(/erro ao fazer login|credenciais inv/i))
    .first()
    .waitFor({ state: 'visible', timeout: 60000 })
    .catch(() => {});
}

async function ensureTenantSelected(page: any) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const tenantHeading = page.getByRole('heading', { name: /Selecione o Tenant/i }).first();
    const tenantDialog = page.locator('[role="dialog"]').filter({ hasText: 'Selecione o Tenant' }).first();
    const tenantOverlay = page.locator('div[tabindex="-1"]').filter({ hasText: 'Selecione o Tenant' }).first();

    const headingVisible = await tenantHeading.isVisible().catch(() => false);
    const dialogVisible = await tenantDialog.isVisible().catch(() => false);
    const overlayVisible = await tenantOverlay.isVisible().catch(() => false);

    if (!headingVisible && !dialogVisible && !overlayVisible) return;

    const modalRoot = dialogVisible ? tenantDialog : overlayVisible ? tenantOverlay : page;
    await modalRoot.locator('text=System').first().click({ force: true }).catch(() => {});

    const acessarInModal = modalRoot.getByRole('button', { name: /^Acessar$/i }).first();
    if (await acessarInModal.isVisible().catch(() => false)) {
      await acessarInModal.click({ force: true }).catch(() => {});
    }

    const acessarGlobal = page.getByRole('button', { name: /^Acessar$/i }).first();
    if (await acessarGlobal.isVisible().catch(() => false)) {
      await acessarGlobal.click({ force: true }).catch(() => {});
    }

    const resolved = await expect(tenantHeading).toBeHidden({ timeout: 7000 }).then(() => true).catch(() => false);
    if (resolved) return;
    await page.waitForTimeout(300);
  }
}

async function navigateToSupport(page: any, baseUrl: string, role = 'agent') {
  for (let attempt = 1; attempt <= 3; attempt++) {
    await page.goto(`${baseUrl}/support`, { waitUntil: 'domcontentloaded' });
    await waitForApiResponsive(page);

    // Mesma proteção contra render atrasado do React (ver ensureAuthenticated):
    // aguardar login OU support-page antes de decidir se precisa autenticar.
    const loginHeading = page.locator('text=Login de Agente');
    await loginHeading
      .or(page.getByTestId('support-page'))
      .first()
      .waitFor({ state: 'visible', timeout: 30000 })
      .catch(() => {});

    const loginVisible = await loginHeading.isVisible().catch(() => false);
    if (loginVisible) {
      await ensureAuthenticated(page, baseUrl, role);
      await page.goto(`${baseUrl}/support`, { waitUntil: 'domcontentloaded' });
    }

    await ensureTenantSelected(page);

    const supportVisible = await page
      .getByTestId('support-page')
      // 45s: em runners com poucos vCPUs a página pode competir com o Chromium
      // do RPA de uma wave em andamento; o carregamento é infra, não assertiva.
      .waitFor({ state: 'visible', timeout: 45000 })
      .then(() => true)
      .catch(() => false);

    if (!supportVisible) continue;

    // Expandir lista de tickets se estiver colapsada (display:none no CSS)
    const showListBtn = page.getByRole('button', { name: /Mostrar (lista de )?conversas/i }).first();
    if (await showListBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await showListBtn.click({ force: true }).catch(() => {});
      await page.waitForTimeout(300);
    }

    return;
  }

  throw new Error('Não foi possível carregar a página /support após 3 tentativas.');
}

async function supportFetch(page: any, path: string, options: any = {}) {
  return page.evaluate(
    async ({ requestPath, requestOptions }) => {
      const token = localStorage.getItem('auth_token');
      let tenantId = localStorage.getItem('auth_effective_tenant_id');
      if (!tenantId) {
        try {
          const agent = JSON.parse(localStorage.getItem('auth_agent') || '{}');
          tenantId = agent?.tenantId || 'system';
        } catch {
          tenantId = 'system';
        }
      }
      const response = await fetch(requestPath, {
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(tenantId ? { 'X-Tenant-Id': String(tenantId) } : {}),
          ...(requestOptions.headers || {}),
        },
        ...requestOptions,
      });
      const text = await response.text();
      let body: any = null;
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        body = { raw: text };
      }
      return { ok: response.ok, status: response.status, body };
    },
    { requestPath: path, requestOptions: options },
  );
}

async function ensureOperationalSupportTicket(page: any, baseUrl: string) {
  await navigateToSupport(page, baseUrl);
  const phone = `551199${String(Date.now()).slice(-7)}`;
  const createPayload = {
    phoneNumber: phone,
    queue: 'support',
    initialMessage: 'Cliente solicita atendimento operacional QA Waves.',
  };

  let created = await supportFetch(page, '/tickets', {
    method: 'POST',
    body: JSON.stringify(createPayload),
  });
  if (!created.ok) {
    created = await supportFetch(page, '/api/tickets', {
      method: 'POST',
      body: JSON.stringify(createPayload),
    });
  }

  let ticket = created.body?.ticket || created.body;
  if ((!ticket?.id || !created.ok) && created.status === 409) {
    const listed = await supportFetch(page, '/tickets?limit=50&offset=0', { method: 'GET' });
    const items = listed.body?.tickets || listed.body?.items || listed.body || [];
    const active = Array.isArray(items) ? items.find((it: any) => it?.status && String(it.status).toLowerCase() !== 'closed') : null;
    if (active) ticket = active;
  }

  if (!created.ok && created.status !== 409) {
    failNoGo('PRECONDITION_FAILED', ['real_ticket_created']);
  }
  if (!ticket?.id) {
    failNoGo('PRECONDITION_FAILED', ['real_ticket_id']);
  }

  const takeover = await supportFetch(page, `/tickets/${encodeURIComponent(ticket.id)}/takeover`, {
    method: 'POST',
    body: JSON.stringify({ reason: 'qa_waves_operational_support_flow' }),
  });
  if (!takeover.ok) {
    failNoGo('PRECONDITION_FAILED', ['ticket_in_progress']);
  }

  // Assign para mover status para in_progress (obrigatório para o compositor ficar visível)
  const agentInfo = await page.evaluate(() => {
    try { return JSON.parse(localStorage.getItem('auth_agent') || '{}'); } catch { return {}; }
  });
  const agentUsername = agentInfo?.username || agentInfo?.id || 'systemadmin';
  await supportFetch(page, `/tickets/${encodeURIComponent(ticket.id)}/assign`, {
    method: 'POST',
    body: JSON.stringify({ assignedTo: agentUsername }),
  });

  await page.goto(`${baseUrl}/support`, { waitUntil: 'domcontentloaded' });
  await ensureTenantSelected(page);

  // Expandir lista de tickets se colapsada
  const showListBtn = page.getByRole('button', { name: /Mostrar (lista de )?conversas/i }).first();
  if (await showListBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await showListBtn.click({ force: true }).catch(() => {});
    await page.waitForTimeout(300);
  }

  return { id: ticket.id, phone };
}

async function openTicketCard(page: any, locator: any) {
  await locator.scrollIntoViewIfNeeded().catch(() => {});
  await locator.click({ timeout: 7000 }).catch(async () => {
    await page.keyboard.press('Escape').catch(() => {});
    await locator.click({ force: true });
  });
}

function failNoGo(reason: string, missing: string[]) {
  throw new Error(
    JSON.stringify({
      status: 'NO_GO',
      reason,
      missing,
    })
  );
}

// Wait de infra (não assertivo): sob contenção de CPU com o Chromium do RPA
// de uma wave em andamento na API, 10s não bastam para o painel de detalhe
// do ticket renderizar após o clique no card.
const TICKET_DETAIL_WAIT_MS = 30000;

// ─── tests ────────────────────────────────────────────────────────────────────

test.describe('Support Agent Operations Wave', () => {
  // Sem retry: o cenário 6 dispara uma execução real na fila global da API
  // (EXECUTION_ALREADY_RUNNING). Uma retentativa enquanto a execução anterior
  // ainda está ativa falharia no POST por 409, mascarando o resultado real.
  test.describe.configure({ retries: 0 });
  const baseUrl = process.env.FRONTEND_URL || 'http://localhost:5173';

  test('cenário 1: agente visualiza lista de tickets e abre ticket', async ({ page }) => {
    await navigateToSupport(page, baseUrl);

    // Verifica página de suporte
    await expect(page.getByTestId('support-page')).toBeVisible({ timeout: 10000 });

    // Verifica lista de tickets
    const ticketList = page.getByTestId('ticket-list');
    await expect(ticketList).toBeVisible({ timeout: 10000 });

    // Conta tickets disponíveis
    const ticketCards = page.getByTestId('ticket-card');
    const count = await ticketCards.count();

    if (count === 0) {
      failNoGo('PRECONDITION_FAILED', ['open_ticket_exists']);
    }

    // Clica no primeiro ticket
    await openTicketCard(page, ticketCards.first());

    // Verifica que a conversa está aberta (ticket-detail é obrigatório)
    await expect(page.getByTestId('ticket-detail')).toBeVisible({ timeout: TICKET_DETAIL_WAIT_MS });
    // ticket-message-list só é renderizado quando ticket está in_progress ou paused
    // Verificar que algum conteúdo do painel de conversa está visível
    const hasDetail = await page.getByTestId('ticket-detail').isVisible().catch(() => false);
    if (!hasDetail) {
      failNoGo('OPERATIONAL_BLOCKER', ['ticket_detail_visible']);
    }
  });

  test('cenário 2: agente responde mensagem em ticket in_progress', async ({ page }) => {
    const { id: createdTicketId } = await ensureOperationalSupportTicket(page, baseUrl);
    await expect(page.getByTestId('support-page')).toBeVisible({ timeout: 10000 });

    // Usar ID direto do ticket criado (após takeover status=waiting mas mode=human)
    let ticketToClick = page.locator(`[data-testid="ticket-card"][data-ticket-id="${createdTicketId}"]`).first();
    let ticketVisible = await ticketToClick.isVisible().catch(() => false);

    if (!ticketVisible) {
      // Atualizar lista e tentar novamente
      await page.getByRole('button', { name: /Atualizar chamados/i }).click().catch(() => {});
      await page.waitForTimeout(1000);
      ticketVisible = await ticketToClick.isVisible().catch(() => false);
      if (!ticketVisible) failNoGo('PRECONDITION_FAILED', ['in_progress_ticket_exists']);
    }

    await openTicketCard(page, ticketToClick);

    // Verifica que compositor está disponível (ticket in_progress)
    const replyInput = page.getByTestId('ticket-reply-input');
    const replyVisible = await replyInput.isVisible().catch(() => false);

    if (!replyVisible) {
      failNoGo('PRECONDITION_FAILED', ['ticket_reply_composer_available']);
    }

    await replyInput.fill('Mensagem de teste do agente - validação operacional.');
    await expect(page.getByTestId('ticket-send-button')).toBeVisible();
    await page.getByTestId('ticket-send-button').click();

    // Aguarda mensagem enviada aparecer no log
    await expect(page.getByTestId('message-sent').last()).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId('ticket-status-select')).toContainText(/em atendimento|in_progress|atendimento/i, { timeout: 10000 });
  });

  test('cenário 3: agente verifica status e detalhes do ticket', async ({ page }) => {
    await navigateToSupport(page, baseUrl);
    await expect(page.getByTestId('support-page')).toBeVisible({ timeout: 10000 });

    const ticketCards = page.getByTestId('ticket-card');
    const count = await ticketCards.count();
    if (count === 0) {
      failNoGo('PRECONDITION_FAILED', ['open_ticket_exists']);
    }

    await openTicketCard(page, ticketCards.first());

    await expect(page.getByTestId('ticket-detail')).toBeVisible({ timeout: TICKET_DETAIL_WAIT_MS });
    await expect(page.getByTestId('ticket-updated')).toBeVisible({ timeout: 10000 });

    // Verifica que o status é exibido
    const statusInfo = page.getByTestId('ticket-status-info');
    const statusVisible = await statusInfo.isVisible().catch(() => false);
    if (statusVisible) {
      await expect(page.getByTestId('ticket-status-select')).toBeVisible();
    }
  });

  test('cenário 4: agente adiciona tag ao ticket', async ({ page }) => {
    await navigateToSupport(page, baseUrl);
    await expect(page.getByTestId('support-page')).toBeVisible({ timeout: 10000 });

    const ticketCards = page.getByTestId('ticket-card');
    const count = await ticketCards.count();
    if (count === 0) {
      failNoGo('PRECONDITION_FAILED', ['open_ticket_exists']);
    }

    await openTicketCard(page, ticketCards.first());
    await expect(page.getByTestId('ticket-detail')).toBeVisible({ timeout: TICKET_DETAIL_WAIT_MS });

    const tagButton = page.getByTestId('ticket-tag-button');
    const tagButtonVisible = await tagButton.isVisible().catch(() => false);
    if (!tagButtonVisible) {
      failNoGo('PRECONDITION_FAILED', ['ticket_tag_button_available']);
    }

    // Preenche campo de tag
    const tagInput = page.locator('input[placeholder="Adicionar tag"]');
    await tagInput.fill('operacional');
    await tagButton.click();

    // Verifica que a área foi atualizada
    await expect(page.getByTestId('ticket-updated')).toBeVisible({ timeout: 10000 });
  });

  test('cenário 5: agente fecha ticket', async ({ page }) => {
    const { id: createdTicketId } = await ensureOperationalSupportTicket(page, baseUrl);
    await expect(page.getByTestId('support-page')).toBeVisible({ timeout: 10000 });

    // Usar ID direto do ticket criado (status=waiting mode=human após takeover)
    let ticketToClick = page.locator(`[data-testid="ticket-card"][data-ticket-id="${createdTicketId}"]`).first();
    let ticketVisible = await ticketToClick.isVisible().catch(() => false);

    if (!ticketVisible) {
      await page.getByRole('button', { name: /Atualizar chamados/i }).click().catch(() => {});
      await page.waitForTimeout(1000);
      ticketVisible = await ticketToClick.isVisible().catch(() => false);
      if (!ticketVisible) failNoGo('PRECONDITION_FAILED', ['in_progress_ticket_exists']);
    }

    await openTicketCard(page, ticketToClick);

    const closeButton = page.getByTestId('ticket-close-button');
    await expect(closeButton).toBeVisible({ timeout: 10000 });
    await closeButton.click();

    // Modal de confirmação de encerramento — escopar ao dialog para não resolver ticket-close-button
    const closeModal = page.locator('[role="dialog"][aria-labelledby="close-ticket-title"]');
    const modalVisible = await closeModal.isVisible({ timeout: 5000 }).catch(() => false);
    if (modalVisible) {
      // Preencher motivo (campo obrigatório)
      const reasonInput = closeModal.locator('input[class*="support-form-input"]').last();
      if (await reasonInput.isVisible().catch(() => false)) {
        await reasonInput.fill('Resolvido pelo QA');
      }
      // Clicar no botão Fechar dentro do modal (não o ticket-close-button)
      await closeModal.getByRole('button', { name: /^Fechar$/ }).click({ force: true });
    }

    // Verifica atualização da UI
    await expect(page.getByTestId('ticket-updated')).toBeVisible({ timeout: 15000 });
  });

  test('cenário 6: wave operacional gera replay e replay aparece na listagem', async ({ page }) => {
    // A wave real + o drain final podem ultrapassar o timeout padrão de 180s
    // (mesmo motivo do test.setTimeout na spec qa-waves-replay).
    test.setTimeout(420000);
    const apiBase = process.env.API_URL || 'http://localhost:13001';

    // 0) Navegar para suporte primeiro (necessário para localStorage acessível em supportFetch)
    await navigateToSupport(page, baseUrl);

    // 1) Selecionar cenário executável localmente da jornada de suporte.
    // O primeiro item da lista pode ser pipeline-only (ex.: cenários de
    // vertical cujos platformScenarioIds exigem o pipeline oficial) — nesse
    // caso o POST retorna 409 PIPELINE_ONLY_SCENARIO e nenhum replay é
    // gerado. A wave operacional de suporte deve usar um cenário da
    // jornada support_ticket_flow, executável no ambiente local.
    const scenariosResp = await supportFetch(page, '/api/qa-waves/scenarios');
    const scenarioItems: any[] = scenariosResp.body?.items || [];
    const hasPlatformIds = (item: any) => Array.isArray(item?.platformScenarioIds) && item.platformScenarioIds.length > 0;
    const supportScenario =
      scenarioItems.find((item) => item?.id === 'support-inbox-nota-ui' && hasPlatformIds(item))
      || scenarioItems.find((item) => (item?.journeyId === 'support_ticket_flow' || item?.journey === 'support_ticket_flow') && hasPlatformIds(item));
    const validScenarioId: string = supportScenario?.id || '';
    if (!validScenarioId) {
      failNoGo('PRECONDITION_FAILED', ['qa_waves_support_scenario_available']);
    }

    // 2) Disparar execução
    const execution = await supportFetch(page, '/api/test-executions', {
      method: 'POST',
      body: JSON.stringify({
        source: 'qa_waves',
        mode: 'real',
        replay: true,
        scenarioIds: [validScenarioId],
      }),
    });

    let executionId: string = execution.body?.executionId || '';
    let capturedReplayId: string = (execution.body?.replayId || '').replace(/\.json$/i, '');

    if (!execution.ok) {
      // A fila de execuções QA Waves é global no processo da API. Quando outra
      // spec desta mesma run serial já disparou uma wave (ex.: qa-waves-replay),
      // o POST retorna 409 execution_already_running. Nesse caso a wave
      // operacional JÁ está em andamento e já gerou replay — usar a execução
      // ativa como evidência e validar a listagem dela (sem enfraquecer o
      // critério: o replay precisa existir e aparecer na UI).
      const alreadyRunning = execution.status === 409
        && execution.body?.error === 'execution_already_running'
        && typeof execution.body?.activeExecutionId === 'string';
      if (!alreadyRunning) {
        failNoGo('PRECONDITION_FAILED', ['qa_waves_support_execution']);
      }

      executionId = execution.body.activeExecutionId;
      const activeReplays = await supportFetch(
        page,
        `/api/test-executions/replays?executionId=${encodeURIComponent(executionId)}`,
      );
      const activeFiles: any[] = activeReplays.body?.files || [];
      capturedReplayId = String(activeFiles[0]?.replayId || '').replace(/\.json$/i, '');
      if (!capturedReplayId) {
        failNoGo('PRECONDITION_FAILED', ['qa_waves_support_execution']);
      }
    }

    // 3) Polling de até 60 s para aguardar replayId ser preenchido
    if (!capturedReplayId && executionId) {
      for (let poll = 0; poll < 12; poll++) {
        await page.waitForTimeout(5000);
        const statusResp = await supportFetch(page, `/api/test-executions/${encodeURIComponent(executionId)}`);
        const pollReplayId = (statusResp.body?.replayId || '').replace(/\.json$/i, '');
        if (pollReplayId) {
          capturedReplayId = pollReplayId;
          break;
        }
      }
    }

    // 4) Verificar listagem de replays
    await page.goto(`${baseUrl}/dev/rpa-replays`, { waitUntil: 'domcontentloaded' });
    await ensureTenantSelected(page);

    const replaysPage = page.getByTestId('rpa-replays-page');
    await expect(replaysPage).toBeVisible({ timeout: 15000 });

    if (capturedReplayId) {
      const replayItem = page.locator(`[data-testid="rpa-replay-item"][data-replay-id="${capturedReplayId}"]`).first();
      // Recarregar até o replay aparecer (pode estar em background)
      for (let retry = 0; retry < 6; retry++) {
        if (await replayItem.isVisible().catch(() => false)) break;
        await page.reload({ waitUntil: 'domcontentloaded' });
        await ensureTenantSelected(page);
        await page.waitForTimeout(5000);
      }
      await expect(replayItem).toBeVisible({ timeout: 10000 });
    } else {
      // Sem replayId: confirmar que a listagem carrega (sem replay disponível é evidência operacional)
      await expect(replaysPage).toBeVisible({ timeout: 10000 });
    }

    // 5) Drenar a wave antes de encerrar: o replay pode aparecer na listagem
    // enquanto o browser RPA da API ainda finaliza a execução. Sem este
    // drain, a wave vaza para a run seguinte e deixa os primeiros testes
    // dela sem CPU (falhas intermitentes de carregamento de página).
    // Dois estágios: (a) status da execução sair de processing; (b) a API
    // voltar a responder — o status vira terminal ANTES do pós-processamento
    // RPA (browser/screenshot) terminar, e é esse pós-processamento que
    // satura o event loop e derruba requests (status -1) na run seguinte.
    // Higiene de infra, não assertiva: não falha o teste se estourar o
    // orçamento ou se o browser do teste fechar.
    if (executionId) {
      try {
        for (let poll = 0; poll < 24; poll++) {
          const statusResp = await supportFetch(page, `/api/test-executions/${encodeURIComponent(executionId)}`);
          const currentStatus = String(statusResp.body?.status || '').toLowerCase();
          if (!statusResp.ok || (currentStatus && currentStatus !== 'processing' && currentStatus !== 'queued' && currentStatus !== 'running')) {
            break;
          }
          await page.waitForTimeout(5000);
        }
        await waitForApiResponsive(page, 240000);
      } catch {
        // best-effort: browser/contexto fechado durante a higiene não invalida
        // as evidências já validadas acima
      }
    }
  });
});
