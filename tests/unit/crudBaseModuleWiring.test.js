'use strict';

const fs = require('fs');
const path = require('path');

describe('crud-base module wiring', () => {
  test('index.js exporta os quatro membros canônicos', () => {
    const indexPath = path.join(process.cwd(), 'frontend', 'src', 'modules', 'crud-base', 'index.js');
    const source = fs.readFileSync(indexPath, 'utf8');

    expect(source).toMatch(/CrudPageBase/);
    expect(source).toMatch(/useCrudFilters/);
    expect(source).toMatch(/useCrudList/);
    expect(source).toMatch(/useCrudForm/);
  });

  test('CrudPageBase.jsx existe e exporta o componente nomeado', () => {
    const filePath = path.join(process.cwd(), 'frontend', 'src', 'modules', 'crud-base', 'CrudPageBase.jsx');
    const source = fs.readFileSync(filePath, 'utf8');

    expect(source).toMatch(/export function CrudPageBase/);
    expect(source).toMatch(/support-page/);
    expect(source).toMatch(/support-header/);
  });

  test('useCrudFilters.js exporta o hook com as três funções esperadas', () => {
    const filePath = path.join(process.cwd(), 'frontend', 'src', 'modules', 'crud-base', 'hooks', 'useCrudFilters.js');
    const source = fs.readFileSync(filePath, 'utf8');

    expect(source).toMatch(/export function useCrudFilters/);
    expect(source).toMatch(/setFilter/);
    expect(source).toMatch(/resetFilters/);
    expect(source).toMatch(/hasActiveFilters/);
  });

  test('useCrudList.js exporta o hook com loadItems e reload', () => {
    const filePath = path.join(process.cwd(), 'frontend', 'src', 'modules', 'crud-base', 'hooks', 'useCrudList.js');
    const source = fs.readFileSync(filePath, 'utf8');

    expect(source).toMatch(/export function useCrudList/);
    expect(source).toMatch(/loadItems/);
    expect(source).toMatch(/reload/);
  });

  test('useCrudForm.js exporta o hook com setField, resetForm e isDirty', () => {
    const filePath = path.join(process.cwd(), 'frontend', 'src', 'modules', 'crud-base', 'hooks', 'useCrudForm.js');
    const source = fs.readFileSync(filePath, 'utf8');

    expect(source).toMatch(/export function useCrudForm/);
    expect(source).toMatch(/setField/);
    expect(source).toMatch(/resetForm/);
    expect(source).toMatch(/isDirty/);
  });

  test('páginas do cluster admin usam CrudPageBase e não wrapper support-page inline', () => {
    const pages = [
      'QuickRepliesPage.jsx',
      'TenantsPage.jsx',
      'AgentsPage.jsx',
      'AccessControlPage.jsx',
      'BackupPage.jsx',
      'SsoScimPage.jsx',
      'ConfigPage.jsx',
      'FaqManagementPage.jsx',
      'TicketMaintenancePage.jsx',
      'SupportPage.jsx',
      'RAGDocumentsPage.jsx',
    ];
    const pagesDir = path.join(process.cwd(), 'frontend', 'src', 'pages');

    for (const page of pages) {
      const source = fs.readFileSync(path.join(pagesDir, page), 'utf8');
      expect(source).toMatch(/CrudPageBase/);
      expect(source).not.toMatch(/<div className="support-page"/);
    }
  });

  test('TenantsPage, AgentsPage e AccessControlPage consomem useCrudList para carregamento principal', () => {
    const pagesDir = path.join(process.cwd(), 'frontend', 'src', 'pages');
    const tenantsSource = fs.readFileSync(path.join(pagesDir, 'TenantsPage.jsx'), 'utf8');
    const agentsSource = fs.readFileSync(path.join(pagesDir, 'AgentsPage.jsx'), 'utf8');
    const accessControlSource = fs.readFileSync(path.join(pagesDir, 'AccessControlPage.jsx'), 'utf8');

    expect(tenantsSource).toMatch(/useCrudList/);
    expect(tenantsSource).toMatch(/loadItems:\s*loadTenants/);
    expect(agentsSource).toMatch(/useCrudList/);
    expect(agentsSource).toMatch(/loadItems:\s*loadAgents/);
    expect(accessControlSource).toMatch(/useCrudList/);
    expect(accessControlSource).toMatch(/reload:\s*reloadAll/);
  });
});
