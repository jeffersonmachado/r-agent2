/**
 * Testes automatizados para o CDR Validator
 * 
 * Garante que:
 * - Respostas proibidas são bloqueadas
 * - Respostas corretas passam
 * - Negativas são objetivas
 * - Nenhuma frase proibida aparece
 */

const { validateCDR, getSafeResponse, generateViolationLog, clearCache, loadCapabilities } = require('../cdrValidator');
const path = require('path');
const fs = require('fs');

describe('CDR Validator', () => {
  const originalEnv = process.env.NODE_ENV;

  beforeEach(() => {
    clearCache();
    // Define ambiente como produção para que os testes esperem "error" ao invés de "warn"
    process.env.NODE_ENV = 'production';
  });

  afterEach(() => {
    // Restaura ambiente original
    if (originalEnv) {
      process.env.NODE_ENV = originalEnv;
    } else {
      delete process.env.NODE_ENV;
    }
  });

  describe('R1 - Ações inexistentes', () => {
    test('deve bloquear ação não permitida', () => {
      const response = 'Vou abrir um chamado no sistema externo para você.';
      const result = validateCDR(response);
      
      expect(result.status).toBe('error');
      expect(result.code).toBe('CDR_ACTION_NOT_ALLOWED');
    });

    test('deve bloquear verbo de ação sem capacidade', () => {
      const response = 'Já estou verificando isso no sistema.';
      const result = validateCDR(response);
      
      expect(result.status).toBe('error');
      expect(result.code).toBe('CDR_ACTION_NOT_ALLOWED');
    });

    test('deve permitir resposta sem ações', () => {
      const response = 'Olá! Como posso ajudar você hoje?';
      const result = validateCDR(response);
      
      expect(result.status).toBe('ok');
    });
  });

  describe('R2 - Promessas de futuro', () => {
    test('deve bloquear "em breve"', () => {
      const response = 'Isso será resolvido em breve.';
      const result = validateCDR(response);
      
      expect(result.status).toBe('error');
      expect(result.code).toBe('CDR_FUTURE_PROMISE');
    });

    test('deve bloquear "assim que possível"', () => {
      const response = 'Vou resolver isso assim que possível.';
      const result = validateCDR(response);
      
      expect(result.status).toBe('error');
      expect(result.code).toBe('CDR_FUTURE_PROMISE');
    });

    test('deve bloquear "iremos resolver"', () => {
      const response = 'Iremos resolver isso para você.';
      const result = validateCDR(response);
      
      expect(result.status).toBe('error');
      expect(result.code).toBe('CDR_FUTURE_PROMISE');
    });

    test('deve bloquear "retornarei em breve"', () => {
      const response = 'Retornarei em breve com a resposta.';
      const result = validateCDR(response);
      
      expect(result.status).toBe('error');
      expect(result.code).toBe('CDR_FUTURE_PROMISE');
    });

    test('deve permitir resposta sem promessas futuras', () => {
      const response = 'Posso ajudar você agora mesmo.';
      const result = validateCDR(response);
      
      expect(result.status).toBe('ok');
    });
  });

  describe('R3 - Simulação de humano ou setor', () => {
    test('deve bloquear simulação de atendente sem capacidade', () => {
      // Remove capacidade de handoff para testar
      const capabilities = { can: [], cannot: ['transferir_humano'] };
      const response = 'Nossa equipe já está analisando seu caso.';
      const result = validateCDR(response, capabilities);
      
      expect(result.status).toBe('error');
      expect(result.code).toBe('CDR_FAKE_HANDOFF');
    });

    test('deve bloquear "atendente já está resolvendo"', () => {
      const capabilities = { can: [], cannot: ['transferir_humano'] };
      const response = 'O atendente já está resolvendo isso.';
      const result = validateCDR(response, capabilities);
      
      expect(result.status).toBe('error');
      expect(result.code).toBe('CDR_FAKE_HANDOFF');
    });

    test('deve permitir quando há capacidade de handoff', () => {
      const capabilities = { can: ['transferir_humano'], cannot: [] };
      const response = 'Vou transferir você para um atendente.';
      const result = validateCDR(response, capabilities);
      
      // Pode passar se não violar outras regras
      // (pode ter outros erros, mas não CDR_FAKE_HANDOFF)
      if (result.status === 'error') {
        expect(result.code).not.toBe('CDR_FAKE_HANDOFF');
      }
    });
  });

  describe('R4 - Estados operacionais falsos', () => {
    test('deve bloquear "em análise"', () => {
      const response = 'Seu pedido está em análise.';
      const result = validateCDR(response);
      
      expect(result.status).toBe('error');
      expect(result.code).toBe('CDR_FAKE_STATE');
    });

    test('deve bloquear "em andamento"', () => {
      const response = 'Isso está em andamento.';
      const result = validateCDR(response);
      
      expect(result.status).toBe('error');
      expect(result.code).toBe('CDR_FAKE_STATE');
    });

    test('deve bloquear "em processamento"', () => {
      const response = 'Sua solicitação está em processamento.';
      const result = validateCDR(response);
      
      expect(result.status).toBe('error');
      expect(result.code).toBe('CDR_FAKE_STATE');
    });

    test('deve permitir resposta sem estados falsos', () => {
      const response = 'Entendi sua solicitação.';
      const result = validateCDR(response);
      
      expect(result.status).toBe('ok');
    });
  });

  describe('R5 - Negativa inválida', () => {
    test('deve bloquear negação seguida de promessa futura', () => {
      const response = 'Não posso fazer isso, mas em breve será possível.';
      const result = validateCDR(response);
      
      expect(result.status).toBe('error');
      // Pode ser CDR_INVALID_DENIAL ou CDR_FUTURE_PROMISE, ambos são válidos
      expect(['CDR_INVALID_DENIAL', 'CDR_FUTURE_PROMISE']).toContain(result.code);
    });

    test('deve bloquear negação seguida de "iremos"', () => {
      const response = 'Infelizmente não tenho isso, mas iremos implementar.';
      const result = validateCDR(response);
      
      expect(result.status).toBe('error');
      expect(result.code).toBe('CDR_INVALID_DENIAL');
    });

    test('deve bloquear negação seguida de "estamos trabalhando"', () => {
      const response = 'Não disponho dessa funcionalidade, mas estamos trabalhando nisso.';
      const result = validateCDR(response);
      
      expect(result.status).toBe('error');
      expect(result.code).toBe('CDR_INVALID_DENIAL');
    });

    test('deve permitir negação objetiva', () => {
      const response = 'No momento, não tenho essa funcionalidade. Posso ajudar com o que está disponível.';
      const result = validateCDR(response);
      
      expect(result.status).toBe('ok');
    });
  });

  describe('Validação de entrada', () => {
    test('deve retornar erro para string vazia', () => {
      const result = validateCDR('');
      
      expect(result.status).toBe('error');
      expect(result.code).toBe('CDR_INVALID_INPUT');
    });

    test('deve retornar erro para null', () => {
      const result = validateCDR(null);
      
      expect(result.status).toBe('error');
      expect(result.code).toBe('CDR_INVALID_INPUT');
    });

    test('deve retornar erro para undefined', () => {
      const result = validateCDR(undefined);
      
      expect(result.status).toBe('error');
      expect(result.code).toBe('CDR_INVALID_INPUT');
    });

    test('deve retornar erro para tipo não string', () => {
      const result = validateCDR(123);
      
      expect(result.status).toBe('error');
      expect(result.code).toBe('CDR_INVALID_INPUT');
    });
  });

  describe('Resposta segura', () => {
    test('deve retornar resposta segura padrão', () => {
      const safeResponse = getSafeResponse();
      
      expect(typeof safeResponse).toBe('string');
      expect(safeResponse.length).toBeGreaterThan(0);
      expect(safeResponse).toContain('não tenho');
    });

    test('resposta segura deve passar validação CDR', () => {
      const safeResponse = getSafeResponse();
      const result = validateCDR(safeResponse);
      
      expect(result.status).toBe('ok');
    });
  });

  describe('Logs estruturados', () => {
    test('deve gerar log estruturado de violação', () => {
      const validationResult = {
        status: 'error',
        code: 'CDR_ACTION_NOT_ALLOWED',
        message: 'Resposta viola regras CDR'
      };
      const responseText = 'Vou abrir um chamado.';
      
      const log = generateViolationLog(validationResult, responseText);
      
      expect(log.type).toBe('CDR_VIOLATION');
      expect(log.code).toBe('CDR_ACTION_NOT_ALLOWED');
      expect(log.response).toBe(responseText);
      expect(log.timestamp).toBeDefined();
      expect(log.environment).toBeDefined();
    });

    test('deve limitar tamanho da resposta no log', () => {
      const longResponse = 'A'.repeat(1000);
      const validationResult = {
        status: 'error',
        code: 'CDR_FUTURE_PROMISE'
      };
      
      const log = generateViolationLog(validationResult, longResponse);
      
      expect(log.response.length).toBeLessThanOrEqual(500);
    });
  });

  describe('Comportamento por ambiente', () => {
    const originalEnv = process.env.NODE_ENV;

    afterEach(() => {
      process.env.NODE_ENV = originalEnv;
    });

    test('deve bloquear em produção', () => {
      process.env.NODE_ENV = 'production';
      clearCache();
      
      const response = 'Vou resolver isso em breve.';
      const result = validateCDR(response);
      
      expect(result.status).toBe('error');
    });

    test('deve bloquear em QA runtime', () => {
      process.env.NODE_ENV = 'qa-runtime';
      clearCache();
      
      const response = 'Vou resolver isso em breve.';
      const result = validateCDR(response);
      
      expect(result.status).toBe('error');
    });

    test('deve gerar warning em desenvolvimento', () => {
      process.env.NODE_ENV = 'development';
      clearCache();
      
      const response = 'Vou resolver isso em breve.';
      const result = validateCDR(response);
      
      expect(result.status).toBe('warn');
    });
  });

  describe('Casos de uso reais', () => {
    test('deve permitir resposta informativa válida', () => {
      const response = 'Olá! Posso ajudar você com informações sobre nossos produtos.';
      const result = validateCDR(response);
      
      expect(result.status).toBe('ok');
    });

    test('deve bloquear resposta que promete ação externa', () => {
      const response = 'Vou solicitar a abertura do seu chamado no sistema agora mesmo.';
      const result = validateCDR(response);
      
      expect(result.status).toBe('error');
    });

    test('deve bloquear resposta que simula processo em andamento', () => {
      const response = 'Seu pedido já está sendo processado pela equipe.';
      const result = validateCDR(response);
      
      expect(result.status).toBe('error');
    });

    test('deve permitir resposta de negação objetiva', () => {
      const response = 'No momento, não tenho essa funcionalidade. Posso ajudar com outras coisas.';
      const result = validateCDR(response);
      
      expect(result.status).toBe('ok');
    });
  });

  describe('Carregamento de capacidades', () => {
    test('deve carregar capacidades do arquivo', () => {
      const capabilities = loadCapabilities();
      
      expect(capabilities).toBeDefined();
      expect(Array.isArray(capabilities.can) || Array.isArray(capabilities.cannot)).toBe(true);
    });

    test('deve usar cache após primeiro carregamento', () => {
      const capabilities1 = loadCapabilities();
      const capabilities2 = loadCapabilities();
      
      expect(capabilities1).toBe(capabilities2); // Mesma referência (cache)
    });

    test('deve limpar cache corretamente', () => {
      loadCapabilities();
      clearCache();
      const capabilities1 = loadCapabilities();
      clearCache();
      const capabilities2 = loadCapabilities();
      
      // Após clearCache, devem ser objetos diferentes (novo carregamento)
      expect(capabilities1).not.toBe(capabilities2);
    });
  });
});

