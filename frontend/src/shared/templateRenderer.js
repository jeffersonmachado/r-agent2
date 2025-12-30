/**
 * Wrapper ES module para engine/utils/templateRenderer.js (CommonJS)
 * 
 * Este arquivo permite que o frontend importe o módulo CommonJS do backend
 * como se fosse um ES module.
 */

// Importa o módulo CommonJS do backend usando namespace import
import * as backendModule from '../../../engine/utils/templateRenderer.js';

// Re-exporta como ES module
// O Vite pode colocar as exportações CommonJS em default ou diretamente no objeto
const module = backendModule.default || backendModule;

// Garante que renderTemplate está disponível
export const renderTemplate = module.renderTemplate || module;

// Debug: verifica se renderTemplate está definido
if (!renderTemplate || typeof renderTemplate !== 'function') {
  console.error('[templateRenderer] renderTemplate não está definido corretamente', {
    module,
    backendModule,
    renderTemplate,
  });
}
