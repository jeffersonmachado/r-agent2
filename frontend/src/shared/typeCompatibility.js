/**
 * Wrapper ES module para engine/utils/typeCompatibility.js (CommonJS)
 * 
 * Este arquivo permite que o frontend importe o módulo CommonJS do backend
 * como se fosse um ES module.
 */

// Importa o módulo CommonJS do backend usando namespace import
import * as backendModule from '../../../engine/utils/typeCompatibility.js';

// Re-exporta como ES module
// O Vite pode colocar as exportações CommonJS em default ou diretamente no objeto
const module = backendModule.default || backendModule;

// Garante que TYPE_COMPATIBILITY está disponível
export const TYPE_COMPATIBILITY = module.TYPE_COMPATIBILITY || (typeof module === 'object' && module !== null ? module : {});

// Debug: verifica se TYPE_COMPATIBILITY está definido
if (!TYPE_COMPATIBILITY || typeof TYPE_COMPATIBILITY !== 'object') {
  console.error('[typeCompatibility] TYPE_COMPATIBILITY não está definido corretamente', {
    module,
    backendModule,
    TYPE_COMPATIBILITY,
  });
}
