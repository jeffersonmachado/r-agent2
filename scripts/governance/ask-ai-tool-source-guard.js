'use strict';

/**
 * Guarda de FONTE ÚNICA do catálogo de tools do copiloto (A2).
 *
 * O Ask AI NÃO pode manter um registro paralelo de tools: a definição (id,
 * capability, permissão, política) vive em `api/services/askAi/askAiToolCatalog.js`
 * e `toolRegistry.js` apenas a PROJETA no Canonical Tool Registry.
 *
 * Este scanner é a parte DETERMINÍSTICA e testável dessa invariante: qualquer
 * outro módulo da pasta `api/services/askAi/` que declare um id canônico
 * (`id: 'askai.*'`) ou uma capability literal (`capability: 'x.y'`) é uma
 * definição paralela e precisa reprovar o gate.
 *
 * Ficou extraído (em vez de inline no validador) para poder ser exercitado com
 * um fixture real — um invariante precisa ser capaz de FALHAR.
 */

const fs = require('fs');
const path = require('path');

/** O único arquivo autorizado a DECLARAR tools do copiloto. */
const CATALOG_FILE = 'askAiToolCatalog.js';

/** Id canônico declarado (`id: 'askai.…'`) — não casa `toolId:` nem `canonicalId:`. */
const PARALLEL_TOOL_ID = /(?:^|[{,\s])id:\s*['"]askai\./m;

/** Capability literal (`capability: 'crm.read'`) — não casa `capability: tool.capability`. */
const PARALLEL_CAPABILITY = /capability:\s*['"][a-z]+\.[a-z]+['"]/m;

/**
 * Lista os módulos de `dir` que declaram uma tool própria (definição paralela).
 *
 * @param {string} dir diretório com os módulos do copiloto
 * @returns {string[]} nomes de arquivo (ordenados) em conflito com o catálogo
 */
function findParallelToolDeclarations(dir) {
  const offenders = [];
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith('.js') || file === CATALOG_FILE) continue;
    const source = fs.readFileSync(path.join(dir, file), 'utf8');
    if (PARALLEL_TOOL_ID.test(source) || PARALLEL_CAPABILITY.test(source)) {
      offenders.push(file);
    }
  }
  return offenders.sort();
}

module.exports = {
  CATALOG_FILE,
  PARALLEL_TOOL_ID,
  PARALLEL_CAPABILITY,
  findParallelToolDeclarations,
};
