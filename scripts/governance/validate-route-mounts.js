#!/usr/bin/env node
'use strict';

/**
 * validate-route-mounts.js — gate estático: todo router declarado é montado.
 *
 * Um router instanciado e ausente de `api/app/routeRegistry.js` NÃO é montado e
 * responde 404 silenciosamente (defeito real: MCP — 9 rotas; Product Metrics —
 * /api/product-metrics/summary). Este gate roda antes do runtime e falha com a
 * lista exata.
 *
 * Saída: reports/route-mount-report.json (+ cópia canônica em governance/).
 */

const fs = require('fs');
const path = require('path');

const { compareRouteMounts } = require('./lib/route-mount-consistency');

const ROOT = path.resolve(__dirname, '..', '..');
const REGISTER_ROUTES = path.join(ROOT, 'api', 'app', 'registerRoutes.js');
const ROUTE_REGISTRY = path.join(ROOT, 'api', 'app', 'routeRegistry.js');

function read(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch (_) {
    return null;
  }
}

function main() {
  const registerRoutesSource = read(REGISTER_ROUTES);
  const routeRegistrySource = read(ROUTE_REGISTRY);

  if (registerRoutesSource == null || routeRegistrySource == null) {
    console.error('[route-mounts] FALHA: api/app/registerRoutes.js ou api/app/routeRegistry.js ausente');
    process.exit(1);
  }

  const result = compareRouteMounts({ registerRoutesSource, routeRegistrySource });
  const lineage = read(path.join(ROOT, 'governance', '.current-run.json'));
  let runId = null;
  let sourceFingerprint = null;
  try {
    const ctx = JSON.parse(lineage || '{}');
    runId = ctx.runId || null;
    sourceFingerprint = ctx.sourceFingerprint || null;
  } catch (_) { /* lineage é best-effort aqui */ }

  const report = {
    status: result.ok ? 'PASS' : 'FAIL',
    decision: result.ok ? 'ALL_DECLARED_ROUTERS_MOUNTED' : (result.code || 'ROUTE_MOUNT_INCONSISTENT'),
    generatedAt: new Date().toISOString(),
    artifactType: 'route-mount-report',
    artifactVersion: '1.0.0',
    runId,
    sourceFingerprint,
    declaredCount: result.declared.length,
    mountedCount: result.mounted.length,
    missing: result.missing,
    unknown: result.unknown,
    detail: result.detail,
  };

  fs.mkdirSync(path.join(ROOT, 'reports'), { recursive: true });
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  // SOMENTE reports/ (ver nota em verify-release-artifact-identity.js).
  fs.writeFileSync(path.join(ROOT, 'reports', 'route-mount-report.json'), serialized);

  console.log(`[route-mounts] status=${report.status} declarados=${report.declaredCount} montados=${report.mountedCount}`);
  if (!result.ok) {
    console.log(`[route-mounts] ${result.code}: ${result.detail}`);
  }
  process.exit(result.ok ? 0 : 1);
}

main();
