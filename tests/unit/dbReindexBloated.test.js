'use strict';

/**
 * Rotina de detecção/correção de bloat de índice (`scripts/db-reindex-bloated.js`).
 *
 * Os números usados aqui são os MEDIDOS em 2026-10-02 no banco real — o limite
 * default só tem valor se for rastreável até uma medição, não a um palpite.
 *
 *   tabela            indices ANTES   indices DEPOIS   linhas     indices
 *   event_ledger       5.393 MB         424 MB        873.910      8
 *   execution_jobs     2.100 MB         310 MB      1.524.955      5
 *
 * Prova direta do inchaço: um índice NOVO com a mesma definição de
 * `event_ledger_tenant_occurred_at_idx` — (tenant_key, occurred_at) — ocupou
 * 26 MB contra 283 MB do existente (10,9x), construído em 1,8 s.
 */

const {
  DEFAULT_THRESHOLD_BYTES_PER_ROW,
  indexBytesPerRow,
  isBloated,
  isEligible,
  parseArgs,
  resolvePositiveNumber,
} = require('../../scripts/db-reindex-bloated');

const MB = 1024 * 1024;

describe('db-reindex-bloated — metrica de bytes por linha por indice', () => {
  it('mede o estado SAUDAVEL do event_ledger pos-REINDEX', () => {
    const bytesPerRow = indexBytesPerRow({ indexBytes: 424 * MB, liveRows: 873910, indexCount: 8 });
    expect(bytesPerRow).toBeGreaterThan(50);
    expect(bytesPerRow).toBeLessThan(80);
    expect(isBloated({ bytesPerRow })).toBe(false);
  });

  it('mede o estado INCHADO do event_ledger antes do REINDEX', () => {
    const bytesPerRow = indexBytesPerRow({ indexBytes: 5393 * MB, liveRows: 873910, indexCount: 8 });
    expect(bytesPerRow).toBeGreaterThan(700);
    expect(isBloated({ bytesPerRow })).toBe(true);
  });

  it('mede o estado INCHADO do execution_jobs (fator menor, ainda acima do limite)', () => {
    const bloatado = indexBytesPerRow({ indexBytes: 2100 * MB, liveRows: 1524955, indexCount: 5 });
    const saudavel = indexBytesPerRow({ indexBytes: 310 * MB, liveRows: 1524955, indexCount: 5 });
    expect(isBloated({ bytesPerRow: bloatado })).toBe(true);
    expect(isBloated({ bytesPerRow: saudavel })).toBe(false);
    // o fator real foi 6,8x
    expect(bloatado / saudavel).toBeGreaterThan(6);
  });

  it('NAO marca indice legitimamente largo (falso positivo que mataria a confianca)', () => {
    // event_ledger_tenant_type_idempotency_uq = (tenant_key, type, idempotency_key)
    // 158 MB / 873.910 linhas = 181 B/linha — largo por natureza, nao por bloat
    const bytesPerRow = indexBytesPerRow({ indexBytes: 158 * MB, liveRows: 873910, indexCount: 1 });
    expect(bytesPerRow).toBeGreaterThan(150);
    expect(isBloated({ bytesPerRow })).toBe(false);
    expect(DEFAULT_THRESHOLD_BYTES_PER_ROW).toBeGreaterThan(bytesPerRow);
  });

  it('devolve null quando nao ha como dividir (fail-closed)', () => {
    expect(indexBytesPerRow({ indexBytes: 1000, liveRows: 0, indexCount: 1 })).toBeNull();
    expect(indexBytesPerRow({ indexBytes: 1000, liveRows: 100, indexCount: 0 })).toBeNull();
    expect(indexBytesPerRow({ indexBytes: Number.NaN, liveRows: 100, indexCount: 1 })).toBeNull();
    expect(indexBytesPerRow({ indexBytes: null, liveRows: null, indexCount: null })).toBeNull();
  });

  it('LIMITACAO CONHECIDA: a margem entre "legitimo largo" e "inchado" e estreita', () => {
    // Este teste existe para que ninguem superestime a metrica. Ela conflita
    // "chave larga" com "bloat": 181 (legitimo) contra 288 (inchado) = ~1,6x.
    const legitimoLargo = indexBytesPerRow({ indexBytes: 158 * MB, liveRows: 873910, indexCount: 1 });
    const menorInchadoConfirmado = indexBytesPerRow({ indexBytes: 2100 * MB, liveRows: 1524955, indexCount: 5 });

    const margem = menorInchadoConfirmado / legitimoLargo;
    expect(margem).toBeGreaterThan(1);
    expect(margem).toBeLessThan(2); // margem estreita, de proposito documentada

    // o limite fica ENTRE os dois: marca o inchado, poupa o legitimo
    expect(DEFAULT_THRESHOLD_BYTES_PER_ROW).toBeGreaterThan(legitimoLargo);
    expect(DEFAULT_THRESHOLD_BYTES_PER_ROW).toBeLessThan(menorInchadoConfirmado);

    // O vies e para BAIXO de proposito: falso positivo = REINDEX inofensivo;
    // falso negativo = inchaco acumulando. A verificacao decisiva e reconstruir
    // uma copia e comparar (foi assim que o defeito foi provado: 26 MB vs 283 MB).
    expect(isBloated({ bytesPerRow: menorInchadoConfirmado })).toBe(true);
  });
});

describe('db-reindex-bloated — decisao', () => {
  it('sem metrica confiavel NAO recomenda reconstruir', () => {
    expect(isBloated({ bytesPerRow: null })).toBe(false);
    expect(isBloated({ bytesPerRow: Number.NaN })).toBe(false);
    expect(isBloated({ bytesPerRow: undefined })).toBe(false);
  });

  it('limite invalido NAO vira "reindexar tudo"', () => {
    // com limite <= 0 qualquer valor positivo passaria; a funcao recusa
    expect(isBloated({ bytesPerRow: 500, thresholdBytesPerRow: 0 })).toBe(false);
    expect(isBloated({ bytesPerRow: 500, thresholdBytesPerRow: -1 })).toBe(false);
    expect(isBloated({ bytesPerRow: 500, thresholdBytesPerRow: Number.NaN })).toBe(false);
  });

  it('comparacao e estritamente maior que o limite', () => {
    expect(isBloated({ bytesPerRow: 300, thresholdBytesPerRow: 300 })).toBe(false);
    expect(isBloated({ bytesPerRow: 301, thresholdBytesPerRow: 300 })).toBe(true);
  });

  it('ignora tabelas pequenas (ruido estatistico)', () => {
    expect(isEligible({ liveRows: 10, minRows: 5000 })).toBe(false);
    expect(isEligible({ liveRows: 5000, minRows: 5000 })).toBe(true);
    expect(isEligible({ liveRows: 900000, minRows: 5000 })).toBe(true);
    expect(isEligible({ liveRows: Number.NaN, minRows: 5000 })).toBe(false);
  });

  it('le --execute, --threshold e --min-rows', () => {
    expect(parseArgs([])).toEqual({ execute: false, threshold: undefined, minRows: undefined });
    expect(parseArgs(['--execute']).execute).toBe(true);
    expect(parseArgs(['--threshold=500']).threshold).toBe('500');
    expect(parseArgs(['--min-rows=20000']).minRows).toBe('20000');
  });

  it('recusa parametro numerico invalido em vez de assumir default silencioso', () => {
    expect(resolvePositiveNumber(undefined, 300, 'threshold')).toBe(300);
    expect(resolvePositiveNumber('500', 300, 'threshold')).toBe(500);
    expect(() => resolvePositiveNumber('0', 300, 'threshold')).toThrow(/threshold_invalido/);
    expect(() => resolvePositiveNumber('-1', 300, 'threshold')).toThrow(/threshold_invalido/);
    expect(() => resolvePositiveNumber('abc', 300, 'threshold')).toThrow(/threshold_invalido/);
  });
});
