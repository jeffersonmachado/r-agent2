'use strict';

/**
 * Regressão de DEF-FLAKY-MISSIONFULLE2E-SOB-CARGA (causa raiz medida).
 *
 * O sintoma reportado era "suíte flaky sob carga". A causa era ESTÁTICA: quando o agregado
 * passou a persistir veredito próprio, `validate:governance-enforcement` virou wrapper e a
 * cadeia `&&` foi para `:chain`. Quem lia o script de TOPO (o guard
 * MANDATORY_RUNTIME_GATE_IN_OFFICIAL_PIPELINE, executado pelo Router na fase GOVERNANCE)
 * passou a reprovar um pipeline que CONTINUAVA chamando o gate de runtime — a missão ia a RED.
 *
 * Estes testes provam o resolvedor nos dois formatos e, principalmente, as RECUSAS: wrapper
 * sem cadeia, wrapper cujo runner não executa a cadeia, e cadeia com a forma structural-only.
 */

const {
  resolverCadeiaEfetiva,
  cadeiaContemPasso,
} = require('../../../scripts/governance/lib/effective-aggregate-chain');

const RUNTIME = 'npm run validate:engineering-router-v1:runtime';
const RUNNER = 'node scripts/governance/run-governance-enforcement.js';

describe('resolverCadeiaEfetiva — agregado de governança', () => {
  test('forma DIRETA: a própria string é a cadeia', () => {
    const r = resolverCadeiaEfetiva({ 'validate:governance-enforcement': `npm run validate:ai-memory && ${RUNTIME}` });
    expect(r.forma).toBe('DIRETA');
    expect(r.motivos).toEqual([]);
    expect(r.cadeia).toContain(RUNTIME);
  });

  test('forma WRAPPER: a cadeia efetiva é `:chain` (e o runner precisa executá-la)', () => {
    const r = resolverCadeiaEfetiva(
      {
        'validate:governance-enforcement': RUNNER,
        'validate:governance-enforcement:chain': `npm run validate:ai-memory && ${RUNTIME}`,
      },
      { lerFonteRunner: () => "const cadeia = pkg.scripts['validate:governance-enforcement:chain'];" },
    );
    expect(r.forma).toBe('WRAPPER');
    expect(r.motivos).toEqual([]);
    expect(r.cadeia).toContain(RUNTIME);
  });

  test('wrapper SEM `:chain` é recusado (nunca cadeia vazia silenciosa)', () => {
    const r = resolverCadeiaEfetiva({ 'validate:governance-enforcement': RUNNER }, {
      lerFonteRunner: () => "pkg.scripts['validate:governance-enforcement:chain']",
    });
    expect(r.cadeia).toBeNull();
    expect(r.motivos).toContain('WRAPPER_SEM_CADEIA');
  });

  test('wrapper cujo runner NÃO executa a cadeia é recusado (atóstica de wrapper vazio)', () => {
    const r = resolverCadeiaEfetiva(
      {
        'validate:governance-enforcement': RUNNER,
        'validate:governance-enforcement:chain': `npm run validate:ai-memory && ${RUNTIME}`,
      },
      { lerFonteRunner: () => '// runner que não lê a cadeia' },
    );
    expect(r.cadeia).toBeNull();
    expect(r.motivos).toContain('WRAPPER_NAO_EXECUTA_CADEIA');
  });

  test('agregado ausente é recusado explicitamente', () => {
    const r = resolverCadeiaEfetiva({});
    expect(r.cadeia).toBeNull();
    expect(r.motivos).toContain('AGREGADO_AUSENTE');
  });

  test('cadeia com a forma structural-only é DETECTÁVEL (o guard a reprova)', () => {
    const cadeiaStructural = 'npm run validate:ai-memory && npm run validate:engineering-router-v1 && npm run validate:dist';
    expect(/validate:engineering-router-v1(?!:runtime)/.test(cadeiaStructural)).toBe(true);
    // E a forma correta NÃO dispara o detector.
    const cadeiaRuntime = `npm run validate:ai-memory && ${RUNTIME}`;
    expect(/validate:engineering-router-v1(?!:runtime)/.test(cadeiaRuntime)).toBe(false);
  });

  test('cadeiaContemPasso é literal (não casa por regex do nome do passo)', () => {
    expect(cadeiaContemPasso(`a && ${RUNTIME} && b`, RUNTIME)).toBe(true);
    expect(cadeiaContemPasso('a && b', RUNTIME)).toBe(false);
    expect(cadeiaContemPasso(null, RUNTIME)).toBe(false);
  });
});

describe('package.json real — o agregado atual continua exigindo o gate de runtime', () => {
  test('cadeia efetiva do repositório contém o passo de runtime e nenhuma forma structural-only', () => {
    const fs = require('fs');
    const path = require('path');
    const ROOT = path.resolve(__dirname, '..', '..', '..');
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    const r = resolverCadeiaEfetiva(pkg.scripts || {}, {
      lerFonteRunner: () => fs.readFileSync(path.join(ROOT, 'scripts', 'governance', 'run-governance-enforcement.js'), 'utf8'),
    });
    expect(r.motivos).toEqual([]);
    expect(cadeiaContemPasso(r.cadeia, RUNTIME)).toBe(true);
    expect(/validate:engineering-router-v1(?!:runtime)/.test(r.cadeia)).toBe(false);
  });
});
