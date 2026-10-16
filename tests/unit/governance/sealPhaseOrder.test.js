'use strict';

/**
 * P0-3 — CERTIFICAR ANTES DE PUBLICAR.
 *
 * DEFEITO REAL medido em 2026-10-15/16: a ordem era
 * `prepare → candidate → final → publish → consolidate`, ou seja, a TAG era criada
 * ANTES dos gates obrigatórios (gate agregado, aprovação de deploy, prova de runtime
 * do mcp-research, cadeia criptográfica). Três ciclos abortaram no `consolidate` com
 * a tag JÁ no remote — a promessa pública (a tag) existia antes da verificação que
 * deveria sustentá-la.
 *
 * Critério de aceite da missão: "uma falha injetada em qualquer gate pré-publicação
 * impede a criação da tag". Este teste protege as três condições necessárias:
 *   (1) a ORDEM declarada executa a certificação antes da publicação;
 *   (2) a criação da tag vive SÓ na fase de publicação;
 *   (3) a fase de publicação NÃO executa gate nenhum (publicar não re-certifica).
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const SELO = path.join(ROOT, 'scripts', 'governance', 'seal-release.sh');
const fonte = () => fs.readFileSync(SELO, 'utf8');

/** Corpo de uma fase (do cabeçalho `phase_x() {` até o `}` na coluna 0). */
function corpoDaFase(nome) {
  const texto = fonte();
  const alvo = `phase_${nome}() {`;
  const inicio = texto.indexOf(alvo);
  if (inicio < 0) return null;
  const resto = texto.slice(inicio + alvo.length);
  const fim = resto.indexOf('\n}');
  return fim < 0 ? resto : resto.slice(0, fim);
}

// Invocações que caracterizam um GATE obrigatório (não são passos de publicação).
const GATES = [
  'validate:governance-enforcement',
  'validate-governance-chain.js',
  'verify-mcp-research-docker-e2e-pass.js',
  'system:go-no-go',
];

describe('P0-3 — a ordem das fases certifica antes de publicar', () => {
  it('PHASES executa consolidate e certify ANTES de publish, com verify-delivery por último', () => {
    const m = fonte().match(/^PHASES=\(([^)]*)\)/m);
    expect(m).toBeTruthy();
    const fases = m[1].trim().split(/\s+/);
    expect(fases).toEqual([
      'prepare',
      'candidate',
      'final',
      'consolidate',
      'certify',
      'publish',
      'verify-delivery',
    ]);
    expect(fases.indexOf('consolidate')).toBeLessThan(fases.indexOf('publish'));
    expect(fases.indexOf('certify')).toBeLessThan(fases.indexOf('publish'));
    expect(fases[fases.length - 1]).toBe('verify-delivery');
  });

  it('a criação da TAG existe SÓ na fase publish', () => {
    const publish = corpoDaFase('publish');
    expect(publish).toBeTruthy();
    expect(publish).toContain('create-release-tag.sh');
    for (const fase of ['consolidate', 'certify', 'verify_delivery', 'prepare', 'candidate', 'final']) {
      const corpo = corpoDaFase(fase);
      expect(corpo).toBeTruthy();
      expect(corpo).not.toContain('create-release-tag.sh');
    }
  });

  it('publicar NÃO re-certifica: a fase publish não executa gate obrigatório', () => {
    const publish = corpoDaFase('publish');
    for (const gate of GATES) {
      expect(publish).not.toContain(gate);
    }
  });

  it('os gates obrigatórios vivem em consolidate/certify (controle positivo do teste)', () => {
    const consolidate = corpoDaFase('consolidate');
    const certify = corpoDaFase('certify');
    expect(consolidate).toContain('validate:governance-enforcement');
    expect(certify).toContain('validate-governance-chain.js');
    expect(certify).toContain('verify-mcp-research-docker-e2e-pass.js');
    expect(certify).toContain('system:go-no-go');
  });

  it('o despacho cobre as 7 fases — `verify-delivery` tem hífen e não é função bash', () => {
    const texto = fonte();
    expect(texto).toContain('dispatch_phase()');
    // A fase com hífen precisa de mapeamento explícito: `phase_$phase` falharia com
    // "command not found" e o ciclo terminaria SEM a verificação final.
    expect(texto).toMatch(/verify-delivery\)\s+phase_verify_delivery/);
    expect(texto).not.toMatch(/"phase_\$phase"/);
  });

  it('a certificação da cadeia (P0-2) roda na fase certify, não em consolidate', () => {
    const consolidate = corpoDaFase('consolidate');
    const certify = corpoDaFase('certify');
    expect(certify).toContain('sign-governance.js');
    expect(consolidate).not.toContain('sign-governance.js');
  });
});
