'use strict';

/**
 * delivery-verification.js — juiz da ENTREGA (fail-closed).
 *
 * DEFEITO MEDIDO (2026-10-16, no `seal-release.sh`): as fases `candidate` e
 * `verify-delivery` faziam
 *
 *     timeout 900 npm run verify:delivered-release > "$vlog" 2>&1
 *     if grep -qE 'DELIVERED_RELEASE_VERIFIED|DELIVERED_PENDING_SCORECARD' "$vlog"; then ok ...
 *
 * Três defeitos em duas linhas:
 *   1. o EXIT CODE do verificador era DESCARTADO — um `exit != 0` com texto
 *      positivo no log passava como sucesso;
 *   2. `DELIVERED_PENDING_SCORECARD` era aceito como entrega verificada, mas é
 *      estado PRÉ-pacote no vocabulário canônico (`PRE_PACKAGE_PASS`);
 *   3. TEXTO de log era usado como AUTORIDADE de certificação.
 *
 * Este módulo é o juiz: exige exit code, resultado ESTRUTURADO, decisão permitida
 * para a fase, identidade presente e correspondente, cadeia íntegra e ausência de
 * gate bloqueante. O texto do log entra apenas como DIAGNÓSTICO — nunca como voto.
 *
 * Módulo PURO (zero I/O): quem lê arquivos são os chamadores.
 */

/** Decisões que sustentam ENTREGA verificada. Lista fechada e curta de propósito. */
const DECISOES_ENTREGA_PERMITIDAS = Object.freeze(['DELIVERED_RELEASE_VERIFIED']);

/**
 * Decisões que PARECEM positivas mas não são entrega verificada.
 * `DELIVERED_PENDING_SCORECARD` é estado PRÉ-pacote (scorecard pendente).
 */
const DECISOES_ENTREGA_PROIBIDAS = Object.freeze({
  DELIVERED_PENDING_SCORECARD: 'ESTADO_PRE_PACOTE_NAO_E_ENTREGA',
  PASS_WITH_DEFERRED_PACKAGE_GATE: 'ESTADO_PRE_PACOTE_NAO_E_ENTREGA',
  AUTONOMOUS_READY: 'ESTADO_PRE_PACOTE_NAO_E_ENTREGA',
  PRODUCTION_READY: 'ESTADO_PRE_PACOTE_NAO_E_ENTREGA',
  CONTROLLED_PILOT: 'ESTADO_PRE_PACOTE_NAO_E_ENTREGA',
});

/** Status de gate que bloqueiam (política de PERMITIDOS: só PASS avança). */
const GATE_STATUS_PERMITIDOS = Object.freeze(['PASS']);

function _preenchido(v) {
  return v !== undefined && v !== null && String(v).trim() !== '';
}

function _decisaoDoRelatorio(relatorio) {
  if (!relatorio || typeof relatorio !== 'object') return '';
  return String(relatorio.decision || relatorio.status || relatorio.finalDecision || '').trim();
}

/**
 * Avalia a entrega.
 *
 * @param {object} entrada
 * @param {number|null} entrada.exitCode exit code REAL do processo verificador
 * @param {object|null} entrada.relatorio relatório ESTRUTURADO lido do disco
 * @param {object|null} [entrada.identidadeAtual] {runId, sourceCommit, sourceFingerprint}
 * @param {object|null} [entrada.cadeia] {valid, motivo, failures}
 * @param {string} [entrada.logText] DIAGNÓSTICO apenas — nunca altera o veredito
 * @returns {{ok: boolean, code: string, motivo: string, decisao: string, diagnosticos: string[]}}
 */
function avaliarEntrega(entrada = {}) {
  const { exitCode, relatorio = null, identidadeAtual = null, cadeia = null, logText = '' } = entrada;
  const diagnosticos = [];
  const reprovar = (code, motivo) => ({ ok: false, code, motivo, decisao: _decisaoDoRelatorio(relatorio), diagnosticos });

  // 1. Exit code é obrigatório e tem de ser ZERO. Texto positivo no log não substitui.
  if (exitCode === null || exitCode === undefined) {
    return reprovar('EXIT_CODE_AUSENTE', 'o verificador não reportou exit code');
  }
  if (Number(exitCode) !== 0) {
    const promessaNoLog = /DELIVERED_[A-Z_]+/.test(String(logText));
    if (promessaNoLog) {
      diagnosticos.push('LOG_PROMETIA_SUCESSO_MAS_EXIT_NAO_ZERO');
    }
    return reprovar('EXIT_CODE_NAO_ZERO', `verificador saiu com exit ${exitCode}`);
  }

  // 2. Resultado ESTRUTURADO obrigatório (log não é autoridade).
  if (!relatorio) {
    return reprovar('RELATORIO_AUSENTE', 'nenhum relatório estruturado da entrega');
  }
  if (typeof relatorio !== 'object' || Array.isArray(relatorio)) {
    return reprovar('RELATORIO_MALFORMADO', 'relatório da entrega não é um objeto');
  }

  const decisao = _decisaoDoRelatorio(relatorio);
  if (decisao === '') {
    return reprovar('DECISAO_AUSENTE', 'relatório sem decision/status/finalDecision');
  }

  // 3. Estado pré-pacote nunca é entrega — mesmo com exit 0 e nome "positivo".
  if (DECISOES_ENTREGA_PROIBIDAS[decisao]) {
    return reprovar(DECISOES_ENTREGA_PROIBIDAS[decisao], `"${decisao}" é estado PRÉ-pacote, não entrega verificada`);
  }

  // 4. Decisão precisa estar na lista PERMITIDA da fase.
  if (!DECISOES_ENTREGA_PERMITIDAS.includes(decisao)) {
    return reprovar('DECISAO_NAO_PERMITIDA', `"${decisao}" não está entre as decisões permitidas para a fase`);
  }

  // 5. Identidade: presente e correspondente (ausência não é coerência).
  const campos = ['runId', 'sourceFingerprint'];
  if (identidadeAtual) {
    const faltantes = campos.filter((c) => !_preenchido(relatorio[c]) || !_preenchido(identidadeAtual[c]));
    if (faltantes.length > 0) {
      return reprovar('IDENTIDADE_INCOMPLETA', `campos de identidade ausentes: ${faltantes.join(', ')}`);
    }
    const divergentes = campos.filter((c) => String(relatorio[c]).trim() !== String(identidadeAtual[c]).trim());
    if (divergentes.length > 0) {
      return reprovar('IDENTIDADE_DIVERGENTE', `entrega é de outra identidade: ${divergentes.join(', ')}`);
    }
  } else {
    return reprovar('IDENTIDADE_AUSENTE', 'não há identidade corrente para comparar (run governado ausente)');
  }

  // 6. Integridade criptográfica (cadeia RECALCULADA pelo chamador).
  if (cadeia) {
    if (cadeia.valid !== true) {
      return reprovar('CADEIA_INVALIDA', `cadeia não fecha: ${cadeia.motivo || 'sem motivo'} (divergências=${(cadeia.failures || []).length})`);
    }
  } else {
    return reprovar('CADEIA_NAO_VERIFICADA', 'a cadeia não foi recalculada — entrega não pode ser confirmada sem integridade');
  }

  // 7. Gates do relatório: só PASS avança.
  const gates = Array.isArray(relatorio.gates) ? relatorio.gates : [];
  const pendentes = gates.filter((g) => {
    if (!g || typeof g !== 'object') return true; // gate ilegível bloqueia
    const s = String(g.status == null ? '' : g.status).toUpperCase();
    return !GATE_STATUS_PERMITIDOS.includes(s);
  });
  if (gates.length === 0) {
    return reprovar('SEM_GATES', 'relatório de entrega sem gates declarados');
  }
  if (pendentes.length > 0) {
    const nomes = pendentes.map((g) => `${(g && g.id) || '?'}=${(g && g.status) || '(vazio)'}`).join(', ');
    return reprovar('GATE_BLOQUEANTE', `pendência bloqueante: ${nomes}`);
  }

  return {
    ok: true,
    code: 'ENTREGA_VERIFICADA',
    motivo: `decisão ${decisao} com exit 0, identidade correspondente, cadeia íntegra e ${gates.length} gate(s) PASS`,
    decisao,
    diagnosticos,
  };
}

module.exports = {
  DECISOES_ENTREGA_PERMITIDAS,
  DECISOES_ENTREGA_PROIBIDAS,
  GATE_STATUS_PERMITIDOS,
  avaliarEntrega,
};
