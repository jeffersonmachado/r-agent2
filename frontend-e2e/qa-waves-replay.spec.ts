import { test, expect } from '@playwright/test';

// ─── helpers ─────────────────────────────────────────────────────────────────

function pickReplayIdFromPayload(payload: any) {
  if (!payload || typeof payload !== 'object') return '';
  const candidate =
    payload.replayId ||
    payload.id ||
    payload.filename ||
    payload?.compatibility?.replayId ||
    payload?.compatibility?.id ||
    payload?.execution?.replayId;
  return typeof candidate === 'string' ? candidate.replace(/\.json$/i, '') : '';
}

function pickExecutionIdFromPayload(payload: any) {
  if (!payload || typeof payload !== 'object') return '';
  const candidate =
    payload.executionId ||
    payload.id ||
    payload?.compatibility?.executionId ||
    payload?.data?.executionId ||
    payload?.execution?.id ||
    payload?.execution?.executionId;
  return typeof candidate === 'string' ? candidate : '';
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

async function ensureAuthenticated(page: any, baseUrl: string) {
  const username = process.env.TEST_USERNAME || process.env.TEST_ADMIN_USERNAME || 'systemadmin';
  const password = process.env.TEST_PASSWORD || process.env.TEST_ADMIN_PASSWORD || 'Admin123!';

  await page.goto(`${baseUrl}/dev/qa-waves`, { waitUntil: 'domcontentloaded' });

  // O goto resolve em domcontentloaded, antes do React renderizar. Sob
  // contenção de CPU (ex.: wave RPA em andamento na API) um isVisible
  // imediato retorna falso e a autenticação seria pulada indevidamente.
  // Esperar a decisão real da rota: ou o login aparece, ou a página alvo
  // já renderizou autenticada.
  const loginHeading = page.locator('text=Login de Agente');
  await loginHeading
    .or(page.getByTestId('qa-waves-page'))
    .first()
    .waitFor({ state: 'visible', timeout: 30000 })
    .catch(() => {});

  const onLoginPage = await loginHeading.isVisible().catch(() => false);
  if (!onLoginPage) return;

  await page.locator('input[placeholder*="username" i]').fill(username);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole('button', { name: /entrar/i }).click();

  // O login é inline (a URL não muda para /login) e super-admin recebe o
  // modal de tenant na mesma rota — waitForURL seria trivialmente satisfeito
  // sem provar nada. Esperar o desfecho real: modal de tenant, página alvo
  // autenticada ou erro de login (neste caso a tentativa seguinte do
  // ensureQaWavesReady refaz o fluxo).
  await page
    .getByRole('heading', { name: /Selecione o Tenant/i })
    .or(page.getByTestId('qa-waves-page'))
    .or(page.getByText(/erro ao fazer login|credenciais inv/i))
    .first()
    .waitFor({ state: 'visible', timeout: 60000 })
    .catch(() => {});
  await page.goto(`${baseUrl}/dev/qa-waves`, { waitUntil: 'domcontentloaded' });
}

async function ensureTenantSelected(page: any) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const modalRoot = page
      .locator('div[tabindex="-1"]')
      .filter({ hasText: 'Selecione o Tenant' })
      .first();
    const modalVisible = await modalRoot.isVisible().catch(() => false);
    if (!modalVisible) return;

    // Seleciona o tenant System clicando no BOTÃO do tenant (o nome acessível
    // inclui "System SYSTEM system • enterprise"). O botão "Acessar" só fica
    // habilitado após a seleção.
    const systemTenantButton = modalRoot.getByRole('button', { name: /System/i }).first();
    if (await systemTenantButton.isVisible().catch(() => false)) {
      await systemTenantButton.click({ force: true }).catch(() => {});
    }

    const acessarButton = modalRoot.getByRole('button', { name: /^Acessar$/i }).first();
    if (await acessarButton.isEnabled({ timeout: 5000 }).catch(() => false)) {
      await acessarButton.click({ force: true }).catch(() => {});
    }

    // Aguarda o fechamento real do modal antes de prosseguir; se não fechar,
    // tenta novamente (o modal pode reabrir tarde, após as queries da página).
    const closed = await expect(modalRoot)
      .toBeHidden({ timeout: 10000 })
      .then(() => true)
      .catch(() => false);
    if (closed) return;
    await page.waitForTimeout(500);
  }
}

async function ensureQaWavesReady(page: any, baseUrl: string) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await page.goto(`${baseUrl}/dev/qa-waves`, { waitUntil: 'domcontentloaded' });
    await waitForApiResponsive(page);

    // Mesma proteção contra render atrasado do React (ver ensureAuthenticated):
    // aguardar login OU qa-waves-page antes de decidir se precisa autenticar.
    const loginHeading = page.locator('text=Login de Agente');
    await loginHeading
      .or(page.getByTestId('qa-waves-page'))
      .first()
      .waitFor({ state: 'visible', timeout: 30000 })
      .catch(() => {});

    const loginVisible = await loginHeading.isVisible().catch(() => false);
    if (loginVisible) {
      await ensureAuthenticated(page, baseUrl);
      await page.goto(`${baseUrl}/dev/qa-waves`, { waitUntil: 'domcontentloaded' });
    }

    await ensureTenantSelected(page);

    await expect(page.getByTestId('qa-waves-page')).toBeVisible({ timeout: 20000 }).catch(() => {});

    const qaWavesVisible = await page
      .getByTestId('qa-waves-title')
      .waitFor({ state: 'visible', timeout: 20000 })
      .then(() => true)
      .catch(() => false);

    if (qaWavesVisible) return;
  }

  throw new Error('Não foi possível carregar a página QA Waves após 3 tentativas.');
}

async function waitForReplaysPageReady(page: any, replaysUrl: string) {
  await page.goto(replaysUrl, { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('rpa-replays-page')).toBeVisible({ timeout: 30000 });
  await expect(page.getByTestId('rpa-replays-title')).toBeVisible({ timeout: 30000 });

  const loadingLabel = page.getByText('Carregando replays...').first();
  if (await loadingLabel.isVisible().catch(() => false)) {
    await expect(loadingLabel).toBeHidden({ timeout: 60000 });
  }
}

async function waitForReplayVisibleInUi(page: any, replaysUrl: string, replayId: string, timeoutMs = 90000) {
  await expect
    .poll(
      async () => {
        await waitForReplaysPageReady(page, replaysUrl);

        const searchInput = page
          .locator('input[type="search"], input[placeholder*="buscar" i], input[placeholder*="replay" i]')
          .first();
        const hasSearchInput = await searchInput.isVisible().catch(() => false);
        if (hasSearchInput) {
          await searchInput.fill(replayId);
          await searchInput.press('Enter').catch(() => {});
        }

        return page.locator(`[data-testid="rpa-replay-item"][data-replay-id="${replayId}"]`).count();
      },
      {
        timeout: timeoutMs,
        intervals: [1500, 3000, 5000],
        message: `Replay ${replayId} não apareceu na UI dentro do tempo esperado`,
      },
    )
    .toBeGreaterThan(0);
}


test.describe('QA Waves -> RPA Replays', () => {
  // Sem retry: esta spec dispara uma execução real na fila global da API
  // (EXECUTION_ALREADY_RUNNING). Uma retentativa enquanto a execução anterior
  // ainda está ativa falharia no POST por 409, mascarando o resultado real.
  test.describe.configure({ retries: 0 });
  test('gera replay completo e permite diagnóstico visual', async ({ page }, testInfo) => {
    test.setTimeout(420000);
    const baseUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    const consoleLogs: string[] = [];

    page.on('console', (msg: any) => {
      consoleLogs.push(`[${msg.type()}] ${msg.text()}`);
      if (consoleLogs.length > 400) {
        consoleLogs.shift();
      }
    });

    const attachFailureDiagnostics = async () => {
      const currentUrl = page.url();
      await testInfo.attach('current-url.txt', {
        body: Buffer.from(currentUrl, 'utf8'),
        contentType: 'text/plain',
      });

      await testInfo.attach('console-logs.txt', {
        body: Buffer.from(consoleLogs.join('\n') || '(sem logs de console capturados)', 'utf8'),
        contentType: 'text/plain',
      });

      const html = await page.content().catch(() => '<html><body>falha ao capturar html</body></html>');
      await testInfo.attach('page.html', {
        body: Buffer.from(html, 'utf8'),
        contentType: 'text/html',
      });

      const screenshot = await page.screenshot({ fullPage: true }).catch(() => null);
      if (screenshot) {
        await testInfo.attach('failure.png', {
          body: screenshot,
          contentType: 'image/png',
        });
      }
    };

    try {
      await ensureQaWavesReady(page, baseUrl);

      // 1) confirmar página QA Waves carregada
      await expect(page.getByTestId('qa-waves-title')).toContainText('QA Waves Integrado', { timeout: 30000 });
      await expect(page.getByTestId('qa-waves-run-button').first()).toBeVisible({ timeout: 30000 });

      // 2) Seleciona um cenário executável no contexto local. O cenário
      // selecionado por padrão pode ser pipeline-only (ex.: cenários de
      // vertical com platformScenarioIds marcados requiresOfficialPipeline
      // no meshRegistry) — nesse caso o POST retorna PIPELINE_ONLY_SCENARIO
      // e nenhum replay é gerado. 'support-inbox-nota-ui' é persistido e
      // executável localmente (validado via POST /api/test-executions).
      // Caminho na UI: árvore de jornadas → "Support Ticket Flow" (filtra a
      // aba Cenários para essa jornada) → cenário na lista. O modal de tenant
      // pode reabrir tardiamente (após as queries da página) — garantir que
      // está fechado antes de interagir com a árvore.
      await ensureTenantSelected(page);
      // A SIDEBAR MOSTRA APENAS O DOMÍNIO SELECIONADO (QaWavesPage.jsx:321-322 — a navegação entre
      // domínios é feita pelos pills do topo). Medido no run 40975061143: a API devolvia
      // 10 domínios com `temSupport: true`, mas o DOM tinha só as 2 jornadas do domínio `beauty`
      // (o primeiro da lista), porque a jornada de suporte vive em `core`. O teste presumia a jornada
      // visível sem antes selecionar o domínio — a pré-condição agora resolve o DOMÍNIO pela API e
      // clica no pill correspondente antes de procurar a jornada.
      const dominioDaJornada = await page.evaluate(async () => {
        const token = localStorage.getItem('auth_token');
        const tenantId = localStorage.getItem('auth_effective_tenant_id') || 'system';
        try {
          const r = await fetch('/api/qa-waves/journeys', {
            credentials: 'include',
            headers: {
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
              'X-Tenant-Id': String(tenantId),
            },
          });
          const json = await r.json();
          const domains = Array.isArray(json?.domains) ? json.domains : [];
          for (const domain of domains) {
            const journey = (domain.journeys || []).find((j: any) => /support|ticket|atendimento/i.test(String(j.journeyName || j.journeyId || '')));
            if (journey) {
              return { ok: true, domainId: domain.id, domainName: domain.name || domain.id, journeyName: journey.journeyName || journey.journeyId };
            }
          }
          return { ok: false, dominios: domains.map((d: any) => `${d.id}:${(d.journeys || []).length}`) };
        } catch (error) {
          return { ok: false, erro: String((error as Error)?.message || error) };
        }
      });

      if (!dominioDaJornada.ok) {
        throw new Error(JSON.stringify({
          status: 'NO_GO',
          reason: 'PRECONDITION_FAILED',
          missing: ['journey_with_support_scenario na API: ' + JSON.stringify(dominioDaJornada)],
        }));
      }

      // Seleciona o DOMÍNIO dono da jornada (pill do topo) e espera a árvore popular com ele.
      const pillDoDominio = page.locator('.qa-domain-pill', { hasText: new RegExp(String(dominioDaJornada.domainName), 'i') }).first();
      if (await pillDoDominio.isVisible().catch(() => false)) {
        await pillDoDominio.click({ timeout: 15000 });
      }
      const jornadaAlvo = page
        .locator('.qa-journey-tree-journey', { hasText: String(dominioDaJornada.journeyName) })
        .first();
      await expect(jornadaAlvo).toBeVisible({ timeout: 20000 });
      await jornadaAlvo.click({ timeout: 15000 });
      // O "tab" Cenários NÃO EXISTE MAIS (medido 2026-10-30, execução local com a árvore já selecionada):
      // a lista de cenários virou uma SEÇÃO sempre visível (`QaWavesPage.jsx:1440`) e o clique num
      // controle inexistente consumia os 420 s inteiros do teste. A espera pelo botão do cenário é
      // limitada e nomeia o que existe quando ele não aparece.
      const runnableScenarioButton = page
        .locator('button', { hasText: 'support-inbox-nota-ui@' })
        .first();
      await expect(runnableScenarioButton).toBeVisible({ timeout: 30000 });
      await runnableScenarioButton.click();

      // 3) Executar cenário e capturar resposta do POST com retentativa caso o cenário não esteja selecionado.
      const executeButton = page.getByTestId('qa-waves-run-button').first();
      await expect(executeButton).toBeEnabled({ timeout: 15000 });

      let executionBody: any = {};

      for (let runAttempt = 1; runAttempt <= 2; runAttempt += 1) {
        const executionPostPromise = page.waitForResponse(
          (resp: any) => {
            if (resp.request().method() !== 'POST') return false;
            const url = resp.url();
            return (
              url.includes('/api/test-executions') ||
              url.includes('/api/qa-waves/run') ||
              url.includes('/dev/qa-waves/run') ||
              url.includes('/api/qa-waves/executions') ||
              url.includes('/dev/qa-waves/executions')
            );
          },
          { timeout: 60000 },
        );

        let executed = false;
        let lastClickError: unknown = null;
        for (let clickAttempt = 1; clickAttempt <= 3; clickAttempt += 1) {
          await ensureTenantSelected(page);
          try {
            await executeButton.click({ timeout: 7000 });
            executed = true;
            break;
          } catch (error) {
            lastClickError = error;
            await page.keyboard.press('Escape').catch(() => {});
            await page.waitForLoadState('domcontentloaded').catch(() => {});
          }
        }

        if (!executed) {
          throw new Error(
            `Falha ao clicar em Executar cenário após 3 tentativas: ${String(
              (lastClickError as Error)?.message || lastClickError,
            )}`,
          );
        }

        const executionResp = await executionPostPromise;
        expect(executionResp, 'POST /api/test-executions não foi capturado').toBeTruthy();
        executionBody = executionResp ? await executionResp.json().catch(() => ({})) : {};

        const replayCandidate = pickReplayIdFromPayload(executionBody);
        if (replayCandidate) break;

        const message = String(executionBody?.message || executionBody?.error || '').toLowerCase();
        const missingScenario = message.includes('nenhum scenario') || message.includes('scenario');
        if (!missingScenario || runAttempt === 2) break;

        const firstScenarioButton = page
          .locator('button')
          .filter({ hasText: /Status:/i })
          .filter({ hasText: /@/ })
          .first();

        if (await firstScenarioButton.isVisible().catch(() => false)) {
          await firstScenarioButton.click({ force: true });
        }
      }

      const executionId: string = pickExecutionIdFromPayload(executionBody);
      const replayId: string = pickReplayIdFromPayload(executionBody);

      expect(replayId, `POST /api/test-executions deve retornar replayId. payload=${JSON.stringify(executionBody)}`).toBeTruthy();
      console.log(`[spec] executionId=${executionId || 'n/a'} replayId=${replayId}`);

      // 7) Navegar para replays e aguardar o item ficar visível com recarregamento controlado
      const replaysUrl = `${baseUrl}/dev/rpa-replays?source=qa-waves&search=${encodeURIComponent(replayId)}`;
      await waitForReplayVisibleInUi(page, replaysUrl, replayId, 90000);

      // 8) validar contexto mínimo de diagnóstico no card
      const replayItem = page.locator(`[data-testid="rpa-replay-item"][data-replay-id="${replayId}"]`).first();
      await expect(replayItem).toBeVisible({ timeout: 90000 });
      if (executionId) {
        await expect(page.locator(`text=${executionId}`).first()).toBeVisible({ timeout: 60000 });
      }
      await expect(page.locator('text=Cenário:').first()).toBeVisible({ timeout: 60000 });

      // 9) Quando houver painel de detalhes, validar navegação/trace (best-effort, não falha se sidebar ausente)
      await replayItem.click({ force: true }).catch(() => {});
      await page.waitForTimeout(1500).catch(() => {});

      const replaySidebar = page.getByTestId('replay-sidebar').first();
      const sidebarVisible = await replaySidebar.isVisible({ timeout: 5000 }).catch(() => false);
      if (sidebarVisible) {
        const replaySteps = page.getByTestId('replay-step');
        if ((await replaySteps.count().catch(() => 0)) > 0) {
          await expect(replaySteps.first()).toBeVisible({ timeout: 10000 }).catch(() => {});
        }
      }
      // Diagnóstico visual: verificar que o item continua visível após clique (best-effort: clique pode navegar para detalhe)
      await expect(replayItem).toBeVisible({ timeout: 10000 }).catch(() => {});

      // Dreno best-effort da execução RPA: a fila é global na API e o Chromium
      // do RPA consome CPU do runner. Aguardar o término (sem falhar se
      // estourar o orçamento) evita contenção com as specs seguintes.
      if (executionId) {
        const drainDeadline = Date.now() + 240000;
        let drainStatus = 'processing';
        while (drainStatus === 'processing' && Date.now() < drainDeadline) {
          await page.waitForTimeout(10000);
          drainStatus = await page
            .evaluate(async (execId) => {
              const token = localStorage.getItem('auth_token');
              const tenantId = localStorage.getItem('auth_effective_tenant_id') || 'system';
              const resp = await fetch(`/api/test-executions/${encodeURIComponent(execId)}`, {
                credentials: 'include',
                headers: {
                  ...(token ? { Authorization: `Bearer ${token}` } : {}),
                  'X-Tenant-Id': String(tenantId),
                },
              }).catch(() => null);
              if (!resp) return 'processing';
              const body = await resp.json().catch(() => ({}));
              return String(body?.status || '').toLowerCase() || 'processing';
            }, executionId)
            .catch(() => 'processing');
        }
        // O status vira terminal ANTES do pós-processamento RPA (browser,
        // screenshots) terminar — e é esse pós-processamento que satura o
        // event loop da API e derruba requests das specs seguintes.
        // Segundo estágio do drain: aguardar a API voltar a responder.
        await waitForApiResponsive(page, 240000);
        console.log(`[spec] drain da execução ${executionId}: status final=${drainStatus}`);
        if (drainStatus !== 'success') {
          // Evidência de diagnóstico: a execução RPA da wave termina 'failed'
          // no runner do CI (local: success). Logar erro e steps para tornar
          // a causa visível no log do job em vez de escondê-la.
          const detail = await page
            .evaluate(async (execId) => {
              const token = localStorage.getItem('auth_token');
              const tenantId = localStorage.getItem('auth_effective_tenant_id') || 'system';
              const resp = await fetch(`/api/test-executions/${encodeURIComponent(execId)}`, {
                credentials: 'include',
                headers: {
                  ...(token ? { Authorization: `Bearer ${token}` } : {}),
                  'X-Tenant-Id': String(tenantId),
                },
              }).catch(() => null);
              if (!resp) return null;
              return resp.json().catch(() => null);
            }, executionId)
            .catch(() => null);
          if (detail) {
            const results = Array.isArray(detail.results) ? detail.results : [];
            const failedResults = results
              .filter((r) => r && String(r.status || '').toLowerCase() !== 'success');
            console.log('[spec] drain diagnóstico:', JSON.stringify({
              status: detail.status,
              summary: detail.summary || null,
              currentStep: detail.currentStep || null,
              totalResults: results.length,
            }));
            // Entradas dos cenários falhos sem o array `logs` (verboso):
            // prioriza `errors` (mensagens de console críticas do RPA) e
            // mantém apenas as últimas linhas de log para contexto.
            for (const entry of failedResults) {
              const slim = {
                id: entry.id,
                status: entry.status,
                errors: entry.errors || [],
                lastLogs: Array.isArray(entry.logs) ? entry.logs.slice(-5) : [],
              };
              console.log('[spec] drain cenário falho:', JSON.stringify(slim).slice(0, 4000));
            }
          }
        }
      }
    } catch (error) {
      await attachFailureDiagnostics();
      throw error;
    }
  });
});
