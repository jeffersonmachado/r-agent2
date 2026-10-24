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

/** Contrato do runId: `run-<14 dígitos de data>-<8 hex>`. Entra em caminho, logo é validado. */
const PADRAO_RUN_ID = /^run-\d{14}-[0-9a-f]{8}$/;

function validarRunId(runId) {
  if (typeof runId !== 'string' || !PADRAO_RUN_ID.test(runId)) {
    return { ok: false, motivo: `RUN_ID_FORA_DO_CONTRATO:${String(runId).slice(0, 40)}` };
  }
  return { ok: true, runId };
}

const sha256Texto = (t) => crypto.createHash('sha256').update(String(t), 'utf8').digest('hex');
const sha256Arquivo = (abs) => crypto.createHash('sha256').update(fs.readFileSync(abs)).digest('hex');
const agora = () => new Date().toISOString();

/** `baseRel` é relativo, sem `..` e sem raiz absoluta (achado A5). */
function validarBaseRel(baseRel) {
  if (typeof baseRel !== 'string' || baseRel.trim() === '') return { ok: false, motivo: 'BASE_REL_INVALIDA' };
  if (path.isAbsolute(baseRel)) return { ok: false, motivo: 'BASE_REL_ABSOLUTA' };
  if (baseRel.split(/[\\/]/).includes('..')) return { ok: false, motivo: 'BASE_REL_COM_TRAVERSAL' };
  return { ok: true };
}

/**
 * Caminho da execução, com contenção REAL (achado A4): `path.resolve` não resolve symlink e
 * `startsWith` é comparação textual — um symlink `runs/<runId>` apontando para fora passava.
 * Aqui o `realpath` é obrigatório nos dois lados (mesma disciplina de `defect-id.dentroDaRaiz`).
 */
function dirDaExecucao(rootDir, baseRel, runId) {
  const v = validarRunId(runId);
  if (!v.ok) throw new Error(v.motivo);
  const baseValidada = validarBaseRel(baseRel);
  if (!baseValidada.ok) throw new Error(baseValidada.motivo);
  const base = path.resolve(rootDir, baseRel, 'runs');
  const abs = path.resolve(base, v.runId);
  if (abs !== path.join(base, v.runId)) throw new Error(`RUN_ID_FORA_DA_RAIZ:${String(runId).slice(0, 40)}`);
  // A base pode não existir ainda: resolve o ancestral real e recompõe o trecho relativo.
  const realBase = realpathDoAncestral(base);
  const relDentro = path.relative(base, abs);
  const recomposto = path.resolve(realBase, relDentro);
  if (recomposto !== path.join(realBase, v.runId) || !recomposto.startsWith(`${realBase}${path.sep}`)) {
    throw new Error(`RUN_ID_FORA_DA_RAIZ:${String(runId).slice(0, 40)}`);
  }
  // O diretório da execução JÁ existente é resolvido de verdade: symlink escapa mesmo que o
  // caminho textual pareça contido (achado A4).
  const st = fs.lstatSync(abs, { throwIfNoEntry: false });
  if (st) {
    if (st.isSymbolicLink()) throw new Error(`RUN_DIR_E_SYMLINK:${String(runId).slice(0, 40)}`);
    const realAbs = fs.realpathSync(abs);
    if (realAbs !== path.join(realBase, v.runId)) {
      throw new Error(`RUN_ID_FORA_DA_RAIZ:${String(runId).slice(0, 40)}`);
    }
  }
  return abs;
}

/** `realpath` do ancestral existente mais próximo (o diretório pode ainda não existir). */
function realpathDoAncestral(abs) {
  let atual = path.resolve(abs);
  for (;;) {
    try {
      return fs.realpathSync(atual);
    } catch (_) {
      const pai = path.dirname(atual);
      if (pai === atual) return path.resolve(atual);
      atual = pai;
    }
  }
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
function iniciar({ rootDir, baseRel, commit, sourceFingerprint, inventoryFingerprint, hardeningQueueFingerprint, testManifestFingerprint, escopo, ambiente }) {
  const runId = `run-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}-${crypto.randomBytes(4).toString('hex')}`;
  const dir = dirDaExecucao(rootDir, baseRel, runId);
  const dirItensNovo = path.join(dir, 'itens');
  const stItensNovo = fs.lstatSync(dirItensNovo, { throwIfNoEntry: false });
  if (stItensNovo && stItensNovo.isSymbolicLink()) throw new Error('ITENS_E_SYMLINK');
  fs.mkdirSync(dirItensNovo, { recursive: true });
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
      // Digest da FILA (candidatos) — distinto do inventário de sistema. É contra ele que a
      // cobertura integral é conferida (achado A1-1 da 3ª passada).
      hardeningQueueFingerprint: hardeningQueueFingerprint || null,
      testManifestFingerprint,
    },
    ambiente: ambiente || identidadeDoAmbiente(),
    escopo: {
      tipo: escopo.tipo, // INTEGRAL | PARCIAL
      filtroSeveridade: escopo.filtroSeveridade || 'ALL',
      idsSelecionados: escopo.idsSelecionados || [],
      limite: escopo.limite || 0,
      esperadoNoEscopo: escopo.esperadoNoEscopo || 0,
      // LISTA EXPLÍCITA do que a execução se propôs a cobrir. Sem ela, "N artefatos" poderia ser
      // satisfeito com N arquivos de conteúdo repetido (achado (a) da 2ª passada).
      idsEsperados: Array.isArray(escopo.idsEsperados) ? [...escopo.idsEsperados] : [],
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
  if (!validarRunId(runId).ok) return null;
  let dir;
  try {
    dir = dirDaExecucao(rootDir, baseRel, runId);
  } catch (_) {
    // Caminho recusado (symlink, traversal) é "não há manifesto legível" — fail-closed.
    return null;
  }
  const abs = path.join(dir, 'manifest.json');
  if (!fs.existsSync(abs)) return null;
  try {
    return JSON.parse(fs.readFileSync(abs, 'utf8'));
  } catch (_) {
    return null;
  }
}

/** Contrato do id de RESULTADO (achado A8): o arquivo é `<id>.json`, logo o id é caminho. */
function validarIdResultado(id) {
  if (typeof id !== 'string' || id.trim() === '') return { ok: false, motivo: 'ID_VAZIO' };
  if (id.length > 120) return { ok: false, motivo: 'ID_LONGO_DEMAIS' };
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id)) return { ok: false, motivo: 'ID_FORA_DO_CONTRATO' };
  if (id.includes('..') || id.includes('/') || id.includes('\\')) return { ok: false, motivo: 'ID_COM_SEPARADOR_DE_CAMINHO' };
  return { ok: true, id };
}

function gravarResultado({ rootDir, baseRel, runId, resultado, esperadoNoEscopo }) {
  const idValido = validarIdResultado(resultado && resultado.id);
  if (!idValido.ok) return { ok: false, motivo: `RESULTADO_ID_INVALIDO:${idValido.motivo}` };
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
  let dirDoRun;
  try {
    dirDoRun = dirDaExecucao(rootDir, baseRel, runId);
  } catch (e) {
    return { ok: false, motivo: e.message };
  }
  // Achado A4-1: `itens/` também é componente de caminho — symlink aqui ESCREVERIA fora.
  const dirItensAlvo = path.join(dirDoRun, 'itens');
  const stItens = fs.lstatSync(dirItensAlvo, { throwIfNoEntry: false });
  if (stItens && stItens.isSymbolicLink()) return { ok: false, motivo: 'ITENS_E_SYMLINK' };
  const destino = path.join(dirItensAlvo, `${resultado.id}.json`);
  const stDestino = fs.lstatSync(destino, { throwIfNoEntry: false });
  if (stDestino && stDestino.isSymbolicLink()) return { ok: false, motivo: 'RESULTADO_E_SYMLINK' };
  // Escrita atômica: temporário imprevisível + rename (não segue symlink, não deixa parcial).
  const tmp = path.join(dirItensAlvo, `.tmp-${process.pid}-${crypto.randomBytes(8).toString('hex')}`);
  try {
    const fd = fs.openSync(tmp, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
    try {
      fs.writeSync(fd, `${JSON.stringify(corpo, null, 2)}\n`);
      fs.fsyncSync(fd);
    } finally {
      try { fs.closeSync(fd); } catch (_) { /* já fechado */ }
    }
    fs.renameSync(tmp, destino);
  } catch (e) {
    try { fs.rmSync(tmp, { force: true }); } catch (_) { /* nada a limpar */ }
    return { ok: false, motivo: `ESCRITA_FALHOU:${e.code || e.message}` };
  }
  return { ok: true, abs: destino, sha256: corpo.artifactSha256 };
}

/** Reconhece o fim da execução. `completo` só é true se cobriu TODO o escopo declarado. */
function finalizar({ rootDir, baseRel, runId, status = STATUS.COMPLETED, observacoes = [] }) {
  const abs = path.join(dirDaExecucao(rootDir, baseRel, runId), 'manifest.json');
  const m = lerManifesto(rootDir, baseRel, runId);
  if (!m) return { ok: false, motivo: 'MANIFESTO_AUSENTE' };
  // `processados` é CONTADO dos artefatos (achado 1 da revisão): o chamador não declara
  // cobertura, ele a produz.
  const dirItens = path.join(path.dirname(abs), 'itens');
  const processados = fs.existsSync(dirItens)
    ? fs.readdirSync(dirItens).filter((f) => f.endsWith('.json')).length
    : 0;
  m.status = status;
  m.completedAt = agora();
  m.resultados = processados;
  m.observacoes = observacoes;
  const idsEsperados = Array.isArray(m.escopo.idsEsperados) ? m.escopo.idsEsperados : [];
  const stItensFinalizar = fs.lstatSync(dirItens, { throwIfNoEntry: false });
  if (stItensFinalizar && stItensFinalizar.isSymbolicLink()) return { ok: false, motivo: 'ITENS_E_SYMLINK' };
  const arquivosItens = fs.existsSync(dirItens) ? fs.readdirSync(dirItens).filter((f) => f.endsWith('.json')) : [];
  const idsReais = [];
  for (const arquivo of arquivosItens) {
    const esperadoDoArquivo = arquivo.replace(/\.json$/, '');
    let idDoConteudo = null;
    try {
      idDoConteudo = JSON.parse(fs.readFileSync(path.join(dirItens, arquivo), 'utf8')).id;
    } catch (_) {
      idDoConteudo = null;
    }
    // Nome do arquivo e id do CONTEÚDO têm de coincidir (achado A8): senão `completo:true`
    // poderia ser declarado com o conteúdo de outro defeito.
    if (String(idDoConteudo) !== String(esperadoDoArquivo)) return {
      ok: false,
      motivo: `RESULTADO_ID_DIVERGENTE_DO_ARQUIVO:${arquivo}`,
    };
    idsReais.push(esperadoDoArquivo);
  }
  const cobreLista = idsEsperados.length > 0
    && new Set(idsReais).size === idsReais.length
    && idsReais.length === idsEsperados.length
    && idsEsperados.every((id) => idsReais.includes(String(id)));
  m.escopo.completo = status === STATUS.COMPLETED
    && processados > 0
    && processados >= Number(m.escopo.esperadoNoEscopo || 0)
    && cobreLista;
  fs.writeFileSync(abs, `${JSON.stringify(m, null, 2)}\n`, 'utf8');
  return { ok: true, manifesto: m };
}

/** Lê os resultados de UMA execução conferindo integridade de cada artefato. */
function lerResultados(rootDir, baseRel, runId) {
  if (!validarRunId(runId).ok) {
    return { ok: false, motivo: `RUN_ID_FORA_DO_CONTRATO:${String(runId).slice(0, 40)}`, resultados: [], manifesto: null };
  }
  let dir;
  try {
    dir = dirDaExecucao(rootDir, baseRel, runId);
  } catch (e) {
    return { ok: false, motivo: e.message, resultados: [], manifesto: null };
  }
  const manifesto = lerManifesto(rootDir, baseRel, runId);
  if (!manifesto) return { ok: false, motivo: 'MANIFESTO_AUSENTE', resultados: [], manifesto: null };
  const dirItens = path.join(dir, 'itens');
  // `itens/` também é componente de caminho: symlink aqui leria artefatos de fora da execução
  // (achado (d) da 3ª passada). Recusa explícita, não confiança no hash do conteúdo.
  const stItens = fs.lstatSync(dirItens, { throwIfNoEntry: false });
  if (stItens && stItens.isSymbolicLink()) {
    return { ok: false, motivo: 'ITENS_E_SYMLINK', resultados: [], manifesto, adulterados: [{ arquivo: 'itens', motivo: 'ITENS_E_SYMLINK' }] };
  }
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
    for (const campo of ['commit', 'sourceFingerprint', 'inventoryFingerprint', 'hardeningQueueFingerprint', 'testManifestFingerprint']) {
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
 * LIMITE DECLARADO (achado 3 da revisão independente): a identidade é auto-declarada e o
 * `artifactSha256` é calculado pelo executor; quem reescrever manifesto + itens E recalcular os
 * hashes passa. É detecção de erro OPERACIONAL, não controle contra adulteração deliberada.
 *
 * Recusa quando:
 *   - a lista de runs é vazia ou algum run não existe;
 *   - algum run não está COMPLETED (execução interrompida/parcial ⇒ INCOMPLETE);
 *   - a identidade de código difere entre runs (commit/fingerprints);
 *   - o mesmo id aparece em mais de um run (duplicidade não é "o último vence");
 *   - algum artefato foi adulterado (hash não confere).
 */
/**
 * Candidatos REAIS do inventário do rootDir: defeitos que declaram fechamento sem prova válida,
 * derivados pela MESMA regra do regularizador (`defect-registry`), com os mesmos filtros do
 * escopo. É isso — e não a lista que o manifesto declara — que define "cobertura integral".
 */
function candidatosDoInventario(rootDir, escopo = {}) {
  try {
    // A REGRA vem do módulo (código); os DADOS vêm da fila do rootDir agregado. Carregar o
    // registry do próprio rootDir faria de um diretório de evidência a autoridade da regra.
    const registry = require('../../..' + '/governance/bug-closure/defect-registry');
    const queuePath = path.join(rootDir, 'AI_MEMORY', 'hardening-queue.json');
    const inventario = registry.carregarInventario({ queuePath, rootDir });
    let candidatos = (inventario.defeitos || []).filter((d) => d.fechamentoNaoProvado === true);
    const apenas = String(escopo.filtroSeveridade || 'ALL').toUpperCase();
    if (apenas !== 'ALL') candidatos = candidatos.filter((d) => String(d.severity || '').toUpperCase() === apenas);
    if (Array.isArray(escopo.idsSelecionados) && escopo.idsSelecionados.length > 0) {
      candidatos = candidatos.filter((d) => escopo.idsSelecionados.includes(d.id));
    }
    const limite = Number(escopo.limite || 0);
    if (limite > 0) candidatos = candidatos.slice(0, limite);
    return candidatos.map((d) => String(d.id)).sort();
  } catch (_) {
    return null;
  }
}

/**
 * Digest canônico do inventário OFICIAL do rootDir (mesma função do resto do Bug Closure).
 * `null` quando não é possível calcular — o que impede declarar cobertura integral.
 */
function digestDoInventarioOficial(rootDir) {
  try {
    // Hash do ARQUIVO da fila — exatamente o valor que o regularizador grava em
    // `identidade.hardeningQueueFingerprint`. Comparar digest-de-itens contra hash-de-arquivo
    // reprovava toda execução genuína (achado A1-1 da 3ª passada).
    return sha256Arquivo(path.join(rootDir, 'AI_MEMORY', 'hardening-queue.json'));
  } catch (_) {
    return null;
  }
}

/**
 * AGREGAÇÃO EXPLÍCITA de execuções. Nunca mistura silenciosamente.
 *
 * ACHADO A1 da 2ª passada: `completo` era recalculado apenas contra `manifesto.escopo.idsEsperados`
 * — que o próprio manifesto declara. Um manifesto com `tipo:INTEGRAL`, 1 id e 1 artefato recebia
 * "cobertura INTEGRAL" com 135 itens na fila. Agora a cobertura integral exige, além da lista
 * exata, que o `inventoryFingerprint` do manifesto seja o digest do inventário REAL do rootDir,
 * recalculado aqui. Sem inventário legível, não há cobertura integral (fail-closed).
 *
 * LIMITE DECLARADO (achado 3 da 1ª passada): a identidade é auto-declarada e o `artifactSha256` é
 * calculado pelo executor; quem reescrever manifesto + itens E recalcular os hashes passa. É
 * detecção de erro OPERACIONAL, não controle contra adulteração deliberada.
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

  // Nenhuma execução VAZIA pode ser agregada: zero artefatos não prova cobertura nenhuma.
  const vazia = execucoes.find((e) => e.resultados.length === 0);
  if (vazia) {
    return { ok: false, motivo: `EXECUCAO_SEM_RESULTADOS:${vazia.runId}` };
  }

  const referencia = execucoes[0].manifesto.identidade;
  const campos = ['commit', 'sourceFingerprint', 'inventoryFingerprint', 'hardeningQueueFingerprint', 'testManifestFingerprint'];
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
  // "Completo" é RECALCULADO a partir dos artefatos lidos E do inventário real — nunca aceito do
  // manifesto. (Achado 1 da 1ª passada: manifesto forjado com `completo:true` e zero itens.
  // Achado A1 da 2ª passada: cobertura relativa à lista que o próprio manifesto declara.)
  const digestRealDoInventario = digestDoInventarioOficial(rootDir);
  const completaPorArtefatos = (e) => {
    const escopo = e.manifesto.escopo || {};
    const esperado = Number(escopo.esperadoNoEscopo || 0);
    const idsEsperados = Array.isArray(escopo.idsEsperados) ? escopo.idsEsperados : [];
    const idsReais = e.resultados.map((r) => String(r.id));
    // Achado A1-2 (3ª passada): comparar com a lista do PRÓPRIO manifesto autenticava a fila,
    // não o escopo — 1 id de 130 passava como integral. O conjunto esperado é DERIVADO da fila
    // pela mesma regra do regularizador e tem de casar com o que foi executado.
    const candidatosReais = candidatosDoInventario(rootDir, escopo);
    const escopoConfere = Array.isArray(candidatosReais)
      && candidatosReais.length > 0
      && idsEsperados.length === candidatosReais.length
      && candidatosReais.every((id, i) => String(idsEsperados[i]) === id);
    const cobreLista = idsEsperados.length > 0
      && new Set(idsReais).size === idsReais.length
      && idsReais.length === idsEsperados.length
      && idsEsperados.every((id) => idsReais.includes(String(id)));
    // Achado A1-1: o CLI grava `inventoryFingerprint` do system-inventory; o digest da FILA é
    // outro campo. Comparar campos diferentes reprovava toda execução genuína.
    const filaDoManifesto = e.manifesto.identidade.hardeningQueueFingerprint;
    const filaConfere = Boolean(digestRealDoInventario)
      && String(filaDoManifesto) === String(digestRealDoInventario);
    // Achado (a) da 4ª passada (auto-revisão): declarar `tipo:INTEGRAL` com `limite`/filtro
    // reduzia o conjunto derivado e um SUBCONJUNTO passava como cobertura integral. Integral
    // exige escopo NEUTRO: sem limite, sem filtro de severidade, sem seleção de ids.
    const escopoNeutro = Number(escopo.limite || 0) === 0
      && String(escopo.filtroSeveridade || 'ALL').toUpperCase() === 'ALL'
      && (!Array.isArray(escopo.idsSelecionados) || escopo.idsSelecionados.length === 0);
    return escopoNeutro
      && escopo.tipo === 'INTEGRAL'
      && e.resultados.length > 0
      && esperado > 0
      && e.resultados.length >= esperado
      && cobreLista
      && escopoConfere
      && filaConfere
      && Number(e.manifesto.resultados) === e.resultados.length;
  };
  const completo = execucoes.length === 1 && completaPorArtefatos(execucoes[0]);
  return {
    ok: true,
    identidade: referencia,
    runIds: ids,
    completo,
    // Explicita POR QUE a cobertura não é integral, para o relatório não sugerir o contrário.
    coberturaIntegral: completo
      ? { motivo: 'lista de ids coberta e inventário do rootDir confere', inventoryDigest: digestRealDoInventario }
      : { motivo: digestRealDoInventario ? 'escopo/lista/inventário não conferem' : 'INVENTARIO_ILEGIVEL', inventoryDigest: digestRealDoInventario },
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
  validarRunId,
  validarBaseRel,
  validarIdResultado,
  digestDoInventarioOficial,
  candidatosDoInventario,
  PADRAO_RUN_ID,
};
