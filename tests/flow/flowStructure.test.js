/**
 * Testes de validação estrutural de fluxos.
 * 
 * Valida estrutura de todos os fluxos de teste.
 */

const { validateFlowStructure } = require('./flowStructure.validator');
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '../../api/data/test');
const FLOWS_FILE = path.join(DATA_DIR, 'flows.json');

describe('Validação Estrutural de Fluxos', () => {
  test('deve validar estrutura de todos os fluxos de teste', () => {
    // Verifica se arquivo existe
    if (!fs.existsSync(FLOWS_FILE)) {
      console.warn('Arquivo de fluxos não encontrado. Execute npm run seed:test primeiro.');
      return;
    }
    
    // Carrega fluxos
    const content = fs.readFileSync(FLOWS_FILE, 'utf8');
    const flows = JSON.parse(content);
    
    if (!Array.isArray(flows)) {
      throw new Error('Fluxos devem ser um array');
    }
    
    // Valida cada fluxo
    const allErrors = [];
    const allWarnings = [];
    
    for (const flow of flows) {
      const result = validateFlowStructure(flow);
      allErrors.push(...result.errors);
      allWarnings.push(...result.warnings);
    }
    
    // Reporta erros
    if (allErrors.length > 0) {
      console.log('Erros estruturais encontrados:', allErrors);
    }
    
    if (allWarnings.length > 0) {
      console.log('Avisos estruturais encontrados:', allWarnings);
    }
    
    // Falha se houver erros críticos
    expect(allErrors.length).toBe(0);
  });
});

















