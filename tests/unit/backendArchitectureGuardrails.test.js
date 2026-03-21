'use strict';

const fs = require('fs');
const path = require('path');

function walk(dir) {
  let out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const target = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out = out.concat(walk(target));
      continue;
    }
    if (target.endsWith('.js')) {
      out.push(target);
    }
  }
  return out;
}

describe('backend architecture guardrails', () => {
  const serverPath = path.join(__dirname, '..', '..', 'api', 'server.js');
  const registerRoutesPath = path.join(__dirname, '..', '..', 'api', 'app', 'registerRoutes.js');
  const coreContextPath = path.join(__dirname, '..', '..', 'api', 'composition', 'core', 'buildCoreRoutingContext.js');
  const platformContextPath = path.join(__dirname, '..', '..', 'api', 'composition', 'platform', 'buildPlatformRoutingContext.js');
  const extendedContextPath = path.join(__dirname, '..', '..', 'api', 'composition', 'extended', 'buildExtendedRoutingContext.js');

  test('server.js stays as a thin entrypoint', () => {
    const source = fs.readFileSync(serverPath, 'utf8');
    const lineCount = source.trim().split('\n').length;

    expect(lineCount).toBeLessThan(260);
    expect(source).toContain("require('./runtime/startServerRuntime')");
    expect(source).toContain("require('./runtime/flowRuntimeState')");
    expect(source).not.toContain('async function initializeSystemAdmin');
    expect(source).not.toContain('async function validateProviderTokenDirect');
  });

  test('registerRoutes.js stays declarative and uses route registry', () => {
    const source = fs.readFileSync(registerRoutesPath, 'utf8');

    expect(source).toContain("require('./routeRegistry')");
    expect(source).toContain('createRouteRegistry({');
    expect((source.match(/buildDeps: \(req, res\) =>/g) || []).length).toBe(0);
  });

  test('routing context builders stay decomposed into slices', () => {
    const coreSource = fs.readFileSync(coreContextPath, 'utf8');
    const platformSource = fs.readFileSync(platformContextPath, 'utf8');
    const extendedSource = fs.readFileSync(extendedContextPath, 'utf8');

    expect(coreSource).toContain("require('./buildCoreCommonDeps')");
    expect(coreSource).toContain("require('./buildCoreAdminDeps')");
    expect(platformSource).toContain("require('./buildPlatformCommonDeps')");
    expect(platformSource).toContain("require('./buildPlatformContentDeps')");
    expect(extendedSource).toContain("require('./buildExtendedCommonDeps')");
    expect(extendedSource).toContain("require('./buildExtendedChannelDeps')");

    expect(coreSource.trim().split('\n').length).toBeLessThan(90);
    expect(platformSource.trim().split('\n').length).toBeLessThan(90);
    expect(extendedSource.trim().split('\n').length).toBeLessThan(80);
  });

  test('production code outside api/serverHandlers no longer imports serverHandlers', () => {
    const apiRoot = path.join(__dirname, '..', '..', 'api');
    const files = walk(apiRoot).filter((file) => !file.includes(`${path.sep}serverHandlers${path.sep}`));
    const offenders = files.filter((file) => fs.readFileSync(file, 'utf8').includes('serverHandlers'));

    expect(offenders).toEqual([]);
  });

  test('api/serverHandlers legacy directory no longer exists', () => {
    const serverHandlersPath = path.join(__dirname, '..', '..', 'api', 'serverHandlers');
    expect(fs.existsSync(serverHandlersPath)).toBe(false);
  });
});
