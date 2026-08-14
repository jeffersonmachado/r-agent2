'use strict';

async function firstVisible(page, selectors, timeout = 5000) {
  for (const selector of selectors) {
    try {
      const locator = page.locator(selector).first();
      if (await locator.isVisible({ timeout })) {
        return locator;
      }
    } catch (_) {
      // tenta o proximo seletor
    }
  }
  return null;
}

async function fillFirst(page, selectors, value) {
  const locator = await firstVisible(page, selectors);
  if (!locator) return false;
  await locator.fill(value);
  return true;
}

async function clickFirst(page, selectors) {
  const locator = await firstVisible(page, selectors);
  if (!locator) return false;
  await locator.click();
  return true;
}

async function getTenantModalState(page) {
  try {
    return await page.evaluate(() => {
      const headings = Array.from(document.querySelectorAll('h1, h2, h3'));
      const heading = headings.find((node) => {
        const text = String(node.textContent || '').trim().toLowerCase();
        return text.includes('selecione o tenant') || text.includes('selecione o tenant'.toLowerCase());
      });

      if (!heading) {
        return { visible: false, buttons: [], filterFound: false, selected: null, accessEnabled: false };
      }

      const header = heading.closest('div');
      const modalRoot = header && header.parentElement ? header.parentElement : heading.parentElement;
      if (!modalRoot) {
        return { visible: false, buttons: [], filterFound: false, selected: null, accessEnabled: false };
      }

      const buttons = Array.from(modalRoot.querySelectorAll('button')).map((button) => ({
        text: String(button.innerText || button.textContent || '').trim(),
        disabled: Boolean(button.disabled),
      }));

      const selectedButton = Array.from(modalRoot.querySelectorAll('button')).find((button) => {
        const text = String(button.innerText || button.textContent || '').trim().toLowerCase();
        return text.includes('✓');
      });

      const accessButton = Array.from(modalRoot.querySelectorAll('button')).find((button) => {
        const text = String(button.innerText || button.textContent || '').trim().toLowerCase();
        return text.includes('acessar') || text.includes('access');
      });

      return {
        visible: true,
        filterFound: Boolean(modalRoot.querySelector('input[type="text"]')),
        buttons,
        selected: selectedButton ? String(selectedButton.innerText || selectedButton.textContent || '').trim() : null,
        accessEnabled: accessButton ? !accessButton.disabled : false,
      };
    });
  } catch (_) {
    return { visible: false, buttons: [], filterFound: false, selected: null, accessEnabled: false };
  }
}

async function fillTenantFilter(page, tenantId) {
  return page.evaluate((value) => {
    const headings = Array.from(document.querySelectorAll('h1, h2, h3'));
    const heading = headings.find((node) => {
      const text = String(node.textContent || '').trim().toLowerCase();
      return text.includes('selecione o tenant');
    });
    if (!heading) return false;

    const header = heading.closest('div');
    const modalRoot = header && header.parentElement ? header.parentElement : heading.parentElement;
    const input = modalRoot ? modalRoot.querySelector('input[type="text"]') : null;
    if (!input) return false;

    input.focus();
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }, tenantId).catch(() => false);
}

async function clickTenantOption(page, tenantId, tenantName = '') {
  return page.evaluate(({ id, name }) => {
    const headings = Array.from(document.querySelectorAll('h1, h2, h3'));
    const heading = headings.find((node) => {
      const text = String(node.textContent || '').trim().toLowerCase();
      return text.includes('selecione o tenant');
    });
    if (!heading) return false;

    const header = heading.closest('div');
    const modalRoot = header && header.parentElement ? header.parentElement : heading.parentElement;
    if (!modalRoot) return false;

    const candidates = Array.from(modalRoot.querySelectorAll('button')).filter((button) => {
      const text = String(button.innerText || button.textContent || '').trim().toLowerCase();
      if (!text) return false;
      if (text.includes('acessar') || text.includes('access') || text.includes('cancelar')) return false;
      return text.includes(String(id || '').toLowerCase()) || (name && text.includes(String(name).toLowerCase())) || text.includes('system');
    });

    const target = candidates[0] || null;
    if (!target) return false;

    target.click();
    return true;
  }, { id: tenantId, name: tenantName }).catch(() => false);
}

async function clickTenantAccess(page) {
  return page.evaluate(() => {
    const headings = Array.from(document.querySelectorAll('h1, h2, h3'));
    const heading = headings.find((node) => {
      const text = String(node.textContent || '').trim().toLowerCase();
      return text.includes('selecione o tenant');
    });
    if (!heading) return false;

    const header = heading.closest('div');
    const modalRoot = header && header.parentElement ? header.parentElement : heading.parentElement;
    if (!modalRoot) return false;

    const accessButton = Array.from(modalRoot.querySelectorAll('button')).find((button) => {
      const text = String(button.innerText || button.textContent || '').trim().toLowerCase();
      return (text.includes('acessar') || text.includes('access')) && !button.disabled;
    });

    if (!accessButton) return false;
    accessButton.click();
    return true;
  }).catch(() => false);
}

async function waitForTenantModal(page, timeout = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await tenantModalVisible(page)) {
      return true;
    }
    await page.waitForTimeout(250);
  }
  return false;
}

async function waitForTenantModalToClose(page, timeout = 4000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (!(await tenantModalVisible(page))) {
      return true;
    }
    await page.waitForTimeout(250);
  }
  return false;
}

async function waitForTenantOption(page, { tenantId = 'system', tenantName = '', timeout = 10000 } = {}) {
  const normalizedTenantId = String(tenantId || '').trim().toLowerCase();
  const normalizedTenantName = String(tenantName || '').trim().toLowerCase();

  return page.waitForFunction(({ id, name }) => {
    const headings = Array.from(document.querySelectorAll('h1, h2, h3'));
    const heading = headings.find((node) => {
      const text = String(node.textContent || '').trim().toLowerCase();
      return text.includes('selecione o tenant');
    });
    if (!heading) return false;

    const header = heading.closest('div');
    const modalRoot = header && header.parentElement ? header.parentElement : heading.parentElement;
    if (!modalRoot) return false;

    const loadingText = String(modalRoot.textContent || '').toLowerCase();
    if (loadingText.includes('carregando tenants')) {
      return false;
    }

    return Array.from(modalRoot.querySelectorAll('button')).some((button) => {
      const text = String(button.innerText || button.textContent || '').trim().toLowerCase();
      if (!text) return false;
      if (text.includes('acessar') || text.includes('access') || text.includes('cancelar')) return false;
      return text.includes(id) || (name && text.includes(name));
    });
  }, { id: normalizedTenantId, name: normalizedTenantName }, { timeout }).then(() => true).catch(() => false);
}

async function clickVisibleButtonByText(page, { includes = [], excludes = [] } = {}) {
  const buttons = await page.$$('button');

  for (const button of buttons) {
    try {
      const text = String(await button.textContent() || '').trim();
      if (!text) continue;

      const normalized = text.toLowerCase();
      const matchesIncludes = includes.length === 0 || includes.some((value) => normalized.includes(String(value).toLowerCase()));
      const matchesExcludes = excludes.some((value) => normalized.includes(String(value).toLowerCase()));

      if (!matchesIncludes || matchesExcludes) continue;

      const visible = await button.isVisible().catch(() => false);
      if (!visible) continue;

      await button.click({ timeout: 5000 });
      return true;
    } catch (_) {
      // tenta o proximo botao
    }
  }

  return false;
}

async function waitForLoginSurface(page, timeout = 15000) {
  const start = Date.now();

  while (Date.now() - start < timeout) {
    // Uma página autenticada pode conter vários inputs de texto (busca,
    // filtros, formulários). Só é uma superfície de login quando o campo de
    // usuário aparece junto de um campo de senha visível.
    const passwordField = await firstVisible(page, [
      'input[type="password"]',
      'input[name="password"]',
      '[data-testid="password"]',
    ], 500);

    const usernameField = await firstVisible(page, [
      'input[name="username"]',
      'input[placeholder*="username" i]',
      'input[autocomplete="username"]',
      '[data-testid="username"]',
      'input[type="text"]',
    ], 500);

    if (usernameField && passwordField) {
      return true;
    }

    const headingVisible = await firstVisible(page, [
      'text=/Login de Agente/i',
      'text=/login/i',
    ], 1000);

    if (headingVisible) {
      await page.waitForTimeout(250);
    } else {
      await page.waitForTimeout(500);
    }
  }

  return false;
}

async function tenantModalVisible(page) {
  const modal = await firstVisible(page, [
    'text=/Selecione o Tenant/i',
    'text=/Selecione o tenant/i',
    'text=/Escolha qual tenant deseja acessar/i',
    '[role="dialog"]',
  ], 1500);

  if (modal) return true;

  try {
    return await page.evaluate(() => {
      const text = document.body?.innerText || '';
      return text.includes('Selecione o Tenant') || text.includes('Selecione o tenant') || text.includes('Escolha qual tenant deseja acessar');
    });
  } catch (_) {
    return false;
  }
}

async function selectTenant(page, { tenantId = 'system', tenantName = '' } = {}) {
  const modalOpen = await waitForTenantModal(page);
  if (!modalOpen) return { handled: false, selectedTenant: null };

  await waitForTenantOption(page, { tenantId, tenantName, timeout: 12000 });

  const initialModalState = await getTenantModalState(page);
  if (initialModalState.filterFound) {
    await fillTenantFilter(page, tenantId);
    await waitForTenantOption(page, { tenantId, tenantName, timeout: 4000 });
  }

  let clickedTenant = await clickTenantOption(page, tenantId, tenantName);

  if (!clickedTenant && initialModalState.filterFound) {
    await fillTenantFilter(page, '');
    await waitForTenantOption(page, { tenantId, tenantName, timeout: 4000 });
    clickedTenant = await clickTenantOption(page, tenantId, tenantName);
  }

  if (!clickedTenant) {
    throw new Error(`Modal de tenant detectado, mas opcao do tenant ${tenantId} nao foi encontrada`);
  }

  await page.waitForTimeout(500);

  const modalClosedAutomatically = await waitForTenantModalToClose(page, 4000);
  if (modalClosedAutomatically) {
    return { handled: true, selectedTenant: tenantId };
  }

  await page.waitForFunction(() => {
    const headings = Array.from(document.querySelectorAll('h1, h2, h3'));
    const heading = headings.find((node) => String(node.textContent || '').trim().toLowerCase().includes('selecione o tenant'));
    if (!heading) return false;
    const header = heading.closest('div');
    const modalRoot = header && header.parentElement ? header.parentElement : heading.parentElement;
    if (!modalRoot) return false;
    return Array.from(modalRoot.querySelectorAll('button')).some((button) => {
      const text = String(button.innerText || button.textContent || '').trim().toLowerCase();
      return (text.includes('acessar') || text.includes('access')) && !button.disabled;
    });
  }, undefined, { timeout: 10000 }).catch(() => null);

  const accessClicked = await clickTenantAccess(page);

  if (!accessClicked) {
    const modalStillVisible = await tenantModalVisible(page);
    const effectiveTenantResolved = await page.evaluate((expectedTenantId) => {
      const effectiveTenantId = localStorage.getItem('auth_effective_tenant_id');
      if (effectiveTenantId && String(effectiveTenantId).trim()) {
        return String(effectiveTenantId).trim().toLowerCase() === String(expectedTenantId || '').trim().toLowerCase();
      }

      try {
        const agent = JSON.parse(localStorage.getItem('auth_agent') || '{}');
        const agentTenantId = agent?.tenantId || null;
        return agentTenantId
          ? String(agentTenantId).trim().toLowerCase() === String(expectedTenantId || '').trim().toLowerCase()
          : false;
      } catch (_) {
        return false;
      }
    }, tenantId).catch(() => false);

    if (!modalStillVisible || effectiveTenantResolved) {
      return { handled: true, selectedTenant: tenantId };
    }

    const modalState = await getTenantModalState(page);
    throw new Error(`Modal de tenant detectado, mas botao "Acessar" nao encontrado: ${JSON.stringify(modalState)}`);
  }

  await page.waitForTimeout(800);
  await page.waitForFunction(
    () => !document.body.innerText.includes('Selecione o Tenant') && !document.body.innerText.includes('Escolha qual tenant deseja acessar'),
    undefined,
    { timeout: 10000 }
  ).catch(() => null);

  return { handled: true, selectedTenant: tenantId };
}

async function loginWithTenantSelection(page, {
  targetUrl,
  username,
  password,
  tenantId = 'system',
  tenantName = '',
} = {}) {
  if (!targetUrl) {
    throw new Error('targetUrl e obrigatoria para loginWithTenantSelection');
  }

  await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

  const hasStoredToken = await page.evaluate(() => Boolean(localStorage.getItem('auth_token'))).catch(() => false);
  if (hasStoredToken) {
    const tenantSelection = await selectTenant(page, { tenantId, tenantName });
    if (page.url() !== targetUrl || tenantSelection.handled) {
      await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    }
    return tenantSelection;
  }

  // Sem sessão, sempre usa a rota canônica. Detectar login pela presença de
  // inputs na rota alvo é ambíguo (páginas de configuração também possuem
  // campos de texto/senha) e pode preencher formulários não relacionados.
  const loginUrl = new URL('/login', targetUrl).toString();
  if (page.url() !== loginUrl) {
    await page.goto(loginUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  }
  const loginSurfaceReady = await waitForLoginSurface(page);

  const usernameOk = await fillFirst(page, [
    'input[name="username"]',
    'input[placeholder*="username" i]',
    'input[autocomplete="username"]',
    'input[type="text"]',
    '[data-testid="username"]',
  ], username);

  if (!loginSurfaceReady || !usernameOk) {
    throw new Error('Campo de username nao encontrado');
  }

  const passwordOk = await fillFirst(page, [
    'input[type="password"]',
    'input[name="password"]',
    '[data-testid="password"]',
  ], password);

  if (!passwordOk) {
    throw new Error('Campo de password nao encontrado');
  }

  const loginClicked = await clickFirst(page, [
    'button:has-text("Login")',
    'button:has-text("Sign In")',
    'button[type="submit"]',
  ]);

  if (!loginClicked) {
    throw new Error('Botao de login nao encontrado');
  }

  await page.waitForTimeout(2000);
  const tenantSelection = await selectTenant(page, { tenantId, tenantName });

  await page.waitForTimeout(1500);

  if (page.url().includes('/workspace') || page.url().includes('/login') || tenantSelection.handled) {
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  }

  return tenantSelection;
}

module.exports = {
  loginWithTenantSelection,
  selectTenant,
};
