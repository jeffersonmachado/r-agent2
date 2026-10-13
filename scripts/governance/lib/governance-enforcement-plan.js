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
  const agregado = pkg && pkg.scripts && pkg.scripts['validate:governance-enforcement'];
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

module.exports = {
  listarValidadores,
  resumirSaida,
  comporRelatorio,
  calcularExit,
  filtrarValidadores,
  deveRevalidarAposCarimbo,
};
