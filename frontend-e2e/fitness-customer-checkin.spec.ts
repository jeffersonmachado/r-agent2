import { test, expect } from '@playwright/test';

async function ensureAuthenticated(page: any, baseUrl: string) {
  await page.goto(`${baseUrl}/operations-dashboard`, { waitUntil: 'domcontentloaded' });

  const onLoginPage = await page.locator('text=Login de Agente').isVisible().catch(() => false);
  if (!onLoginPage) return;

  const username = process.env.TEST_USERNAME || process.env.TEST_ADMIN_USERNAME || 'systemadmin';
  const password = process.env.TEST_PASSWORD || process.env.TEST_ADMIN_PASSWORD || 'Admin123!';
  await page.locator('input[placeholder*="username" i]').fill(username);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole('button', { name: /entrar/i }).click();
  await page.waitForURL((url: URL) => !url.pathname.includes('/login'), { timeout: 30000 });
}

async function ensureTenantSelected(page: any) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const tenantHeading = page.getByRole('heading', { name: /Selecione o Tenant/i }).first();
    const tenantDialog = page.locator('[role="dialog"]').filter({ hasText: 'Selecione o Tenant' }).first();
    const tenantOverlay = page.locator('div[tabindex="-1"]').filter({ hasText: 'Selecione o Tenant' }).first();

    const visible = await tenantHeading.isVisible().catch(() => false);
    const dialogVisible = await tenantDialog.isVisible().catch(() => false);
    const overlayVisible = await tenantOverlay.isVisible().catch(() => false);
    if (!visible && !dialogVisible && !overlayVisible) return;

    const root = dialogVisible ? tenantDialog : overlayVisible ? tenantOverlay : page;
    await root.locator('text=System').first().click({ force: true }).catch(() => {});
    const acessarLocal = root.getByRole('button', { name: /^Acessar$/i }).first();
    if (await acessarLocal.isVisible().catch(() => false)) {
      await acessarLocal.click({ force: true }).catch(() => {});
    }
    const acessarGlobal = page.getByRole('button', { name: /^Acessar$/i }).first();
    if (await acessarGlobal.isVisible().catch(() => false)) {
      await acessarGlobal.click({ force: true }).catch(() => {});
    }

    const resolved = await expect(tenantHeading).toBeHidden({ timeout: 8000 }).then(() => true).catch(() => false);
    if (resolved) return;
    await page.waitForTimeout(300);
  }
}

async function apiFetch(page: any, path: string, options: any = {}) {
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

function noGo(reason: string, missing: string[]) {
  throw new Error(JSON.stringify({ status: 'NO_GO', reason, missing }));
}

test.describe('Fitness Customer Check-in Operational Flow', () => {
  const baseUrl = process.env.FRONTEND_URL || 'http://localhost:5173';

  test('executa check-in real com decisão allow, evento de acesso, presença e timeline', async ({ page }) => {
    test.setTimeout(180000);
    await ensureAuthenticated(page, baseUrl);
    await ensureTenantSelected(page);

    const suffix = String(Date.now());
    const subjectId = `qa-fit-subject-${suffix}`;
    const membershipId = `qa-fit-membership-${suffix}`;
    const credentialValue = `QA-FIT-${suffix}`;

    const student = await apiFetch(page, '/api/fitness/student', {
      method: 'POST',
      body: JSON.stringify({
        subjectId,
        customerId: `qa-fit-customer-${suffix}`,
        membershipId,
        name: 'QA Waves Fitness Check-in',
        document: `DOC${suffix}`,
        code: `FIT${suffix}`,
        planName: 'Plano QA Operacional',
        billingStatus: 'active',
        status: 'active',
      }),
    });
    if (!student.ok || !student.body?.subject?.id || !student.body?.membership?.id) {
      noGo('PRECONDITION_FAILED', ['crm_contact_real', 'membership_active']);
    }

    const credential = await apiFetch(page, '/api/access-control/credentials', {
      method: 'POST',
      body: JSON.stringify({
        type: 'qrcode',
        subjectId,
        membershipId,
        credentialValue,
        credentialRef: `qa-fit-ref-${suffix}`,
        vertical: 'fitness',
        status: 'active',
      }),
    });
    if (!credential.ok || !credential.body?.item?.id) {
      noGo('PRECONDITION_FAILED', ['credential_real']);
    }

    const policy = await apiFetch(page, '/api/access-control/policies', {
      method: 'POST',
      body: JSON.stringify({
        id: `qa-fit-policy-${suffix}`,
        name: 'QA Waves Fitness Allow Policy',
        vertical: 'fitness',
        appliesTo: {
          actions: ['enter'],
          vertical_profiles: ['fitness'],
          membership_statuses: ['active'],
        },
      }),
    });
    if (!policy.ok) {
      noGo('PRECONDITION_FAILED', ['access_policy_allow']);
    }

    const beforeAttendance = await apiFetch(page, `/api/fitness/subject/${encodeURIComponent(subjectId)}/attendance?limit=20`);
    const beforeCount = Number(beforeAttendance.body?.items?.length || 0);

    await page.goto(`${baseUrl}/operations-dashboard`, { waitUntil: 'domcontentloaded' });
    await ensureTenantSelected(page);
    await page.getByRole('button', { name: /Check-in Fitness/i }).click();
    await page.locator('input[placeholder*="Buscar aluno" i]').fill(subjectId);
    await page.getByRole('button', { name: /^Buscar aluno$/i }).click();
    await expect(page.getByText(subjectId).first()).toBeVisible({ timeout: 30000 });

    const decision = await apiFetch(page, '/api/access-control/decisions/resolve', {
      method: 'POST',
      body: JSON.stringify({
        action: 'enter',
        credentialValue,
        subjectId,
        membershipId,
        vertical: 'fitness',
        rawPayload: { evidence: 'fitness_customer_checkin_e2e' },
      }),
    });
    if (!decision.ok || decision.body?.decision?.decision !== 'allow') {
      noGo('OPERATIONAL_BLOCKER', ['access_decision_allow']);
    }

    await expect.poll(
      async () => {
        const attendance = await apiFetch(page, `/api/fitness/subject/${encodeURIComponent(subjectId)}/attendance?limit=20`);
        return Number(attendance.body?.items?.length || 0);
      },
      { timeout: 30000, intervals: [1000, 2000, 3000] },
    ).toBeGreaterThan(beforeCount);

    const events = await apiFetch(page, `/api/access-control/events?subject_id=${encodeURIComponent(subjectId)}&limit=20`);
    if (!events.ok || !Array.isArray(events.body?.items) || events.body.items.length === 0) {
      noGo('OPERATIONAL_BLOCKER', ['access_release_event_created']);
    }

    // Timeline pode ser preenchida de forma assíncrona — polling de até 90 s
    let timelineItems: any[] = [];
    for (let t = 0; t < 18; t++) {
      const timeline = await apiFetch(page, `/api/fitness/subject/${encodeURIComponent(subjectId)}/timeline`);
      if (timeline.ok && Array.isArray(timeline.body?.items) && timeline.body.items.length > 0) {
        timelineItems = timeline.body.items;
        break;
      }
      await page.waitForTimeout(5000);
    }
    if (timelineItems.length === 0) {
      noGo('OPERATIONAL_BLOCKER', ['crm_presence_timeline']);
    }

    await page.getByRole('button', { name: /Detalhe/i }).first().click();
    await expect(page.getByText(/Historico recente de presenca/i)).toBeVisible({ timeout: 30000 });
    await expect(page.getByText(subjectId).first()).toBeVisible({ timeout: 30000 });
  });
});
