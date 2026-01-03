/**
 * Testes para templateRenderer.js
 */

const { renderTemplate } = require('../utils/templateRenderer');

describe('templateRenderer', () => {
  describe('renderTemplate', () => {
    test('deve renderizar template simples com uma variável', () => {
      const template = 'Olá {{nome}}';
      const variables = { nome: 'João' };
      const result = renderTemplate(template, variables);
      
      expect(result).toBe('Olá João');
    });

    test('deve renderizar template com múltiplas variáveis', () => {
      const template = 'Olá {{nome}}, você tem {{idade}} anos';
      const variables = { nome: 'Maria', idade: 30 };
      const result = renderTemplate(template, variables);
      
      expect(result).toBe('Olá Maria, você tem 30 anos');
    });

    test('deve substituir variáveis inexistentes por string vazia', () => {
      const template = 'Olá {{nome}}, você tem {{idade}} anos';
      const variables = { nome: 'Pedro' };
      const result = renderTemplate(template, variables);
      
      expect(result).toBe('Olá Pedro, você tem  anos');
    });

    test('deve retornar template original quando não há variáveis', () => {
      const template = 'Olá {{nome}}';
      const result = renderTemplate(template, {});
      
      expect(result).toBe('Olá ');
    });

    test('deve retornar string vazia quando template não é string', () => {
      expect(renderTemplate(null, {})).toBe('');
      expect(renderTemplate(undefined, {})).toBe('');
      expect(renderTemplate(123, {})).toBe('');
      expect(renderTemplate({}, {})).toBe('');
    });

    test('deve retornar template original quando variables não é objeto', () => {
      const template = 'Olá {{nome}}';
      
      expect(renderTemplate(template, null)).toBe(template);
      expect(renderTemplate(template, undefined)).toBe(template);
      expect(renderTemplate(template, 'string')).toBe(template);
      expect(renderTemplate(template, 123)).toBe(template);
    });

    test('deve lidar com espaços nos placeholders', () => {
      const template = 'Olá {{ nome }}, você tem {{idade }} anos';
      const variables = { nome: 'Ana', idade: 25 };
      const result = renderTemplate(template, variables);
      
      expect(result).toBe('Olá Ana, você tem 25 anos');
    });

    test('deve converter valores não-string para string', () => {
      const template = 'Número: {{num}}, Booleano: {{bool}}';
      const variables = { num: 42, bool: true };
      const result = renderTemplate(template, variables);
      
      expect(result).toBe('Número: 42, Booleano: true');
    });

    test('deve lidar com valores null e undefined', () => {
      const template = 'Valor: {{valor}}';
      const variables = { valor: null };
      const result = renderTemplate(template, variables);
      
      expect(result).toBe('Valor: ');
    });

    test('deve renderizar múltiplas ocorrências da mesma variável', () => {
      const template = '{{nome}} disse: Olá {{nome}}';
      const variables = { nome: 'Carlos' };
      const result = renderTemplate(template, variables);
      
      expect(result).toBe('Carlos disse: Olá Carlos');
    });

    test('deve lidar com template sem placeholders', () => {
      const template = 'Texto simples sem variáveis';
      const variables = { nome: 'João' };
      const result = renderTemplate(template, variables);
      
      expect(result).toBe('Texto simples sem variáveis');
    });

    test('deve lidar com placeholders vazios', () => {
      const template = 'Olá {{}}';
      const variables = {};
      const result = renderTemplate(template, variables);
      
      // O renderTemplate não substitui {{}} porque não há nome de variável
      // O comportamento real é manter o placeholder
      expect(result).toBe('Olá {{}}');
    });
  });
});

