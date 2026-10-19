'use strict';

/**
 * Plano de execução COMPLETO dos validadores do gate agregado — funções PURAS.
 *
 * POR QUE EXISTE (defeito de VISIBILIDADE medido em 2026-10-13):
 * `validate:governance-enforcement` é uma cadeia `&&` no package.json. Quando o
 * primeiro validador falha, os seguintes NÃO rodam — e o log mostra "1 FAIL"
 * como se fosse o único problema. Medido: o agregado reportava 1 falha
 * (`release-governance`) enquanto a execução ISOLADA dos 60 validadores revelou
 * **10 falhas**, com causas completamente diferentes (documento RAG falhado,
 * evidência de runtime obsoleta, projeção stale, pacote ausente...). Quem opera
 * descobria uma falha por ciclo de ~1h.
 *
 * Este módulo NÃO substitui o agregado: ele lê a MESMA lista (fonte única em
 * `package.json`) e permite executar TODOS, preservando o resultado de cada um.
 * A decisão final continua fail-closed: uma falha ⇒ exit ≠ 0.
 */

/** Extrai a lista ordenada de scripts npm do agregado (dedup, ordem preservada). */
function listarValidadores(pkg) {
  // A cadeia canônica vive em `validate:governance-enforcement:chain`; o script
  // `validate:governance-enforcement` é o wrapper que a executa gravando veredito
  // próprio (P1 — agregado sem relatório). Aceitar os dois mantém este planejador
  // funcionando com qualquer uma das formas.
  const agregado = pkg && pkg.scripts
    && (pkg.scripts['validate:governance-enforcement:chain'] || pkg.scripts['validate:governance-enforcement']);
  if (typeof agregado !== 'string' || agregado.trim() === '') {
    throw new Error('validate:governance-enforcement ausente no package.json');
  }
  const vistos = new Set();
  const nomes = [];
  for (const parte of agregado.split('&&')) {
    const m = parte.trim().match(/^npm run (?:--silent )?([^\s]+)/);
    if (!m) continue;
    if (vistos.has(m[1])) continue;
    vistos.add(m[1]);
    nomes.push(m[1]);
  }
  if (nomes.length === 0) {
    throw new Error('nenhum validador extraído de validate:governance-enforcement');
  }
  return nomes;
}

/** Últimas linhas úteis da saída de um validador (o "porquê" fica legível no relatório). */
function resumirSaida(saida, limite = 3) {
  const linhas = String(saida || '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '' && !/^>/.test(l) && !/^npm (error|warn)/i.test(l));
  return linhas.slice(-limite);
}

/**
 * Compõe o relatório. `status` é FAIL quando QUALQUER validador falhar — o gate
 * completo nunca "passa parcialmente".
 */
function comporRelatorio(resultados, { generatedAt = new Date().toISOString(), origem = null } = {}) {
  const lista = Array.isArray(resultados) ? resultados : [];
  const falhas = lista.filter((r) => Number(r.exitCode) !== 0);
  return {
    artifactType: 'governance-enforcement-full-report',
    artifactVersion: '1.0.0',
    generatedAt,
    // De onde a lista veio: sem isso o relatório não é auditável.
    origem: origem || "package.json:scripts['validate:governance-enforcement']",
    total: lista.length,
    pass: lista.length - falhas.length,
    fail: falhas.length,
    status: falhas.length === 0 ? 'PASS' : 'FAIL',
    falhas: falhas.map((r) => r.name),
    results: lista,
  };
}

/** Exit code do runner: 0 só quando TODOS passam (fail-closed). */
function calcularExit(relatorio) {
  return relatorio && relatorio.fail === 0 ? 0 : 1;
}

/**
 * Este validador falhou por CAUSA DE LINEAGE (e só por isso pode ser revalidado
 * após o carimbo)?
 *
 * Restrito de propósito: mensagem `INVALID_AUTHORITATIVE_ARTIFACT` (emitida pelo
 * `validate:current-run-temporal-integrity`) ou o consumidor declarado do
 * relatório dele (`validate:required-tests`). Qualquer outra falha NUNCA é
 * reexecutada — reexecutar "o que falhou" genericamente seria dar uma segunda
 * chance a defeito real.
 */
function deveRevalidarAposCarimbo(resultado) {
  if (!resultado || Number(resultado.exitCode) === 0) return false;
  if (resultado.name === 'validate:required-tests') return true;
  return (resultado.summary || []).some((l) => /INVALID_AUTHORITATIVE_ARTIFACT/.test(String(l)));
}

/** Filtra a lista por `--only=a,b` (para execução dirigida, ex.: testes). */
function filtrarValidadores(nomes, only) {
  const selecionados = String(only || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (selecionados.length === 0) return nomes;
  const desconhecidos = selecionados.filter((s) => !nomes.includes(s));
  if (desconhecidos.length > 0) {
    // Um `--only` que não casa nada NÃO pode virar "0 validadores, tudo ok":
    // seria um verde por vacuidade (o mesmo defeito que o runner combate).
    throw new Error(`--only com validador(es) fora do agregado: ${desconhecidos.join(', ')}`);
  }
  return nomes.filter((n) => selecionados.includes(n));
}

/**
 * O runner NÃO pode ficar cego à mutação da própria superfície que ele prova.
 *
 * DEFEITO MEDIDO (2026-10-13): durante uma execução deste runner, um arquivo NOVO
 * foi criado em `scripts/smoke/` — raiz que está em `SOURCE_ROOTS` do
 * fingerprint chain. A evidência de runtime do engineering-router foi coletada
 * ANTES da criação e validada DEPOIS, contra um fingerprint já diferente, e o
 * `validate:engineering-router-v1:runtime` reprovou com
 * `RUNTIME_EVIDENCE_FRESH`/"evidência de runtime obsoleta". O gate estava CERTO
 * (evidência de uma superfície que mudou não vale), mas o operador recebia isso
 * como se fosse falha de produto, no fim de um run de ~40 min, sem nenhuma
 * pista de que o motivo era uma edição feita durante o próprio run.
 *
 * Aqui o runner passa a MEDIR a superfície provada antes e depois do loop e a
 * ATRIBUIR as falhas de obsolescência à mutação — explicitamente, com a lista de
 * arquivos. Não mascara nada: o exit continua refletindo as falhas; muda só a
 * explicação, e o relatório passa a dizer que a ação correta é estabilizar o
 * worktree e recoletar (não "consertar um defeito" que não existe).
 */
const MOTIVOS_OBSOLESCENCIA_POR_MUTACAO = [
  /RUNTIME_EVIDENCE_FRESH/i,
  /evid[eê]ncia de runtime obsoleta/i,
  /sourceFingerprint/i,
  /fingerprint.*(diverg|mudou|obsolet)/i,
];

/** Mapa {arquivo -> hash} da superfície provada, via mecanismos canônicos. */
function mapearSuperficieProvada(rootDir) {
  const path = require('path');
  const fs = require('fs');
  const { walkSourceFiles } = require(path.join(rootDir, 'governance', 'proof-engine', 'fingerprint-chain'));
  const { sha256 } = require(path.join(rootDir, 'qa', 'coverage', 'fingerprints'));

  const mapa = {};
  for (const rel of walkSourceFiles(rootDir)) {
    try {
      mapa[rel] = sha256(fs.readFileSync(path.join(rootDir, rel), 'utf8'));
    } catch (_) {
      mapa[rel] = 'ILEGIVEL';
    }
  }
  return mapa;
}

/** Diferença entre duas fotografias da superfície provada. */
function compararSuperficieProvada(antes, depois) {
  const mapAntes = antes || {};
  const mapDepois = depois || {};
  const alterados = [];
  for (const [rel, hash] of Object.entries(mapDepois)) {
    if (!(rel in mapAntes)) alterados.push({ arquivo: rel, tipo: 'criado' });
    else if (mapAntes[rel] !== hash) alterados.push({ arquivo: rel, tipo: 'modificado' });
  }
  for (const rel of Object.keys(mapAntes)) {
    if (!(rel in mapDepois)) alterados.push({ arquivo: rel, tipo: 'removido' });
  }
  alterados.sort((a, b) => a.arquivo.localeCompare(b.arquivo));
  return { estabilidade: alterados.length === 0 ? 'ESTAVEL' : 'MUTADA_DURANTE_O_RUN', alterados };
}

/**
 * Marca, sem apagar, quais falhas são EXPLICADAS pela mutação da superfície.
 * Uma falha só é atribuída quando (a) a superfície realmente mudou e (b) o motivo
 * da falha é de obsolescência — nunca por conveniência.
 */
function atribuirMutacaoDaSuperficie(resultados, estabilidade) {
  const mutada = estabilidade && estabilidade.estabilidade === 'MUTADA_DURANTE_O_RUN';
  if (!mutada) return [];
  const atribuidos = [];
  for (const r of resultados) {
    if (r.exitCode === 0) continue;
    const motivo = (r.summary || []).join(' ');
    if (!MOTIVOS_OBSOLESCENCIA_POR_MUTACAO.some((re) => re.test(motivo))) continue;
    r.attributedToSourceMutation = true;
    atribuidos.push(r.name);
  }
  return atribuidos;
}

module.exports = {
  listarValidadores,
  resumirSaida,
  comporRelatorio,
  calcularExit,
  filtrarValidadores,
  deveRevalidarAposCarimbo,
  mapearSuperficieProvada,
  compararSuperficieProvada,
  atribuirMutacaoDaSuperficie,
  MOTIVOS_OBSOLESCENCIA_POR_MUTACAO,
};
