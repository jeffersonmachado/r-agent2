'use strict';

/**
 * Prova que o validador da fila recusa COMMIT ÓRFÃO como evidência.
 *
 * DEFEITO MEDIDO (2026-10-21): 3 itens `done` citavam `5f6d0c1c9`, hash que não existe em nenhum
 * objeto do repositório (reescrito em rebase). O validador só exigia "campo não vazio", então a
 * fila exibia provas que ninguém podia abrir — falso verde com aparência de rigor. As correções
 * eram reais; o PONTEIRO estava órfão e ninguém detectava.
 *
 * Este teste usa o validador REAL (não um dublê) contra hashes reais do próprio repositório.
 */

const { execFileSync } = require('child_process');
const { validar } = require('../../../scripts/governance/validate-hardening-queue');

function commitReal() {
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: process.cwd(), encoding: 'utf8' }).trim();
}

function filaCom(item) {
  return {
    items: [
      {
        id: 'ITEM-TESTE',
        title: 'item de teste',
        status: 'prevention_active',
        commit: commitReal(),
        evidence: 'prova',
        prevention: 'regra',
        ...item,
      },
    ],
  };
}

describe('validate-hardening-queue — prova precisa ser abrível', () => {
  test('commit real do repositório é aceito', () => {
    const { violations } = validar(filaCom({}));
    expect(violations.filter((v) => v.code === 'COMMIT_INEXISTENTE')).toHaveLength(0);
  });

  test('hash inexistente é VIOLAÇÃO (o caso 5f6d0c1c9)', () => {
    const { violations } = validar(filaCom({ commit: '5f6d0c1c9' }));
    const falha = violations.find((v) => v.code === 'COMMIT_INEXISTENTE');
    expect(falha).toBeTruthy();
    expect(falha.detail).toContain('5f6d0c1c9');
  });

  test('commit abreviado que existe continua aceito (não exige 40 chars)', () => {
    const curto = commitReal().slice(0, 8);
    const { violations } = validar(filaCom({ commit: curto }));
    expect(violations.filter((v) => v.code === 'COMMIT_INEXISTENTE')).toHaveLength(0);
  });

  test('formato inválido (não-hex, com espaço) é VIOLAÇÃO mesmo sem consultar o git', () => {
    for (const invalido of ['HEAD~1', 'abc', 'zzzzzzz', 'deadbeef not-a-sha']) {
      const { violations } = validar(filaCom({ commit: invalido }));
      expect(violations.some((v) => v.code === 'COMMIT_INEXISTENTE')).toBe(true);
    }
  });

  test('item sem commit não gera COMMIT_INEXISTENTE (é outra violação: campo obrigatório)', () => {
    const { violations } = validar(filaCom({ commit: undefined }));
    expect(violations.some((v) => v.code === 'COMMIT_INEXISTENTE')).toBe(false);
    expect(violations.some((v) => v.code === 'CAMPO_OBRIGATORIO_AUSENTE')).toBe(true);
  });
});
