'use strict';

/**
 * core/index.js
 *
 * Manifesto arquitetural do Core — motor real da plataforma.
 *
 * O CORE é composto por dois sub-motores independentes:
 *
 * 1. RPA Engine (core/rpa/)
 *    - Automação de browser (Playwright)
 *    - Gravação, replay e execução determinística de fluxos RPA
 *    - Detecção e recuperação de erros
 *    - Resolução inteligente de bugs
 *
 * 2. Scenario Engine (engine/)
 *    - Execução de fluxos de conversa chatbot (runner.js)
 *    - Validação estática de fluxos (validator.js)
 *    - Replay de conversas (replay.js)
 *    - Compilação e cache de fluxos (compileFlow.js)
 *    - Nós de execução (nodes/)
 *    - Handlers de AI, RAG, voz, persistência
 *
 * Separação de responsabilidades:
 *   core/   = execução           (RPA engine + Scenario engine)
 *   qa/     = validação          (Mesh, Checkpoints, Stability, Learn)
 *   engine/ = scenario/validator/replay  (parte do core, raiz histórica)
 *
 * Regra:
 *   - core/rpa/ e engine/ NÃO se importam mutuamente
 *   - qa/ NÃO implementa engine própria — consome core/
 *   - api/ consome engine/ e core/rpa/ diretamente
 */

const rpa = require('./rpa/rpaTestRunner');

module.exports = {
  rpa,
  // engine é acessado diretamente via require('../../engine/...') — não há wrapper aqui
  // para evitar indireção desnecessária
};
