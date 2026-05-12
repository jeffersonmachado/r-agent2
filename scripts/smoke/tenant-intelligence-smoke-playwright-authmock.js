const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { OPERATIONAL_TREND_FORMULA_TEXT } = require('../../frontend/src/utils/operationalTrend.cjs');

const BASE_URL = process.env.FRONTEND_URL || 'http://localhost:5173';
const outDir = '/tmp/tenant-intelligence-smoke-artifacts';
const reportPath = '/tmp/tenant_intelligence_smoke_report.md';

const mockAgent = {
  id: 'agent-ti-smoke',
  username: 'tenant-intelligence-admin',
  role: 'admin',
  tenantId: 'demo-tenant',
};

let goals = [
  {
    id: 'goal-1',
    name: 'Reduzir cancelamentos',
    metric_key: 'orders.cancel_rate',
    target_value: 5,
    current_value: 7,
    comparison_mode: 'lte',
    status: 'active',
    computed: {
      computedStatus: 'off_track',
      progressPercent: 71,
    },
  },
];

const insights = [
  {
    id: 'insight-1',
    type: 'goal_off_track',
    title: 'Cancelamentos acima da meta',
    confidence: 0.88,
    impact: 'high',
  },
];

const recommendations = [
  {
    id: 'rec-1',
    title: 'Aplicar playbook de reversao',
    action_type: 'operational_review',
    priority: 'high',
  },
];

const insightEvidence = {
  'insight-1': Array.from({ length: 7 }, (_, index) => ({
    id: `evidence-${index + 1}`,
    evidence_type: 'metric_snapshot',
    source_type: index % 2 === 0 ? 'tenant_metric_snapshot' : 'event_ledger',
    source_id: `snapshot-${index + 1}`,
    excerpt: index === 0 ? 'Cancelamentos acima da meta mensal.' : `Evidencia smoke ${index + 1}`,
    structured_data: {
      metric_key: 'orders.cancel_rate',
      current_value: 7 + index,
      target_value: 5,
    },
    metadata: {
      period: 'month',
      index: index + 1,
    },
  })),
};

let operationalState = {
  tenant: {
    id: mockAgent.tenantId,
    context: {
      objetivo: 'Elevar retencao de pedidos',
    },
  },
  period: {
    type: 'month',
    start: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
    end: new Date().toISOString(),
  },
  filters: {},
  health: {
    status: 'warning',
    score: 62,
    reasons: ['1 goal(s) off_track'],
  },
  goals: {
    total: goals.length,
    byStatus: {
      off_track: 1,
    },
    items: goals,
  },
  metrics: {
    totalSnapshots: 1,
    latestSnapshotAt: new Date().toISOString(),
    items: [{ id: 'metric-1', metric_key: 'event_ledger.total_events', value: 120 }],
  },
  insights: {
    totalOpen: insights.length,
    byImpact: {
      high: 1,
    },
    items: insights,
    evidenceByInsight: {
      'insight-1': insightEvidence['insight-1'].slice(0, 5),
    },
    evidenceTotal: 5,
  },
  recommendations: {
    totalOpen: recommendations.length,
    byPriority: {
      high: 1,
    },
    items: recommendations,
  },
  refresh: {
    metrics: false,
    snapshotsCreated: 0,
    ok: true,
  },
  generatedAt: new Date().toISOString(),
};

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeReport(lines) {
  fs.writeFileSync(reportPath, `${lines.join('\n')}\n`, 'utf8');
}

function jsonResponse(route, status, body) {
  return route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}

function parseBody(raw) {
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

async function clickWithRetry(page, getLocator, attempts = 4) {
  let lastError = null;
  for (let i = 0; i < attempts; i += 1) {
    try {
      const locator = getLocator();
      await locator.first().click({ timeout: 12000 });
      return;
    } catch (error) {
      lastError = error;
      await page.waitForTimeout(300 + (i * 200));
    }
  }
  throw lastError;
}

(async () => {
  ensureDir(outDir);
  const report = [];
  report.push('# Tenant Intelligence E2E Smoke Report');
  report.push(`- Date: ${new Date().toISOString()}`);
  report.push(`- Base URL: ${BASE_URL}`);
  report.push('- Auth mode: mocked /auth/me + localStorage token');
  report.push('- API mode: mocked /api/intelligence/*');

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();

  await context.route(/^https?:\/\/[^/]+\/auth\/me(?:\?|$)/, async (route) => {
    await jsonResponse(route, 200, { agent: mockAgent });
  });

  await context.route(/^https?:\/\/[^/]+\/tenants(?:\/|\?|$)/, async (route, request) => {
    const url = new URL(request.url());
    const id = url.pathname.split('/').pop() || 'demo-tenant';
    await jsonResponse(route, 200, {
      tenant: {
        id,
        tenantId: id,
        name: 'Tenant Demo',
      },
    });
  });

  await context.route(/^https?:\/\/[^/]+\/tickets(?:\/|\?|$)/, async (route) => {
    await jsonResponse(route, 200, {
      tickets: [],
      total: 0,
    });
  });

  await context.route(/^https?:\/\/[^/]+\/api\/intelligence(?:\/|\?|$)/, async (route, request) => {
    const url = new URL(request.url());
    const pathname = url.pathname;
    const method = request.method().toUpperCase();
    const body = parseBody(request.postData());

    if (method === 'GET' && pathname === '/api/intelligence/goals') {
      await jsonResponse(route, 200, { ok: true, items: goals, total: goals.length });
      return;
    }

    if (method === 'POST' && pathname === '/api/intelligence/goals') {
      const id = `goal-${Date.now()}`;
      const target = Number(body.target_value || 0);
      const current = body.current_value == null ? null : Number(body.current_value);
      const computed = current == null
        ? { computedStatus: 'unknown', progressPercent: null }
        : {
            computedStatus: current >= target ? 'on_track' : 'off_track',
            progressPercent: target > 0 ? Math.round((current / target) * 100) : null,
          };
      const created = {
        id,
        name: String(body.name || 'Meta criada'),
        metric_key: String(body.metric_key || 'metric.test'),
        target_value: target,
        current_value: current,
        comparison_mode: String(body.comparison_mode || 'gte'),
        status: 'active',
        computed,
      };
      goals = [created, ...goals];
      await jsonResponse(route, 201, { ok: true, goal: created, evaluation: computed });
      return;
    }

    if (method === 'PUT' && pathname.startsWith('/api/intelligence/goals/')) {
      const goalId = decodeURIComponent(pathname.slice('/api/intelligence/goals/'.length));
      goals = goals.map((goal) => {
        if (goal.id !== goalId) return goal;
        const nextCurrent = body.current_value == null ? goal.current_value : Number(body.current_value);
        const target = Number(goal.target_value || 0);
        const progressPercent = target > 0 && Number.isFinite(nextCurrent)
          ? Math.round((nextCurrent / target) * 100)
          : null;
        return {
          ...goal,
          current_value: nextCurrent,
          computed: {
            computedStatus: target > 0 && Number.isFinite(nextCurrent) && nextCurrent >= target ? 'on_track' : 'off_track',
            progressPercent,
          },
        };
      });
      const updated = goals.find((goal) => goal.id === goalId);
      await jsonResponse(route, 200, {
        ok: true,
        goal: updated,
        evaluation: updated ? updated.computed : null,
      });
      return;
    }

    if (method === 'POST' && pathname === '/api/intelligence/metrics/snapshots') {
      await jsonResponse(route, 200, { ok: true, snapshots: [{ id: 'snapshot-1' }] });
      return;
    }

    if (method === 'GET' && pathname === '/api/intelligence/insights') {
      await jsonResponse(route, 200, { ok: true, items: insights, total: insights.length });
      return;
    }

    if (method === 'GET' && pathname.startsWith('/api/intelligence/insights/') && pathname.endsWith('/evidence')) {
      const insightId = decodeURIComponent(pathname.slice('/api/intelligence/insights/'.length).replace('/evidence', ''));
      const items = insightEvidence[insightId] || [];
      await jsonResponse(route, 200, { ok: true, items, total: items.length });
      return;
    }

    if (method === 'GET' && pathname === '/api/intelligence/recommendations') {
      await jsonResponse(route, 200, { ok: true, items: recommendations, total: recommendations.length });
      return;
    }

    if (method === 'GET' && pathname === '/api/intelligence/operational-state') {
      const mode = String(url.searchParams.get('mode') || 'read').toLowerCase();
      const refreshMetrics = String(url.searchParams.get('refreshMetrics') || 'false').toLowerCase() === 'true';

      if (mode === 'refresh' || refreshMetrics) {
        operationalState = {
          ...operationalState,
          health: {
            ...operationalState.health,
            score: 74,
            status: 'healthy',
            reasons: [],
          },
          refresh: {
            metrics: true,
            snapshotsCreated: 1,
            ok: true,
          },
          generatedAt: new Date().toISOString(),
        };
      }

      await jsonResponse(route, 200, {
        ok: true,
        state: operationalState,
      });
      return;
    }

    if (method === 'POST' && pathname === '/api/intelligence/search') {
      await jsonResponse(route, 200, {
        ok: true,
        answer: 'Resumo: cancelamentos acima da meta; priorizar playbook de reversao e acompanhamento diario.',
        context: {
          tenant: {
            objetivo: 'Elevar retencao de pedidos',
          },
          objectives: goals.map((g) => ({
            id: g.id,
            name: g.name,
            metric_key: g.metric_key,
            target_value: g.target_value,
            current_value: g.current_value,
            status: g.computed?.computedStatus || g.status || 'unknown',
          })),
          period: operationalState.period,
          filters: {},
        },
        goalsImpact: goals.map((g) => ({
          id: g.id,
          name: g.name,
          metric_key: g.metric_key,
          target_value: g.target_value,
          current_value: g.current_value,
          status: g.computed?.computedStatus || g.status || 'unknown',
          progress_percent: g.computed?.progressPercent ?? null,
        })),
        insights,
        recommendations,
        evidence: insightEvidence['insight-1'].slice(0, 2),
        sources: [{ documentId: 'doc-1', chunkId: 'chunk-1', score: 0.91 }],
        meta: {
          usedRag: true,
          ragConfidence: 0.86,
          usedSnapshots: false,
          usedPersistedInsights: true,
          mode: 'read',
        },
      });
      return;
    }

    await jsonResponse(route, 404, { error: 'not_found', pathname, method });
  });

  await context.addInitScript((agent) => {
    class SmokeWebSocket {
      constructor() {
        this.readyState = 3;
      }
      addEventListener() {}
      removeEventListener() {}
      send() {}
      close() {}
    }
    SmokeWebSocket.CONNECTING = 0;
    SmokeWebSocket.OPEN = 1;
    SmokeWebSocket.CLOSING = 2;
    SmokeWebSocket.CLOSED = 3;

    // Evita transicoes de auth de WebSocket durante o smoke UI.
    window.WebSocket = SmokeWebSocket;

    localStorage.setItem('auth_token', 'tenant-intelligence-smoke-token');
    localStorage.setItem('auth_agent', JSON.stringify(agent));
    localStorage.setItem('auth_effective_tenant_id', agent.tenantId);
  }, mockAgent);

  const page = await context.newPage();

  try {
    await page.goto(`${BASE_URL}/tenant-intelligence`, { waitUntil: 'networkidle', timeout: 45000 });

    const denied = await page.locator('text=Acesso Negado').first().isVisible().catch(() => false);
    if (denied) {
      throw new Error('Acesso negado em /tenant-intelligence com auth mock de admin.');
    }

    await page
      .locator('h1')
      .filter({ hasText: /Inteligência do Tenant|Tenant Intelligence/i })
      .first()
      .waitFor({ state: 'visible', timeout: 20000 });

    const stateCardVisible = await page.locator('h3:has-text("Estado operacional")').first().isVisible().catch(() => false);
    if (!stateCardVisible) {
      throw new Error('Card "Estado operacional" nao foi renderizado.');
    }

    const goalCard = page.locator('text=Metas ativas').first();
    if (!(await goalCard.isVisible())) {
      throw new Error('Card "Metas ativas" nao foi renderizado.');
    }

    const warningVisible = await page.locator('text=warning').first().isVisible().catch(() => false);
    if (!warningVisible) {
      throw new Error('Status inicial "warning" do estado operacional nao apareceu.');
    }

    await clickWithRetry(page, () => page.getByRole('button', { name: /Atualizar estado operacional/i }));
    await page.waitForTimeout(350);

    const healthyVisible = await page.locator('text=healthy').first().isVisible().catch(() => false);
    if (!healthyVisible) {
      throw new Error('Status "healthy" nao apareceu apos refresh do estado operacional.');
    }

    const trendVisible = await page.locator('text=alta (+12)').first().isVisible().catch(() => false);
    if (!trendVisible) {
      throw new Error('Tendencia "alta (+12)" nao apareceu apos refresh do estado operacional.');
    }

    const trendTooltip = await page
      .locator('div[title]')
      .filter({ hasText: /^Tendência$/ })
      .first()
      .getAttribute('title')
      .catch(() => null);
    if (!trendTooltip || !trendTooltip.includes(OPERATIONAL_TREND_FORMULA_TEXT)) {
      throw new Error('Tooltip da tendencia nao apresentou a formula esperada.');
    }

    const scoreTooltip = await page
      .locator('div[title]')
      .filter({ hasText: /^Score$/ })
      .first()
      .getAttribute('title')
      .catch(() => null);
    if (!scoreTooltip || !scoreTooltip.includes(OPERATIONAL_TREND_FORMULA_TEXT)) {
      throw new Error('Tooltip de score nao apresentou a formula esperada.');
    }

    await clickWithRetry(page, () => page.getByRole('button', { name: /Executar busca/i }));
    await page.waitForTimeout(400);

    const insightVisible = await page.locator('text=Cancelamentos acima da meta').first().isVisible().catch(() => false);
    if (!insightVisible) {
      throw new Error('Insight esperado nao apareceu apos busca estrategica.');
    }

    await clickWithRetry(page, () => page.getByRole('button', { name: /Ver evidências|Ver evidencias/i }));
    await page.waitForTimeout(300);

    const evidenceVisible = await page.locator('text=Cancelamentos acima da meta mensal.').first().isVisible().catch(() => false);
    if (!evidenceVisible) {
      throw new Error('Evidencia esperada nao apareceu apos expandir insight.');
    }

    const pageIndicatorVisible = await page.locator('text=/Página|Pagina 1 de 2/i').first().isVisible().catch(() => false);
    if (!pageIndicatorVisible) {
      throw new Error('Indicador de paginacao de evidencias nao apareceu (esperado: Pagina/Página 1 de 2).');
    }

    await clickWithRetry(page, () => page.getByRole('button', { name: /^Próxima$|^Proxima$/i }));
    await page.waitForTimeout(300);

    const secondPageEvidenceVisible = await page.locator('text=/Evidência|Evidencia smoke 6/i').first().isVisible().catch(() => false);
    if (!secondPageEvidenceVisible) {
      throw new Error('Evidencia esperada da segunda pagina nao apareceu.');
    }

    await clickWithRetry(page, () => page.getByRole('button', { name: /Atualizar snapshots/i }));
    await page.waitForTimeout(300);

    const uniqueGoalName = `Meta Smoke ${Date.now()}`;
    await page.getByPlaceholder('Nome da meta').fill(uniqueGoalName);
    await clickWithRetry(page, () => page.getByRole('button', { name: /^Criar meta$/i }));
    await page.waitForTimeout(500);

    const newGoalVisible = await page.locator(`text=${uniqueGoalName}`).first().isVisible().catch(() => false);
    if (!newGoalVisible) {
      throw new Error('Meta criada nao apareceu na lista apos submit.');
    }

    page.once('dialog', (dialog) => {
      dialog.accept('42').catch(() => {});
    });
    await clickWithRetry(
      page,
      () => page.locator('li').filter({ hasText: uniqueGoalName }).getByRole('button', { name: /Atualizar valor atual/i }),
    );
    await page.waitForTimeout(500);

    const updatedValueVisible = await page
      .locator('li')
      .filter({ hasText: uniqueGoalName })
      .locator('text=atual: 42.00')
      .first()
      .isVisible()
      .catch(() => false);

    if (!updatedValueVisible) {
      throw new Error('Valor atual da meta nao foi atualizado para 42.00 na UI.');
    }

    const screenshotPath = path.join(outDir, 'tenant-intelligence-smoke.png');
    await page.screenshot({ path: screenshotPath, fullPage: true });

    report.push('- Route /tenant-intelligence loaded successfully');
    report.push('- Operational state card rendered and refresh validated');
    report.push('- Operational trend indicator validated (alta +12)');
    report.push('- Operational trend tooltip validated (formula delta score_atual-score_anterior)');
    report.push('- Operational score tooltip validated (same formula delta score_atual-score_anterior)');
    report.push('- Strategic search executed and insight rendered');
    report.push('- Insight evidence panel validated');
    report.push('- Insight evidence pagination validated');
    report.push('- Goal creation flow validated');
    report.push('- Goal current value update flow validated');
    report.push(`- Screenshot: ${screenshotPath}`);
    report.push('- Result: SUCCESS');
    writeReport(report);

    console.log('Tenant Intelligence smoke succeeded.');
    console.log(`Report: ${reportPath}`);
    console.log(`Artifacts: ${outDir}`);
  } catch (error) {
    try {
      const failShot = path.join(outDir, 'tenant-intelligence-smoke-failed.png');
      await page.screenshot({ path: failShot, fullPage: true });
    } catch {
      // no-op
    }
    const fail = [
      '# Tenant Intelligence E2E Smoke Report',
      `- Date: ${new Date().toISOString()}`,
      '- Result: FAILED',
      `- Error: ${error.message}`,
    ];
    writeReport(fail);
    console.error('Tenant Intelligence smoke failed:', error.message);
    console.error(`Report: ${reportPath}`);
    process.exitCode = 1;
  } finally {
    await context.close();
    await browser.close();
  }
})();
