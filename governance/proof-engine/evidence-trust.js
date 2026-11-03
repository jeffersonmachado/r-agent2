'use strict';

/**
 * evidence-trust.js — SEPARAÇÃO FORMAL DE CONFIANÇA DA EVIDÊNCIA (Fase 3 / missão C).
 *
 * PROBLEMA
 * --------
 * `artifactSha256` é calculado pelo MESMO executor que escreve o artefato: ele protege contra
 * inconsistência operacional (arquivo trocado, cópia parcial, manifesto que não corresponde ao
 * item), mas NÃO comprova autenticidade contra quem pode reescrever manifesto E artefatos e
 * recalcular os hashes. Sem separação explícita, "os hashes conferem" era lido como "a prova vale".
 *
 * NÍVEIS (cada um EXIGE o anterior; nunca são inferidos por conveniência)
 * ----------------------------------------------------------------------
 *   1. LOCAL_INTEGRITY            — hashes internos conferem e o conteúdo é legível.
 *   2. RUN_IDENTITY               — manifesto e artefatos pertencem ao MESMO runId e a identidade
 *                                   gravada é coerente entre eles.
 *   3. PROVENANCE                 — essa identidade corresponde a fatos observáveis do código
 *                                   (digest do inventário/fila recalculado do rootDir).
 *   4. CRYPTOGRAPHIC_AUTHENTICITY — existe assinatura VERIFICADA contra chave confiável.
 *   5. EXTERNAL_ANCHOR            — existe âncora EXTERNA à árvore (fingerprint de chave/inventário
 *                                   provisionado fora do repositório) e ela confere.
 *   6. CERTIFIED                  — decisão canônica em GO DEFINITIVO sobre os três relatórios.
 *
 * REGRA INVIOLÁVEL: evidência com integridade local NÃO adquire autoridade certificante por ser
 * internamente consistente. `CERTIFIED` exige 4 E 5 E 6 ao mesmo tempo; qualquer ausência vira
 * bloqueio NOMEADO. Este módulo NÃO assina, NÃO provisiona âncora e NÃO cria aprovação humana —
 * ele só CLASSIFICA o que existe.
 */

const NIVEIS = Object.freeze({
  LOCAL_INTEGRITY: 'LOCAL_INTEGRITY',
  RUN_IDENTITY: 'RUN_IDENTITY',
  PROVENANCE: 'PROVENANCE',
  CRYPTOGRAPHIC_AUTHENTICITY: 'CRYPTOGRAPHIC_AUTHENTICITY',
  EXTERNAL_ANCHOR: 'EXTERNAL_ANCHOR',
  CERTIFIED: 'CERTIFIED',
});

const ORDEM = Object.freeze([
  NIVEIS.LOCAL_INTEGRITY,
  NIVEIS.RUN_IDENTITY,
  NIVEIS.PROVENANCE,
  NIVEIS.CRYPTOGRAPHIC_AUTHENTICITY,
  NIVEIS.EXTERNAL_ANCHOR,
  NIVEIS.CERTIFIED,
]);

/**
 * @param {object} entrada
 * @param {boolean} [entrada.integridadeOk]   hashes/parse dos artefatos conferem
 * @param {boolean} [entrada.runIdCoerente]   manifesto e artefatos no MESMO runId
 * @param {boolean} [entrada.identidadeCoerente] identidade gravada é igual entre manifesto/artefatos
 * @param {boolean} [entrada.provenienciaConfere] digest recalculado do rootDir == o gravado
 * @param {{verificada:boolean, motivo?:string}} [entrada.assinatura]
 * @param {{confere:boolean, motivo?:string}} [entrada.ancoraExterna]
 * @param {{goDefinitivo:boolean, motivo?:string}} [entrada.decisaoCanonica]
 * @returns {{nivel:string, alcancados:string[], bloqueios:Array<{nivel:string, motivo:string}>, certificante:boolean}}
 */
function classificarEvidencia(entrada = {}) {
  const campos = {
    integridadeOk: entrada.integridadeOk === true,
    runIdCoerente: entrada.runIdCoerente === true,
    identidadeCoerente: entrada.identidadeCoerente === true,
    provenienciaConfere: entrada.provenienciaConfere === true,
    assinatura: Boolean(entrada.assinatura && entrada.assinatura.verificada === true),
    ancora: Boolean(entrada.ancoraExterna && entrada.ancoraExterna.confere === true),
    decisao: Boolean(entrada.decisaoCanonica && entrada.decisaoCanonica.goDefinitivo === true),
  };
  const motivos = {
    integridadeOk: 'HASH_OU_PARSE_INVALIDO',
    runIdCoerente: campos.runIdCoerente ? 'IDENTIDADE_DIVERGENTE' : 'RUN_ID_DIVERGENTE',
    identidadeCoerente: 'IDENTIDADE_DIVERGENTE',
    provenienciaConfere: 'PROVENIENCIA_NAO_CONFERE',
    assinatura: (entrada.assinatura && entrada.assinatura.motivo) || 'SEM_ASSINATURA_VERIFICADA',
    ancora: (entrada.ancoraExterna && entrada.ancoraExterna.motivo) || 'SEM_ANCORA_EXTERNA',
    decisao: (entrada.decisaoCanonica && entrada.decisaoCanonica.motivo) || 'DECISAO_NAO_E_GO_DEFINITIVO',
  };

  const condicoes = [
    [NIVEIS.LOCAL_INTEGRITY, campos.integridadeOk, motivos.integridadeOk],
    [NIVEIS.RUN_IDENTITY, campos.runIdCoerente && campos.identidadeCoerente,
      campos.runIdCoerente ? motivos.identidadeCoerente : motivos.runIdCoerente],
    [NIVEIS.PROVENANCE, campos.provenienciaConfere, motivos.provenienciaConfere],
    [NIVEIS.CRYPTOGRAPHIC_AUTHENTICITY, campos.assinatura, motivos.assinatura],
    [NIVEIS.EXTERNAL_ANCHOR, campos.ancora, motivos.ancora],
    [NIVEIS.CERTIFIED, campos.decisao, motivos.decisao],
  ];

  // `alcancados` é SEMPRE um prefixo (um nível não é alcançado se o anterior falhou), mas os
  // bloqueios listam TUDO o que falta — o operador precisa saber os três requisitos de certificação,
  // não apenas o primeiro.
  const alcancados = [];
  const bloqueios = [];
  let cortado = false;
  for (const [nivel, satisfeito, motivo] of condicoes) {
    if (!cortado && satisfeito) {
      alcancados.push(nivel);
      continue;
    }
    cortado = true;
    bloqueios.push({ nivel, motivo: satisfeito ? 'NIVEL_ANTERIOR_NAO_ALCANCADO' : motivo });
  }

  const nivel = alcancados[alcancados.length - 1] || 'NENHUM';
  return {
    nivel,
    alcancados,
    bloqueios,
    certificante: Boolean(campos.decisao) && nivel === NIVEIS.CERTIFIED,
  };
}

/** Próximo nível exigido a partir do alcançado (para relatório/operador). */
function proximoNivel(nivelAtual) {
  const i = ORDEM.indexOf(nivelAtual);
  if (i < 0) return ORDEM[0];
  return ORDEM[i + 1] || null;
}

module.exports = { NIVEIS, ORDEM, classificarEvidencia, proximoNivel };
