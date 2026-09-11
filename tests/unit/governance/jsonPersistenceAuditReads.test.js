'use strict';

/**
 * AUDITORIA DE ESTADO JSON — LEITURA NÃO É ESCRITA (RAP-078)
 *
 * Defeito reproduzido: o scanner de alvos de escrita tratava TODO
 * `path.join(..., 'algo.json')` como alvo de escrita. Ao introduzir
 * `governance/certification-states.js` — que apenas LÊ
 * `config/integrations/evo-contract.json` —, o gate passou a acusar
 * `UNKNOWN_JSON_WRITE_TARGET: evo-contract.json` e reprovava `verify:no-mutable-json-state`
 * e a dimensão RAP-078 sem existir uma única escrita.
 *
 * O verde aqui é o scanner separar LEITURA de ESCRITA: nenhum escritor real
 * pode deixar de ser detectado (isso seria fail-open em governança).
 */

const path = require('path');

const {
  buildAudit,
  isReaderCallContext,
  scanWriteTargets,
} = require('../../../governance/json-persistence-audit');

describe('isReaderCallContext distingue leitura de escrita', () => {
  const src = "const c = readJsonIfExists(path.join(rootDir, 'config', 'evo-contract.json'));";
  const writeSrc = "writeJson(path.join(ROOT, 'governance', 'final-proof-report.json'), proof);";
  const readFileSrc = "const raw = fs.readFileSync(path.join(ROOT, 'config', 'x.json'), 'utf8');";

  it('marca como LEITURA o path.join dentro de readJson*', () => {
    const index = src.indexOf('path.join');
    expect(isReaderCallContext(src, index)).toBe(true);
  });

  it('marca como LEITURA o path.join dentro de readFileSync', () => {
    expect(isReaderCallContext(readFileSrc, readFileSrc.indexOf('path.join'))).toBe(true);
  });

  it('marca como LEITURA o path.join dentro de require', () => {
    const s = "const c = require(path.join(ROOT, 'config', 'x.json'));";
    expect(isReaderCallContext(s, s.indexOf('path.join'))).toBe(true);
  });

  it('NÃO marca como leitura o path.join dentro de um writer', () => {
    expect(isReaderCallContext(writeSrc, writeSrc.indexOf('path.join'))).toBe(false);
  });

  it('NÃO marca como leitura um path.join isolado (atribuição e escrita posterior)', () => {
    const s = "const p = path.join(ROOT, 'reports', 'x.json'); writeFileSync(p, data);";
    expect(isReaderCallContext(s, s.indexOf('path.join'))).toBe(false);
  });
});

describe('a auditoria real não confunde leitura com alvo de escrita', () => {
  const audit = buildAudit();

  it('não há alvo UNKNOWN (o falso positivo era exatamente isso)', () => {
    expect(audit.summary.unknown).toBe(0);
    expect(audit.entries.filter((e) => e.category === 'UNKNOWN')).toEqual([]);
  });

  it('o contrato EVO lido pelo módulo de certificação não é registrado como escrita', () => {
    const offender = audit.entries.find(
      (e) => e.writer === 'governance/certification-states.js' && e.target.includes('evo-contract.json'),
    );
    expect(offender).toBeUndefined();
  });

  it('nenhum alvo UNKNOWN é usado como desculpa para rebaixar a classificação', () => {
    // O gate exige 0 UNKNOWN — o caminho legítimo é classificar, não silenciar.
    const unknown = audit.entries.filter((e) => e.category === 'UNKNOWN');
    const deprecated = audit.entries.filter((e) => e.category === 'DEPRECATED');
    const dbCanonicalState = audit.entries.filter((e) => e.category === 'DB_CANONICAL_STATE');
    expect({ unknown: unknown.length, deprecated: deprecated.length, dbCanonicalState: dbCanonicalState.length })
      .toEqual({ unknown: 0, deprecated: 0, dbCanonicalState: 0 });
  });

  it('escritores REAIS continuam detectados (o filtro não é fail-open)', () => {
    const targets = scanWriteTargets();
    const all = [...targets.values()].map((e) => e.target);
    // Alvos de escrita de relatórios governados continuam presentes.
    expect(all).toContain('governance/mutable-json-state-validation-report.json');
    expect(all).toContain('governance/final-readiness-report.json');
    expect(all).toContain('qa-mesh/go-no-go-report.json');
    expect(all).toContain('reports/coverage-gate-report.json');
    // E o produtor externo de readiness segue sendo um escritor detectado.
    const writers = new Set([...targets.values()].map((e) => e.writer));
    expect(writers.has(path.posix.join('tools', 'system', 'platform-readiness.js'))).toBe(true);
    expect(writers.has(path.posix.join('scripts', 'governance', 'run-persisted-scorecard.js'))).toBe(true);
  });
});
