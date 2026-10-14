'use strict';

/**
 * engine/shared/clock.js — RELÓGIO INJETÁVEL da engine.
 *
 * POR QUE EXISTE (dívida medida em 2026-10-13): `engine/` acumulava **31 leituras
 * `new Date()` + 25 `Date.now()`** espalhadas por 20+ arquivos. Ler o relógio direto
 * dentro da engine quebra duas coisas:
 *   1. determinismo de REPLAY (gate bloqueante): duas execuções do mesmo fluxo com
 *      o mesmo input produzem `replayHash` diferente se o código lê o relógio;
 *   2. TESTABILIDADE: não há como provar comportamento dependente de tempo sem
 *      congelar o relógio.
 *
 * Este módulo é a ÚNICA porta da engine para o tempo. Ele é declarado em
 * `ioAllowedFiles` do `validate:layer-conventions` — o mesmo mecanismo já usado por
 * `engine/ai/aiEnvelope.js`: arquivos-ponte CONCENTRAM o I/O para que o resto da
 * engine permaneça puro, em vez de espalhar a exceção.
 *
 * A borda (API, CLI, testes, replay) injeta o que quiser — inclusive um relógio
 * CONGELADO — via `setClockProvider`. Sem injeção, o comportamento é o histórico
 * (`Date.now()`), para não mudar produção silenciosamente.
 *
 * Uso na engine:
 *   const { nowMs, nowIso, now } = require('./shared/clock');   // ou '../shared/clock'
 *   const startedAt = nowMs();          // número (ms)
 *   const ts = nowIso();                // string ISO
 *   const d = now();                    // Date
 *
 * Uso na borda / teste:
 *   const clock = require('../engine/shared/clock');
 *   clock.setClockProvider(() => Date.UTC(2026, 0, 1));   // congela
 *   clock.resetClockProvider();                            // volta ao real
 */

/** @type {null | (() => number)} provider corrente (ms desde epoch). */
let provider = null;

/**
 * Injeta a fonte de tempo. Recebe uma função que devolve ms desde epoch.
 * @param {(() => number) | null} fn
 */
function setClockProvider(fn) {
  if (fn !== null && typeof fn !== 'function') {
    throw new TypeError('clock: o provider precisa ser uma função que devolve ms (ou null)');
  }
  provider = fn;
}

/** Volta ao relógio real do processo. */
function resetClockProvider() {
  provider = null;
}

/** Há provider injetado? (útil para diagnóstico e para não presumir) */
function hasInjectedClock() {
  return provider !== null;
}

/** Milissegundos desde epoch. */
function nowMs() {
  if (provider) return provider();
  return Date.now();
}

/** `Date` corrente (a conversão de `nowMs` — determinística dado o provider). */
function now() {
  return new Date(nowMs());
}

/** String ISO-8601 corrente. */
function nowIso() {
  return new Date(nowMs()).toISOString();
}

module.exports = {
  setClockProvider,
  resetClockProvider,
  hasInjectedClock,
  nowMs,
  now,
  nowIso,
};
