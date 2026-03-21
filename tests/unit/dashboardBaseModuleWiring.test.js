'use strict';

const fs = require('fs');
const path = require('path');

describe('dashboard-base module wiring', () => {
  test('module canonico reexporta os componentes de dashboard', () => {
    const modulePath = path.join(process.cwd(), 'frontend', 'src', 'modules', 'dashboard-base', 'index.js');
    const source = fs.readFileSync(modulePath, 'utf8');

    expect(source).toMatch(/DashboardFeatureCard/);
    expect(source).toMatch(/DashboardFeatureGrid/);
    expect(source).toMatch(/DashboardKpiCard/);
    expect(source).toMatch(/DashboardSection/);
  });

  test('dashboards de pilares importam pelo path canonico', () => {
    const pagesDir = path.join(process.cwd(), 'frontend', 'src', 'pages');
    const pages = ['ChatHumanoDashboardPage.jsx', 'QueuePhysicalDashboardPage.jsx'];

    for (const page of pages) {
      const source = fs.readFileSync(path.join(pagesDir, page), 'utf8');
      expect(source).toMatch(/modules\/dashboard-base/);
      expect(source).not.toMatch(/components\/DashboardBase/);
    }
  });

  test('DataGrid legado nao existe mais no frontend ativo', () => {
    const dataGridPath = path.join(process.cwd(), 'frontend', 'src', 'components', 'DataGrid.jsx');
    expect(fs.existsSync(dataGridPath)).toBe(false);
  });
});
