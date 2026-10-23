'use strict';

/**
 * regularizationRun.js — IDENTIDADE DE EXECUÇÃO e AGREGAÇÃO VALIDADA do regularizador histórico.
 *
 * POR QUE EXISTE (P1-B)
 * ---------------------
 * O regularizador gravava os resultados POR ITEM num diretório compartilhado
 * (`AI_MEMORY/evidence/bug-closure-regularization/itens/`) e montava o relatório agregado lendo
 * TUDO que estava lá. Uma execução parcial (por `--limit`, por `--id`, por falha no meio)
 * reutilizava arquivos de execuções anteriores — inclusive de outro commit e de outro
 * fingerprint — e o agregado passava a parecer cobertura integral com evidências incompatíveis.
 *
 * MODELO
 * ------
 *   1. Cada execução tem `runId` e um diretório próprio: `runs/<runId>/`.
 *   2. `manifest.json` registra a IDENTIDADE: commit, sourceFingerprint, inventoryFingerprint,
 *      testManifestFingerprint, versão do regularizador, escopo, ambiente, início/fim, status.
 *   3. Cada resultado carrega `runId` + a identidade + `artifactSha256` do próprio conteúdo.
 *   4. `agregar()` só aceita execuções COMPLETAS, de identidade IDÊNTICA, sem id duplicado e com
 *      hash de artefato conferido. Qualquer divergência ⇒ recusa com motivo.
 *   5. Relatório de execução parcial NUNCA nasce com aparência integral: `escopo.completo` é
 *      calculado a partir do que a execução realmente cobriu.
 *
 * Nada aqui assina, certifica ou altera a fila: só dá identidade e rastreabilidade à evidência.
 */

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const VERSAO_REGULARIZADOR = '2.0.0';
const STATUS = Object.freeze({ RUNNING: 'RUNNING', COMPLETED: 'COMPLETED', FAILED: 'FAILED' });

const sha256Texto = (t) => crypto.createHash('sha256').update(String(t), 'utf8').digest('hex');
const sha256Arquivo = (abs) => crypto.createHash('sha256').update(fs.readFileSync(abs)).digest('hex');
const agora = () => new Date().toISOString();

function dirDaExecucao(rootDir, baseRel, runId) {
  return path.join(rootDir, baseRel, 'runs', runId);
}

/** Identidade do AMBIENTE que influencia o resultado (runner, banco, node) — sem segredos. */
function identidadeDoAmbiente(extra = {}) {
  return {
    node: process.version,
    plataforma: `${process.platform}-${process.arch}`,
    host: os.hostname(),
    runnerDeTeste: 'jest',
    bancoDeTeste: process.env.CRM_PG_TEST_URL ? 'CRM_PG_TEST_URL' : 'padrao',
    runnerEngenharia: process.env.ENGINEERING_RUNNER_URL ? 'ENGINEERING_RUNNER_URL' : 'padrao',
    ...extra,
  };
}

/**
 * Cria a execução: diretório + manifesto com status RUNNING.
 * O manifesto é a autoridade de identidade — resultados só valem referenciando um runId.
 */
function iniciar({ rootDir, baseRel, commit, sourceFingerprint, inventoryFingerprint, testManifestFingerprint, escopo, ambiente }) {
  const runId = `run-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}-${crypto.randomBytes(4).toString('hex')}`;
  const dir = dirDaExecucao(rootDir, baseRel, runId);
  fs.mkdirSync(path.join(dir, 'itens'), { recursive: true });
  const manifesto = {
    schemaVersion: 1,
    kind: 'bug-closure-regularization-run',
    authoritative: false,
    runId,
    versaoRegularizador: VERSAO_REGULARIZADOR,
    identidade: {
      commit,
      sourceFingerprint,
      inventoryFingerprint,
      testManifestFingerprint,
    },
    ambiente: ambiente || identidadeDoAmbiente(),
    escopo: {
      tipo: escopo.tipo, // INTEGRAL | PARCIAL
      filtroSeveridade: escopo.filtroSeveridade || 'ALL',
      idsSelecionados: escopo.idsSelecionados || [],
      limite: escopo.limite || 0,
      esperadoNoEscopo: escopo.esperadoNoEscopo || 0,
      completo: false, // só vira true no fim, se cobriu o esperado
    },
    status: STATUS.RUNNING,
    startedAt: agora(),
    completedAt: null,
    resultados: 0,
  };
  fs.writeFileSync(path.join(dir, 'manifest.json'), `${JSON.stringify(manifesto, null, 2)}\n`, 'utf8');
  return { runId, dir, manifesto };
}

function lerManifesto(rootDir, baseRel, runId) {
  const abs = path.join(dirDaExecucao(rootDir, baseRel, runId), 'manifest.json');
  if (!fs.existsSync(abs)) return null;
  try {
    return JSON.parse(fs.readFileSync(abs, 'utf8'));
  } catch (_) {
    return null;
  }
}

function gravarResultado({ rootDir, baseRel, runId, resultado, esperadoNoEscopo }) {
  const m = lerManifesto(rootDir, baseRel, runId);
  if (!m) return { ok: false, motivo: 'MANIFESTO_AUSENTE' };
  if (m.status !== STATUS.RUNNING) return { ok: false, motivo: `EXECUCAO_NAO_ESTA_EM_ANDAMENTO:${m.status}` };
  const corpo = {
    ...resultado,
    runId,
    identidade: m.identidade,
    artifactSha256: null,
  };
  const semHash = JSON.stringify(corpo, null, 2);
  corpo.artifactSha256 = sha256Texto(semHash);
  const destino = path.join(dirDaExecucao(rootDir, baseRel, runId), 'itens', `${resultado.id}.json`);
  fs.writeFileSync(destino, `${JSON.stringify(corpo, null, 2)}\n`, 'utf8');
  return { ok: true, abs: destino, sha256: corpo.artifactSha256 };
}

/** Reconhece o fim da execução. `completo` só é true se cobriu TODO o escopo declarado. */
function finalizar({ rootDir, baseRel, runId, status = STATUS.COMPLETED, processados = 0, observacoes = [] }) {
  const abs = path.join(dirDaExecucao(rootDir, baseRel, runId), 'manifest.json');
  const m = lerManifesto(rootDir, baseRel, runId);
  if (!m) return { ok: false, motivo: 'MANIFESTO_AUSENTE' };
  m.status = status;
  m.completedAt = agora();
  m.resultados = processados;
  m.observacoes = observacoes;
  m.escopo.completo = status === STATUS.COMPLETED
    && processados > 0
    && processados >= Number(m.escopo.esperadoNoEscopo || 0);
  fs.writeFileSync(abs, `${JSON.stringify(m, null, 2)}\n`, 'utf8');
  return { ok: true, manifesto: m };
}

/** Lê os resultados de UMA execução conferindo integridade de cada artefato. */
function lerResultados(rootDir, baseRel, runId) {
  const dir = dirDaExecucao(rootDir, baseRel, runId);
  const manifesto = lerManifesto(rootDir, baseRel, runId);
  if (!manifesto) return { ok: false, motivo: 'MANIFESTO_AUSENTE', resultados: [], manifesto: null };
  const dirItens = path.join(dir, 'itens');
  const resultados = [];
  const adulterados = [];
  const arquivos = fs.existsSync(dirItens) ? fs.readdirSync(dirItens).filter((f) => f.endsWith('.json')).sort() : [];
  for (const arquivo of arquivos) {
    const abs = path.join(dirItens, arquivo);
    let corpo;
    try {
      corpo = JSON.parse(fs.readFileSync(abs, 'utf8'));
    } catch (e) {
      adulterados.push({ arquivo, motivo: `ILEGIVEL:${e.message}` });
      continue;
    }
    const semHash = JSON.stringify({ ...corpo, artifactSha256: null }, null, 2);
    if (sha256Texto(semHash) !== corpo.artifactSha256) {
      adulterados.push({ arquivo, motivo: 'ARTIFACT_HASH_DIVERGENTE' });
      continue;
    }
    if (String(corpo.runId) !== String(runId)) {
      adulterados.push({ arquivo, motivo: `RUN_ID_DIVERGENTE:${corpo.runId}` });
      continue;
    }
    const ident = corpo.identidade || {};
    for (const campo of ['commit', 'sourceFingerprint', 'inventoryFingerprint', 'testManifestFingerprint']) {
      if (String(ident[campo]) !== String(manifesto.identidade[campo])) {
        adulterados.push({ arquivo, motivo: `IDENTIDADE_DIVERGENTE:${campo}` });
        break;
      }
    }
    resultados.push(corpo);
  }
  return { ok: adulterados.length === 0, motivo: adulterados.length ? 'ARTEFATO_ADULTERADO' : null, resultados, manifesto, adulterados };
}

/**
 * AGREGAÇÃO EXPLÍCITA de execuções. Nunca mistura silenciosamente.
 *
 * Recusa quando:
 *   - a lista de runs é vazia ou algum run não existe;
 *   - algum run não está COMPLETED (execução interrompida/parcial ⇒ INCOMPLETE);
 *   - a identidade de código difere entre runs (commit/fingerprints);
 *   - o mesmo id aparece em mais de um run (duplicidade não é "o último vence");
 *   - algum artefato foi adulterado (hash não confere).
 */
function agregar({ rootDir, baseRel, runIds }) {
  const ids = Array.isArray(runIds) ? runIds : [];
  if (ids.length === 0) return { ok: false, motivo: 'NENHUMA_EXECUCAO_INFORMADA' };

  const execucoes = [];
  for (const runId of ids) {
    const lido = lerResultados(rootDir, baseRel, runId);
    if (!lido.manifesto) return { ok: false, motivo: `EXECUCAO_AUSENTE:${runId}` };
    if (lido.manifesto.status !== STATUS.COMPLETED) {
      return { ok: false, motivo: `EXECUCAO_INCOMPLETA:${runId}:${lido.manifesto.status}` };
    }
    if (!lido.ok) return { ok: false, motivo: `ARTEFATO_ADULTERADO:${runId}`, adulterados: lido.adulterados };
    execucoes.push({ runId, manifesto: lido.manifesto, resultados: lido.resultados });
  }

  const referencia = execucoes[0].manifesto.identidade;
  const campos = ['commit', 'sourceFingerprint', 'inventoryFingerprint', 'testManifestFingerprint'];
  for (const e of execucoes) {
    for (const campo of campos) {
      if (String(e.manifesto.identidade[campo]) !== String(referencia[campo])) {
        return {
          ok: false,
          motivo: `IDENTIDADE_INCOMPATIVEL:${campo}`,
          detalhe: { runBase: execucoes[0].runId, runDivergente: e.runId, esperado: referencia[campo], encontrado: e.manifesto.identidade[campo] },
        };
      }
    }
  }

  const porId = new Map();
  const duplicados = [];
  for (const e of execucoes) {
    for (const r of e.resultados) {
      if (porId.has(r.id)) duplicados.push({ id: r.id, runs: [porId.get(r.id).runId, e.runId] });
      else porId.set(r.id, { ...r, runId: e.runId });
    }
  }
  if (duplicados.length > 0) return { ok: false, motivo: 'ID_DUPLICADO_ENTRE_EXECUCOES', duplicados };

  const resultados = [...porId.values()].sort((a, b) => String(a.severity).localeCompare(String(b.severity)) || String(a.id).localeCompare(String(b.id)));
  // "Completo" = cobertura INTEGRAL do inventário por UMA execução. Execução parcial, ainda que
  // tenha processado tudo o que selecionou, NUNCA é cobertura integral.
  const completo = execucoes.length === 1
    && execucoes[0].manifesto.escopo.tipo === 'INTEGRAL'
    && execucoes[0].manifesto.escopo.completo === true;
  return {
    ok: true,
    identidade: referencia,
    runIds: ids,
    completo,
    escopo: execucoes.map((e) => ({
      runId: e.runId,
      tipo: e.manifesto.escopo.tipo,
      completoNoEscopo: e.manifesto.escopo.completo === true,
      esperadoNoEscopo: e.manifesto.escopo.esperadoNoEscopo,
      processados: e.resultados.length,
    })),
    resultados,
  };
}

module.exports = {
  VERSAO_REGULARIZADOR,
  STATUS,
  iniciar,
  finalizar,
  gravarResultado,
  lerManifesto,
  lerResultados,
  agregar,
  identidadeDoAmbiente,
  dirDaExecucao,
};
