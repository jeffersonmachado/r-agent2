'use strict';

/**
 * ORÇAMENTOS DE TEMPO COMPARTILHADOS (medidos 2026-10-24 no harness de checkout limpo).
 *
 * Contexto: as suítes que sobem a aplicação inteira (`require('../../api/server')` + `createServer()`)
 * pagam o custo de COMPILAR todo o grafo de módulos do Express. Com cache do Jest frio — clone
 * recém-instalado, como no `ci:clean-checkout` e no runner do CI — a medição real foi:
 *
 *   publicStorefrontPhysicalEndpoints ... 24,5 s (orçamento vigente: 30 s)
 *   aiWrappersAliasEndpoints ........... 20,9 s
 *   pipelineValidatePrereqsRoute ........ 8,6 s
 *   systemGenerateFaqRoute .............. 7,5 s
 *
 * Com 22% de folga, a suíte reprovou por TIMEOUT (não por asserção) quando a máquina estava ocupada
 * — o `ci:clean-checkout --scenario clean` roda o L0 logo depois de dois builds de imagem Docker.
 * Um vermelho por contenção ensina o time a ignorar vermelho; o orçamento passa a ser explícito e
 * compartilhado em vez de repetir `30000` em cada arquivo.
 *
 * Isto NÃO afrouxa asserção alguma: o valor é TETO DE ESPERA, não expectativa de comportamento.
 */
const TIMEOUT_BOOT_APP_MS = 60000;

module.exports = { TIMEOUT_BOOT_APP_MS };
