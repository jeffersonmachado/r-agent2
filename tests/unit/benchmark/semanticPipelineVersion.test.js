'use strict';

/**
 * Regressão do versionamento do pipeline semântico.
 *
 * O risco que estes testes travam: a versão virar um carimbo. Se ela derivar de
 * timestamp, todo achado nasce STALE e o gate vira ruído; se derivar de commit,
 * o mesmo programa aparece como programas diferentes; se um comentário tiver o
 * mesmo efeito que uma regra, a versão deixa de significar "o programa mudou".
 *
 * O caso central é a DETERMINISMO + SENSIBILIDADE:
 *   - mesma entrada, duas chamadas => mesma versão;
 *   - conteúdo de módulo alterado => versão diferente.
 */

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  SEMANTIC_VERSION_FORMAT,
  SEMANTIC_PIPELINE_COMPONENTS,
  STALE_REASONS,
  computeSemanticPipelineDigest,
  getSemanticPipelineVersion,
  resetSemanticPipelineVersionCache,
  evaluateSemanticVersion,
  buildSemanticVersionRecord,
} = require('../../../api/services/benchmark/semantic/semanticPipelineVersion');

describe('semanticPipelineVersion — derivação determinística', () => {
  it('declara os 4 componentes do pipeline (extrator, classificador, normalizador, clustering)', () => {
    expect(SEMANTIC_PIPELINE_COMPONENTS).toEqual([
      'semanticExtractor.js',
      'observationClassifier.js',
      'normalizationPipeline.js',
      'clustering.js',
    ]);
  });

  it('produz a MESMA versão em chamadas repetidas (não depende de tempo)', () => {
    resetSemanticPipelineVersionCache();
    const first = getSemanticPipelineVersion().version;
    resetSemanticPipelineVersionCache();
    const second = getSemanticPipelineVersion().version;
    expect(first).toBe(second);
    expect(first).toMatch(/^sem-v1:[0-9a-f]{32}$/);
  });

  it('não deriva de timestamp nem de commit', () => {
    const { version } = getSemanticPipelineVersion();
    const isoish = /\d{4}-\d{2}-\d{2}|\d{10,}/;
    expect(isoish.test(version.replace(/^sem-v1:/, ''))).toBe(false);
    // O hash tem de ser reprodutível a partir do CONTEÚDO dos módulos.
    const { components, digest } = computeSemanticPipelineDigest();
    const canonical = [SEMANTIC_VERSION_FORMAT, ...components.map((c) => `${c.name}:${c.sha256}`)].join('\n');
    expect(digest).toBe(crypto.createHash('sha256').update(canonical).digest('hex'));
    expect(version).toBe(`sem-v1:${digest.slice(0, 32)}`);
  });

  it('cobre exatamente os módulos declarados, com hash de conteúdo real', () => {
    const { components } = computeSemanticPipelineDigest();
    expect(components.map((c) => c.name)).toEqual([...SEMANTIC_PIPELINE_COMPONENTS]);
    const semanticDir = path.join(__dirname, '..', '..', '..', 'api', 'services', 'benchmark', 'semantic');
    for (const component of components) {
      const bytes = fs.readFileSync(path.join(semanticDir, component.name));
      expect(component.sha256).toBe(crypto.createHash('sha256').update(bytes).digest('hex'));
    }
  });
});

describe('semanticPipelineVersion — avaliação de compatibilidade (fail-closed)', () => {
  const expected = getSemanticPipelineVersion().version;

  it('aceita documento com a versão atual', () => {
    const result = evaluateSemanticVersion({ semanticPipelineVersion: expected });
    expect(result.current).toBe(true);
    expect(result.reason).toBeNull();
  });

  it('RECUSA documento sem versão (ausência não é compatibilidade)', () => {
    for (const doc of [{}, null, undefined, { semanticPipelineVersion: '' }, { semanticPipelineVersion: '   ' }]) {
      const result = evaluateSemanticVersion(doc);
      expect(result.current).toBe(false);
      expect(result.reason).toBe(STALE_REASONS.VERSION_MISSING);
    }
  });

  it('marca STALE_SEMANTICS quando a versão registrada é de outro pipeline', () => {
    const result = evaluateSemanticVersion({ semanticPipelineVersion: 'sem-v1:' + 'f'.repeat(32) });
    expect(result.current).toBe(false);
    expect(result.reason).toBe(STALE_REASONS.VERSION_STALE);
    expect(result.recorded).toBe('sem-v1:' + 'f'.repeat(32));
    expect(result.expected).toBe(expected);
  });

  it('recusa formato desconhecido em vez de assumir compatível', () => {
    const result = evaluateSemanticVersion({ semanticPipelineVersion: '2026-09-19T00:00:00Z' });
    expect(result.current).toBe(false);
    expect(result.reason).toBe(STALE_REASONS.VERSION_UNKNOWN_FORMAT);
  });

  it('buildSemanticVersionRecord anexa versão, formato e componentes', () => {
    const record = buildSemanticVersionRecord({ normalizedId: 'payment.checkin' });
    expect(record.semanticPipelineVersion).toBe(expected);
    expect(record.semanticPipelineFormatVersion).toBe(SEMANTIC_VERSION_FORMAT);
    expect(record.semanticPipelineComponents).toEqual([...SEMANTIC_PIPELINE_COMPONENTS]);
    expect(record.normalizedId).toBe('payment.checkin');
  });
});

describe('semanticPipelineVersion — sensibilidade à mudança de regra', () => {
  // Prova que alterar o CONTEÚDO de um módulo do pipeline muda a versão.
  // Sem isso, a versão poderia ser constante e o gate nunca acusaria nada.
  it('muda quando o conteúdo de um componente muda (simulado)', () => {
    const original = computeSemanticPipelineDigest();
    const tampered = original.components.map((c, index) => (
      index === 0 ? { ...c, sha256: 'a'.repeat(64) } : c
    ));
    const canonical = [SEMANTIC_VERSION_FORMAT, ...tampered.map((c) => `${c.name}:${c.sha256}`)].join('\n');
    const tamperedDigest = crypto.createHash('sha256').update(canonical).digest('hex');
    expect(tamperedDigest).not.toBe(original.digest);
  });

  it('muda quando um componente é adicionado ou removido', () => {
    const original = computeSemanticPipelineDigest();
    const canonical = [
      SEMANTIC_VERSION_FORMAT,
      ...original.components.map((c) => `${c.name}:${c.sha256}`),
      'novoModulo.js:' + 'b'.repeat(64),
    ].join('\n');
    const withExtra = crypto.createHash('sha256').update(canonical).digest('hex');
    expect(withExtra).not.toBe(original.digest);
  });

  it('é estável entre diretórios de trabalho (não usa process.cwd)', () => {
    const originalCwd = process.cwd();
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'semver-'));
    try {
      process.chdir(temp);
      resetSemanticPipelineVersionCache();
      const fromTemp = getSemanticPipelineVersion().version;
      process.chdir(originalCwd);
      resetSemanticPipelineVersionCache();
      const fromRoot = getSemanticPipelineVersion().version;
      expect(fromTemp).toBe(fromRoot);
    } finally {
      process.chdir(originalCwd);
      fs.rmSync(temp, { recursive: true, force: true });
      resetSemanticPipelineVersionCache();
    }
  });
});
