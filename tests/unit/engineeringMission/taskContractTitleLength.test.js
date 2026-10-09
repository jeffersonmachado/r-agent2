'use strict';

/**
 * Regressão do defeito medido em 2026-10-09 na execução de missão pelo painel de
 * engenharia: clicar "Executar" devolvia **HTTP 500** com
 * `22001 value too long for type character varying(255)`.
 *
 * Causa: `engineering_tasks.title` é varchar(255) e o orquestrador colocava ali o
 * objetivo INTEIRO da missão (`objective` é `text`, sem limite). Missões criadas à
 * mão tinham objetivo curto e passavam; as missões de correção de segurança trazem
 * o texto completo da spec (restrições + pré-condições), estouram a coluna e a
 * execução morre antes de começar — ou seja, nenhuma vulnerabilidade seria corrigida.
 *
 * O contrato correto: `title` é RÓTULO (limitado), `objective` carrega o texto
 * completo.
 */

jest.mock('../../../api/db/sequelize', () => ({ connect: jest.fn(), getSequelize: jest.fn() }));

const { buildTaskContract } = require('../../../api/services/engineeringMission/missionOrchestratorService');

const LIMITE_DA_COLUNA = 255;

const specLonga = (tamanho) => ({
  missionType: 'BUG_FIX',
  risk: 'HIGH',
  objective: `Corrigir vulnerabilidade GHSA-x em fast-uri.\n\n${'Restrição inegociável. '.repeat(Math.ceil(tamanho / 24))}`,
  originalMission: 'texto original',
  acceptanceCriteria: [],
});

describe('buildTaskContract — título da task não pode estourar varchar(255)', () => {
  it('objetivo longo NÃO vai inteiro para o título (era a causa do HTTP 500)', () => {
    const spec = specLonga(1000);
    expect(spec.objective.length).toBeGreaterThan(LIMITE_DA_COLUNA);

    const contract = buildTaskContract(spec, { createdBy: 'ator' });
    expect(contract.title.length).toBeLessThanOrEqual(LIMITE_DA_COLUNA);
    // O texto completo continua preservado no campo que suporta (objective é `text`).
    expect(contract.objective).toBe(spec.objective);
  });

  it('o título é uma linha só (rótulo), não o texto multilinha', () => {
    const contract = buildTaskContract(specLonga(2000), {});
    expect(contract.title).not.toContain('\n');
    expect(contract.title.startsWith('Corrigir vulnerabilidade GHSA-x em fast-uri.')).toBe(true);
  });

  it('prefere o `title` da spec quando ele existe (o compilador já o limita)', () => {
    const contract = buildTaskContract({
      title: 'security: atualizar fast-uri 3.1.0 -> 3.1.8',
      missionType: 'BUG_FIX',
      objective: 'objetivo longo '.repeat(50),
    }, {});
    expect(contract.title).toBe('security: atualizar fast-uri 3.1.0 -> 3.1.8');
    expect(contract.objective).toBe('objetivo longo '.repeat(50));
  });

  it('título explícito absurdo também é cortado (defesa na fronteira da coluna)', () => {
    const contract = buildTaskContract({ title: 'x'.repeat(900), missionType: 'BUG_FIX' }, {});
    expect(contract.title.length).toBe(LIMITE_DA_COLUNA);
  });

  it('missão curta mantém o comportamento anterior (sem regressão de rótulo)', () => {
    const contract = buildTaskContract({
      missionType: 'BUG_FIX',
      objective: 'Ajustar o cabeçalho da tela de login.',
    }, {});
    expect(contract.title).toBe('Ajustar o cabeçalho da tela de login.');
  });

  it('spec sem objetivo nem título cai num rótulo (title é NOT NULL), nunca em vazio', () => {
    // `engineering_tasks.title` é NOT NULL e `objective` aceita nulo: o fallback é
    // obrigatório para não trocar o 500 de tamanho por um 500 de nulo.
    const contract = buildTaskContract({ missionType: 'BUG_FIX' }, {});
    expect(contract.title).toBe('Missão de engenharia');
    expect(contract.title.length).toBeGreaterThan(0);
    expect(contract.objective).toBeUndefined();
  });
});
