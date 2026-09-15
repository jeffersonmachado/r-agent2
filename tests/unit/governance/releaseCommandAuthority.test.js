'use strict';

/**
 * Gate de autoridade única de release (`release:seal`).
 *
 * Prova nos dois sentidos sobre o núcleo puro `evaluate()`:
 *  - com os arquivos REAIS do repositório o gate PASSA;
 *  - com conteúdo regredido (doc sem a frase de autoridade, doc apresentando
 *    `system:release`/`zip:release` sem citar `release:seal`, encadeamento
 *    manual sem classificação de etapa interna, package.json sem o mapping,
 *    orquestrador sem fase) o gate FALHA com o código de violação correto.
 */

const {
  evaluate,
  readSources,
  VIOLATION_CODES,
  GOVERNED_DOCS,
} = require('../../../scripts/governance/validate-release-command-authority');

function realSources() {
  return readSources();
}

function violationCodes(result) {
  return result.violations.map((v) => v.code);
}

describe('validate-release-command-authority — arquivos reais', () => {
  test('PASSA sobre o repositório atual', () => {
    const result = evaluate(realSources());
    expect(result.violations).toEqual([]);
    expect(result.checks.every((c) => c.status === 'PASS')).toBe(true);
  });
});

describe('validate-release-command-authority — regressões documentais são FAIL', () => {
  test('reverter a declaração de autoridade em um doc governado falha', () => {
    const sources = realSources();
    sources.docs[GOVERNED_DOCS[1]] = sources.docs[GOVERNED_DOCS[1]]
      .replace(/A autoridade única de release completo[^\n]*/g, 'release antigo');
    const result = evaluate(sources);
    expect(violationCodes(result)).toContain(VIOLATION_CODES.DOC_WITHOUT_AUTHORITY_STATEMENT);
  });

  test('doc que apresenta system:release sem citar release:seal falha', () => {
    const sources = realSources();
    sources.docs['docs/OPERACIONAL_CHEATSHEET.md'] =
      '# Release\n\n```bash\nnpm run system:validate\nnpm run system:release\nnpm run zip:release:clean\n```\n';
    const result = evaluate(sources);
    const codes = violationCodes(result);
    expect(codes).toContain(VIOLATION_CODES.INTERNAL_STAGE_PRESENTED_AS_RELEASE);
    expect(codes).toContain(VIOLATION_CODES.MANUAL_CHAIN_NOT_CLASSIFIED);
  });

  test('encadeamento manual sem classificação de etapa interna falha', () => {
    const sources = realSources();
    sources.docs['docs/DOUTRINA_OPERACIONAL.md'] = sources.docs['docs/DOUTRINA_OPERACIONAL.md']
      .replace(/`system:release` e `zip:release` são etapas internas[^\n]*/g, 'etapas do release');
    const result = evaluate(sources);
    expect(violationCodes(result)).toContain(VIOLATION_CODES.MANUAL_CHAIN_NOT_CLASSIFIED);
  });

  test('package.json sem o mapping release:seal → seal-release.sh falha', () => {
    const sources = realSources();
    sources.packageJson = JSON.parse(JSON.stringify(sources.packageJson));
    sources.packageJson.scripts['release:seal'] = 'node tools/system/release.js';
    const result = evaluate(sources);
    expect(violationCodes(result)).toContain(VIOLATION_CODES.SEAL_NPM_MAPPING_WRONG);
  });

  test('orquestrador sem uma fase canônica falha', () => {
    const sources = realSources();
    sources.sealScript = sources.sealScript.replace(/publish/g, 'publ1sh');
    const result = evaluate(sources);
    expect(violationCodes(result)).toContain(VIOLATION_CODES.SEAL_PHASE_MISSING);
  });

  test('AGENTS.md sem nomear release:seal como ciclo completo falha', () => {
    const sources = realSources();
    sources.agentsMd = sources.agentsMd.replace(/selagem \+ publicação/g, 'empacotamento');
    const result = evaluate(sources);
    expect(violationCodes(result)).toContain(VIOLATION_CODES.AGENTS_MD_NOT_NAMING_SEAL);
  });
});
