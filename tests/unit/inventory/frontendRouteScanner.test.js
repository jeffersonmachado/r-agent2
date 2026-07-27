'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { scanFrontendRoutes, classifyPage } = require('../../../api/services/qa/inventory/frontendRouteScanner');

function writeFixture(rootDir, relativePath, content) {
  const filePath = path.join(rootDir, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

function createFixtureRoot() {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'inventory-frontend-'));

  writeFixture(rootDir, 'frontend/src/main.jsx', `
const isRoute = (basePath) => currentPath === basePath || currentPath.startsWith(basePath + '/');
const isAgenda = isRoute('/agenda');
const isQaWaves = isRoute('/dev/qa-waves');
const isQa = isRoute('/qa');
const isCrm = currentPath.startsWith('/crm');
const isHome = currentPath === '/dashboard';
const normalizedPath = currentPath.startsWith('/r-agent2') ? currentPath.replace(/^\/r-agent2/, '') : currentPath;
const protectedRoutes = ['/agenda', '/qa'];
`);

  writeFixture(rootDir, 'frontend/src/navigation/menu.js', `
export const navigationMenu = [
  {
    id: 'operacao',
    label: 'Operação',
    path: '/agenda',
    roles: ['admin', 'super_admin'],
    permission: { resource: 'reports', action: 'read' },
  },
  {
    id: 'plataforma',
    label: 'Plataforma',
    children: [
      {
        id: 'super-admin',
        label: 'Super Admin',
        roles: ['super_admin'],
        children: [
          { id: 'dev-qa-waves', label: 'QA Waves', path: '/dev/qa-waves', roles: ['super_admin'] },
        ],
      },
    ],
  },
];

export function normalizeNavigationPath(value) {
  return value;
}
`);

  return rootDir;
}

describe('frontendRouteScanner', () => {
  let rootDir;
  let result;

  beforeAll(() => {
    rootDir = createFixtureRoot();
    result = scanFrontendRoutes({ rootDir });
  });

  afterAll(() => {
    fs.rmSync(rootDir, { recursive: true, force: true });
  });

  it('descobre páginas de main.jsx e cruza com o menu', () => {
    const agenda = result.items.find((item) => item.id === 'page:/agenda');
    expect(agenda).toBeDefined();
    expect(agenda.roles).toEqual(['admin', 'super_admin']);
    expect(agenda.permission).toBe('reports:read');
    expect(agenda.section).toBe('operacao');
    expect(agenda.guarded).toBe(true);
    expect(agenda.classification).toBe('PRODUCTION');
  });

  it('classifica páginas /dev/* como DEVELOPMENT com roles herdadas', () => {
    const qaWaves = result.items.find((item) => item.id === 'page:/dev/qa-waves');
    expect(qaWaves).toBeDefined();
    expect(qaWaves.classification).toBe('DEVELOPMENT');
    expect(qaWaves.roles).toEqual(['super_admin']);
    expect(qaWaves.guarded).toBe(true);
  });

  it('classifica páginas de diagnóstico/QA como SUPPORT', () => {
    const qa = result.items.find((item) => item.id === 'page:/qa');
    expect(qa).toBeDefined();
    expect(qa.classification).toBe('SUPPORT');
    expect(qa.guarded).toBe(false); // não está no menu da fixture
  });

  it('descobre paths via currentPath.startsWith e currentPath ===', () => {
    expect(result.items.some((item) => item.id === 'page:/crm')).toBe(true);
    expect(result.items.some((item) => item.id === 'page:/dashboard')).toBe(true);
  });

  it('ignora prefixo de mount de deploy (/r-agent2) — não é uma página', () => {
    // Regressão: currentPath.startsWith('/r-agent2') em main.jsx é a normalização do
    // prefixo de deploy (app servida sob /r-agent2 em produção), não uma rota.
    // O scanner gerava o item fantasma page:/r-agent2 (órfão sem jornada possível).
    expect(result.items.some((item) => item.id === 'page:/r-agent2')).toBe(false);
  });

  it('regra de classification isolada', () => {
    expect(classifyPage('/dev', null)).toBe('DEVELOPMENT');
    expect(classifyPage('/dev/x', null)).toBe('DEVELOPMENT');
    expect(classifyPage('/qa-mesh', null)).toBe('SUPPORT');
    expect(classifyPage('/support', null)).toBe('PRODUCTION'); // Central de Atendimento é de negócio
    expect(classifyPage(
      '/admin/agents',
      { roles: ['super_admin'], ancestors: ['plataforma', 'super-admin'], section: 'plataforma' },
    )).toBe('DEVELOPMENT');
  });

  it('aliases legados de páginas /dev/* herdam classificação DEVELOPMENT', () => {
    // Regressão: aliases legados (/rpa-replays, /rpa-seeds, /system-status) renderizam
    // as mesmas páginas de engenharia que /dev/*, mas eram classificados PRODUCTION
    // por não terem prefixo /dev nem entrada de menu — viravam órfãos e ruído de
    // política de visibilidade.
    expect(classifyPage('/rpa-replays', null)).toBe('DEVELOPMENT');
    expect(classifyPage('/rpa-seeds', null)).toBe('DEVELOPMENT');
    expect(classifyPage('/system-status', null)).toBe('DEVELOPMENT');
    // páginas operacionais com prefixo parecido não podem ser afetadas
    expect(classifyPage('/rpa', null)).not.toBe('DEVELOPMENT');
    expect(classifyPage('/system', null)).not.toBe('DEVELOPMENT');
  });
});
