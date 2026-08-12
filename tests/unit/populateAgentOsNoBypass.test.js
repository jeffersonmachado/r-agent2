'use strict';

/**
 * Regressão (gap 3.3): scripts/populate-agent-os.js enviava
 * `qaWaveResult: 'GO'` no passo de validação — bypass manual que o Agent
 * Factory corretamente proíbe. O bootstrap deve criar → configurar →
 * validar de verdade → aprovar somente se elegível → publicar.
 */

const fs = require('fs');
const path = require('path');

const SCRIPT = path.join(__dirname, '..', '..', 'scripts', 'populate-agent-os.js');

describe('populate-agent-os — sem override manual de QA', () => {
  const src = fs.readFileSync(SCRIPT, 'utf8');

  test('não envia qaWaveResult em nenhuma chamada', () => {
    expect(src).not.toContain('qaWaveResult');
  });

  test('só aprova agente quando a validação real retorna GO', () => {
    // O script precisa inspecionar o resultado da validação antes do approve.
    expect(src).toMatch(/validate/i);
    expect(src).toMatch(/status\s*!==?\s*'GO'|status\s*===?\s*'GO'/);
  });

  test('não marca agente como aprovado/ativo sem validação', () => {
    expect(src).not.toMatch(/lifecycle:\s*'(approved|active)'/);
  });
});
