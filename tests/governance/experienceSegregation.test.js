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
  });
});
