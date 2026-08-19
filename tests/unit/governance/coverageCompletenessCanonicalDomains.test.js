'use strict';

/**
 * HARD-009 (reforço) — validate-coverage-completeness usa domínios canônicos.
 *
 * Falha coberta (falharia antes da correção):
 * `mapModuleToDomain`/`mapPathToDomain` retornavam IDs legados
 * (`mercado`, `clinica`, `servicos`) enquanto o meshRegistry foi
 * canonicalizado para `market`/`clinic`/`services` (config/verticals.json).
 * O cruzamento módulo×cenário por domínio deixava de casar e o módulo
 * `market-intelligence` virava `api-uncovered` (error) → gate exit 1.
 *
 * O relatório agora resolve aliases via config/verticals.json e nunca
 * mistura ID legado com canônico na análise por domínio.
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const SCRIPT = path.join(ROOT, 'scripts', 'governance', 'validate-coverage-completeness.js');
const REPORT = path.join(ROOT, 'reports', 'coverage-completeness-report.json');
const VERTICALS = path.join(ROOT, 'config', 'verticals.json');

describe('validate-coverage-completeness — domínios canônicos (HARD-009)', () => {
  let report;

  beforeAll(() => {
    execFileSync(process.execPath, [SCRIPT], { cwd: ROOT, stdio: 'pipe', timeout: 120000 });
    report = JSON.parse(fs.readFileSync(REPORT, 'utf8'));
  }, 150000);

  test('exit 0 sem issues de severidade error/critical', () => {
    const blocking = (report.issues || []).filter(i => i.severity === 'error' || i.severity === 'critical');
    expect(blocking).toEqual([]);
  });

  test('market-intelligence não é api-uncovered (match por domínio canônico market)', () => {
    const uncovered = (report.issues || []).filter(i => i.category === 'api-uncovered');
    expect(uncovered.map(i => i.module)).not.toContain('market-intelligence');
    expect(report.uncoveredApis || []).not.toContain('market-intelligence');
  });

  test('análise por domínio só contém IDs canônicos de config/verticals.json', () => {
    const verticals = JSON.parse(fs.readFileSync(VERTICALS, 'utf8'));
    const canonicalIds = new Set(Object.keys(verticals.domains));
    const aliasSet = new Set();
    for (const def of Object.values(verticals.domains)) {
      for (const alias of (def.aliases || [])) aliasSet.add(String(alias).toLowerCase());
    }

    const domains = report.businessAnalysis ? Object.keys(report.businessAnalysis) : [];
    expect(domains.length).toBeGreaterThan(0);
    for (const d of domains) {
      expect(canonicalIds.has(d)).toBe(true);
      // nenhum alias legado pode aparecer como domínio próprio
      expect(aliasSet.has(d) && !canonicalIds.has(d)).toBe(false);
    }
    // aliases legados explicitamente ausentes
    expect(domains).not.toContain('mercado');
    expect(domains).not.toContain('clinica');
    expect(domains).not.toContain('servicos');
  });
});
