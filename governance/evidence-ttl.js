'use strict';

/**
 * P1-11 — Autoridade única de TTL/frescor de evidência.
 *
 * Motivação medida: cada consumidor decidia frescor por conta própria e, na
 * prática, só existiam duas checagens — "tem generatedAt?" e "idade > maxAgeMs?".
 * Ficavam de fora, silenciosamente:
 *   - TTL inválido / não-positivo / não-finito (string, NaN, 0, -1);
 *   - `generatedAt` no FUTURO (relógio adiantado ou artefato forjado), que
 *     passava como "fresco" para sempre porque a idade fica NEGATIVA;
 *   - evidência que EXPIRA DURANTE o processamento (o gate aprova, o selo
 *     termina depois, e o veredito passa a se referir a evidência vencida);
 *   - evidência de OUTRO run/commit/fingerprint, contada como cobertura válida.
 *
 * Regra geral: qualquer dúvida é NÃO-fresco (fail-closed). Nunca existe motivo
 * "desconhecido" que aprove.
 */

const MOTIVO = {
  OK: 'OK',
  TTL_AUSENTE: 'TTL_AUSENTE',
  TTL_NAO_FINITO: 'TTL_NAO_FINITO',
  TTL_NAO_POSITIVO: 'TTL_NAO_POSITIVO',
  TIMESTAMP_AUSENTE: 'TIMESTAMP_AUSENTE',
  TIMESTAMP_INVALIDO: 'TIMESTAMP_INVALIDO',
  TIMESTAMP_FUTURO: 'TIMESTAMP_FUTURO',
  EVIDENCIA_EXPIRADA: 'EVIDENCIA_EXPIRADA',
  EXPIRA_DURANTE_PROCESSAMENTO: 'EXPIRA_DURANTE_PROCESSAMENTO',
  EVIDENCIA_DE_OUTRO_COMMIT: 'EVIDENCIA_DE_OUTRO_COMMIT',
  EVIDENCIA_DE_OUTRO_RUN: 'EVIDENCIA_DE_OUTRO_RUN',
  EVIDENCIA_DE_OUTRO_FINGERPRINT: 'EVIDENCIA_DE_OUTRO_FINGERPRINT',
  ESTADO_ILEGIVEL: 'ESTADO_ILEGIVEL',
};

/** Folga de relógio entre hosts: acima disso o timestamp futuro é anomalia. */
const DEFAULT_TOLERANCIA_FUTURO_MS = 5 * 60 * 1000;
/** Margem exigida para a evidência sobreviver ao processamento restante. */
const DEFAULT_FOLGA_PROCESSAMENTO_MS = 60 * 1000;

/**
 * Valida um TTL declarado (env, option, config).
 * Aceita número finito > 0, ou string numérica equivalente. Qualquer outra coisa
 * é rejeitada com motivo nomeado — nunca convertida em NaN nem em 0 por engano.
 */
function validarTtl(valor, { defaultMs = null, rotulo = 'ttlMs' } = {}) {
  if (valor === null || valor === undefined || valor === '') {
    if (defaultMs === null || defaultMs === undefined) {
      return { ok: false, ms: null, motivo: MOTIVO.TTL_AUSENTE, rotulo, origem: 'ausente' };
    }
    return { ok: true, ms: defaultMs, motivo: MOTIVO.OK, rotulo, origem: 'default' };
  }

  const numero = typeof valor === 'number' ? valor : Number(String(valor).trim());

  if (typeof numero !== 'number' || Number.isNaN(numero) || !Number.isFinite(numero)) {
    return { ok: false, ms: null, motivo: MOTIVO.TTL_NAO_FINITO, rotulo, origem: 'declarado', valorOriginal: String(valor) };
  }
  if (numero <= 0) {
    return { ok: false, ms: null, motivo: MOTIVO.TTL_NAO_POSITIVO, rotulo, origem: 'declarado', valorOriginal: String(valor) };
  }
  return { ok: true, ms: numero, motivo: MOTIVO.OK, rotulo, origem: 'declarado' };
}

function paraTimestampMs(valor) {
  if (valor instanceof Date) return valor.getTime();
  if (typeof valor === 'number') return Number.isFinite(valor) ? valor : NaN;
  if (typeof valor !== 'string' || valor.trim() === '') return NaN;
  return Date.parse(valor);
}

/**
 * Avalia o frescor de UMA evidência.
 *
 * @param {object} entrada
 * @param {string|number|Date} entrada.generatedAt  instante de produção da evidência
 * @param {number} entrada.ttlMs                    validade (use validarTtl antes)
 * @param {number} [entrada.agoraMs]                relógio injetável
 * @param {number} [entrada.toleranciaFuturoMs]
 * @param {number} [entrada.folgaProcessamentoMs]
 * @param {string} [entrada.commitEsperado] / [entrada.commitEvidencia]
 * @param {string} [entrada.runEsperado]    / [entrada.runEvidencia]
 * @param {string} [entrada.fingerprintEsperado] / [entrada.fingerprintEvidencia]
 * @returns {{ok:boolean, motivo:string, idadeMs:number|null, expiraEmMs:number|null, restanteMs:number|null}}
 */
function avaliarFrescor(entrada = {}) {
  const {
    generatedAt,
    ttlMs,
    agoraMs,
    toleranciaFuturoMs = DEFAULT_TOLERANCIA_FUTURO_MS,
    folgaProcessamentoMs = DEFAULT_FOLGA_PROCESSAMENTO_MS,
    commitEsperado = null,
    commitEvidencia = null,
    runEsperado = null,
    runEvidencia = null,
    fingerprintEsperado = null,
    fingerprintEvidencia = null,
  } = entrada;

  const agora = Number.isFinite(agoraMs) ? agoraMs : Date.now();
  const gerado = paraTimestampMs(generatedAt);

  if (generatedAt === null || generatedAt === undefined || generatedAt === '') {
    return { ok: false, motivo: MOTIVO.TIMESTAMP_AUSENTE, idadeMs: null, expiraEmMs: null, restanteMs: null };
  }
  if (!Number.isFinite(gerado)) {
    return { ok: false, motivo: MOTIVO.TIMESTAMP_INVALIDO, idadeMs: null, expiraEmMs: null, restanteMs: null };
  }

  const idadeMs = agora - gerado;
  const expiraEmMs = gerado + ttlMs;
  const restanteMs = expiraEmMs - agora;

  // 1) Evidência do FUTURO: idade negativa não é "mais que fresca", é anomalia.
  if (-idadeMs > toleranciaFuturoMs) {
    return { ok: false, motivo: MOTIVO.TIMESTAMP_FUTURO, idadeMs, expiraEmMs, restanteMs };
  }

  // 2) Já expirada.
  if (idadeMs >= ttlMs) {
    return { ok: false, motivo: MOTIVO.EVIDENCIA_EXPIRADA, idadeMs, expiraEmMs, restanteMs };
  }

  // 3) Expira DURANTE o processamento: aprovar seria assinar um veredito sobre
  //    evidência que já venceu quando o selo termina.
  if (restanteMs <= folgaProcessamentoMs) {
    return { ok: false, motivo: MOTIVO.EXPIRA_DURANTE_PROCESSAMENTO, idadeMs, expiraEmMs, restanteMs };
  }

  // 4) Identidade estrangeira. Só compara quando AMBOS os lados existem, para
  //    não aprovar por ausência nem reprovar por campo ainda não produzido.
  if (commitEsperado && commitEvidencia && commitEsperado !== commitEvidencia) {
    return {
      ok: false,
      motivo: MOTIVO.EVIDENCIA_DE_OUTRO_COMMIT,
      idadeMs,
      expiraEmMs,
      restanteMs,
      esperado: commitEsperado,
      encontrado: commitEvidencia,
    };
  }
  if (runEsperado && runEvidencia && runEsperado !== runEvidencia) {
    return {
      ok: false,
      motivo: MOTIVO.EVIDENCIA_DE_OUTRO_RUN,
      idadeMs,
      expiraEmMs,
      restanteMs,
      esperado: runEsperado,
      encontrado: runEvidencia,
    };
  }
  if (fingerprintEsperado && fingerprintEvidencia && fingerprintEsperado !== fingerprintEvidencia) {
    return {
      ok: false,
      motivo: MOTIVO.EVIDENCIA_DE_OUTRO_FINGERPRINT,
      idadeMs,
      expiraEmMs,
      restanteMs,
      esperado: fingerprintEsperado,
      encontrado: fingerprintEvidencia,
    };
  }

  return { ok: true, motivo: MOTIVO.OK, idadeMs, expiraEmMs, restanteMs };
}

/**
 * Conveniência: valida o TTL e o frescor numa única chamada, fail-closed em
 * qualquer etapa (TTL inválido reprova a evidência, não "cai no default" em
 * silêncio quando o valor foi DECLARADO pelo operador).
 */
function validarEvidencia(entrada = {}, { defaultTtlMs = null, rotulo = 'ttlMs' } = {}) {
  const ttl = validarTtl(entrada.ttlMs, { defaultMs: defaultTtlMs, rotulo });
  if (!ttl.ok) {
    return { ok: false, motivo: ttl.motivo, ttl, idadeMs: null, expiraEmMs: null, restanteMs: null };
  }
  const frescor = avaliarFrescor({ ...entrada, ttlMs: ttl.ms });
  return { ...frescor, ttl };
}

module.exports = {
  MOTIVO,
  DEFAULT_TOLERANCIA_FUTURO_MS,
  DEFAULT_FOLGA_PROCESSAMENTO_MS,
  validarTtl,
  avaliarFrescor,
  validarEvidencia,
  paraTimestampMs,
};
