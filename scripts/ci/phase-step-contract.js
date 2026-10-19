'use strict';

/**
 * CONTRATO CANÔNICO DE COBERTURA DE FASE (P0-01, auditoria 2026-10-19).
 *
 * Defeito medido: `avaliarEstadosPorFase()` declarava uma fase `PASS` quando os
 * resultados PRESENTES estavam aprovados — sem comparar com o conjunto de passos
 * obrigatórios da fase. A fase D define 7 verificações; um único resultado
 * aprovado (ou 7 resultados com um id duplicado e outro ausente) produzia
 * `PASS`. Contagem de resultados nunca foi cobertura: ausência não tem linha.
 *
 * Regra deste contrato: a decisão compara TRÊS conjuntos e as evidências:
 *
 *   ESPERADOS (definição canônica do código — não vem de argumento, stdout,
 *              relatório nem de campo do próprio resultado)
 *   EXECUTADOS (resultados reais, com vínculo de sha/runId e digest)
 *   APROVADOS  (executados com exit 0, sem timeout/sinal, estado permitido)
 *
 * Qualquer diferença de conjunto é `INCOMPLETE` — nunca `PASS`. Estado
 * desconhecido, evidência ausente/adulterada e resultado de outro run são
 * fail-closed por construção, não por enumeração de casos proibidos.
 *
 * O módulo é PURO (sem git, sem spawn, sem env): o `lerEvidencia` é injetado,
 * o que permite provar a detecção de evidência adulterada sem executar nada.
 */

const fs = require('fs');
const crypto = require('crypto');

const ESTADOS = Object.freeze({
  PASS: 'PASS',
  FAIL: 'FAIL',
  BLOCKED: 'BLOCKED',
  NOT_EXECUTED: 'NOT_EXECUTED',
  UNKNOWN: 'UNKNOWN',
  NOT_APPLICABLE: 'NOT_APPLICABLE',
  // Cobertura parcial: o conjunto executado não é exatamente o obrigatório.
  // Nunca é aprovado e nunca é confundido com "não executada" (houve execução).
  INCOMPLETE: 'INCOMPLETE',
});

/** Estados que um resultado pode declarar e que NUNCA contam como aprovado. */
const ESTADOS_NAO_APROVADOS = Object.freeze([
  'NOT_EXECUTED',
  'UNKNOWN',
  'SKIPPED',
  'BLOCKED',
  'FAIL',
  'INCOMPLETE',
]);

const DIGEST = /^[0-9a-f]{64}$/i;

function sha256(texto) {
  return crypto.createHash('sha256').update(String(texto), 'utf8').digest('hex');
}

function lerEvidenciaPadrao(raiz, ref) {
  const path = require('path');
  const absoluto = path.isAbsolute(ref) ? ref : path.resolve(raiz, ref);
  return fs.readFileSync(absoluto, 'utf8');
}

/**
 * Conjunto OBRIGATÓRIO de uma fase, derivado da definição imutável do código.
 * Passos marcados `opcional: true` na definição ficam de fora do obrigatório —
 * a opcionalidade é explícita na definição, nunca no resultado.
 */
function passosObrigatoriosDaFase(definicao) {
  const passos = Array.isArray(definicao) ? definicao : [];
  return passos
    .filter((p) => p && p.id && p.opcional !== true)
    .map((p) => String(p.id));
}

function passosOpcionaisDaFase(definicao) {
  const passos = Array.isArray(definicao) ? definicao : [];
  return passos
    .filter((p) => p && p.id && p.opcional === true)
    .map((p) => String(p.id));
}

function duplicados(ids) {
  const vistos = new Set();
  const repetidos = new Set();
  for (const id of ids) {
    if (vistos.has(id)) repetidos.add(id);
    vistos.add(id);
  }
  return [...repetidos];
}

/**
 * Valida a cobertura de UMA fase.
 *
 * @param {Object} p
 * @param {string} p.fase
 * @param {Array<{id:string, opcional?:boolean}>} p.definicao passos canônicos da fase
 * @param {Array<Object>} p.resultados todos os resultados da execução (todas as fases)
 * @param {{sha?:string, execucaoId?:string}|null} p.contexto identidade do run
 * @param {Set<string>} [p.timeoutsIds]
 * @param {string} [p.raiz] raiz para resolver `saidaRef`
 * @param {(raiz:string, ref:string)=>string} [p.lerEvidencia]
 * @returns {{estado:string, motivo:string|null, detalhes:Object}}
 */
function validarCoberturaDeFase({
  fase,
  definicao,
  resultados,
  contexto,
  timeoutsIds,
  raiz = process.cwd(),
  lerEvidencia = lerEvidenciaPadrao,
}) {
  const esperados = passosObrigatoriosDaFase(definicao);
  const opcionais = passosOpcionaisDaFase(definicao);
  const permitidos = new Set([...esperados, ...opcionais]);
  const shaAtual = contexto ? contexto.sha : null;
  const execucaoAtual = contexto ? contexto.execucaoId : null;
  const timeouts = timeoutsIds || new Set();

  if (esperados.length === 0) {
    return {
      estado: ESTADOS.UNKNOWN,
      motivo: 'FASE_SEM_CONTRATO_DE_PASSOS',
      detalhes: { esperados, executados: 0, aprovados: 0 },
    };
  }

  const daFase = (resultados || []).filter((r) => r && r.fase === fase);
  const reais = daFase.filter((r) => r.naoExecutado !== true);
  const base = { esperados, opcionais, executados: reais.length, aprovados: 0, ausentes: [], duplicados: [], desconhecidos: [] };

  if (reais.length === 0) {
    return {
      estado: ESTADOS.NOT_EXECUTED,
      motivo: 'FASE_NAO_EXECUTADA',
      detalhes: base,
    };
  }

  const ids = reais.map((r) => String(r.id));
  const dup = duplicados(ids);
  if (dup.length > 0) {
    // Duplicação mascara ausência: 7 resultados para 7 obrigatórios com 1 id
    // repetido significa que OUTRO obrigatório não rodou.
    return {
      estado: ESTADOS.INCOMPLETE,
      motivo: `PASSO_DUPLICADO:${dup.join(',')}`,
      detalhes: { ...base, duplicados: dup },
    };
  }

  const desconhecidos = ids.filter((id) => !permitidos.has(id));
  if (desconhecidos.length > 0) {
    return {
      estado: ESTADOS.INCOMPLETE,
      motivo: `PASSO_DESCONHECIDO:${desconhecidos.join(',')}`,
      detalhes: { ...base, desconhecidos },
    };
  }

  const presentes = new Set(ids);
  const ausentes = esperados.filter((id) => !presentes.has(id));
  if (ausentes.length > 0) {
    return {
      estado: ESTADOS.INCOMPLETE,
      motivo: `PASSOS_AUSENTES:${ausentes.join(',')}`,
      detalhes: { ...base, ausentes },
    };
  }

  // Ordem: quando a definição declara `depoisDe`, o resultado dependente precisa
  // aparecer DEPOIS do pré-requisito. Ordem declarada é contrato; ordem implícita
  // (sem `depoisDe`) não é imposta — passos independentes podem rodar em qualquer
  // ordem sem virar falso positivo.
  const dependentes = (Array.isArray(definicao) ? definicao : []).filter((p) => p && p.depoisDe);
  for (const dep of dependentes) {
    const idxDependente = ids.indexOf(String(dep.id));
    const idxPreRequisito = ids.indexOf(String(dep.depoisDe));
    if (idxDependente >= 0 && idxPreRequisito >= 0 && idxPreRequisito > idxDependente) {
      return {
        estado: ESTADOS.INCOMPLETE,
        motivo: `ORDEM_INVALIDA:${dep.id}<${dep.depoisDe}`,
        detalhes: base,
      };
    }
  }

  // Estado declarado pelo resultado: um "PASS" textual não substitui exit code,
  // e estados de não-execução nunca contam como aprovado.
  const estadoDeclaradoInvalido = reais.filter((r) => {
    const declarado = r.estado || r.status;
    return typeof declarado === 'string' && declarado.toUpperCase() !== ESTADOS.PASS;
  });
  if (estadoDeclaradoInvalido.length > 0) {
    const pulados = estadoDeclaradoInvalido.filter(
      (r) => String(r.estado || r.status).toUpperCase() === 'SKIPPED',
    );
    return {
      estado: ESTADOS.INCOMPLETE,
      motivo: pulados.length > 0
        ? `PASSO_PULADO_NAO_AUTORIZADO:${pulados.map((r) => r.id).join(',')}`
        : `PASSO_EM_ESTADO_NAO_APROVADO:${estadoDeclaradoInvalido.map((r) => `${r.id}=${r.estado || r.status}`).join(',')}`,
      detalhes: base,
    };
  }

  const semDigest = reais.filter((r) => !DIGEST.test(String(r.sha256Saida || '')));
  if (semDigest.length > 0) {
    return {
      estado: ESTADOS.UNKNOWN,
      motivo: `EVIDENCIA_SEM_DIGEST:${semDigest.map((r) => r.id).join(',')}`,
      detalhes: base,
    };
  }
  const semVinculo = reais.filter((r) => !r.sha || !r.execucaoId);
  if (semVinculo.length > 0) {
    return {
      estado: ESTADOS.UNKNOWN,
      motivo: `EVIDENCIA_SEM_VINCULO:${semVinculo.map((r) => r.id).join(',')}`,
      detalhes: base,
    };
  }
  const outroSha = shaAtual ? reais.filter((r) => String(r.sha) !== String(shaAtual)) : [];
  if (outroSha.length > 0) {
    return {
      estado: ESTADOS.UNKNOWN,
      motivo: `EVIDENCIA_DE_OUTRO_SHA:${outroSha.map((r) => r.id).join(',')}`,
      detalhes: base,
    };
  }
  const outraExecucao = execucaoAtual
    ? reais.filter((r) => String(r.execucaoId) !== String(execucaoAtual))
    : [];
  if (outraExecucao.length > 0) {
    return {
      estado: ESTADOS.UNKNOWN,
      motivo: `EVIDENCIA_DE_OUTRA_EXECUCAO:${outraExecucao.map((r) => r.id).join(',')}`,
      detalhes: base,
    };
  }

  const comTimeout = reais.filter((r) => r.timeout === true || timeouts.has(r.id));
  if (comTimeout.length > 0) {
    return {
      estado: ESTADOS.BLOCKED,
      motivo: `TIMEOUT:${comTimeout.map((r) => r.id).join(',')}`,
      detalhes: base,
    };
  }
  // exitCode null = morte por sinal/timeout: "sem veredito" nunca é aprovação.
  const semVeredito = reais.filter((r) => r.exitCode === null || r.exitCode === undefined);
  if (semVeredito.length > 0) {
    return {
      estado: ESTADOS.BLOCKED,
      motivo: `SEM_EXIT_CODE:${semVeredito.map((r) => r.id).join(',')}`,
      detalhes: base,
    };
  }
  const comFalha = reais.filter((r) => r.exitCode !== 0);
  if (comFalha.length > 0) {
    return {
      estado: ESTADOS.FAIL,
      motivo: `PASSO_FALHOU:${comFalha.map((r) => r.id).join(',')}`,
      detalhes: base,
    };
  }

  // Evidência verificável: precisa existir e o conteúdo não pode ter mudado
  // depois da execução (digest do arquivo == digest registrado).
  const semRef = reais.filter((r) => !r.saidaRef);
  if (semRef.length > 0) {
    return {
      estado: ESTADOS.INCOMPLETE,
      motivo: `EVIDENCIA_AUSENTE:${semRef.map((r) => r.id).join(',')}`,
      detalhes: base,
    };
  }
  for (const r of reais) {
    let conteudo;
    try {
      conteudo = lerEvidencia(raiz, r.saidaRef);
    } catch (_) {
      return {
        estado: ESTADOS.INCOMPLETE,
        motivo: `EVIDENCIA_INEXISTENTE:${r.id}`,
        detalhes: base,
      };
    }
    if (typeof conteudo !== 'string') {
      return {
        estado: ESTADOS.INCOMPLETE,
        motivo: `EVIDENCIA_ILEGIVEL:${r.id}`,
        detalhes: base,
      };
    }
    if (sha256(conteudo) !== String(r.sha256Saida)) {
      return {
        estado: ESTADOS.INCOMPLETE,
        motivo: `EVIDENCIA_ADULTERADA:${r.id}`,
        detalhes: base,
      };
    }
  }

  return {
    estado: ESTADOS.PASS,
    motivo: null,
    detalhes: { ...base, aprovados: reais.length },
  };
}

module.exports = {
  ESTADOS,
  ESTADOS_NAO_APROVADOS,
  passosObrigatoriosDaFase,
  passosOpcionaisDaFase,
  validarCoberturaDeFase,
  sha256,
};
