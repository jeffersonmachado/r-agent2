'use strict';

/**
 * Testes do validador estático validate-experience-segregation:
 * garante que conteúdo técnico interno (QA/RPA/Replay/Seeds/Evidence/etc.)
 * é detectado em superfícies PRODUCTION e que páginas dev-only ficam
 * fora do escopo de scan.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const validator = require('../../scripts/governance/validate-experience-segregation');

describe('validate-experience-segregation', () => {
  describe('isDevOnly', () => {
    test('páginas internas de engenharia ficam fora do escopo PRODUCTION', () => {
      expect(validator.isDevOnly('frontend/src/pages/RpaReplaysPage.jsx')).toBe(true);
      expect(validator.isDevOnly('frontend/src/pages/QaWavesPage.jsx')).toBe(true);
      expect(validator.isDevOnly('frontend/src/pages/qa/StabilityPage.jsx')).toBe(true);
      expect(validator.isDevOnly('frontend/src/modules/workspace/WorkspaceQaRpaPanel.jsx')).toBe(true);
      expect(validator.isDevOnly('frontend/src/modules/workspace/workspaceDevSurface.js')).toBe(true);
    });

    test('páginas de cliente permanecem no escopo PRODUCTION', () => {
      expect(validator.isDevOnly('frontend/src/pages/InboxPage.jsx')).toBe(false);
      expect(validator.isDevOnly('frontend/src/pages/WorkspacePage.jsx')).toBe(false);
      expect(validator.isDevOnly('frontend/src/modules/workspace/WorkspaceLayout.jsx')).toBe(false);
      expect(validator.isDevOnly('frontend/src/pages/DemoPage.jsx')).toBe(false);
    });
  });

  describe('scanFile', () => {
    let tmpDir;
    let relPath;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'exp-seg-'));
      relPath = path.relative(validator.__rootDir || path.join(__dirname, '..', '..'), tmpDir);
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    function scanContent(content) {
      // scanFile lê do disco relativo ao ROOT_DIR; usamos um arquivo dentro do repo em tmp controlado
      const target = path.join(__dirname, '.fixture-exp-seg.jsx');
      fs.writeFileSync(target, content);
      try {
        const rel = path.relative(path.join(__dirname, '..', '..'), target).split(path.sep).join('/');
        return validator.scanFile(rel, validator.FORBIDDEN_RULES);
      } finally {
        fs.rmSync(target, { force: true });
      }
    }

    test('detecta literais técnicos proibidos', () => {
      const hits = scanContent([
        'const label = "QA Wave falhou";',
        'const other = "Replay Studio";',
        'const x = "Evidence ID: 992";',
        'const y = "RPA step 17";',
        'const z = "Seeds sintéticos";',
      ].join('\n'));
      const rules = hits.map((h) => h.rule);
      expect(rules).toContain('qa_wave');
      expect(rules).toContain('replay');
      expect(rules).toContain('evidence');
      expect(rules).toContain('rpa_term');
      expect(rules).toContain('seed');
    });

    test('não detecta linguagem sanitizada de outcome operacional', () => {
      const hits = scanContent([
        'const msg = "Instabilidade detectada e recuperada.";',
        'const title = "Chamados";',
        'const tab = "Caixa de Entrada";',
      ].join('\n'));
      expect(hits).toHaveLength(0);
    });
  });

  describe('collectViolations (repo real)', () => {
    test('superfícies PRODUCTION não contêm conteúdo técnico não isento', () => {
      const { violations, surfaces } = validator.collectViolations();
      expect(surfaces.length).toBeGreaterThan(0);
      expect(violations).toEqual([]);
    });

    test('superfícies SUPPORT são varridas e não importam engenharia', () => {
      const { supportSurfaces } = validator.collectViolations();
      expect(supportSurfaces).toContain('frontend/src/pages/PlatformSupportPage.jsx');
      expect(supportSurfaces.some((p) => p.startsWith('frontend/src/components/support/'))).toBe(true);
    });
  });

  // ─── Check B: contrato /support (capability caseManagement) ────────────────
  describe('analyzeSupportCapabilityContract', () => {
    const validMenu = `
export const navigationMenu = [
  {
    id: 'relacionamento',
    label: 'Relacionamento',
    path: '/support',
    children: [
      {
        id: 'support',
        label: 'Central de Atendimento',
        path: '/support',
        permission: { resource: 'tickets', action: 'read' },
        capability: 'caseManagement',
      },
    ],
  },
];
`;
    const validPermissions = `
export function canAccessPath(agent, path, options = {}) {
  const { allowUnknown = true, capabilities } = options;
  const matchingItems = menuItems.filter((menuItem) => menuItem.path === path);
  if (matchingItems.length === 0) return allowUnknown;
  for (const matchingItem of matchingItems) {
    if (matchingItem.capability && capabilities?.[matchingItem.capability] !== true) {
      return false;
    }
  }
  return canAccessMenuItem(agent, matchingItems[0], capabilities);
}
`;
    const validPage = `/**
 * @deprecated Superfície legada de atendimento ticket-based.
 */
import React from 'react';
export function SupportPage() {
  const { agent, capabilities } = useAuth();
  const caseManagementEnabled = capabilities?.caseManagement === true;
  if (!caseManagementEnabled) {
    return <div>Case Management não está ativo</div>;
  }
  return (<SupportPageInner agent={agent} />);
}
`;

    function analyze(overrides = {}) {
      return validator.analyzeSupportCapabilityContract({
        menuContent: validMenu,
        menuPermissionsContent: validPermissions,
        supportPageContent: validPage,
        ...overrides,
      });
    }

    test('contrato íntegro não produz violações', () => {
      expect(analyze()).toEqual([]);
    });

    test('FAIL: item de menu /support sem capability caseManagement', () => {
      const violations = analyze({ menuContent: validMenu.replace("capability: 'caseManagement',", '') });
      expect(violations.map((v) => v.rule)).toContain('support_menu_capability_missing');
    });

    test('FAIL: item de menu /support (id support) ausente', () => {
      const violations = analyze({ menuContent: validMenu.replace("id: 'support',", "id: 'atendimento-legado',") });
      expect(violations.map((v) => v.rule)).toContain('support_menu_item_missing');
    });

    test('FAIL: canAccessPath sem gate de capability em todos os itens da rota', () => {
      const semGate = `
export function canAccessPath(agent, path, options = {}) {
  const matchingItems = menuItems.filter((menuItem) => menuItem.path === path);
  if (matchingItems.length === 0) return true;
  return canAccessMenuItem(agent, matchingItems[0], options.capabilities);
}
`;
      const violations = analyze({ menuPermissionsContent: semGate });
      expect(violations.map((v) => v.rule)).toContain('support_path_capability_gate_missing');
    });

    test('FAIL: canAccessPath checando capability só no primeiro item (bypass pelo nó-pai)', () => {
      const gateSoNoPrimeiro = `
export function canAccessPath(agent, path, options = {}) {
  const { capabilities } = options;
  const matchingItems = menuItems.filter((menuItem) => menuItem.path === path);
  const first = matchingItems[0];
  if (first && first.capability && capabilities?.[first.capability] !== true) return false;
  return true;
}
`;
      const violations = analyze({ menuPermissionsContent: gateSoNoPrimeiro });
      expect(violations.map((v) => v.rule)).toContain('support_path_capability_gate_missing');
    });

    test('FAIL: SupportPage sem guard de capability', () => {
      const semGuard = validPage.replace(/if \(!caseManagementEnabled\) \{[\s\S]*?\}\n/, '');
      const violations = analyze({ supportPageContent: semGuard });
      expect(violations.map((v) => v.rule)).toContain('support_page_capability_guard_missing');
    });

    test('FAIL: guard de capability DEPOIS da renderização do conteúdo', () => {
      const guardTardio = `/**
 * @deprecated Superfície legada.
 */
import React from 'react';
export function SupportPage() {
  const { capabilities } = useAuth();
  const caseManagementEnabled = capabilities?.caseManagement === true;
  const content = <SupportPageInner />;
  if (!caseManagementEnabled) {
    return <div>off</div>;
  }
  return content;
}
`;
      const violations = analyze({ supportPageContent: guardTardio });
      expect(violations.map((v) => v.rule)).toContain('support_page_capability_guard_missing');
    });

    test('FAIL: nota @deprecated ausente no cabeçalho da página', () => {
      const violations = analyze({ supportPageContent: validPage.replace('@deprecated ', '') });
      expect(violations.map((v) => v.rule)).toContain('support_page_deprecation_missing');
    });

    test('repo real: contrato /support íntegro (menu + permissões + página)', () => {
      const repoRoot = path.join(__dirname, '..', '..');
      const violations = validator.analyzeSupportCapabilityContract({
        menuContent: fs.readFileSync(path.join(repoRoot, 'frontend/src/navigation/menu.js'), 'utf8'),
        menuPermissionsContent: fs.readFileSync(path.join(repoRoot, 'frontend/src/utils/menuPermissions.js'), 'utf8'),
        supportPageContent: fs.readFileSync(path.join(repoRoot, 'frontend/src/pages/SupportPage.impl.jsx'), 'utf8'),
      });
      expect(violations).toEqual([]);
    });
  });

  // ─── Check C1: dev surface do workspace DEVELOPMENT-only ───────────────────
  describe('analyzeDevSurfaceGate', () => {
    test('repo real: isDevSurfaceVisible é DEVELOPMENT-only', () => {
      const repoRoot = path.join(__dirname, '..', '..');
      const content = fs.readFileSync(
        path.join(repoRoot, 'frontend/src/modules/workspace/workspaceDevSurface.js'),
        'utf8',
      );
      expect(validator.analyzeDevSurfaceGate(content)).toEqual([]);
    });

    test('FAIL: dev surface visível para SUPPORT', () => {
      const content = `
export function isDevSurfaceVisible(classification) {
  return classification === 'DEVELOPMENT' || classification === 'SUPPORT';
}
`;
      const violations = validator.analyzeDevSurfaceGate(content);
      expect(violations.map((v) => v.rule)).toContain('dev_surface_visible_to_non_development');
    });

    test('FAIL: dev surface visível para qualquer classificação', () => {
      const content = `
export function isDevSurfaceVisible(classification) {
  return Boolean(classification);
}
`;
      const violations = validator.analyzeDevSurfaceGate(content);
      expect(violations.map((v) => v.rule)).toContain('dev_surface_visible_to_non_development');
    });

    test('FAIL: função isDevSurfaceVisible ausente', () => {
      const violations = validator.analyzeDevSurfaceGate('export const x = 1;');
      expect(violations.map((v) => v.rule)).toContain('dev_surface_gate_function_missing');
    });
  });

  // ─── Check C2: superfícies SUPPORT sem conteúdo DEVELOPMENT ────────────────
  describe('scanSupportSurfaceContent', () => {
    test('não aponta imports operacionais legítimos', () => {
      const hits = validator.scanSupportSurfaceContent([
        "import React from 'react';",
        "import { Button } from '../../styles/Button';",
        "import { SupportCard } from './SupportCard';",
        "import { formatSupportReason } from './supportHumanization';",
      ].join('\n'));
      expect(hits).toEqual([]);
    });

    test('FAIL: superfície SUPPORT importando módulo de engenharia', () => {
      const hits = validator.scanSupportSurfaceContent([
        "import { QaWavesPanel } from '../../modules/qa/QaWavesPanel';",
        "import { meshReport } from '../../modules/qa-mesh/report';",
        "import { RpaLab } from '../../modules/rpa/RpaLab';",
        "import { AutoCorrectionCard } from '../autoCorrection/Card';",
        "import { RegressionSummary } from '../regression/Summary';",
        "import { CoverageBadge } from '../coverage/Badge';",
        "const panel = require('../qa-waves/panel');",
      ].join('\n'));
      const rules = hits.map((h) => h.rule);
      expect(rules).toContain('eng_qa_module');
      expect(rules).toContain('eng_qa_mesh');
      expect(rules).toContain('eng_rpa_module');
      expect(rules).toContain('eng_autocorrection');
      expect(rules).toContain('eng_regression');
      expect(rules).toContain('eng_coverage');
      expect(rules).toContain('eng_qa_waves');
    });

    test('FAIL: superfície SUPPORT renderizando componente DEVELOPMENT em JSX', () => {
      const hits = validator.scanSupportSurfaceContent([
        'export function Card() {',
        '  return (<div><WorkspaceQaRpaPanel incidents={x} /></div>);',
        '}',
      ].join('\n'));
      expect(hits.map((h) => h.rule)).toContain('eng_jsx_qa_rpa_panel');
    });

    test('FAIL: dev surface do workspace importada em superfície SUPPORT', () => {
      const hits = validator.scanSupportSurfaceContent(
        "import { isDevSurfaceVisible } from '../../modules/workspace/workspaceDevSurface';",
      );
      expect(hits.map((h) => h.rule)).toContain('eng_dev_surface');
    });
  });
});
