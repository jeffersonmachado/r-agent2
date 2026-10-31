'use strict';

/**
 * Política de operação do QA Mesh — QUANDO o Bug Closure First se aplica.
 *
 * Defeito real medido em 2026-10-21 (checkout limpo, `npm run qa:mesh:refresh`):
 * `pipeline/entrypoints/runQaMesh.js` chamava `exigirElegibilidade('QA_WAVES_COMPLETA')`
 * ANTES de olhar o que foi pedido. Com um P1 bloqueante aberto na fila (o próprio item
 * `L1-NPM-TEST-CI-VERMELHO`, aberto justamente porque o ambiente não estava preparado),
 * o comando que **constrói o índice** do mesh era recusado com exit 3:
 *
 *   [bug-closure] QA_WAVES_COMPLETA @ …: RECUSADO — P1_BLOQUEANTE_ABERTO
 *
 * Isso fecha um ciclo impossível: o índice é PRÉ-REQUISITO para medir cobertura e
 * fechar o defeito, e o defeito impede construir o índice.
 *
 * A distinção correta:
 *   - `--refresh-registry` (sozinho) apenas RECONSTRÓI O ÍNDICE a partir das definições
 *     versionadas (`meshRunner.refreshRegistry()` → `buildRegistry()`). Não executa
 *     cenário, não produz evidência canônica, não promove go/no-go, não toca o host.
 *     → NÃO é operação extensiva; não pode ser barrada por Bug Closure First.
 *   - Qualquer execução (inclusive `--impact-only`, `--only`, listas de cenários ou
 *     `--refresh-registry` combinado com outra flag) EXECUTA cenários e continua
 *     integralmente sujeita ao gate.
 *
 * A regra é conservadora de propósito: só a forma EXATA `--refresh-registry` isolado é
 * classificada como manutenção de índice. Qualquer combinação cai em `EXECUCAO`.
 */

const REFRESH_REGISTRY = 'REFRESH_REGISTRY';
const EXECUCAO = 'EXECUCAO';

/**
 * @param {string[]} argv argumentos do processo (sem node/script)
 * @returns {'REFRESH_REGISTRY'|'EXECUCAO'}
 */
function classificarOperacaoMesh(argv = []) {
  const args = Array.isArray(argv) ? argv : [];
  const flags = args.filter((a) => String(a).startsWith('--'));
  const posicionais = args.filter((a) => !String(a).startsWith('--'));
  if (flags.length === 1 && flags[0] === '--refresh-registry' && posicionais.length === 0) {
    return REFRESH_REGISTRY;
  }
  return EXECUCAO;
}

/** `true` quando a operação EXECUTA cenários (e portanto exige elegibilidade). */
function exigeElegibilidade(argv = []) {
  return classificarOperacaoMesh(argv) === EXECUCAO;
}

module.exports = { classificarOperacaoMesh, exigeElegibilidade, REFRESH_REGISTRY, EXECUCAO };
