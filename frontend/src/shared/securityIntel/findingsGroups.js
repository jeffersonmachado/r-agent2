/**
 * Colapso dos achados por PACOTE (serviço + nome@versão).
 *
 * DEFEITO MEDIDO (2026-10-11, tela /dev/security-intel): 130 achados carregados
 * correspondiam a apenas **39 pacotes distintos** — 28 pacotes repetidos, com
 * `brace-expansion@2.0.2#frontend` ocupando 14 linhas (uma por advisory). O
 * operador decide sobre PACOTES (é assim que o gate conta: `packageServiceKey`),
 * mas a tabela o obrigava a ler advisor por advisor para descobrir o que fazer.
 *
 * A regra aqui NÃO esconde nada: cada consulta mantém os membros do grupo
 * acessíveis. O colapso troca a linha repetida por UMA linha representativa
 * (o achado mais grave do pacote) e devolve a contagem para a tela dizer
 * "+N advisories" — com a lista completa quando o grupo é expandido.
 *
 * Módulo puro: sem React, sem I/O, sem relógio.
 */

/** Ordem de gravidade (mesma do restante da superfície: crítico primeiro). */
export const SEVERITY_RANK = Object.freeze({
  CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3, INFORMATIONAL: 4,
});

export function severityRank(severity) {
  const chave = String(severity || '').toUpperCase();
  return Object.prototype.hasOwnProperty.call(SEVERITY_RANK, chave) ? SEVERITY_RANK[chave] : 9;
}

function findingKeyOf(row) {
  if (!row) return null;
  return row.finding_key || row.findingKey || null;
}

/**
 * Chave do grupo: serviço + pacote@versão.
 *
 * O serviço entra na chave de propósito: `braces@3.0.3` no `api` e no `frontend`
 * são exposições diferentes (superfícies diferentes), e o gate também as separa.
 */
export function packageGroupKey(row) {
  const servico = row && row.service ? row.service : '?';
  const pacote = row && row.package_name ? row.package_name : '?';
  const versao = row && row.installed_version ? row.installed_version : '?';
  return `${servico}::${pacote}@${versao}`;
}

/**
 * Colapsa a lista de achados por pacote.
 *
 * @param {Array} items achados já filtrados pela tela (o colapso não filtra nada)
 * @param {{expandedKeys?: Set<string>, waiversByFinding?: Map<string, object>}} [options]
 *   `expandedKeys` são os grupos que o operador abriu; `waiversByFinding` permite
 *   contar quantos advisories do grupo têm isenção ATIVA (sem isso, o resumo
 *   diria que o pacote bloqueia quando ele já está isento).
 * @returns {{rows: Array, groups: Map<string, object>}}
 *   `rows` é a lista a renderizar (representantes + membros dos grupos abertos),
 *   na MESMA ordem relativa em que os grupos apareceram na entrada;
 *   `groups` mapeia chave → resumo AGREGADO de TODOS os membros
 *   (count, runtimeCount, devOnlyCount, kevCount, bloqueantes, maxSeverity, …).
 */
export function collapseFindingsByPackage(items, { expandedKeys, waiversByFinding } = {}) {
  const lista = Array.isArray(items) ? items : [];
  const expandidos = expandedKeys instanceof Set ? expandedKeys : new Set();
  const isencoes = waiversByFinding instanceof Map ? waiversByFinding : new Map();
  const porChave = new Map();
  for (const row of lista) {
    const chave = packageGroupKey(row);
    if (!porChave.has(chave)) porChave.set(chave, []);
    porChave.get(chave).push(row);
  }

  const rows = [];
  const groups = new Map();
  let emitidos = 0;
  for (const [chave, membros] of porChave) {
    // Representante = achado mais grave; empate resolvido pelo primeiro da entrada
    // (a entrada já vem ordenada por prioridade/severidade do backend).
    const representante = membros.reduce((melhor, atual) => (
      severityRank(atual && atual.severity) < severityRank(melhor && melhor.severity) ? atual : melhor
    ), membros[0]);
    // Severidade do GRUPO = a mais grave entre TODOS os membros (não só a do
    // representante): o resumo precisa descrever o pacote, e um grupo com um
    // crítico dentro não pode aparecer como "médio" por causa do desempate.
    const membroMaisGrave = membros.reduce((melhor, atual) => (
      severityRank(atual && atual.severity) < severityRank(melhor && melhor.severity) ? atual : melhor
    ), membros[0]);
    const severidadeMaxima = membroMaisGrave ? membroMaisGrave.severity : null;
    const devOnlyCount = membros.filter((row) => row && row.dev_only === true).length;
    const runtimeCount = membros.length - devOnlyCount;
    const isentoDe = (row) => {
      const chaveAchado = findingKeyOf(row);
      const entrada = chaveAchado ? isencoes.get(chaveAchado) : null;
      return Boolean(entrada && entrada.active);
    };
    // Bloqueia o release: gravidade bloqueante, risco de RUNTIME (dev-only não vai
    // a produção) e sem isenção vigente. É a conta que o operador precisa ver.
    const bloqueantes = membros.filter((row) => (
      severityRank(row && row.severity) <= SEVERITY_RANK.HIGH
      && row && row.dev_only !== true
      && !isentoDe(row)
    )).length;
    const groupInfo = {
      key: chave,
      count: membros.length,
      advisories: membros.map((row) => row && row.advisory_id).filter(Boolean),
      maxSeverity: severidadeMaxima,
      // Agregado completo: o resumo representa TODOS os advisories do grupo.
      runtimeCount,
      devOnlyCount,
      kevCount: membros.filter((row) => row && row.kev === true).length,
      semCorrecaoCount: membros.filter((row) => String((row && row.status) || '').toUpperCase() === 'NO_FIX_AVAILABLE').length,
      isentosCount: membros.filter(isentoDe).length,
      bloqueantes,
      kev: membros.some((row) => row && row.kev === true),
      // "sem correção publicada" só vale para o GRUPO quando TODOS os advisories
      // estão sem fix — dizer isso com um fix disponível seria mentir sobre a saída.
      semCorrecaoPublicada: membros.every((row) => String((row && row.status) || '').toUpperCase() === 'NO_FIX_AVAILABLE'),
      // Só é dev-only se TODOS os membros forem: um achado de runtime no grupo
      // torna o grupo risco de runtime (o gate trata o aviso por pacote-serviço).
      devOnly: devOnlyCount === membros.length,
      hasFix: membros.some((row) => Array.isArray(row.fixed_versions) && row.fixed_versions.length > 0),
    };
    groups.set(chave, groupInfo);
    rows.push(representante);
    emitidos += 1;
    if (membros.length > 1 && expandidos.has(chave)) {
      // Membros restantes logo abaixo do representante, na ordem da entrada.
      for (const membro of membros) {
        if (membro === representante) continue;
        rows.push(membro);
        emitidos += 1;
      }
    }
  }
  return { rows, groups, collapsedCount: rows.length, emitted: emitidos };
}

/**
 * Frase do resumo agregado do grupo, para a tela declarar o que o pacote contém.
 *
 * Representa TODOS os advisories: quantidade, quantos são de runtime vs build/teste,
 * quantos têm exploração conhecida (KEV), quantos estão isentos e quantos bloqueiam.
 * Nada é inferido do representante — a frase é derivada do agregado.
 */
export function describeGroup(groupInfo) {
  if (!groupInfo || !groupInfo.count) return '';
  const partes = [`${groupInfo.count} advisory(s)`];
  if (groupInfo.runtimeCount) partes.push(`${groupInfo.runtimeCount} de runtime`);
  if (groupInfo.devOnlyCount) partes.push(`${groupInfo.devOnlyCount} dev-only`);
  if (groupInfo.kevCount) partes.push(`${groupInfo.kevCount} KEV`);
  if (groupInfo.isentosCount) partes.push(`${groupInfo.isentosCount} isento(s)`);
  const bloqueio = groupInfo.bloqueantes > 0
    ? `${groupInfo.bloqueantes} bloqueia(m) o release`
    : 'nenhum bloqueia o release';
  partes.push(bloqueio);
  return partes.join(' · ');
}

/**
 * Resumo do colapso para a tela declarar o efeito (o dono do filtro é quem exibe).
 * @returns {{loaded: number, pacotes: number, achados: number, repetidos: number}}
 */
export function summarizeCollapse({ items, groups } = {}) {
  const lista = Array.isArray(items) ? items : [];
  const mapa = groups instanceof Map ? groups : new Map();
  let repetidos = 0;
  for (const info of mapa.values()) {
    if (info && info.count > 1) repetidos += 1;
  }
  return {
    loaded: lista.length,
    pacotes: mapa.size,
    achados: lista.length,
    repetidos,
  };
}

export default { collapseFindingsByPackage, packageGroupKey, severityRank, describeGroup };
