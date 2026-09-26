#!/usr/bin/env node
'use strict';

/**
 * api-surface-wave.js — runner da API Surface Wave (Security/Platform Wave).
 *
 * Executa probes HTTP REAIS contra um servidor vivo e alimenta o motor puro
 * `qa/coverage/apiSurfaceWave.js`, produzindo
 * `reports/api-surface-report.json` — fonte de execução técnica consumida
 * pelo coverage gate para itens `api:` sem domínio/jornada ligada
 * (scripts/governance/validate-coverage-gate.js).
 *
 * Probes por item (política segura, ver qa/coverage/apiSurfaceWave.js):
 *   - P1 anonymous:  sem credencial (todos os métodos quando authRequired;
 *                    apenas GET/HEAD quando a rota é pública — probes
 *                    mutáveis autenticados poderiam causar efeitos reais).
 *   - P2 production: token de papel operacional (admin via fluxo RPA) —
 *                    GET/HEAD em qualquer rota e métodos mutáveis em rotas
 *                    SUPPORT/DEVELOPMENT com auth declarada (requireClassification
 *                    rejeita o papel PRODUCTION antes do handler; 401/403
 *                    esperados — qualquer outra resposta é violação de
 *                    visibilidade). Nunca em rota PRODUCTION mutável (o papel
 *                    é autorizado e executaria efeito real).
 *   - P3 superadmin: token super_admin (apenas GET/HEAD em rotas
 *                    SUPPORT/DEVELOPMENT — em método mutável executaria a
 *                    mutação; developmentReachable fica NOT_APPLICABLE por
 *                    design nesses itens).
 *
 * Uso:
 *   node scripts/governance/api-surface-wave.js
 *   API_SURFACE_BASE_URL=http://localhost:3001 node scripts/governance/api-surface-wave.js
 *
 * Credenciais (defaults = credenciais QA locais documentadas em AGENTS.md):
 *   API_SURFACE_ADMIN_USER / API_SURFACE_ADMIN_PASSWORD
 *
 * O relatório registra apenas status HTTP e assertivas — nunca tokens,
 * credenciais ou corpos de resposta.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const { evaluateApiSurface, probePolicy } = require('../../qa/coverage/apiSurfaceWave');

const ROOT_DIR = path.join(__dirname, '..', '..');
const INVENTORY_PATH = path.join(ROOT_DIR, 'config', 'system-inventory.json');
const EXEMPTIONS_PATH = path.join(ROOT_DIR, 'config', 'api-surface-exemptions.json');
const REPORT_PATH = path.join(ROOT_DIR, 'reports', 'api-surface-report.json');

const BASE_URL = (process.env.API_SURFACE_BASE_URL || 'http://localhost:3001').replace(/\/+$/, '');
const ADMIN_USER = process.env.API_SURFACE_ADMIN_USER || 'systemadmin';
const ADMIN_PASSWORD = process.env.API_SURFACE_ADMIN_PASSWORD || 'Admin123!';
const PROBE_TIMEOUT_MS = Number(process.env.API_SURFACE_PROBE_TIMEOUT_MS || 8000);
const CONCURRENCY = Number(process.env.API_SURFACE_CONCURRENCY || 8);

/**
 * Substitui parâmetros de rota (:id, *) por valor de probe inócuo.
 *
 * Grupos de alternância do Express (`(a|b)`) também precisam virar caminho
 * concreto. Mantidos literais, o caminho NUNCA casa com a rota: o Express cai no
 * fallback 404 e o item é reportado como "rota não registrada" + "endpoint
 * protegido respondeu sem credencial" — um falso alarme de segurança.
 * Medido em 2026-09-25 com `POST /mcp/connections/:id/(enable|disable)`: sondando
 * o literal vinha 404 `{error:not_found}`, enquanto `/enable` e `/disable` reais
 * respondem 403 `classification_forbidden` (rota registrada e com enforcement).
 * Usa a PRIMEIRA alternativa: as demais compartilham o mesmo handler e os mesmos
 * middlewares, então presença e enforcement são provados igualmente.
 */
function concretePath(routePath) {
  return String(routePath)
    .replace(/:[^/]+/g, 'probe')
    .replace(/\(([^)]+)\)/g, (_, group) => {
      const first = String(group).split('|').map((part) => part.trim()).filter(Boolean)[0];
      return first || '';
    })
    .replace(/\*/g, 'probe');
}

async function probeOnce(method, routePath, headers) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE_URL}${routePath}`, {
      method,
      headers: { ...headers },
      body: method === 'GET' || method === 'HEAD' ? undefined : '{}',
      redirect: 'manual',
      signal: controller.signal,
    });
    let notFoundFallback = false;
    if (res.status === 404) {
      // O fallback terminal (registerRoutes.js) marca x-api-route-fallback:1.
      // 404 de ENTIDADE respondido por handler não carrega o marcador —
      // mesmo quando o corpo é {error:'not_found'} (ex.: /mkt/l/:code com
      // código inexistente). Sem o header, nunca assumimos fallback.
      notFoundFallback = res.headers.get('x-api-route-fallback') === '1';
    } else {
      // descarta o corpo (não registramos payloads em evidência)
      await res.arrayBuffer().catch(() => {});
    }
    return { status: res.status, notFoundFallback };
  } catch {
    return { error: true };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Probe com retry único (padrão) para blips de rede: probeOnce retorna
 * { error: true } em falha de transporte (ECONNREFUSED, timeout abortado,
 * contenção da máquina). Retentar uma vez com backoff curto recupera o
 * transitório; erro persistente continua { error: true } → 'network-error'.
 * Respostas HTTP (qualquer status) nunca são retentadas — não é erro de rede.
 */
async function probeWithRetry(method, routePath, headers, options = {}) {
  const probeFn = options.probeFn || probeOnce;
  const retries = Number.isFinite(options.retries) ? options.retries : 1;
  const delayMs = Number.isFinite(options.delayMs) ? options.delayMs : 250;

  let result = await probeFn(method, routePath, headers);
  for (let attempt = 0; result && result.error && attempt < retries; attempt += 1) {
    if (delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    result = await probeFn(method, routePath, headers);
  }
  return result;
}

async function loginSuperAdmin() {
  try {
    const res = await fetch(`${BASE_URL}/auth/login?tenantId=system`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: ADMIN_USER, password: ADMIN_PASSWORD }),
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    if (res.status !== 200) return null;
    const body = await res.json();
    return body && typeof body.token === 'string' ? body.token : null;
  } catch {
    return null;
  }
}

/**
 * Token de papel operacional (PRODUCTION): fluxo RPA cria/reutiliza o usuário
 * `rpa_api-surface-wave` com role admin — classificação PRODUCTION por design.
 * Desde 2026-08-03 GET /auth/rpa/token exige sessão SUPPORT+ (o token RPA é
 * segredo de serviço): o runner autentica como super_admin e apresenta o
 * Bearer na leitura do token RPA.
 */
async function loginProductionRole(bearerToken) {
  try {
    if (!bearerToken) return null;
    const tokenRes = await fetch(`${BASE_URL}/auth/rpa/token`, {
      headers: { authorization: `Bearer ${bearerToken}` },
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    if (tokenRes.status !== 200) return null;
    const { token: rpaToken } = await tokenRes.json();
    const loginRes = await fetch(`${BASE_URL}/auth/rpa/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: rpaToken, tenantId: 'api-surface-wave' }),
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    if (loginRes.status !== 200) return null;
    const body = await loginRes.json();
    return body && typeof body.token === 'string' ? body.token : null;
  } catch {
    return null;
  }
}

async function main() {
  const inventory = JSON.parse(fs.readFileSync(INVENTORY_PATH, 'utf8'));
  let exemptions = {};
  try {
    exemptions = JSON.parse(fs.readFileSync(EXEMPTIONS_PATH, 'utf8'));
  } catch {
    exemptions = {};
  }
  const apiItems = (inventory.items || []).filter((item) => item && item.kind === 'api');
  console.log(`[api-surface-wave] alvo: ${BASE_URL}`);
  console.log(`[api-surface-wave] ${apiItems.length} rotas api: no inventário`);

  const devToken = await loginSuperAdmin();
  const prodToken = await loginProductionRole(devToken);
  console.log(`[api-surface-wave] tokens: development=${devToken ? 'ok' : 'indisponível'} `
    + `production=${prodToken ? 'ok' : 'indisponível'}`);
  if (!devToken) {
    console.log('[api-surface-wave] AVISO: sem token super_admin — P3 pulado (itens privilegiados ficam no máximo VISITED)');
  }
  if (!prodToken) {
    console.log('[api-surface-wave] AVISO: sem token de papel operacional — P2 pulado (itens privilegiados ficam no máximo VISITED)');
  }

  const probesByItemId = new Map();
  let done = 0;

  async function probeItem(item) {
    const method = String(item.method || 'GET').toUpperCase();
    const url = concretePath(item.path);
    const policy = probePolicy(item);
    const probes = {};

    if (policy.p1) {
      probes.p1 = await probeWithRetry(method, url, { 'Content-Type': 'application/json' });
    }
    if (policy.p2 && prodToken) {
      probes.p2 = await probeWithRetry(method, url, {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${prodToken}`,
      });
    }
    if (policy.p3 && devToken) {
      // P3 só roda em método seguro (GET/HEAD) — ver probePolicy. Rotas de
      // governança global exigem o tenant system (enforceSystemTenant);
      // o probe é read-only, então o tenant system é o correto aqui.
      probes.p3 = await probeWithRetry(method, url, {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${devToken}`,
        'X-Tenant-Id': 'system',
      });
    }

    probesByItemId.set(item.id, probes);
    done += 1;
    if (done % 100 === 0) console.log(`[api-surface-wave] progresso: ${done}/${apiItems.length}`);
  }

  // pool de concorrência simples
  const queue = [...apiItems];
  const workers = Array.from({ length: Math.max(1, CONCURRENCY) }, async () => {
    while (queue.length > 0) {
      const item = queue.shift();
      if (item) await probeItem(item);
    }
  });
  await Promise.all(workers);

  const { perItem, totals, exemptionsApplied } = evaluateApiSurface(inventory.items, probesByItemId, exemptions);

  let commit = null;
  try {
    commit = execSync('git rev-parse HEAD', { cwd: ROOT_DIR, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    commit = null;
  }

  const report = {
    generatedAt: new Date().toISOString(),
    commit,
    baseUrl: BASE_URL,
    tokens: { development: Boolean(devToken), production: Boolean(prodToken) },
    totals,
    status: (totals.byState?.FAILED || 0) === 0 && (totals.byState?.BLOCKED || 0) === 0 ? 'PASS' : 'FAIL',
    exemptions: exemptionsApplied,
    perItem,
  };

  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);

  const byState = totals.byState || {};
  console.log(`[api-surface-wave] estados: VALIDATED=${byState.VALIDATED || 0} VISITED=${byState.VISITED || 0} `
    + `FAILED=${byState.FAILED || 0} BLOCKED=${byState.BLOCKED || 0}`);
  console.log(`[api-surface-wave] relatório: ${path.relative(ROOT_DIR, REPORT_PATH)}`);
  if ((byState.FAILED || 0) > 0) {
    console.log('[api-surface-wave] ATENÇÃO: há itens FAILED — inspecione o relatório (possível falha de segurança ou drift de inventário)');
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[api-surface-wave] falha fatal:', err && err.message ? err.message : err);
    process.exit(1);
  });
}

module.exports = { concretePath, probeWithRetry };
