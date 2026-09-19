#!/usr/bin/env node
'use strict';

/**
 * semanticPipelineVersion — versão DERIVADA do pipeline semântico.
 *
 * Por que existe: um achado de benchmark ("esta empresa permite check-in
 * antecipado") é uma CONCLUSÃO produzida por um PROGRAMA — o pipeline
 * semântico (extrator -> classificador -> normalizador -> clustering). Se esse
 * programa muda, conclusões antigas foram produzidas por outro programa e não
 * podem continuar certificando a vertical. Sem versionamento, a troca de uma
 * regra reescreve o significado de milhares de achados já persistidos, em
 * silêncio, e a amostra certificada continua "válida" descrevendo um mundo que
 * o código atual não produz mais.
 *
 * REGRAS
 *   1. NUNCA derivar de timestamp. Duas execuções do MESMO código têm de
 *      produzir a MESMA versão, senão todo achado nasce STALE e a comparação
 *      vira ruído.
 *   2. NUNCA derivar de commit/branch. O mesmo código em outro commit continua
 *      sendo o mesmo programa; o que certifica um achado é o PROGRAMA, não a
 *      posição no histórico.
 *   3. Derivar do CONTEÚDO dos módulos que produzem a conclusão. Qualquer byte
 *      alterado neles muda a versão — inclusive um comentário.
 *
 * Sobre (3): stripar comentários antes de hashear seria "mais elegante" e é
 * exatamente o erro perigoso — um stripper com bug pode REMOVER CÓDIGO e fazer
 * dois programas diferentes colidirem na mesma versão, transformando o gate em
 * carimbo. Preferimos o modo fail-closed: mudança cosmética invalida a
 * certificação e exige reprocessar. Reprocessar é barato; certificar errado não.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

/**
 * Formato do cálculo. Mudar a FORMA de derivar a versão (não o conteúdo dos
 * módulos) exige bumpar isto, senão versões antigas e novas podem colidir.
 */
const SEMANTIC_VERSION_FORMAT = 'semantic-pipeline-v1';

/**
 * Componentes do pipeline, na ordem em que produzem a conclusão.
 *
 * A lista é declarada de propósito: adicionar/remover um módulo do pipeline
 * muda a versão mesmo que o conteúdo dos existentes não mude — o que é
 * correto, porque o programa passou a ser outro.
 */
const SEMANTIC_PIPELINE_COMPONENTS = Object.freeze([
  'semanticExtractor.js',
  'observationClassifier.js',
  'normalizationPipeline.js',
  'clustering.js',
]);

const SEMANTIC_DIR = __dirname;

const STALE_REASONS = Object.freeze({
  VERSION_MISSING: 'SEMANTIC_VERSION_MISSING',
  VERSION_STALE: 'STALE_SEMANTICS',
  VERSION_UNKNOWN_FORMAT: 'SEMANTIC_VERSION_FORMAT_UNKNOWN',
});

function sha256Hex(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

/**
 * Hash de conteúdo de cada componente do pipeline.
 * @returns {{ digest: string, components: Array<{name: string, sha256: string}> }}
 */
function computeSemanticPipelineDigest() {
  const components = SEMANTIC_PIPELINE_COMPONENTS.map((name) => {
    const abs = path.join(SEMANTIC_DIR, name);
    const bytes = fs.readFileSync(abs);
    return { name, sha256: sha256Hex(bytes) };
  });

  const canonical = [
    SEMANTIC_VERSION_FORMAT,
    ...components.map((c) => `${c.name}:${c.sha256}`),
  ].join('\n');

  return { digest: sha256Hex(canonical), components };
}

let cached = null;

/**
 * Versão do pipeline semântico atual.
 * @returns {{ version: string, formatVersion: string, components: Array<{name:string,sha256:string}> }}
 */
function getSemanticPipelineVersion() {
  if (cached) return cached;
  const { digest, components } = computeSemanticPipelineDigest();
  cached = Object.freeze({
    version: `sem-v1:${digest.slice(0, 32)}`,
    formatVersion: SEMANTIC_VERSION_FORMAT,
    components: Object.freeze(components.map((c) => Object.freeze(c))),
  });
  return cached;
}

/** Para testes: descarta o cache. */
function resetSemanticPipelineVersionCache() {
  cached = null;
}

/**
 * Extrai a versão registrada em um documento (achado, sample, relatório).
 */
function readRecordedSemanticVersion(doc) {
  if (!doc || typeof doc !== 'object') return null;
  const value = doc.semanticPipelineVersion;
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * Avalia se a versão registrada corresponde ao pipeline ATUAL.
 *
 * Fail-closed: versão ausente NÃO é "compatível por padrão". Um achado sem
 * versão não pode afirmar que o programa atual o produziria.
 *
 * @returns {{ current: boolean, reason: string|null, recorded: string|null, expected: string }}
 */
function evaluateSemanticVersion(doc) {
  const expected = getSemanticPipelineVersion().version;
  const recorded = readRecordedSemanticVersion(doc);

  if (!recorded) {
    return { current: false, reason: STALE_REASONS.VERSION_MISSING, recorded: null, expected };
  }
  if (!recorded.startsWith('sem-v1:')) {
    return { current: false, reason: STALE_REASONS.VERSION_UNKNOWN_FORMAT, recorded, expected };
  }
  if (recorded !== expected) {
    return { current: false, reason: STALE_REASONS.VERSION_STALE, recorded, expected };
  }
  return { current: true, reason: null, recorded, expected };
}

/** Bloco pronto para anexar a um achado/sample persistido. */
function buildSemanticVersionRecord(extra = {}) {
  const { version, formatVersion, components } = getSemanticPipelineVersion();
  return {
    semanticPipelineVersion: version,
    semanticPipelineFormatVersion: formatVersion,
    semanticPipelineComponents: components.map((c) => c.name),
    ...extra,
  };
}

module.exports = {
  SEMANTIC_VERSION_FORMAT,
  SEMANTIC_PIPELINE_COMPONENTS,
  STALE_REASONS,
  computeSemanticPipelineDigest,
  getSemanticPipelineVersion,
  resetSemanticPipelineVersionCache,
  readRecordedSemanticVersion,
  evaluateSemanticVersion,
  buildSemanticVersionRecord,
};
