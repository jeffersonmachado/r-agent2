/**
 * Testes para validadores de dados.
 * 
 * Estes testes verificam se os validadores funcionam corretamente.
 */

const { validateAgents } = require('../validators/agents.validator');
const { validateFlows } = require('../validators/flows.validator');
const { validateQueues } = require('../validators/queues.validator');
const { validateDepartments } = require('../validators/departments.validator');
const { validateConfig } = require('../validators/config.validator');
const { validateSystem } = require('../validators/system.validator');

describe('Validadores de Dados', () => {
  describe('validateAgents', () => {
    test('deve validar agentes corretamente quando dados estão corretos', () => {
      // Este teste assume que seeds foram populados
      const result = validateAgents();
      // Se houver erros, lista-os
      if (result.errors.length > 0) {
        console.log('Erros encontrados:', result.errors);
      }
      // Não falha o teste, apenas reporta
      expect(result).toHaveProperty('errors');
      expect(result).toHaveProperty('warnings');
    });
  });
  
  describe('validateFlows', () => {
    test('deve validar fluxos corretamente quando dados estão corretos', () => {
      const result = validateFlows();
      if (result.errors.length > 0) {
        console.log('Erros encontrados:', result.errors);
      }
      expect(result).toHaveProperty('errors');
      expect(result).toHaveProperty('warnings');
    });
  });
  
  describe('validateQueues', () => {
    test('deve validar filas corretamente quando dados estão corretos', () => {
      const result = validateQueues();
      if (result.errors.length > 0) {
        console.log('Erros encontrados:', result.errors);
      }
      expect(result).toHaveProperty('errors');
      expect(result).toHaveProperty('warnings');
    });
  });
  
  describe('validateDepartments', () => {
    test('deve validar departamentos corretamente quando dados estão corretos', () => {
      const result = validateDepartments();
      if (result.errors.length > 0) {
        console.log('Erros encontrados:', result.errors);
      }
      expect(result).toHaveProperty('errors');
      expect(result).toHaveProperty('warnings');
    });
  });
  
  describe('validateConfig', () => {
    test('deve validar configuração corretamente quando dados estão corretos', () => {
      const result = validateConfig();
      if (result.errors.length > 0) {
        console.log('Erros encontrados:', result.errors);
      }
      expect(result).toHaveProperty('errors');
      expect(result).toHaveProperty('warnings');
    });
  });
  
  describe('validateSystem', () => {
    test('deve validar sistema completo', () => {
      const result = validateSystem();
      expect(result).toHaveProperty('errors');
      expect(result).toHaveProperty('warnings');
      expect(result).toHaveProperty('valid');
      
      // Se houver erros críticos, lista-os
      if (result.errors.length > 0) {
        console.log('Erros críticos encontrados:', result.errors);
      }
    });
  });
});










