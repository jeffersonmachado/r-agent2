/**
 * Executor de tarefas de IA (wrapper para módulo compartilhado).
 *
 * Este arquivo é um wrapper que:
 * - Importa o módulo compartilhado do backend
 * - Adiciona funcionalidades específicas do frontend (feature flags)
 * - Mantém compatibilidade com código existente
 */

import { getFeature, getFeaturesConfig, setFeature } from './featuresConfig';
import { getFallbackFlag } from './fallbacksConfig';
import { fetchJson } from '../api/client';

// Importa do módulo compartilhado via alias configurado no Vite
// O Vite está configurado para resolver '@shared/aiTaskExecutor' para engine/utils/aiTaskExecutor.js
import {
  executeAiTask as sharedExecuteAiTask,
  validateResponse as sharedValidateResponse,
} from '@shared/aiTaskExecutor';

// Configuração carregada assincronamente
let featuresConfig = {
  aiTasksEnabled: true, // Valor padrão até carregar do JSON
};

// Carrega configuração na inicialização
(async () => {
  try {
    featuresConfig = await getFeaturesConfig();
  } catch (err) {
    console.warn('Erro ao carregar configuração de features, usando padrão', err);
  }
})();

/**
 * Obtém o valor atual de uma feature.
 */
export async function getFeatureValue(featureName) {
  return getFeature(featureName, featuresConfig[featureName]);
}

/**
 * Obtém toda a configuração de features.
 */
export async function getFeatures() {
  return getFeaturesConfig();
}

/**
 * Objeto de features para compatibilidade com código existente.
 */
export const features = {
  get aiTasksEnabled() {
    return featuresConfig.aiTasksEnabled;
  },
  
  async setAiTasksEnabled(value) {
    await setFeature('aiTasksEnabled', value);
    featuresConfig.aiTasksEnabled = value;
  },
};

/**
 * Executa uma tarefa de IA.
 * Wrapper que adiciona verificação de feature flag antes de chamar o módulo compartilhado.
 * 
 * Opções:
 * - Se `useRealApi` estiver habilitado, faz chamada HTTP real à API
 * - Caso contrário, usa implementação mock local
 */
export async function execute(task, input, config = {}, context = {}) {
  // Verifica se IA está habilitada (carrega valor atualizado)
  const aiEnabled = await getFeatureValue('aiTasksEnabled');
  
  // Se IA está desabilitada, retorna fallback imediatamente
  if (!aiEnabled) {
    const allowFallback = await getFallbackFlag('frontendAiDisabledReturnFallback', false);
    if (!allowFallback) {
      throw new Error('Tarefas de IA estão desabilitadas e fallback automático não está permitido (fallbacks.frontendAiDisabledReturnFallback=false)');
    }
    const fallback = config.fallback || 'desconhecido';
    return { value: fallback, confidence: 0.0, _fallbackUsed: true, _reason: 'ai_tasks_disabled' };
  }

  // Verifica se deve usar API real (via feature flag ou config)
  const useRealApi = await getFeatureValue('useRealAiApi') || config.useRealApi === true;
  
  if (useRealApi && task === 'intent_classification') {
    // Faz chamada HTTP real à API de IA
    try {
      // Constrói prompt para classificação de intenção
      const allowedOutputs = Array.isArray(config.allowedOutputs) ? config.allowedOutputs : [];
      const keywords = config.keywords || {};
      
      let prompt = `Classifique a intenção do usuário na seguinte mensagem: "${input}"\n\n`;
      prompt += `Intenções possíveis: ${allowedOutputs.join(', ')}\n\n`;
      
      if (Object.keys(keywords).length > 0) {
        prompt += `Palavras-chave por intenção:\n`;
        for (const [intent, kwList] of Object.entries(keywords)) {
          if (Array.isArray(kwList) && kwList.length > 0) {
            prompt += `- ${intent}: ${kwList.join(', ')}\n`;
          }
        }
        prompt += '\n';
      }
      
      prompt += `Retorne APENAS o nome da intenção (uma das opções acima) ou "desconhecido" se não houver match.`;
      
      const response = await fetchJson('/api/ai/generate', {
        method: 'POST',
        body: JSON.stringify({
          prompt,
          tenantId: context.tenantId, // Tenant deve ser fornecido no context
        }),
      });
      
      if (response?.text) {
        const classifiedIntent = response.text.trim().toLowerCase();
        
        // Verifica se a intenção está nas saídas permitidas
        if (allowedOutputs.includes(classifiedIntent)) {
          return {
            value: classifiedIntent,
            confidence: 0.9, // Alta confiança para resposta da API real
          };
        }
      }
      
      // Se não conseguiu classificar, retorna fallback
      return {
        value: null,
        confidence: 0.0,
        _noMatch: true,
      };
    } catch (error) {
      console.error('Erro ao chamar API de IA real:', error);
      const allowMockFallback = await getFallbackFlag('frontendAiMockOnError', false);
      if (!allowMockFallback) {
        throw error;
      }
      // Fallback explícito: usa implementação mock local
      return sharedExecuteAiTask(task, input, config, context);
    }
  }

  // Usa o módulo compartilhado (implementação mock)
  return sharedExecuteAiTask(task, input, config, context);
}

/**
 * Valida a estrutura de uma resposta de IA.
 */
export function validateResponse(response, task, config) {
  return sharedValidateResponse(response, task, config);
}
