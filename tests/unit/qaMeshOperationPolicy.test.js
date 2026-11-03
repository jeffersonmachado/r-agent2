'use strict';

/**
 * Política do QA Mesh: QUANDO o Bug Closure First se aplica.
 *
 * Defeito real medido em 2026-10-21 (checkout limpo): `npm run qa:mesh:refresh` era recusado
 * com `exit 3 — P1_BLOQUEANTE_ABERTO` porque o guard de elegibilidade rodava antes de olhar a
 * operação pedida. Consequência prática: num checkout limpo o registro do mesh não existe, e o
 * comando que CONSTRÓI o registro era barrado pelo próprio defeito que o ambiente incompleto
 * causava — ciclo impossível (o índice é pré-requisito para medir a cobertura e fechar o item).
 *
 * O que este arquivo trava:
 *  1. `--refresh-registry` ISOLADO é manutenção de índice (não executa cenário) → não exige
 *     elegibilidade;
 *  2. qualquer combinação (execução real) continua exigindo — `--impact-only`, `--only`,
 *     posicionais, ou `--refresh-registry` junto de outra flag;
 *  3. a regra é conservadora: na dúvida, EXECUCAO.
 */

const {
  classificarOperacaoMesh,
  exigeElegibilidade,
  REFRESH_REGISTRY,
  EXECUCAO,
} = require('../../qa-mesh/meshOperationPolicy');

describe('QA Mesh — escopo do Bug Closure First', () => {
  test('--refresh-registry ISOLADO é manutenção de índice', () => {
    expect(classificarOperacaoMesh(['--refresh-registry'])).toBe(REFRESH_REGISTRY);
    expect(exigeElegibilidade(['--refresh-registry'])).toBe(false);
  });

  test('qualquer outra operação continua exigindo elegibilidade', () => {
    const execucoes = [
      [],
      ['--impact-only'],
      ['--only', 'workspace-core'],
      ['--refresh-registry', '--impact-only'],
      ['--refresh-registry', '--only', 'workspace-core'],
      ['--refresh-registry', 'cenario-extra'],
      ['--go'],
    ];
    for (const argv of execucoes) {
      expect({ argv, op: classificarOperacaoMesh(argv) }).toEqual({ argv, op: EXECUCAO });
      expect(exigeElegibilidade(argv)).toBe(true);
    }
  });

  test('não é vacuoso: a classificação distingue de fato as duas operações', () => {
    // Se a função passasse a devolver sempre EXECUCAO, o refresh continuaria quebrado;
    // se devolvesse sempre REFRESH_REGISTRY, o gate de execução desapareceria em silêncio.
    expect(classificarOperacaoMesh(['--refresh-registry'])).not.toBe(classificarOperacaoMesh(['--impact-only']));
    expect(exigeElegibilidade(['--refresh-registry'])).toBe(false);
    expect(exigeElegibilidade(['--impact-only'])).toBe(true);
  });

  test('o entrypoint usa a política (não volta a chamar o guard incondicionalmente)', () => {
    const fs = require('fs');
    const path = require('path');
    const fonte = fs.readFileSync(
      path.resolve(__dirname, '..', '..', 'pipeline', 'entrypoints', 'runQaMesh.js'),
      'utf8',
    );
    expect(fonte).toContain("require('../../qa-mesh/meshOperationPolicy')");
    // O guard precisa estar DENTRO do if de execução — nunca solto no topo do módulo.
    const chamadaSolta = /^require\('\.\.\/\.\.\/governance\/bug-closure\/require-eligibility'\)\s*$/m.test(fonte);
    expect(chamadaSolta).toBe(false);
    expect(fonte).toMatch(/if \(exigeElegibilidade\(process\.argv\.slice\(2\)\)\) \{/);
  });
});
