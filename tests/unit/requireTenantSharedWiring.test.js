'use strict';

const fs = require('fs');
const path = require('path');

describe('requireTenant shared helper wiring', () => {
  test('helper compartilhado existe e exporta requireTenant', () => {
    const helperPath = path.join(process.cwd(), 'api', 'composition', 'shared', 'requireTenant.js');
    const source = fs.readFileSync(helperPath, 'utf8');

    expect(source).toMatch(/function requireTenant/);
    expect(source).toMatch(/module\.exports/);
    expect(source).toMatch(/requireTenant/);
  });

  test('nenhum composition root define requireTenant localmente', () => {
    const compositionDir = path.join(process.cwd(), 'api', 'composition');
    const roots = [
      'pbx/index.js',
      'vertical/index.js',
      'operations-dashboard/index.js',
      'intelligence/index.js',
      'market-intelligence/index.js',
      'access-control/index.js',
      'analytics/index.js',
      'bulk-campaigns/index.js',
      'quick-replies/index.js',
    ];

    for (const root of roots) {
      const source = fs.readFileSync(path.join(compositionDir, root), 'utf8');
      expect(source).not.toMatch(/function requireTenant/);
      expect(source).toMatch(/require.*shared.*requireTenant/);
    }
  });

  test('composition core importa requireTenant do shared', () => {
    const corePath = path.join(process.cwd(), 'api', 'composition', 'core', 'buildCoreRoutingContext.js');
    const source = fs.readFileSync(corePath, 'utf8');

    expect(source).not.toMatch(/function requireTenant/);
    expect(source).toMatch(/require.*shared.*requireTenant/);
  });
});
