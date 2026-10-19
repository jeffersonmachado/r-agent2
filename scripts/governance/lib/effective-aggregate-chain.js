'use strict';

/**
 * Resolve a CADEIA EFETIVA do gate agregado de governança.
 *
 * DEFEITO QUE MOTIVA (medido 2026-10-17): quando o agregado passou a persistir veredito
 * próprio (P1), `validate:governance-enforcement` virou um WRAPPER
 * (`node scripts/governance/run-governance-enforcement.js`) e a cadeia `&&` canônica foi
 * para `validate:governance-enforcement:chain`. Quem lia o script de TOPO passou a atestar a
 * forma antiga: o guard MANDATORY_RUNTIME_GATE_IN_OFFICIAL_PIPELINE reprovava um pipeline que
 * CONTINUAVA chamando o gate de runtime — e, como o Router executa esse guard na fase
 * GOVERNANCE, a missão ia a RED. O sintoma parecia "flakiness sob carga"; a causa era estática.
 *
 * Regras (fail-closed):
 *  - agregado ausente/vazio ⇒ não existe cadeia efetiva;
 *  - forma DIRETA ⇒ a própria string é a cadeia;
 *  - forma WRAPPER ⇒ a cadeia efetiva é `:chain` **e** o runner PRECISA referenciar
 *    `:chain` (sem isso o guard atestaria um wrapper que não executa nada);
 *  - nada aqui "conserta" o package.json: só descreve o que ele realmente executa.
 */

const WRAPPER_RE = /run-governance-enforcement\.js/;
const NOME = 'validate:governance-enforcement';
const NOME_CADEIA = 'validate:governance-enforcement:chain';

/**
 * @param {Object} scripts bloco `scripts` do package.json
 * @param {{lerFonteRunner?: () => string}} [opcoes] leitor do fonte do runner (obrigatório na
 *        forma wrapper para provar que a cadeia é realmente executada)
 * @returns {{forma: string, cadeia: string|null, motivos: string[]}}
 */
function resolverCadeiaEfetiva(scripts, { lerFonteRunner } = {}) {
  const pkg = scripts || {};
  const topo = pkg[NOME];
  if (typeof topo !== 'string' || !topo.trim()) {
    return { forma: 'AUSENTE', cadeia: null, motivos: ['AGREGADO_AUSENTE'] };
  }
  if (!WRAPPER_RE.test(topo)) {
    return { forma: 'DIRETA', cadeia: topo, motivos: [] };
  }
  const cadeia = pkg[NOME_CADEIA];
  if (typeof cadeia !== 'string' || !cadeia.trim()) {
    return { forma: 'WRAPPER_SEM_CADEIA', cadeia: null, motivos: ['WRAPPER_SEM_CADEIA'] };
  }
  if (typeof lerFonteRunner === 'function') {
    const fonte = String(lerFonteRunner() || '');
    if (!fonte.includes(NOME_CADEIA)) {
      return { forma: 'WRAPPER_NAO_EXECUTA_CADEIA', cadeia: null, motivos: ['WRAPPER_NAO_EXECUTA_CADEIA'] };
    }
  }
  return { forma: 'WRAPPER', cadeia, motivos: [] };
}

/** A cadeia contém o passo exato? (igualdade de substring, sem regex do nome do passo) */
function cadeiaContemPasso(cadeia, passo) {
  return typeof cadeia === 'string' && String(passo || '').length > 0 && cadeia.includes(passo);
}

module.exports = { resolverCadeiaEfetiva, cadeiaContemPasso, NOME, NOME_CADEIA };
