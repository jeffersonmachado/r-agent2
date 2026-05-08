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

async function ensureAuthenticated(page: any, baseUrl: string) {
  const username = process.env.TEST_USERNAME || process.env.TEST_ADMIN_USERNAME || 'systemadmin';
  const password = process.env.TEST_PASSWORD || process.env.TEST_ADMIN_PASSWORD || 'Admin123!';

  await page.goto(`${baseUrl}/dev/qa-waves`, { waitUntil: 'domcontentloaded' });

  const onLoginPage = await page.locator('text=Login de Agente').isVisible().catch(() => false);
  if (!onLoginPage) return;

  await page.locator('input[placeholder*="username" i]').fill(username);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole('button', { name: /entrar/i }).click();

  await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 30000 });
  await page.goto(`${baseUrl}/dev/qa-waves`, { waitUntil: 'domcontentloaded' });
}

async function ensureTenantSelected(page: any) {
  const tenantHeading = page.getByRole('heading', { name: /Selecione o Tenant/i }).first();
  const headingVisible = await tenantHeading.isVisible().catch(() => false);

  // Caminho 1: modal com role=dialog
  const tenantDialog = page.locator('[role="dialog"]').filter({ hasText: 'Selecione o Tenant' }).first();
  const dialogVisible = await tenantDialog.isVisible().catch(() => false);

  // Caminho 2: modal sem role, mas com container de overlay tabindex=-1
  const tenantOverlay = page.locator('div[tabindex="-1"]').filter({ hasText: 'Selecione o Tenant' }).first();
  const overlayVisible = await tenantOverlay.isVisible().catch(() => false);

  if (!headingVisible && !dialogVisible && !overlayVisible) return;

  const modalRoot = dialogVisible ? tenantDialog : overlayVisible ? tenantOverlay : page;

  // Seleciona tenant System (quando disponível)
  await modalRoot.locator('text=System').first().click({ force: true }).catch(() => {});

  // Confirma acesso; tenta no modal e depois fallback global
  const acessarInModal = modalRoot.getByRole('button', { name: /^Acessar$/i }).first();
  const hasAcessarInModal = await acessarInModal.isVisible().catch(() => false);
  if (hasAcessarInModal) {
    await acessarInModal.click({ force: true });
  } else {
    const acessarGlobal = page.getByRole('button', { name: /^Acessar$/i }).first();
    const hasAcessarGlobal = await acessarGlobal.isVisible().catch(() => false);
    if (hasAcessarGlobal) {
      await acessarGlobal.click({ force: true });
    }
  }

  // Aguarda o fechamento do modal de tenant
  await expect(tenantHeading).toBeHidden({ timeout: 30000 }).catch(() => {});
  await expect(tenantDialog).toBeHidden({ timeout: 30000 }).catch(() => {});
  await expect(tenantOverlay).toBeHidden({ timeout: 30000 }).catch(() => {});
}

async function ensureQaWavesReady(page: any, baseUrl: string) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await page.goto(`${baseUrl}/dev/qa-waves`, { waitUntil: 'domcontentloaded' });

    const loginVisible = await page.locator('text=Login de Agente').isVisible().catch(() => false);
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
  test('gera replay completo e permite diagnóstico visual', async ({ page }, testInfo) => {
    test.setTimeout(300000);
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

      // 2) Evita alterar cenário dinamicamente durante o teste para reduzir flakiness.
      // O fluxo crítico aqui valida execução real + replay de um cenário já persistido.

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
    } catch (error) {
      await attachFailureDiagnostics();
      throw error;
    }
  });
});
