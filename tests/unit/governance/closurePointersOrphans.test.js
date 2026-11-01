'use strict';

/**
 * HARDENING-ENG-GOV-RELEASE-PONTEIROS-CLOSURE-ORFAOS — ponteiros de fechamento na RAIZ.
 *
 * Contexto medido (2026-10-16): quatro arquivos de fechamento na raiz congelaram em
 * 2026-09-22/24 e NENHUM script os produzia ou validava. Um auditor externo que os
 * lesse como estado corrente auditaria o passado.
 *
 * Esta suíte trava três coisas — as três que impedem a regressão:
 *   1. o ponteiro está MARCADO como histórico (e o conteúdo original foi preservado,
 *      porque marcar não pode destruir a evidência);
 *   2. o entrypoint de auditoria AVISA sobre cada ponteiro que existe — o aviso não é
 *      opcional, é o que faz o leitor externo não confundir passado com presente;
 *   3. nenhum gate os consome como autoridade (se alguém religar um validador neles,
 *      o ponteiro morto volta a mandar na decisão).
 */

const fs = require('fs');
const path = require('path');

const RAIZ = path.resolve(__dirname, '..', '..', '..');

const PONTEIROS = [
  'FINAL_RAP_RELEASE_CLOSURE.json',
  'FINAL_RELEASE_CLOSURE.md',
  'ENGINEERING_ROUTER_V1_SEAL_REPORT.json',
  'ENGINEERING_ROUTER_V1_FINAL_SEAL.md',
];

const lerJson = (rel) => JSON.parse(fs.readFileSync(path.join(RAIZ, rel), 'utf8'));
const existe = (rel) => fs.existsSync(path.join(RAIZ, rel));

describe('ponteiros de closure — o histórico está MARCADO, não apagado', () => {
  test('FINAL_RAP_RELEASE_CLOSURE.json declara SUPERSEDED apontando para arquivo que existe', () => {
    const d = lerJson('FINAL_RAP_RELEASE_CLOSURE.json');
    expect(d.status).toBe('SUPERSEDED');
    expect(d.supersededAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(typeof d.supersededReason).toBe('string');
    expect(d.supersededReason.length).toBeGreaterThan(80);
    // O destino do aviso tem de existir — senão o leitor é mandado para o vazio.
    // DEFEITO MEDIDO (2026-11-01): apontava para `AUDIT_ENTRYPOINT.json`, que NUNCA pode
    // existir (publicar .json em AI_MEMORY/evidence/ reprova `json-persistence-audit`).
    expect(existe(d.supersededBy)).toBe(true);
    // A correção do ponteiro é registrada, não silenciosa: o alvo antigo fica auditável.
    expect(d.supersededByCorrection).toBeDefined();
    expect(d.supersededByCorrection.from).toBe('AI_MEMORY/evidence/AUDIT_ENTRYPOINT.json');
    expect(d.supersededByCorrection.reason.length).toBeGreaterThan(40);
  });

  test('o conteúdo ORIGINAL foi preservado (marcar não pode destruir a evidência)', () => {
    const d = lerJson('FINAL_RAP_RELEASE_CLOSURE.json');
    // Campos que provam que o artefato é o mesmo medido em 2026-09-24, não um casco.
    expect(typeof d.source.headNow).toBe('string');
    expect(d.source.headNow).toMatch(/^[0-9a-f]{7,40}$/);
    expect(d.engineeringRouter).toBeDefined();
    expect(d.supersededMeasurement).toBeDefined();
  });

  test('o aviso de staleness acompanha o artefato (não só o campo de status)', () => {
    const d = lerJson('FINAL_RAP_RELEASE_CLOSURE.json');
    const aviso = JSON.stringify(d);
    expect(aviso).toMatch(/n[ãa]o\s+representa/i);
    expect(aviso).toMatch(/AUDIT_ENTRYPOINT/);
  });
});

describe('ponteiros de closure — o entrypoint AVISA sobre cada um que existe', () => {
  const md = fs.readFileSync(path.join(RAIZ, 'AI_MEMORY/evidence/AUDIT_ENTRYPOINT.md'), 'utf8');

  test('existe a seção explícita que proíbe usá-los como estado atual', () => {
    expect(md).toMatch(/## Ponteiros stale na raiz .*N[ÃA]O use como estado atual/);
  });

  test.each(PONTEIROS)('%s é citado no aviso do entrypoint', (rel) => {
    // Só exige citação para quem existe: ponteiro removido não pode virar exigência.
    if (!existe(rel)) return;
    expect(md).toContain(rel);
  });

  test('o entrypoint aponta para a fonte correta do estado (não para os ponteiros)', () => {
    expect(md).toContain('AI_MEMORY/evidence/AUDIT_ENTRYPOINT.json');
  });
});

describe('ponteiros de closure — nenhum gate os consome como autoridade', () => {
  /**
   * A varredura é por CONSUMO, não por menção: comentários e docs podem (e devem) citá-los.
   * O que não pode é `readFileSync`/`require`/`--file` apontando para eles dentro de um
   * caminho executável de gate.
   */
  const DIRS = ['scripts/governance', 'governance', 'tools/system'];

  const arquivos = (dirRel) => {
    const abs = path.join(RAIZ, dirRel);
    if (!fs.existsSync(abs)) return [];
    const saida = [];
    const pilha = [abs];
    while (pilha.length > 0) {
      const atual = pilha.pop();
      for (const entrada of fs.readdirSync(atual, { withFileTypes: true })) {
        const filho = path.join(atual, entrada.name);
        if (entrada.isDirectory()) {
          if (entrada.name === 'node_modules' || entrada.name.startsWith('.')) continue;
          pilha.push(filho);
        } else if (entrada.name.endsWith('.js') && !entrada.name.endsWith('.test.js')) {
          saida.push(filho);
        }
      }
    }
    return saida;
  };

  test.each(PONTEIROS)('%s não é lido por nenhum gate executável', (rel) => {
    const consumidores = [];
    for (const dir of DIRS) {
      for (const arquivo of arquivos(dir)) {
        const fonte = fs.readFileSync(arquivo, 'utf8');
        // Consumo real: o nome do arquivo passado a uma leitura/require.
        const padrao = new RegExp(`(readFileSync|readJson|require)\\([^)]*${rel.replace(/\./g, '\\.')}`);
        if (padrao.test(fonte)) consumidores.push(path.relative(RAIZ, arquivo));
      }
    }
    expect(consumidores).toEqual([]);
  });

  test('a varredura tem alcance real (não passa por diretório vazio)', () => {
    const total = DIRS.reduce((n, dir) => n + arquivos(dir).length, 0);
    expect(total).toBeGreaterThan(50);
  });
});
