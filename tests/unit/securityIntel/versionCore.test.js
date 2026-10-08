'use strict';

/**
 * Testes do núcleo de versões da inteligência de segurança (RAP Version &
 * Security Intelligence).
 *
 * O que está sendo provado aqui:
 *   - SemVer 2.0.0 estrito (ordem canônica do spec, incluindo pré-releases).
 *   - PEP 440 (epoch, pre/post/dev, segmento local).
 *   - Matching de faixas OSV (introduced/fixed/last_affected/limit).
 *   - Comparator sets (`>=`, `<`, `^`, `~`, `||`).
 *   - REGRA DE HONESTIDADE: versão não comparável devolve `null`, jamais
 *     `false` (ausência de veredito ≠ ausência de vulnerabilidade).
 */

const {
  parseSemver,
  compareSemver,
  parsePep440,
  comparePep440,
  compareVersions,
  isVersionLessThan,
  isVersionInOsvRange,
  satisfiesComparatorSet,
  isVersionAffected,
  comparability,
} = require('../../../engine/securityIntel/versionCore');

describe('versionCore — SemVer 2.0.0', () => {
  test('ordem canônica de pré-releases do spec', () => {
    const ordered = [
      '1.0.0-alpha',
      '1.0.0-alpha.1',
      '1.0.0-alpha.beta',
      '1.0.0-beta',
      '1.0.0-beta.2',
      '1.0.0-beta.11',
      '1.0.0-rc.1',
      '1.0.0',
    ];
    for (let i = 0; i < ordered.length - 1; i += 1) {
      expect(compareSemver(ordered[i], ordered[i + 1])).toBe(-1);
      expect(compareSemver(ordered[i + 1], ordered[i])).toBe(1);
    }
  });

  test('build metadata é ignorada na precedência', () => {
    expect(compareSemver('1.2.3+build.1', '1.2.3+build.2')).toBe(0);
    expect(compareSemver('1.2.3+v1', '1.2.3')).toBe(0);
  });

  test('prefixo v é tolerado (tags de repositório)', () => {
    expect(parseSemver('v22.12.0')).toMatchObject({ major: 22, minor: 12, patch: 0 });
    expect(compareSemver('v1.0.0', '1.0.0')).toBe(0);
  });

  test('versão inválida não é inventada como 0.0.0', () => {
    expect(parseSemver('latest')).toBeNull();
    expect(parseSemver('16')).toBeNull();
    expect(compareSemver('16', '1.0.0')).toBeNull();
  });
});

describe('versionCore — PEP 440', () => {
  test('ordem dev < pre < final < post', () => {
    const ordered = ['1.0.dev1', '1.0a1', '1.0b1', '1.0rc1', '1.0', '1.0.post1'];
    for (let i = 0; i < ordered.length - 1; i += 1) {
      expect(comparePep440(ordered[i], ordered[i + 1])).toBe(-1);
    }
  });

  test('dev de um pre-release ordena antes do pre-release', () => {
    expect(comparePep440('1.0a1.dev1', '1.0a1')).toBe(-1);
  });

  test('epoch domina a comparação', () => {
    expect(comparePep440('1!1.0', '2.0')).toBe(1);
  });

  test('release com tamanho diferente usa padding de zeros', () => {
    expect(comparePep440('1.0', '1.0.0')).toBe(0);
    expect(comparePep440('2.9.1', '2.9.10')).toBe(-1);
  });

  test('segmento local só desempata quando ambos possuem (torch +cpu)', () => {
    expect(comparePep440('2.9.1+cpu', '2.9.1')).toBe(0);
    expect(comparePep440('2.9.1+cpu', '2.9.2')).toBe(-1);
    expect(comparePep440('2.9.1+cpu', '2.9.1+cuda')).toBe(-1);
  });
});

describe('versionCore — despacho por ecossistema', () => {
  test('npm usa semver e pypi usa pep440', () => {
    expect(compareVersions('1.10.0', '1.9.0', { ecosystem: 'npm' })).toBe(1);
    expect(compareVersions('1.10.0', '1.9.0', { ecosystem: 'pypi' })).toBe(1);
    expect(compareVersions('1.0.0-rc.1', '1.0.0', { ecosystem: 'npm' })).toBe(-1);
  });

  test('ecossistema desconhecido degrada para coarse, nunca para "igual"', () => {
    expect(compareVersions('pg16', 'pg15', { ecosystem: 'docker' })).toBe(1);
    expect(comparability('7.4-alpine', { ecosystem: 'docker' })).toBe('coarse');
    expect(comparability('latest', { ecosystem: 'docker' })).toBe('unknown');
  });

  test('isVersionLessThan devolve null quando não comparável', () => {
    expect(isVersionLessThan('1.0.0', '2.0.0', { ecosystem: 'npm' })).toBe(true);
    expect(isVersionLessThan('latest', '2.0.0', { ecosystem: 'npm' })).toBeNull();
  });
});

describe('versionCore — faixas OSV', () => {
  const range = {
    type: 'SEMVER',
    events: [{ introduced: '0' }, { fixed: '1.4.2' }],
  };

  test('introduced/fixed delimita a janela afetada', () => {
    expect(isVersionInOsvRange('1.4.1', range, { ecosystem: 'npm' })).toBe(true);
    expect(isVersionInOsvRange('1.4.2', range, { ecosystem: 'npm' })).toBe(false);
    expect(isVersionInOsvRange('1.0.0', range, { ecosystem: 'npm' })).toBe(true);
  });

  test('introduced posteriores restringem a janela', () => {
    const complex = {
      type: 'SEMVER',
      events: [{ introduced: '1.0.0' }, { fixed: '1.2.0' }, { introduced: '2.0.0' }, { fixed: '2.1.0' }],
    };
    expect(isVersionInOsvRange('0.9.0', complex, { ecosystem: 'npm' })).toBe(false);
    expect(isVersionInOsvRange('1.1.0', complex, { ecosystem: 'npm' })).toBe(true);
    expect(isVersionInOsvRange('1.5.0', complex, { ecosystem: 'npm' })).toBe(false);
    expect(isVersionInOsvRange('2.0.5', complex, { ecosystem: 'npm' })).toBe(true);
    expect(isVersionInOsvRange('2.1.0', complex, { ecosystem: 'npm' })).toBe(false);
  });

  test('last_affected é inclusivo e limit é exclusivo', () => {
    const lastAffected = { events: [{ introduced: '0' }, { last_affected: '1.2.3' }] };
    expect(isVersionInOsvRange('1.2.3', lastAffected, { ecosystem: 'npm' })).toBe(true);
    expect(isVersionInOsvRange('1.2.4', lastAffected, { ecosystem: 'npm' })).toBe(false);
    const limit = { events: [{ introduced: '0' }, { limit: '1.2.3' }] };
    expect(isVersionInOsvRange('1.2.3', limit, { ecosystem: 'npm' })).toBe(false);
  });

  test('versão não comparável devolve DESCONHECIDO, nunca "não afetado"', () => {
    expect(isVersionInOsvRange('latest', range, { ecosystem: 'npm' })).toBeNull();
    expect(isVersionInOsvRange('1.4.1', { events: [{ introduced: 'abc' }] }, { ecosystem: 'npm' })).toBeNull();
  });

  test('faixa vazia ou inválida é desconhecida, não segura', () => {
    expect(isVersionInOsvRange('1.0.0', { events: [] }, { ecosystem: 'npm' })).toBeNull();
    expect(isVersionInOsvRange('1.0.0', null, { ecosystem: 'npm' })).toBeNull();
  });
});

describe('versionCore — comparator sets', () => {
  test('AND implícito e OR explícito', () => {
    expect(satisfiesComparatorSet('1.5.0', '>=1.2.3 <2.0.0', { ecosystem: 'npm' })).toBe(true);
    expect(satisfiesComparatorSet('2.0.0', '>=1.2.3 <2.0.0', { ecosystem: 'npm' })).toBe(false);
    expect(satisfiesComparatorSet('3.1.0', '>=1.2.3 <2.0.0 || >=3.0.0', { ecosystem: 'npm' })).toBe(true);
  });

  test('shorthand ^ e ~', () => {
    expect(satisfiesComparatorSet('1.9.9', '^1.2.3', { ecosystem: 'npm' })).toBe(true);
    expect(satisfiesComparatorSet('2.0.0', '^1.2.3', { ecosystem: 'npm' })).toBe(false);
    expect(satisfiesComparatorSet('1.2.9', '~1.2.3', { ecosystem: 'npm' })).toBe(true);
    expect(satisfiesComparatorSet('1.3.0', '~1.2.3', { ecosystem: 'npm' })).toBe(false);
  });

  test('wildcard é ambíguo e devolve desconhecido', () => {
    expect(satisfiesComparatorSet('1.5.0', '1.*', { ecosystem: 'npm' })).toBeNull();
    expect(satisfiesComparatorSet('1.5.0', '*', { ecosystem: 'npm' })).toBe(true);
  });

  test('isVersionAffected aceita events, comparador e string', () => {
    expect(isVersionAffected('1.0.0', '>=0.9.0', { ecosystem: 'npm' })).toBe(true);
    expect(isVersionAffected('1.0.0', { comparator: '<0.9.0' }, { ecosystem: 'npm' })).toBe(false);
    expect(isVersionAffected('1.0.0', { events: [{ introduced: '0' }, { fixed: '2.0.0' }] }, { ecosystem: 'npm' })).toBe(true);
    expect(isVersionAffected('x.y', '>=0.9.0', { ecosystem: 'npm' })).toBeNull();
  });
});
