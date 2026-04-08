/**
 * Populador de dados RPA.
 * 
 * Popula formulários e campos com dados de teste.
 */

const fs = require('fs');
const path = require('path');
const config = require('./rpaConfig');

class DataPopulator {
  constructor() {
    this.seedData = null;
    this.loadedSeeds = {};
  }

  /**
   * Carrega dados de seeds.
   */
  loadSeeds() {
    const seedPath = config.dataPopulation.seedPath;
    
    if (!fs.existsSync(seedPath)) {
      console.warn(`Diretório de seeds não encontrado: ${seedPath}`);
      return;
    }

    const seedFiles = fs.readdirSync(seedPath)
      .filter(f => f.endsWith('.json'));

    for (const file of seedFiles) {
      const filepath = path.join(seedPath, file);
      const key = file.replace('.json', '');
      
      try {
        const content = fs.readFileSync(filepath, 'utf8');
        this.loadedSeeds[key] = JSON.parse(content);
      } catch (error) {
        console.error(`Erro ao carregar seed ${file}:`, error.message);
      }
    }
  }

  /**
   * Popula valor usando dados de seeds ou variáveis.
   * 
   * @param {string} variable - Variável no formato {{seed.key}} ou {{data.key}}
   * @param {Object} data - Dados adicionais
   */
  populate(variable, data = {}) {
    // Remove {{ e }}
    const cleanVar = variable.replace(/^\{\{|\}\}$/g, '');
    const parts = cleanVar.trim().split('.');

    // Se começa com 'seed.', busca em seeds
    if (parts[0] === 'seed' && parts.length > 1) {
      return this.populateFromSeed(parts.slice(1));
    }

    // Se começa com 'data.', busca em data
    if (parts[0] === 'data' && parts.length > 1) {
      return this.populateFromData(parts.slice(1), data);
    }

    // Se começa com 'testUser' ou 'admin', busca em credentials
    if (parts[0] === 'testUser' || parts[0] === 'admin') {
      return this.populateFromCredentials(parts);
    }

    // Tenta buscar diretamente em data
    return this.populateFromData(parts, data);
  }

  /**
   * Popula valor de seed.
   * 
   * @param {Array<string>} path - Caminho para o valor (ex: ['agents', '0', 'email'])
   */
  populateFromSeed(path) {
    if (Object.keys(this.loadedSeeds).length === 0) {
      this.loadSeeds();
    }

    const [seedKey, ...valuePath] = path;
    const seed = this.loadedSeeds[seedKey];

    if (!seed) {
      throw new Error(`Seed não encontrado: ${seedKey}`);
    }

    let value = seed;
    for (const key of valuePath) {
      if (Array.isArray(value)) {
        value = value[parseInt(key)];
      } else if (value && typeof value === 'object') {
        value = value[key];
      } else {
        throw new Error(`Caminho inválido em seed: ${path.join('.')}`);
      }
    }

    return value;
  }

  /**
   * Popula valor de dados.
   * 
   * @param {Array<string>} path - Caminho para o valor
   * @param {Object} data - Dados
   */
  populateFromData(path, data) {
    let value = data;
    
    for (const key of path) {
      if (value && typeof value === 'object' && key in value) {
        value = value[key];
      } else {
        throw new Error(`Caminho não encontrado em data: ${path.join('.')}`);
      }
    }

    return value;
  }

  /**
   * Popula valor de credentials.
   * 
   * @param {Array<string>} path - Caminho para o valor
   */
  populateFromCredentials(path) {
    const [credentialType, ...valuePath] = path;
    const credentials = config.credentials[credentialType];

    if (!credentials) {
      throw new Error(`Credencial não encontrada: ${credentialType}`);
    }

    let value = credentials;
    for (const key of valuePath) {
      if (value && typeof value === 'object' && key in value) {
        value = value[key];
      } else {
        throw new Error(`Caminho não encontrado em credentials: ${path.join('.')}`);
      }
    }

    return value;
  }

  /**
   * Valida dados antes de usar.
   * 
   * @param {Object} data - Dados a validar
   */
  validateData(data) {
    if (!config.dataPopulation.validateBeforeUse) {
      return { valid: true };
    }

    const errors = [];

    // Validações básicas
    if (data && typeof data === 'object') {
      // Valida emails
      for (const [key, value] of Object.entries(data)) {
        if (key.toLowerCase().includes('email') && typeof value === 'string') {
          const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
          if (!emailRegex.test(value)) {
            errors.push(`Email inválido em ${key}: ${value}`);
          }
        }

        // Valida URLs
        if (key.toLowerCase().includes('url') && typeof value === 'string') {
          try {
            new URL(value);
          } catch (error) {
            errors.push(`URL inválida em ${key}: ${value}`);
          }
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Gera dados de teste aleatórios.
   * 
   * @param {string} type - Tipo de dado ('email', 'name', 'phone', etc)
   */
  generateTestData(type) {
    switch (type) {
      case 'email':
        return `test-${Date.now()}@example.com`;
      case 'name':
        return `Test User ${Date.now()}`;
      case 'phone':
        return `+55 11 9${Math.floor(Math.random() * 90000000) + 10000000}`;
      case 'uuid':
        const { v4: uuidv4 } = require('uuid');
        return uuidv4();
      default:
        return `test-${Date.now()}`;
    }
  }
}

module.exports = { DataPopulator };

