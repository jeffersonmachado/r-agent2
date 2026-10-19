'use strict';

/**
 * BUG CLOSURE FIRST — orçamento, deduplicação e auditoria de execução.
 *
 * Missão §10 (scheduler inteligente e controle de custo):
 *  - cada operação declara finalidade, classe, custo/duração estimados, dependências,
 *    evidências necessárias e condições de início/interrupção/sucesso;
 *  - operação extensiva exige autorização EXPLÍCITA do gate central;
 *  - processo idêntico não deve ser repetido sem mudança de entradas
 *    (deduplicação por identidade de entrada + versão do código);
 *  - otimização de custo NUNCA enfraquece critério de certificação.
 *
 * DEFEITO MEDIDO (2026-10-17): o mesmo ciclo de convergência completo foi iniciado
 * três vezes seguidas sem que as entradas relevantes tivessem mudado de forma que
 * justificasse a repetição — ~2h de pipeline por repetição, com os mesmos P0
 * abertos. Não havia identidade de entrada nem registro de decisão.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/** Custo/duração declarados (estimativa conservadora, explícita). */
const CATALOGO_OPERACOES = Object.freeze({
  DIAGNOSTICO: { classe: 'LEVE', custoEstimadoMin: 1, extensiva: false },
  REPRODUCAO: { classe: 'LEVE', custoEstimadoMin: 2, extensiva: false },
  CORRECAO_CODIGO: { classe: 'LEVE', custoEstimadoMin: 5, extensiva: false },
  TESTES_DIRECIONADOS: { classe: 'LEVE', custoEstimadoMin: 3, extensiva: false },
  TESTES_NEGATIVOS_REGRESSAO: { classe: 'LEVE', custoEstimadoMin: 2, extensiva: false },
  L0_COMPLETO: { classe: 'MEDIA', custoEstimadoMin: 15, extensiva: false },
  L1_AMPLO: { classe: 'MEDIA', custoEstimadoMin: 10, extensiva: false },
  L2_L3_EXTENSIVO: { classe: 'EXTENSIVA', custoEstimadoMin: 120, extensiva: true },
  QA_WAVES_COMPLETA: { classe: 'EXTENSIVA', custoEstimadoMin: 35, extensiva: true },
  REPLAY_MASSIVO: { classe: 'EXTENSIVA', custoEstimadoMin: 60, extensiva: true },
  CONVERGENCIA_COMPLETA: { classe: 'EXTENSIVA', custoEstimadoMin: 60, extensiva: true },
  SELO_FINAL: { classe: 'EXTENSIVA', custoEstimadoMin: 25, extensiva: true },
  PUBLICACAO_RELEASE: { classe: 'EXTENSIVA', custoEstimadoMin: 10, extensiva: true },
});

/**
 * Identidade determinística de ENTRADA de uma execução.
 * Se a identidade não mudou, repetir a operação extensiva não produz informação
 * nova — e é recusado (a menos que `force: true` com justificativa registrada).
 */
function identidadeDaEntrada(entrada = {}) {
  const canonical = JSON.stringify({
    operacao: entrada.operacao || null,
    commit: entrada.commit || null,
    sourceFingerprint: entrada.sourceFingerprint || null,
    runId: entrada.runId || null,
    parametros: entrada.parametros || null,
  });
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

/**
 * @returns {{repetir:boolean, code:string, motivo:string}}
 */
function deveReexecutar(entrada, ultimaExecucao) {
  const agora = identidadeDaEntrada(entrada);
  if (entrada && entrada.force === true) {
    return { repetir: true, code: 'FORCADO', motivo: 'reexecução forçada com justificativa declarada' };
  }
  if (!ultimaExecucao) return { repetir: true, code: 'SEM_HISTORICO', motivo: 'sem execução anterior registrada' };
  const anterior = ultimaExecucao.inputIdentity || identidadeDaEntrada(ultimaExecucao);
  if (anterior === agora) {
    return {
      repetir: false,
      code: 'ENTRADA_IDENTICA',
      motivo: 'entradas idênticas (commit/fingerprint/run/parâmetros): repetir não produz prova nova',
    };
  }
  return { repetir: true, code: 'ENTRADA_MUDOU', motivo: 'entradas mudaram desde a última execução' };
}

/** Resolve a raiz de runtime (fora do workspace) conforme docs/runtime-paths.md. */
function runtimeRoot() {
  if (process.env.RAGENT2_RUNTIME_ROOT) return process.env.RAGENT2_RUNTIME_ROOT;
  if (process.env.NODE_ENV === 'production') return '/var/lib/ragent2';
  return path.join(require('os').homedir(), '.local', 'share', 'ragent2-runtime');
}

function caminhoDaAuditoria() {
  return path.join(runtimeRoot(), 'governance', 'bug-closure-audit.jsonl');
}

/**
 * Trilha de auditoria append-only (JSONL, fora do workspace para não virar
 * artefato governado sem classificação).
 * @returns {string} caminho usado
 */
function registrarAuditoria(registro) {
  const destino = caminhoDaAuditoria();
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  const linha = JSON.stringify({ ...registro, registradoEm: new Date().toISOString() });
  fs.appendFileSync(destino, `${linha}\n`, 'utf8');
  return destino;
}

function lerAuditoria(limite = 50) {
  const destino = caminhoDaAuditoria();
  if (!fs.existsSync(destino)) return [];
  const linhas = fs.readFileSync(destino, 'utf8').split('\n').filter(Boolean);
  return linhas.slice(-limite).map((l) => {
    try { return JSON.parse(l); } catch (_) { return { malformado: true, raw: l.slice(0, 200) }; }
  });
}

module.exports = {
  CATALOGO_OPERACOES,
  identidadeDaEntrada,
  deveReexecutar,
  runtimeRoot,
  caminhoDaAuditoria,
  registrarAuditoria,
  lerAuditoria,
};
