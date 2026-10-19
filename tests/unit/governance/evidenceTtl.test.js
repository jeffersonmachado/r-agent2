'use strict';

/**
 * P1-11 — TTL/frescor de evidência: TTL inválido, timestamp ausente/inválido/
 * futuro, expiração durante o processamento e identidade estrangeira.
 *
 * Defeito medido que motivou o hardening:
 *   `const WAVE_REPORT_MAX_AGE_MS = Number(env) || 7d`
 * aceitava `Infinity` (env `Infinity` ou `1e999`). Com isso
 * `idade > Infinity` é SEMPRE falso ⇒ nenhuma wave vencia jamais ⇒ fail-open
 * silencioso de L1. O mesmo valia para qualquer TTL declarado não-finito.
 *
 * Além disso, timestamp no FUTURO dava idade negativa e a evidência passava por
 * "fresca" indefinidamente; e nada checava se a evidência pertencia ao run/commit
 * corrente, nem se ela iria vencer ANTES do fim do processamento (o gate aprova,
 * o selo termina depois e o veredito passa a se referir a evidência vencida).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  MOTIVO,
  DEFAULT_TOLERANCIA_FUTURO_MS,
  DEFAULT_FOLGA_PROCESSAMENTO_MS,
  validarTtl,
  avaliarFrescor,
  validarEvidencia,
} = require('../../../governance/evidence-ttl');

const { loadApiSurfaceTechnicalExecutions } = require('../../../scripts/governance/validate-coverage-gate');

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-08-01T12:00:00.000Z');

const API_INVENTORY = [{ id: 'api:GET:/api/widgets', kind: 'api' }];

function writeReport(payload) {
  const reportPath = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), 'evidence-ttl-')),
    'report.json',
  );
    fs.writeFileSync(reportPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return reportPath;
}

function iso(offsetMs) {
  return new Date(NOW - offsetMs).toISOString();
}

describe('P1-11 validarTtl — TTL declarado nunca aumenta a validade', () => {
  test('ausente com default => usa o default (e diz que a origem e default)', () => {
    for (const ausente of [undefined, null, '']) {
      const r = validarTtl(ausente, { defaultMs: SEVEN_DAYS_MS });
      expect(r.ok).toBe(true);
      expect(r.ms).toBe(SEVEN_DAYS_MS);
      expect(r.origem).toBe('default');
    }
  });

  test('ausente SEM default => TTL_AUSENTE (nunca inventa validade)', () => {
    const r = validarTtl(undefined, {});
    expect(r.ok).toBe(false);
    expect(r.motivo).toBe(MOTIVO.TTL_AUSENTE);
  });

  test('nao-finito ("abc", "Infinity", 1e999, NaN) => TTL_NAO_FINITO', () => {
    for (const invalido of ['abc', 'Infinity', '1e999', NaN, Infinity]) {
      const r = validarTtl(invalido, { defaultMs: SEVEN_DAYS_MS });
      expect(r.ok).toBe(false);
      expect(r.motivo).toBe(MOTIVO.TTL_NAO_FINITO);
    }
  });

  test('zero e negativo => TTL_NAO_POSITIVO', () => {
    for (const invalido of [0, -1, '-5', '0']) {
      const r = validarTtl(invalido, { defaultMs: SEVEN_DAYS_MS });
      expect(r.ok).toBe(false);
      expect(r.motivo).toBe(MOTIVO.TTL_NAO_POSITIVO);
    }
  });

  test('numeros e strings numericas validas passam com o valor exato', () => {
    expect(validarTtl(60000).ms).toBe(60000);
    expect(validarTtl('60000').ms).toBe(60000);
    expect(validarTtl(' 60000 ').ms).toBe(60000);
    expect(validarTtl(60000).origem).toBe('declarado');
  });

  test('REPRODUCAO do defeito original: `Number(env) || 7d` aceitava Infinity e nunca vencia', () => {
    // expressão EXATA que estava em validate-coverage-gate.js (linha 91)
    const antigo = Number('Infinity') || SEVEN_DAYS_MS;
    expect(antigo).toBe(Infinity);
    expect(Number.isFinite(antigo)).toBe(false);

    const idadeMs = 100 * 24 * 60 * 60 * 1000; // 100 dias: muito vencida
    expect(idadeMs > antigo).toBe(false); // ⇒ fail-open: nunca stale

    // autoridade nova: rejeita o mesmo valor declarado
    const r = validarTtl('Infinity', { defaultMs: SEVEN_DAYS_MS });
    expect(r.ok).toBe(false);
    expect(r.motivo).toBe(MOTIVO.TTL_NAO_FINITO);
    expect(avaliarFrescor({ generatedAt: iso(idadeMs), ttlMs: SEVEN_DAYS_MS, agoraMs: NOW }).ok).toBe(false);
  });
});

describe('P1-11 avaliarFrescor — timestamp, expiração e identidade', () => {
  test('timestamp ausente/invalido => reprovado com motivo nomeado', () => {
    expect(avaliarFrescor({ generatedAt: undefined, ttlMs: SEVEN_DAYS_MS, agoraMs: NOW }).motivo)
      .toBe(MOTIVO.TIMESTAMP_AUSENTE);
    expect(avaliarFrescor({ generatedAt: '', ttlMs: SEVEN_DAYS_MS, agoraMs: NOW }).motivo)
      .toBe(MOTIVO.TIMESTAMP_AUSENTE);
    expect(avaliarFrescor({ generatedAt: 'ontem', ttlMs: SEVEN_DAYS_MS, agoraMs: NOW }).motivo)
      .toBe(MOTIVO.TIMESTAMP_INVALIDO);
  });

  test('timestamp no FUTURO alem da tolerancia => TIMESTAMP_FUTURO (idade negativa nao e frescor)', () => {
    const futuro = new Date(NOW + DEFAULT_TOLERANCIA_FUTURO_MS + 60000).toISOString();
    const r = avaliarFrescor({ generatedAt: futuro, ttlMs: SEVEN_DAYS_MS, agoraMs: NOW });
    expect(r.ok).toBe(false);
    expect(r.motivo).toBe(MOTIVO.TIMESTAMP_FUTURO);
    expect(r.idadeMs).toBeLessThan(0);
  });

  test('timestamp levemente no futuro (dentro da tolerancia de relogio) NAO e falso positivo', () => {
    const futuro = new Date(NOW + 5000).toISOString();
    const r = avaliarFrescor({ generatedAt: futuro, ttlMs: SEVEN_DAYS_MS, agoraMs: NOW });
    expect(r.ok).toBe(true);
    expect(r.motivo).toBe(MOTIVO.OK);
  });

  test('expirada => EVIDENCIA_EXPIRADA; fresca => OK (nao-vacuidade nos dois sentidos)', () => {
    expect(avaliarFrescor({ generatedAt: iso(8 * 24 * 3600 * 1000), ttlMs: SEVEN_DAYS_MS, agoraMs: NOW }).motivo)
      .toBe(MOTIVO.EVIDENCIA_EXPIRADA);
    expect(avaliarFrescor({ generatedAt: iso(3600 * 1000), ttlMs: SEVEN_DAYS_MS, agoraMs: NOW }).motivo)
      .toBe(MOTIVO.OK);
  });

  test('expira DURANTE o processamento => EXPIRA_DURANTE_PROCESSAMENTO', () => {
    const r = avaliarFrescor({
      generatedAt: iso(SEVEN_DAYS_MS - 1000),
      ttlMs: SEVEN_DAYS_MS,
      agoraMs: NOW,
      folgaProcessamentoMs: DEFAULT_FOLGA_PROCESSAMENTO_MS,
    });
    expect(r.ok).toBe(false);
    expect(r.motivo).toBe(MOTIVO.EXPIRA_DURANTE_PROCESSAMENTO);
    expect(r.restanteMs).toBeLessThanOrEqual(DEFAULT_FOLGA_PROCESSAMENTO_MS);
  });

  test('identidade estrangeira => reprovada por commit, run e fingerprint', () => {
    const base = { generatedAt: iso(3600 * 1000), ttlMs: SEVEN_DAYS_MS, agoraMs: NOW };
    expect(avaliarFrescor({ ...base, commitEsperado: 'aaa', commitEvidencia: 'bbb' }).motivo)
      .toBe(MOTIVO.EVIDENCIA_DE_OUTRO_COMMIT);
    expect(avaliarFrescor({ ...base, runEsperado: 'run-A', runEvidencia: 'run-B' }).motivo)
      .toBe(MOTIVO.EVIDENCIA_DE_OUTRO_RUN);
    expect(avaliarFrescor({ ...base, fingerprintEsperado: 'f1', fingerprintEvidencia: 'f2' }).motivo)
      .toBe(MOTIVO.EVIDENCIA_DE_OUTRO_FINGERPRINT);
  });

  test('identidade ausente de um dos lados nao aprova nem reprova (campo ainda nao produzido)', () => {
    const base = { generatedAt: iso(3600 * 1000), ttlMs: SEVEN_DAYS_MS, agoraMs: NOW };
    expect(avaliarFrescor({ ...base, runEsperado: 'run-A', runEvidencia: null }).ok).toBe(true);
    expect(avaliarFrescor({ ...base, runEsperado: null, runEvidencia: 'run-B' }).ok).toBe(true);
  });

  test('validarEvidencia combina TTL invalido e frescor numa unica decisao', () => {
    const r = validarEvidencia({ ttlMs: 'Infinity', generatedAt: iso(3600 * 1000), agoraMs: NOW }, {
      defaultTtlMs: SEVEN_DAYS_MS,
    });
    expect(r.ok).toBe(false);
    expect(r.motivo).toBe(MOTIVO.TTL_NAO_FINITO);
  });
});

describe('P1-11 integracao real no coverage gate (agora aplica as regras)', () => {
  test('TTL declarado nao-finito => evidencia REPROVADA (nao cai no default em silencio)', () => {
    const reportPath = writeReport({
      generatedAt: iso(3600 * 1000),
      perItem: [{ id: 'api:GET:/api/widgets', state: 'VALIDATED' }],
    });
    const { stale, reason, executions } = loadApiSurfaceTechnicalExecutions(API_INVENTORY, {
      reportPath,
      nowMs: NOW,
      maxAgeMs: Infinity,
    });
    expect(stale).toBe(true);
    expect(reason).toBe(MOTIVO.TTL_NAO_FINITO);
    expect(executions).toEqual([{ itemId: 'api:GET:/api/widgets', state: 'STALE' }]);
  });

  test('TTL declarado negativo => reprovada por TTL_NAO_POSITIVO', () => {
    const reportPath = writeReport({
      generatedAt: iso(3600 * 1000),
      perItem: [{ id: 'api:GET:/api/widgets', state: 'VALIDATED' }],
    });
    const { stale, reason } = loadApiSurfaceTechnicalExecutions(API_INVENTORY, {
      reportPath,
      nowMs: NOW,
      maxAgeMs: -1,
    });
    expect(stale).toBe(true);
    expect(reason).toBe(MOTIVO.TTL_NAO_POSITIVO);
  });

  test('relatorio com generatedAt no futuro => STALE (antes passava como fresco)', () => {
    const reportPath = writeReport({
      generatedAt: new Date(NOW + 24 * 3600 * 1000).toISOString(),
      perItem: [{ id: 'api:GET:/api/widgets', state: 'VALIDATED' }],
    });
    const { stale, reason } = loadApiSurfaceTechnicalExecutions(API_INVENTORY, {
      reportPath,
      nowMs: NOW,
    });
    expect(stale).toBe(true);
    expect(reason).toBe(MOTIVO.TIMESTAMP_FUTURO);
  });

  test('evidencia de OUTRO run/fingerprint => STALE quando o gate sabe a identidade corrente', () => {
    const reportPath = writeReport({
      generatedAt: iso(3600 * 1000),
      runId: 'rap-governed-ANTIGO',
      sourceFingerprint: 'fingerprint-antigo',
      perItem: [{ id: 'api:GET:/api/widgets', state: 'VALIDATED' }],
    });

    const outroRun = loadApiSurfaceTechnicalExecutions(API_INVENTORY, {
      reportPath,
      nowMs: NOW,
      currentRunId: 'rap-governed-ATUAL',
    });
    expect(outroRun.stale).toBe(true);
    expect(outroRun.reason).toBe(MOTIVO.EVIDENCIA_DE_OUTRO_RUN);

    const outroFingerprint = loadApiSurfaceTechnicalExecutions(API_INVENTORY, {
      reportPath,
      nowMs: NOW,
      currentRunId: 'rap-governed-ANTIGO',
      currentSourceFingerprint: 'fingerprint-atual',
    });
    expect(outroFingerprint.stale).toBe(true);
    expect(outroFingerprint.reason).toBe(MOTIVO.EVIDENCIA_DE_OUTRO_FINGERPRINT);

    const mesmoRun = loadApiSurfaceTechnicalExecutions(API_INVENTORY, {
      reportPath,
      nowMs: NOW,
      currentRunId: 'rap-governed-ANTIGO',
      currentSourceFingerprint: 'fingerprint-antigo',
    });
    expect(mesmoRun.stale).toBe(false);
    expect(mesmoRun.reason).toBeNull();
  });

  test('fresca, sem identidade declarada => continua valida (nao ha falso vermelho)', () => {
    const reportPath = writeReport({
      generatedAt: iso(3600 * 1000),
      perItem: [{ id: 'api:GET:/api/widgets', state: 'VALIDATED' }],
    });
    const { stale, executions } = loadApiSurfaceTechnicalExecutions(API_INVENTORY, {
      reportPath,
      nowMs: NOW,
    });
    expect(stale).toBe(false);
    expect(executions).toEqual([{ itemId: 'api:GET:/api/widgets', state: 'VALIDATED' }]);
  });
});
