'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

/**
 * Regressão: pruneOldHistory/loadHistory ordenavam o histórico
 * LEXICOGRAFICAMENTE pelo nome do arquivo. Com os dois esquemas de nome em
 * uso (`mesh-<ISO>.json` do runMesh direto e `meshq-<epoch>-<rand>.json` da
 * executionQueue), qualquer arquivo meshq- ordena depois de qualquer mesh-,
 * independentemente da data real. Resultado observado em 2026-07-26: a
 * retenção (MAX_HISTORY=5) apagou as execuções de HOJE (incluindo a prova
 * passed da jornada blocking) e manteve arquivos de 2 dias atrás — e
 * loadHistory(1) devolvia uma execução velha como "mais recente".
 *
 * A ordenação correta é pela data real embutida no nome (epoch do meshq-,
 * ISO do mesh-), com fallback para mtime.
 */

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'mesh-history-recency-'));
process.env.QA_MESH_HISTORY_DIR = path.join(TMP, 'history');
process.env.QA_MESH_EVIDENCE_DIR = path.join(TMP, 'evidence');
process.env.QA_MESH_MAX_HISTORY = '5';

const { loadHistory } = require('../meshRunner');

function writeRun(dir, name, startedAt) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), JSON.stringify({
    executionId: name.replace(/\.json$/, ''),
    startedAt,
    results: [],
  }), 'utf8');
}

// Epochs reais do incidente: meshq de 2026-07-24, mesh- de 2026-07-26.
const RUNS = [
  { name: 'meshq-1784902594396-4p60s2.json', startedAt: '2026-07-24T14:16:34.396Z' },
  { name: 'meshq-1784903201362-r221rm.json', startedAt: '2026-07-24T14:26:41.362Z' },
  { name: 'meshq-1784905966436-c01jil.json', startedAt: '2026-07-24T15:12:46.436Z' },
  { name: 'meshq-1784921478792-6e2ht7.json', startedAt: '2026-07-24T19:31:18.792Z' },
  { name: 'meshq-1784922319709-mrtyoq.json', startedAt: '2026-07-24T19:45:19.709Z' },
  { name: 'mesh-2026-07-26T11-15-00-278Z.json', startedAt: '2026-07-26T11:15:00.278Z' },
  { name: 'mesh-2026-07-26T11-36-24-040Z.json', startedAt: '2026-07-26T11:36:24.040Z' },
];

describe('meshRunner — recência real do histórico (mesh- vs meshq-)', () => {
  test('loadHistory ordena pela data real, não pelo nome', () => {
    const dir = process.env.QA_MESH_HISTORY_DIR;
    for (const run of RUNS) writeRun(dir, run.name, run.startedAt);

    const history = loadHistory(5);

    expect(history).toHaveLength(5);
    expect(history[0].startedAt).toBe('2026-07-26T11:36:24.040Z');
    expect(history[1].startedAt).toBe('2026-07-26T11:15:00.278Z');
    expect(history[2].startedAt).toBe('2026-07-24T19:45:19.709Z');
  });

  test('retenção preserva as execuções mais recentes (as de hoje sobrevivem)', () => {
    const dir = process.env.QA_MESH_HISTORY_DIR;
    fs.rmSync(dir, { recursive: true, force: true });
    for (const run of RUNS) writeRun(dir, run.name, run.startedAt);

    loadHistory(1); // dispara pruneOldHistory

    const remaining = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
    expect(remaining).toHaveLength(5);
    expect(remaining).toContain('mesh-2026-07-26T11-36-24-040Z.json');
    expect(remaining).toContain('mesh-2026-07-26T11-15-00-278Z.json');
    // 7 arquivos, retenção 5: somente os 2 MAIS ANTIGOS são podados.
    expect(remaining).not.toContain('meshq-1784902594396-4p60s2.json');
    expect(remaining).not.toContain('meshq-1784903201362-r221rm.json');
    expect(remaining).toEqual([
      'mesh-2026-07-26T11-15-00-278Z.json',
      'mesh-2026-07-26T11-36-24-040Z.json',
      'meshq-1784905966436-c01jil.json',
      'meshq-1784921478792-6e2ht7.json',
      'meshq-1784922319709-mrtyoq.json',
    ]);
  });
});
