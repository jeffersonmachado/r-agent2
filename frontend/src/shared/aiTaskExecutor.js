/**
 * Wrapper ES module para engine/utils/aiTaskExecutor.js (CommonJS)
 * 
 * Este arquivo permite que o frontend importe o módulo CommonJS do backend
 * como se fosse um ES module.
 * 
 * O Vite automaticamente converte CommonJS para ES modules quando importamos.
 * CommonJS module.exports vira um objeto com as propriedades exportadas.
 */

// Importa o módulo CommonJS do backend usando namespace import
// O Vite converte module.exports para um objeto com as propriedades
import * as backendModule from '../../../engine/utils/aiTaskExecutor.js';

// Re-exporta como ES module
// O Vite pode colocar as exportações CommonJS em default ou diretamente no objeto
const module = backendModule.default || backendModule;

// Garante que todas as exportações estão disponíveis
export const executeAiTask = module.executeAiTask;
export const validateResponse = module.validateResponse;
export const SUPPORTED_TASKS = module.SUPPORTED_TASKS;
export const executeIntentClassification = module.executeIntentClassification;
export const executeEntityExtraction = module.executeEntityExtraction;
export const executeTextNormalization = module.executeTextNormalization;
export const executeAssistedResponse = module.executeAssistedResponse;

// Debug: verifica se SUPPORTED_TASKS está definido
if (!SUPPORTED_TASKS || typeof SUPPORTED_TASKS !== 'object') {
  console.error('[aiTaskExecutor] SUPPORTED_TASKS não está definido corretamente', {
    module,
    backendModule,
    moduleKeys: Object.keys(module || {}),
    SUPPORTED_TASKS,
  });
}
