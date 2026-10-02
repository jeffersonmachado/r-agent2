'use strict';

/**
 * Rotina de expurgo das evidências de RPA (`scripts/prune-rpa-reports.js`).
 *
 * O teste cobre os dois níveis que importam:
 *  1. os predicados puros (nome preservado × elegível, janela de retenção);
 *  2. uma varredura REAL em diretório temporário, com mtime ajustado, para
 *     provar que o walk escolhe exatamente o que deve e nada além.
 *
 * Contexto do defeito: o diretório acumulava 1,4 GB / 25.420 arquivos sem
 * retenção, e o expurgo pré-existente (`scripts/reset-all.sh`) só cobria
 * json/txt e só rodava em reset completo.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  DEFAULT_RETENTION_DAYS,
  isPreservedName,
  isPrunableName,
  isExpired,
  resolveRetentionDays,
  collectCandidates,
} = require('../../scripts/prune-rpa-reports');

const DAY_MS = 24 * 60 * 60 * 1000;

describe('prune-rpa-reports — predicados de nome', () => {
  it('preserva os ponteiros vivos que o runtime lê', () => {
    // `tests/rpa/business/reporting.js` lê este arquivo.
    expect(isPreservedName('business-qa-latest.json')).toBe(true);
    expect(isPreservedName('business-qa-latest.md')).toBe(true);
    expect(isPreservedName('demo-relatorio.json')).toBe(true);
    // memória do bug loop autônomo (core/rpa/bugResolution/bugMemoryStore.js)
    expect(isPreservedName('bug-memory.json')).toBe(true);
  });

  it('preservacao VENCE o padrao de evidencia (precedencia)', () => {
    // estes casam /^business-qa-.*\.(json|md)$/ mas NAO podem ser removidos
    expect(isPreservedName('business-qa-latest.json')).toBe(true);
    expect(isPrunableName('business-qa-latest.json')).toBe(false);
    expect(isPrunableName('business-qa-latest.md')).toBe(false);
    expect(isPrunableName('bug-memory.json')).toBe(false);
  });

  it('reconhece as evidencias historicas como elegiveis', () => {
    expect(isPrunableName('business-qa-2026-08-19T09-00-02-597Z.json')).toBe(true);
    expect(isPrunableName('business-qa-2026-08-19T09-00-02-597Z.md')).toBe(true);
    expect(isPrunableName('bug-1787130236736-10unzo.json')).toBe(true);
    expect(isPrunableName('bug-1787130236736-10unzo.md')).toBe(true);
    expect(isPrunableName('bug-state-1787130234754-oli69z.png')).toBe(true);
    expect(isPrunableName('rpa-report-1787695031952.json')).toBe(true);
    expect(isPrunableName('rpa-detail-test-flow-c2e65847.json')).toBe(true);
  });

  it('NAO considera elegivel nada que nao reconhece (fail-closed)', () => {
    // apagar o que nao se sabe classificar seria destruicao silenciosa
    expect(isPrunableName('README.md')).toBe(false);
    expect(isPrunableName('notes.txt')).toBe(false);
    expect(isPrunableName('important.json')).toBe(false);
    expect(isPrunableName('bug-memory-backup.json')).toBe(false);
    expect(isPrunableName('')).toBe(false);
    expect(isPrunableName(undefined)).toBe(false);
  });

  it('nao confunde evidencia com arquivo de outro tipo de bug', () => {
    // padrao exige o formato bug-<digitos>-<sufixo>; um nome livre nao casa
    expect(isPrunableName('bug-manual.md')).toBe(false);
    expect(isPrunableName('bug-123.json')).toBe(false);
  });
});

describe('prune-rpa-reports — janela de retencao', () => {
  const nowMs = Date.parse('2026-10-02T12:00:00.000Z');

  it('considera vencido somente o que passou da janela', () => {
    const retentionMs = 30 * DAY_MS;
    expect(isExpired({ mtimeMs: nowMs - 31 * DAY_MS, nowMs, retentionMs })).toBe(true);
    expect(isExpired({ mtimeMs: nowMs - 29 * DAY_MS, nowMs, retentionMs })).toBe(false);
    // exatamente na borda: nao expira (comparacao estrita)
    expect(isExpired({ mtimeMs: nowMs - 30 * DAY_MS, nowMs, retentionMs })).toBe(false);
  });

  it('sem dado confiavel de tempo NAO expira (fail-closed)', () => {
    expect(isExpired({ mtimeMs: NaN, nowMs, retentionMs: DAY_MS })).toBe(false);
    expect(isExpired({ mtimeMs: nowMs, nowMs: NaN, retentionMs: DAY_MS })).toBe(false);
    expect(isExpired({ mtimeMs: nowMs, nowMs, retentionMs: NaN })).toBe(false);
  });

  it('resolve a janela por CLI/env e RECUSA valor invalido', () => {
    expect(resolveRetentionDays({})).toBe(DEFAULT_RETENTION_DAYS);
    expect(resolveRetentionDays({ cliDays: '7' })).toBe(7);
    expect(resolveRetentionDays({ envDays: '15' })).toBe(15);
    // CLI vence o env
    expect(resolveRetentionDays({ cliDays: '3', envDays: '15' })).toBe(3);
    // retencao invalida NAO pode virar "apaga tudo"
    expect(() => resolveRetentionDays({ cliDays: '0' })).toThrow(/retencao_invalida/);
    expect(() => resolveRetentionDays({ cliDays: '-5' })).toThrow(/retencao_invalida/);
    expect(() => resolveRetentionDays({ cliDays: 'abc' })).toThrow(/retencao_invalida/);
  });
});

describe('prune-rpa-reports — varredura real em disco', () => {
  let tmpDir;
  const nowMs = Date.now();

  const writeAged = (relPath, { ageDays, content = 'x' }) => {
    const full = path.join(tmpDir, relPath);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
    const when = (nowMs - ageDays * DAY_MS) / 1000;
    fs.utimesSync(full, when, when);
    return full;
  };

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prune-rpa-reports-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('seleciona so evidencia vencida e preserva ponteiros, memoria e desconhecidos', () => {
    const oldBugJson = writeAged(path.join('bugs', 'bug-1787130236736-10unzo.json'), { ageDays: 45 });
    writeAged(path.join('bugs', 'bug-1787130236736-10unzo.md'), { ageDays: 45 });
    writeAged(path.join('bugs', 'assets', 'bug-state-1787130234754-oli69z.png'), { ageDays: 45 });
    writeAged('business-qa-2026-08-19T09-00-02-597Z.json', { ageDays: 45 });

    const freshEvidence = writeAged('business-qa-2026-10-02T09-00-02-597Z.json', { ageDays: 1 });
    const latestPointer = writeAged('business-qa-latest.json', { ageDays: 45 });
    writeAged('demo-relatorio.json', { ageDays: 45 });
    writeAged(path.join('bugs', 'bug-memory.json'), { ageDays: 45 });
    const unknown = writeAged('README.md', { ageDays: 45 });

    const { selected, preservedByPattern, unrecognized } = collectCandidates(tmpDir, {
      nowMs,
      retentionMs: 30 * DAY_MS,
    });

    const selectedRel = selected.map((item) => path.relative(tmpDir, item.full)).sort();
    expect(selectedRel).toEqual([
      path.join('bugs', 'assets', 'bug-state-1787130234754-oli69z.png'),
      path.join('bugs', 'bug-1787130236736-10unzo.json'),
      path.join('bugs', 'bug-1787130236736-10unzo.md'),
      'business-qa-2026-08-19T09-00-02-597Z.json',
    ]);

    // evidencia recente NAO entra
    expect(selectedRel).not.toContain(path.relative(tmpDir, freshEvidence));
    // ponteiros e memoria ficam
    expect(preservedByPattern.map((p) => path.basename(p))).toEqual(
      expect.arrayContaining(['business-qa-latest.json', 'demo-relatorio.json', 'bug-memory.json'])
    );
    expect(selectedRel).not.toContain(path.relative(tmpDir, latestPointer));
    // desconhecido nao e removido nem classificado como evidencia
    expect(unrecognized.map((p) => path.basename(p))).toEqual(['README.md']);
    expect(selectedRel).not.toContain(path.relative(tmpDir, unknown));
  });

  it('nao segue symlink para fora do alvo', () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'prune-outside-'));
    const outsideFile = path.join(outside, 'business-qa-2026-08-19T09-00-02-597Z.json');
    fs.writeFileSync(outsideFile, 'nao pode ser tocado');
    const old = (nowMs - 45 * DAY_MS) / 1000;
    fs.utimesSync(outsideFile, old, old);

    try {
      fs.symlinkSync(outsideFile, path.join(tmpDir, 'business-qa-2026-01-01T00-00-00-000Z.json'));
    } catch (_) {
      fs.rmSync(outside, { recursive: true, force: true });
      return; // ambiente sem suporte a symlink: nada a provar
    }

    const { selected } = collectCandidates(tmpDir, { nowMs, retentionMs: 30 * DAY_MS });
    expect(selected).toHaveLength(0);

    fs.rmSync(outside, { recursive: true, force: true });
  });
});
