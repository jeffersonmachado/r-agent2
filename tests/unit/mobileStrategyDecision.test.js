'use strict';

/**
 * Mobile Strategy Decision — consistency test.
 *
 * The decision (config/mobile-strategy.json) is an executable artifact:
 * this test proves the decision matches repository reality:
 * - decision is 'pwa' and active
 * - the frontend really is a PWA (vite-plugin-pwa + manifest + standalone)
 * - there is no React Native source in apps/mobile (decision consistency)
 * - rejected alternative is documented with reasons
 * - consequences cover the P3.12 bootstrap (not-applicable)
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');

function loadStrategy() {
  return JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'mobile-strategy.json'), 'utf8'));
}

describe('Mobile Strategy Decision (P3.10)', () => {
  test('decisão é pwa, ativa, com rationale e alternativa rejeitada documentada', () => {
    const s = loadStrategy();
    expect(s.artifactType).toBe('mobile-strategy-decision');
    expect(s.decision).toBe('pwa');
    expect(s.status).toBe('active');
    expect(Array.isArray(s.rationale)).toBe(true);
    expect(s.rationale.length).toBeGreaterThanOrEqual(4);
    expect(s.rejected.alternative).toBe('react-native');
    expect(s.rejected.reasons.length).toBeGreaterThanOrEqual(2);
  });

  test('consequência declara P3.12 (bootstrap RN) como não aplicável', () => {
    const s = loadStrategy();
    expect(s.consequences['p3.12.reactNativeBootstrap']).toBe('not-applicable');
  });

  test('o frontend realmente é PWA (decisão ancorada na realidade do repo)', () => {
    const viteConfig = fs.readFileSync(path.join(ROOT, 'frontend', 'vite.config.mjs'), 'utf8');
    expect(viteConfig).toMatch(/VitePWA|vite-plugin-pwa/);
    expect(viteConfig).toMatch(/manifest:\s*{/);
    expect(viteConfig).toMatch(/display:\s*'standalone'/);
    const indexHtml = fs.readFileSync(path.join(ROOT, 'frontend', 'index.html'), 'utf8');
    expect(indexHtml).toMatch(/manifest\.webmanifest/);
  });

  test('não existe fonte React Native em apps/mobile (consistência com a decisão)', () => {
    const mobileDir = path.join(ROOT, 'apps', 'mobile');
    if (!fs.existsSync(mobileDir)) return; // diretório removido: consistente
    const entries = fs.readdirSync(mobileDir);
    const sourceEntries = entries.filter((e) => e !== 'node_modules');
    expect(sourceEntries).toEqual([]);
    // nenhum arquivo de configuração RN/Expo na raiz do diretório
    for (const marker of ['package.json', 'app.json', 'metro.config.js', 'App.tsx', 'App.js']) {
      expect(fs.existsSync(path.join(mobileDir, marker))).toBe(false);
    }
  });

  test('capabilities planejadas referenciam tecnologias web, não nativas', () => {
    const s = loadStrategy();
    expect(s.capabilities.installable.status).toBe('implemented');
    expect(s.capabilities.offlineShell.status).toBe('implemented');
    for (const key of ['offlineInbox', 'push']) {
      expect(s.capabilities[key]).toBeTruthy();
      expect(s.capabilities[key].technology).not.toMatch(/react-native|expo/i);
    }
  });
});
