/**
 * Testes para jsonSchemaValidator.js
 */

const { validateJsonSchema } = require('../utils/jsonSchemaValidator');

describe('jsonSchemaValidator', () => {
  describe('validateJsonSchema', () => {
    test('deve retornar válido quando não há schema', () => {
      const result = validateJsonSchema(null, {});
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    test('deve validar objeto simples', () => {
      const schema = {
        type: 'object',
        properties: {
          name: { type: 'string' },
          age: { type: 'number' },
        },
      };

      const data = { name: 'João', age: 30 };
      const result = validateJsonSchema(schema, data);

      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    test('deve detectar tipo incorreto em objeto', () => {
      const schema = {
        type: 'object',
        properties: {
          name: { type: 'string' },
        },
      };

      const data = { name: 123 };
      const result = validateJsonSchema(schema, data);

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    test('deve validar campos obrigatórios', () => {
      const schema = {
        type: 'object',
        properties: {
          name: { type: 'string' },
          email: { type: 'string' },
        },
        required: ['name', 'email'],
      };

      const data = { name: 'João' };
      const result = validateJsonSchema(schema, data);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('email') && e.includes('obrigatório'))).toBe(true);
    });

    test('deve validar array', () => {
      const schema = {
        type: 'array',
        items: { type: 'string' },
      };

      const data = ['a', 'b', 'c'];
      const result = validateJsonSchema(schema, data);

      expect(result.valid).toBe(true);
    });

    test('deve detectar tipo incorreto em array', () => {
      const schema = {
        type: 'array',
        items: { type: 'string' },
      };

      const data = ['a', 123, 'c'];
      const result = validateJsonSchema(schema, data);

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    test('deve validar string', () => {
      const schema = { type: 'string' };
      const data = 'test';
      const result = validateJsonSchema(schema, data);

      expect(result.valid).toBe(true);
    });

    test('deve detectar string inválida', () => {
      const schema = { type: 'string' };
      const data = 123;
      const result = validateJsonSchema(schema, data);

      expect(result.valid).toBe(false);
    });

    test('deve validar number', () => {
      const schema = { type: 'number' };
      const data = 42;
      const result = validateJsonSchema(schema, data);

      expect(result.valid).toBe(true);
    });

    test('deve detectar number inválido', () => {
      const schema = { type: 'number' };
      const data = '42';
      const result = validateJsonSchema(schema, data);

      expect(result.valid).toBe(false);
    });

    test('deve validar boolean', () => {
      const schema = { type: 'boolean' };
      const data = true;
      const result = validateJsonSchema(schema, data);

      expect(result.valid).toBe(true);
    });

    test('deve detectar boolean inválido', () => {
      const schema = { type: 'boolean' };
      const data = 'true';
      const result = validateJsonSchema(schema, data);

      expect(result.valid).toBe(false);
    });

    test('deve validar objeto aninhado', () => {
      const schema = {
        type: 'object',
        properties: {
          user: {
            type: 'object',
            properties: {
              name: { type: 'string' },
            },
          },
        },
      };

      const data = { user: { name: 'João' } };
      const result = validateJsonSchema(schema, data);

      expect(result.valid).toBe(true);
    });

    test('deve detectar erro em objeto aninhado', () => {
      const schema = {
        type: 'object',
        properties: {
          user: {
            type: 'object',
            properties: {
              name: { type: 'string' },
            },
          },
        },
      };

      const data = { user: { name: 123 } };
      const result = validateJsonSchema(schema, data);

      expect(result.valid).toBe(false);
    });

    test('deve rejeitar null como objeto', () => {
      const schema = { type: 'object' };
      const data = null;
      const result = validateJsonSchema(schema, data);

      expect(result.valid).toBe(false);
    });

    test('deve rejeitar array como objeto', () => {
      const schema = { type: 'object' };
      const data = [];
      const result = validateJsonSchema(schema, data);

      expect(result.valid).toBe(false);
    });

    test('deve validar array de objetos', () => {
      const schema = {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
          },
        },
      };

      const data = [{ id: '1' }, { id: '2' }];
      const result = validateJsonSchema(schema, data);

      expect(result.valid).toBe(true);
    });

    test('deve retornar válido quando schema não é objeto', () => {
      const result = validateJsonSchema('invalid', {});
      expect(result.valid).toBe(true);
    });
  });
});

