'use strict';

/**
 * Prova real no browser da correção do atributo `className` duplicado na
 * página /rbac.
 *
 * Defeito original (encontrado pelo próprio build do Vite):
 *
 *   <select
 *     className="support-form-select"
 *     value={filterRole}
 *     onChange={...}
 *     className="min-w-[160px]"   <-- segundo atributo vence
 *   >
 *
 * O JSX mantém o ÚLTIMO `className`: a classe `support-form-select` era
 * descartada em silêncio, e o select de filtro de papel renderizava sem
 * padding, sem border-radius e sem o background elevado definidos em
 * `frontend/src/index.css`. Não havia erro em runtime — apenas estilo perdido.
 *
 * A prova abaixo lê o estilo COMPUTADO no browser real: não basta a classe
 * estar no HTML, ela tem de estar aplicada.
 */

const path = require('path');

const ROOT = path.join(__dirname, '..');

function loadChromium() {
  const attempts = [
    'playwright',
    'playwright-core',
    path.join(ROOT, 'frontend-e2e', 'node_modules', 'playwright'),
    path.join(ROOT, 'frontend-e2e', 'node_modules', 'playwright-core'),
  ];
  const errors = [];
  for (const attempt of attempts) {
    try {
      // eslint-disable-next-line global-require, import/no-dynamic-require
      return require(attempt).chromium;
    } catch (error) {
      errors.push(`${attempt}: ${error.message}`);
    }
  }
  throw new Error(`playwright_indisponivel: ${errors.join(' | ')}`);
}

const { loginWithTenantSelection } = require('../tests/helpers/playwrightAuth');

const BASE_URL = process.env.ASKAI_VERIFY_BASE || 'http://127.0.0.1:5173';
const USERNAME = process.env.ASKAI_VERIFY_USER || 'systemadmin';
const PASSWORD = process.env.ASKAI_VERIFY_PASSWORD || 'Admin123!';
const TENANT_ID = process.env.TEST_TENANT_ID || 'system';

async function main() {
  const chromium = loadChromium();
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });

  try {
    await loginWithTenantSelection(page, {
      targetUrl: `${BASE_URL}/rbac`,
      username: USERNAME,
      password: PASSWORD,
      tenantId: TENANT_ID,
    });

    await page.waitForSelector('select', { timeout: 20000 });

    // O select de filtro de papel é o que contém a opção "Todos os roles".
    const info = await page.evaluate(() => {
      const options = Array.from(document.querySelectorAll('option'));
      const marker = options.find((option) => /todos os roles/i.test(option.textContent || ''));
      const select = marker?.closest('select');
      if (!select) return { found: false };
      const style = window.getComputedStyle(select);
      return {
        found: true,
        classes: Array.from(select.classList),
        paddingLeft: style.paddingLeft,
        borderRadius: style.borderTopLeftRadius,
        minWidth: style.minWidth,
        cursor: style.cursor,
        width: style.width,
      };
    });

    const checks = [];
    const check = (name, ok, detail) => checks.push({ name, ok, detail });

    check('select_de_filtro_encontrado', info.found === true, 'select com a opção "Todos os roles"');
    if (info.found) {
      check(
        'classe_support_form_select_presente',
        info.classes.includes('support-form-select'),
        `classes=[${info.classes.join(', ')}]`,
      );
      check('classe_min_w_160_presente', info.classes.includes('min-w-[160px]'), `classes=[${info.classes.join(', ')}]`);
      // Estilo EFETIVO: prova que a classe não só existe como é aplicada.
      check('padding_da_classe_aplicado', info.paddingLeft === '8px', `padding-left=${info.paddingLeft} (esperado 8px)`);
      check('border_radius_da_classe_aplicado', info.borderRadius !== '0px', `border-radius=${info.borderRadius}`);
      check('min_width_do_utilitario_aplicado', info.minWidth === '160px', `min-width=${info.minWidth} (esperado 160px)`);
    }

    const failed = checks.filter((entry) => !entry.ok);
    const output = {
      route: '/rbac',
      url: page.url(),
      checks,
      consoleErrors,
      verdict: failed.length === 0 ? 'RBAC_FILTER_SELECT_STYLED' : 'RBAC_FILTER_SELECT_UNSTYLED',
    };
    console.log(JSON.stringify(output, null, 2));
    return failed.length === 0 ? 0 : 1;
  } finally {
    await browser.close();
  }
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.log(JSON.stringify({ verdict: 'ERROR', error: error.message }, null, 2));
    process.exit(2);
  });
