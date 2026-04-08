'use strict';

const DEFAULT_INTENT_ROUTES = {
  login: '/login',
  dashboard: '/',
  support: '/support',
  maintenance: '/maintenance',
  fitness_students: '/fitness/students',
  fitness_memberships: '/fitness/memberships',
  fitness_attendance: '/fitness/attendance',
  beauty_campaigns: '/beauty/campaigns',
  beauty_leads: '/beauty/leads',
  beauty_customers: '/beauty/customers',
  beauty_schedule: '/beauty/schedule',
  beauty_services: '/beauty/services',
  beauty_payments: '/beauty/payments',
  food_orders: '/orders',
  food_kitchen: '/kitchen',
  food_dispatch: '/dispatch',
  solutions: '/solutions',
  node_marketplace: '/node-marketplace',
};

const SEMANTIC_TARGETS = {
  primary_action: [
    '[data-testid="primary-action"]',
    'button[type="submit"]',
    'button:has-text("Salvar")',
    'button:has-text("Confirmar")',
    'button:has-text("Criar")',
    'button:has-text("Enviar")',
    'button',
  ],
  refresh_button: [
    '[data-testid="refresh-button"]',
    'button:has-text("Atualizar")',
    'button:has-text("Recarregar")',
    'button[aria-label*="Atualizar" i]',
  ],
  search_button: [
    '[data-testid="search-button"]',
    'button:has-text("Buscar")',
    'button:has-text("Pesquisar")',
    'button[aria-label*="Buscar" i]',
    'button[type="submit"]',
  ],
  create_campaign: [
    '[data-testid="create-campaign"]',
    'button:has-text("Criar campanha")',
    'button:has-text("Nova campanha")',
    'button:has-text("Criar")',
  ],
  create_lead: [
    '[data-testid="create-lead"]',
    'button:has-text("Criar lead")',
    'button:has-text("Novo lead")',
    'button:has-text("Criar")',
  ],
  search_input: [
    '[data-testid="search-input"]',
    'input[type="search"]',
    'input[placeholder*="Buscar" i]',
    'input[aria-label*="Buscar" i]',
    'form[role="search"] input',
    'input',
  ],
  first_input: [
    '[data-testid="primary-input"]',
    'input[placeholder*="Nome" i]',
    'input[aria-label*="Nome" i]',
    'input',
  ],
  email_input: [
    '[data-testid="email-input"]',
    'input[type="email"]',
    'input[name*="email" i]',
    'input[placeholder*="email" i]',
  ],
  password_input: [
    '[data-testid="password-input"]',
    'input[type="password"]',
    'input[name*="password" i]',
    'input[placeholder*="senha" i]',
  ],
  status_filter: [
    '[data-testid="status-filter"]',
    'select[name*="status" i]',
    'select[aria-label*="Status" i]',
    'select',
  ],
};

function normalizeBaseUrl(baseUrl) {
  return String(baseUrl || process.env.TEST_FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '');
}

function asArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value.filter(Boolean) : [value].filter(Boolean);
}

function buildSelectorList(...parts) {
  const values = [];
  for (const part of parts) {
    for (const item of asArray(part)) {
      const normalized = String(item || '').trim();
      if (!normalized || values.includes(normalized)) continue;
      values.push(normalized);
    }
  }
  return values;
}

function resolveSemanticSelectors(step = {}) {
  const semanticSelectors = buildSelectorList(
    step.semanticSelectors,
    SEMANTIC_TARGETS[step.semanticAction],
    SEMANTIC_TARGETS[step.field],
    SEMANTIC_TARGETS[step.target],
    step.selector,
  );

  return semanticSelectors;
}

function resolveIntentUrl(step = {}, context = {}) {
  const route = step.intent && DEFAULT_INTENT_ROUTES[step.intent]
    ? DEFAULT_INTENT_ROUTES[step.intent]
    : null;
  if (!route) return step.url || step.value || null;
  if (/^https?:\/\//.test(route)) return route;
  return `${normalizeBaseUrl(context.baseUrl)}${route}`;
}

function resolveSemanticStep(step = {}, context = {}) {
  if (!step || typeof step !== 'object') return step;

  const resolved = {
    ...step,
    metadata: {
      ...(step.metadata || {}),
    },
  };

  if (resolved.type === 'navigate' && !resolved.url && !resolved.value && resolved.intent) {
    const intentUrl = resolveIntentUrl(resolved, context);
    if (intentUrl) {
      resolved.url = intentUrl;
      resolved.metadata.semanticIntent = resolved.intent;
    }
  }

  const selectors = resolveSemanticSelectors(resolved);
  if (selectors.length > 0) {
    resolved.selector = selectors.join(', ');
    resolved.metadata.semanticSelectors = selectors;
    resolved.metadata.semanticResolved = true;
  }

  return resolved;
}

async function firstWorkingLocator(page, selectors) {
  let lastError = null;
  for (const selector of selectors) {
    try {
      const locator = page.locator(selector).first();
      const count = await locator.count();
      if (count < 1) continue;
      await locator.waitFor({ state: 'visible', timeout: 5000 });
      return { selector, locator };
    } catch (error) {
      lastError = error;
    }
  }

  if (lastError) throw lastError;
  throw new Error(`Nenhum alvo semântico encontrado: ${selectors.join(', ')}`);
}

function createSemanticPageDriver(page) {
  async function click(actionName, extraSelectors = []) {
    const selectors = buildSelectorList(SEMANTIC_TARGETS[actionName], extraSelectors);
    const { locator } = await firstWorkingLocator(page, selectors);
    await locator.click();
    return selectors;
  }

  async function fill(actionName, value, extraSelectors = []) {
    const selectors = buildSelectorList(SEMANTIC_TARGETS[actionName], extraSelectors);
    const { locator } = await firstWorkingLocator(page, selectors);
    await locator.fill(String(value == null ? '' : value));
    return selectors;
  }

  async function select(actionName, value, extraSelectors = []) {
    const selectors = buildSelectorList(SEMANTIC_TARGETS[actionName], extraSelectors);
    const { locator } = await firstWorkingLocator(page, selectors);
    await locator.selectOption(String(value));
    return selectors;
  }

  async function gotoIntent(intent, options = {}) {
    const targetUrl = resolveIntentUrl({ intent }, { baseUrl: options.baseUrl });
    if (!targetUrl) {
      throw new Error(`Intent sem rota resolvida: ${intent}`);
    }
    await page.goto(targetUrl, {
      waitUntil: options.waitUntil || 'domcontentloaded',
      timeout: options.timeout || 30000,
    });
    return targetUrl;
  }

  return {
    click,
    fill,
    select,
    gotoIntent,
  };
}

module.exports = {
  DEFAULT_INTENT_ROUTES,
  SEMANTIC_TARGETS,
  buildSelectorList,
  resolveIntentUrl,
  resolveSemanticSelectors,
  resolveSemanticStep,
  createSemanticPageDriver,
};