/**
 * Wrapper ES module para engine/utils/jsonSchemaValidator.js (CommonJS)
 * 
 * Este arquivo permite que o frontend importe o módulo CommonJS do backend
 * como se fosse um ES module.
 */

// Importa o módulo CommonJS do backend usando namespace import
import * as backendModule from '../../../engine/utils/jsonSchemaValidator.js';

// Re-exporta como ES module
// O Vite pode colocar as exportações CommonJS em default ou diretamente no objeto
const module = backendModule.default || backendModule;

// Garante que validateJsonSchema está disponível
export const validateJsonSchema = module.validateJsonSchema || module;

// Debug: verifica se validateJsonSchema está definido
if (!validateJsonSchema || typeof validateJsonSchema !== 'function') {
  console.error('[jsonSchemaValidator] validateJsonSchema não está definido corretamente', {
    module,
    backendModule,
    validateJsonSchema,
  });
}
