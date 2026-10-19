'use strict';

/**
 * Regressão do defeito medido no QA Mesh `mesh-2026-10-19T21-12-11-465Z`
 * (cenário `fitness-matricula-leads`, domínio crítico `omnichannel`):
 *
 *   `GET /api/qa-waves/intelligence/coverage` → **500 com corpo vazio**
 *   (proxy sem resposta) → 3 erros de console → `infra_error` → mesh NO_GO.
 *
 * Causa: o cache do índice de replays era tudo-ou-nada. Qualquer arquivo novo
 * invalidava a assinatura e o build seguinte re-parseava TODOS os replays.
 * Medido no runtime real: 756 arquivos / 3,0 GB (maior: 8,8 MB) e 38–57 s na
 * primeira chamada de `/coverage`. Sob 144 cenários abrindo `/dev/qa-waves`
 * simultaneamente, builds completos concorrentes travavam o event loop e a
 * conexão morria.
 *
 * Contratos travados aqui:
 *  1. arquivo INALTERADO não é reparseado (índice por mtime+size);
 *  2. arquivo NOVO custa só ele mesmo;
 *  3. arquivo ALTERADO é reparseado;
 *  4. arquivo REMOVIDO sai do índice;
 *  5. o índice continua correto por tenant (sem vazar replay de outro tenant);
 *  6. o cache em disco sobrevive a um processo novo.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const TMP_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'replay-index-'));
const REPLAY_DIR = path.join(TMP_ROOT, 'rpa', 'replay');
fs.mkdirSync(REPLAY_DIR, { recursive: true });

// Isola o runtime root ANTES do require (o caminho do cache em disco é
// resolvido no load do módulo) e desliga TTL/cooldown de memória para exercitar
// o índice por arquivo a cada chamada.
const { configureRuntimeRoot } = require('../../../api/utils/runtimePaths');
configureRuntimeRoot(TMP_ROOT);
process.env.QA_WAVES_REPLAY_INDEX_TTL_MS = '0';
process.env.QA_WAVES_REPLAY_INDEX_COOLDOWN_MS = '0';

const service = require('../../../api/services/qaWavesIntelligenceService');

function escreverReplay(nome, { scenarioId, tenantId = 'system', status = 'completed', finishedAt = '2026-10-19T12:00:00.000Z' }) {
  const alvo = path.join(REPLAY_DIR, `${nome}.json`);
  fs.writeFileSync(alvo, JSON.stringify({ scenarioId, tenantId, status, finishedAt, padding: 'x'.repeat(64) }));
  return alvo;
}

function contarLeiturasDoReplay(fn) {
  const original = fs.readFileSync;
  const lidos = [];
  const spy = jest.spyOn(fs, 'readFileSync').mockImplementation((file, ...rest) => {
    const abs = path.resolve(String(file));
    if (path.dirname(abs) === path.resolve(REPLAY_DIR)) lidos.push(path.basename(abs));
    return original(file, ...rest);
  });
  try {
    const resultado = fn();
    return { resultado, lidos };
  } finally {
    spy.mockRestore();
  }
}

describe('buildReplayIndex — índice incremental por arquivo', () => {
  afterAll(() => {
    try {
      fs.rmSync(TMP_ROOT, { recursive: true, force: true });
    } catch (_) {
      /* ignore */
    }
  });

  test('arquivo novo custa só ele; inalterado não é reparseado', () => {
    escreverReplay('a', { scenarioId: 'cen-a' });
    escreverReplay('b', { scenarioId: 'cen-b' });

    const primeiro = contarLeiturasDoReplay(() => service.buildReplayIndex('system'));
    expect(primeiro.lidos.sort()).toEqual(['a.json', 'b.json']);
    expect(primeiro.resultado['cen-a'].count).toBe(1);

    escreverReplay('c', { scenarioId: 'cen-c' });
    const segundo = contarLeiturasDoReplay(() => service.buildReplayIndex('system'));
    // Só o arquivo novo foi lido.
    expect(segundo.lidos).toEqual(['c.json']);
    expect(Object.keys(segundo.resultado).sort()).toEqual(['cen-a', 'cen-b', 'cen-c']);
  });

  test('arquivo alterado é reparseado e reflete o novo status', () => {
    const alvo = escreverReplay('d', { scenarioId: 'cen-d', status: 'completed' });
    service.buildReplayIndex('system');

    // Altera conteúdo (mtime+size mudam) — replay é write-once, então isto só
    // acontece em correção manual, mas o índice não pode ficar cego.
    fs.writeFileSync(alvo, JSON.stringify({
      scenarioId: 'cen-d', tenantId: 'system', status: 'failed',
      finishedAt: '2026-10-19T13:00:00.000Z', padding: 'y'.repeat(128),
    }));

    const { resultado, lidos } = contarLeiturasDoReplay(() => service.buildReplayIndex('system'));
    expect(lidos).toEqual(['d.json']);
    expect(resultado['cen-d'].hasFailure).toBe(true);
    expect(resultado['cen-d'].latestAt).toBe('2026-10-19T13:00:00.000Z');
  });

  test('arquivo removido sai do índice', () => {
    escreverReplay('e', { scenarioId: 'cen-e' });
    let idx = service.buildReplayIndex('system');
    expect(idx['cen-e']).toBeDefined();

    fs.unlinkSync(path.join(REPLAY_DIR, 'e.json'));
    idx = service.buildReplayIndex('system');
    expect(idx['cen-e']).toBeUndefined();
  });

  test('índice continua segmentado por tenant', () => {
    // `getAllReplayReadDirs(tenant)` isola o tenant: para um tenant não-default
    // o diretório comum NÃO é lido (só o dir do próprio tenant). O cache por
    // arquivo é compartilhado entre tenants, então o filtro precisa continuar
    // valendo depois dele.
    const { getAllReplayReadDirs } = require('../../../lib/rpaPathResolver');
    const dirOutroTenant = getAllReplayReadDirs('outro-tenant')[0];
    fs.mkdirSync(dirOutroTenant, { recursive: true });
    fs.writeFileSync(
      path.join(dirOutroTenant, 'f.json'),
      JSON.stringify({ scenarioId: 'cen-f', tenantId: 'outro-tenant', status: 'completed', finishedAt: '2026-10-19T12:00:00.000Z' }),
    );

    const sistema = service.buildReplayIndex('system');
    expect(sistema['cen-f']).toBeUndefined();

    const outro = service.buildReplayIndex('outro-tenant');
    expect(outro['cen-f']).toBeDefined();
  });

  test('cache em disco sobrevive a um processo novo (sem reparsear tudo)', () => {
    escreverReplay('g', { scenarioId: 'cen-g' });
    service.buildReplayIndex('system');
    const cachePath = path.join(TMP_ROOT, 'rpa', 'replay-index-cache.json');
    expect(fs.existsSync(cachePath)).toBe(true);

    jest.resetModules();
    const { configureRuntimeRoot: reconfigure } = require('../../../api/utils/runtimePaths');
    reconfigure(TMP_ROOT);
    const serviceNovo = require('../../../api/services/qaWavesIntelligenceService');

    const { resultado, lidos } = contarLeiturasDoReplay(() => serviceNovo.buildReplayIndex('system'));
    expect(Object.keys(resultado)).toContain('cen-g');
    // Nenhum replay foi reparseado: tudo veio do índice em disco.
    expect(lidos).toEqual([]);
  });
});
