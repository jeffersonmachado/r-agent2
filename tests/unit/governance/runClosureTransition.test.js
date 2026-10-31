'use strict';

/**
 * P1-H (prompt duro 2026-10-31) — fechamento de RUN.
 *
 * Defeito medido em `api/services/governance/certificationService.js`:
 *   `await run.update({ status: terminalStatus, completed_at: new Date() }, { transaction })`
 *
 * Sem filtro de estado e sem conferir linhas afetadas:
 *   - um run já `COMPLETED` podia ser reescrito para `FAILED` (e vice-versa);
 *   - transição que não aplicou NADA era indistinguível de sucesso (0 linhas passava).
 *
 * Contrato novo: alvo terminal canônico, transição só a partir de estado não-terminal, UPDATE
 * condicional e EXATAMENTE uma linha.
 */

const {
  aplicarEncerramentoDeRun,
  runEmEstadoTerminal,
  RUN_ESTADOS_TERMINAIS,
  RUN_ESTADOS_TRANSICIONAVEIS,
} = require('../../../api/services/governance/certificationService');

function modeloFalso({ afetadas = 1 } = {}) {
  const chamadas = [];
  return {
    chamadas,
    update: async (valores, opcoes) => { chamadas.push({ valores, opcoes }); return [afetadas]; },
  };
}

describe('P1-H — encerramento de run é condicional e conta linhas', () => {
  test('estados terminais canônicos são reconhecidos', () => {
    for (const estado of RUN_ESTADOS_TERMINAIS) expect(runEmEstadoTerminal(estado)).toBe(true);
    for (const estado of RUN_ESTADOS_TRANSICIONAVEIS) expect(runEmEstadoTerminal(estado)).toBe(false);
  });

  test('run já TERMINAL é recusado sem tocar o banco', async () => {
    const modelo = modeloFalso();
    await expect(aplicarEncerramentoDeRun({
      runId: 'r1', statusAtual: 'COMPLETED', alvo: 'FAILED', modelo,
    })).rejects.toMatchObject({ code: 'RUN_JA_TERMINAL' });
    expect(modelo.chamadas).toHaveLength(0);
  });

  test('alvo não-terminal é recusado (não existe encerramento em estado aberto)', async () => {
    const modelo = modeloFalso();
    await expect(aplicarEncerramentoDeRun({
      runId: 'r1', statusAtual: 'RUNNING', alvo: 'RUNNING', modelo,
    })).rejects.toMatchObject({ code: 'RUN_STATUS_ALVO_INVALIDO' });
    expect(modelo.chamadas).toHaveLength(0);
  });

  test('UPDATE é condicional: WHERE run_id + status IN (não-terminais)', async () => {
    const modelo = modeloFalso({ afetadas: 1 });
    const r = await aplicarEncerramentoDeRun({ runId: 'r1', statusAtual: 'RUNNING', alvo: 'COMPLETED', modelo });
    expect(r).toMatchObject({ status: 'COMPLETED', afetadas: 1 });
    const { onde } = { onde: modelo.chamadas[0].opcoes.where };
    expect(onde.run_id).toBe('r1');
    expect(onde.status).toBeDefined(); // filtro de estado presente (não sobrescreve terminal)
    // `Op.in` não é serializável em JSON (símbolos): extrai os valores pelos símbolos.
    const valores = Object.getOwnPropertySymbols(onde.status)
      .flatMap((simbolo) => [].concat(onde.status[simbolo] || []));
    expect(valores).toEqual(expect.arrayContaining(['CREATED', 'RUNNING']));
    expect(valores).not.toContain('COMPLETED');
  });

  test('ZERO linhas atualizadas ⇒ RUN_STATUS_NAO_TRANSICIONOU (não é sucesso silencioso)', async () => {
    const modelo = modeloFalso({ afetadas: 0 });
    await expect(aplicarEncerramentoDeRun({
      runId: 'r1', statusAtual: 'RUNNING', alvo: 'COMPLETED', modelo,
    })).rejects.toMatchObject({ code: 'RUN_STATUS_NAO_TRANSICIONOU' });
  });

  test('MAIS de uma linha atualizada também é recusado (exatamente uma)', async () => {
    const modelo = modeloFalso({ afetadas: 2 });
    await expect(aplicarEncerramentoDeRun({
      runId: 'r1', statusAtual: 'RUNNING', alvo: 'COMPLETED', modelo,
    })).rejects.toMatchObject({ code: 'RUN_STATUS_NAO_TRANSICIONOU' });
  });

  test('erro de banco propaga (falha verificável, sem engolir)', async () => {
    const modelo = { update: async () => { throw Object.assign(new Error('db down'), { code: 'DB_DOWN' }); } };
    await expect(aplicarEncerramentoDeRun({
      runId: 'r1', statusAtual: 'RUNNING', alvo: 'COMPLETED', modelo,
    })).rejects.toMatchObject({ code: 'DB_DOWN' });
  });
});
