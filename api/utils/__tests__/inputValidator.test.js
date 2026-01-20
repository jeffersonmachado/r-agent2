const {
  validateInput,
  validateString,
  validateNumber,
  validateEmail,
  validateUrl,
  validateArray,
  validateObject,
  sanitizeString,
  ValidationError,
  schemas,
} = require('../inputValidator');

describe('inputValidator', () => {
  describe('validateString', () => {
    test('valida string válida', () => {
      const result = validateString('teste', { minLength: 1, maxLength: 100 });
      expect(result).toBe('teste');
    });

    test('retorna string vazia se não obrigatório e valor vazio', () => {
      const result = validateString('', { required: false });
      expect(result).toBe('');
    });

    test('lança erro se obrigatório e vazio', () => {
      expect(() => {
        validateString('', { required: true });
      }).toThrow(ValidationError);
    });

    test('lança erro se muito curto', () => {
      expect(() => {
        validateString('ab', { minLength: 5 });
      }).toThrow(ValidationError);
    });

    test('trunca string se muito longo', () => {
      // A função trunca ao invés de lançar erro
      const result = validateString('a'.repeat(101), { maxLength: 100 });
      expect(result.length).toBe(100);
    });

    test('sanitiza HTML por padrão', () => {
      const result = validateString('<script>alert("xss")</script>', {});
      expect(result).not.toContain('<script>');
      // A função remove tags HTML completamente, não apenas escapa
      expect(result).not.toContain('<');
      expect(result).not.toContain('>');
    });

    test('não sanitiza HTML se allowHtml=true', () => {
      const result = validateString('<div>test</div>', { allowHtml: true });
      expect(result).toContain('<div>');
    });

    test('valida padrão regex', () => {
      const result = validateString('abc123', { pattern: /^[a-z0-9]+$/ });
      expect(result).toBe('abc123');

      expect(() => {
        validateString('ABC123', { pattern: /^[a-z0-9]+$/ });
      }).toThrow(ValidationError);
    });
  });

  describe('validateNumber', () => {
    test('valida número válido', () => {
      const result = validateNumber(42, { min: 0, max: 100 });
      expect(result).toBe(42);
    });

    test('converte string para número', () => {
      const result = validateNumber('42', {});
      expect(result).toBe(42);
    });

    test('lança erro se não é número', () => {
      expect(() => {
        validateNumber('abc', {});
      }).toThrow(ValidationError);
    });

    test('lança erro se abaixo do mínimo', () => {
      expect(() => {
        validateNumber(5, { min: 10 });
      }).toThrow(ValidationError);
    });

    test('lança erro se acima do máximo', () => {
      expect(() => {
        validateNumber(150, { max: 100 });
      }).toThrow(ValidationError);
    });

    test('valida inteiro', () => {
      const result = validateNumber(42, { integer: true });
      expect(result).toBe(42);

      expect(() => {
        validateNumber(42.5, { integer: true });
      }).toThrow(ValidationError);
    });
  });

  describe('validateEmail', () => {
    test('valida email válido', () => {
      const result = validateEmail('user@example.com');
      expect(result).toBe('user@example.com');
    });

    test('normaliza email para lowercase', () => {
      const result = validateEmail('USER@EXAMPLE.COM');
      expect(result).toBe('user@example.com');
    });

    test('lança erro para email inválido', () => {
      expect(() => {
        validateEmail('invalid-email');
      }).toThrow(ValidationError);
    });

    test('lança erro para email muito longo', () => {
      const longEmail = 'a'.repeat(250) + '@example.com';
      expect(() => {
        validateEmail(longEmail);
      }).toThrow(ValidationError);
    });
  });

  describe('validateUrl', () => {
    test('valida URL válida', () => {
      const result = validateUrl('https://example.com');
      expect(result).toBe('https://example.com');
    });

    test('lança erro para URL inválida', () => {
      expect(() => {
        validateUrl('not-a-url');
      }).toThrow(ValidationError);
    });

    test('valida protocolos permitidos', () => {
      const result = validateUrl('http://example.com', {
        allowedProtocols: ['http:', 'https:'],
      });
      expect(result).toBe('http://example.com');

      expect(() => {
        validateUrl('ftp://example.com', {
          allowedProtocols: ['http:', 'https:'],
        });
      }).toThrow(ValidationError);
    });

    test('adiciona https:// se requireProtocol=false', () => {
      const result = validateUrl('example.com', {
        requireProtocol: false,
      });
      expect(result).toBe('https://example.com');
    });
  });

  describe('validateArray', () => {
    test('valida array válido', () => {
      const result = validateArray([1, 2, 3], { minLength: 1, maxLength: 10 });
      expect(result).toEqual([1, 2, 3]);
    });

    test('lança erro se não é array', () => {
      expect(() => {
        validateArray('not-array', { required: true });
      }).toThrow(ValidationError);
    });

    test('lança erro se muito curto', () => {
      expect(() => {
        validateArray([1], { minLength: 3 });
      }).toThrow(ValidationError);
    });

    test('lança erro se muito longo', () => {
      expect(() => {
        validateArray([1, 2, 3, 4], { maxLength: 3 });
      }).toThrow(ValidationError);
    });

    test('valida itens do array', () => {
      const result = validateArray(['a', 'b', 'c'], {
        itemValidator: (item) => item.toUpperCase(),
      });
      expect(result).toEqual(['A', 'B', 'C']);
    });
  });

  describe('validateObject', () => {
    test('valida objeto com schema', () => {
      const schema = {
        name: {
          type: 'string',
          required: true,
          minLength: 1,
        },
        age: {
          type: 'number',
          required: false,
          min: 0,
        },
      };

      const result = validateObject({ name: 'John', age: 30 }, schema);
      expect(result).toEqual({ name: 'John', age: 30 });
    });

    test('lança erro se campo obrigatório ausente', () => {
      const schema = {
        name: {
          type: 'string',
          required: true,
        },
      };

      expect(() => {
        validateObject({}, schema);
      }).toThrow(ValidationError);
    });

    test('aplica default se campo ausente e não obrigatório', () => {
      const schema = {
        name: {
          type: 'string',
          required: true,
        },
        active: {
          type: 'boolean',
          required: false,
          default: true,
        },
      };

      const result = validateObject({ name: 'John' }, schema);
      expect(result.active).toBe(true);
    });
  });

  describe('validateInput', () => {
    test('valida usando schema de objeto', () => {
      const schema = {
        type: 'object',
        fields: {
          name: {
            type: 'string',
            required: true,
          },
        },
      };

      const result = validateInput({ name: 'John' }, schema);
      expect(result).toEqual({ name: 'John' });
    });

    test('valida usando schema de string', () => {
      const schema = {
        type: 'string',
        required: true,
        minLength: 1,
      };

      const result = validateInput('test', schema);
      expect(result).toBe('test');
    });
  });

  describe('schemas pré-definidos', () => {
    test('schemas.login valida dados de login', () => {
      const valid = validateInput(
        { username: 'user123', password: 'pass123' },
        schemas.login
      );
      expect(valid.username).toBe('user123');
      expect(valid.password).toBe('pass123');
    });

    test('schemas.login aceita email como username', () => {
      const valid = validateInput(
        { username: 'systemadmin@exemplo.com', password: 'Admin123!' },
        schemas.login
      );
      expect(valid.username).toBe('systemadmin@exemplo.com');
      expect(valid.password).toBe('Admin123!');
    });

    test('schemas.login rejeita username inválido', () => {
      expect(() => {
        validateInput({ username: 'user@123', password: 'pass' }, schemas.login);
      }).toThrow(ValidationError);
    });

    test('schemas.createAgent valida criação de agente', () => {
      const valid = validateInput(
        {
          username: 'agent1',
          email: 'agent@example.com',
          password: 'password123',
          tenantId: 'tenant-1',
        },
        schemas.createAgent
      );
      expect(valid.username).toBe('agent1');
      expect(valid.email).toBe('agent@example.com');
      expect(valid.role).toBe('agent'); // default
    });

    test('schemas.createAgent rejeita email inválido', () => {
      expect(() => {
        validateInput(
          {
            username: 'agent1',
            email: 'invalid-email',
            password: 'pass123',
            tenantId: 'tenant-1',
          },
          schemas.createAgent
        );
      }).toThrow(ValidationError);
    });
  });

  describe('sanitizeString', () => {
    test('remove tags HTML', () => {
      const result = sanitizeString('<script>alert("xss")</script>');
      expect(result).not.toContain('<script>');
    });

    test('escapa caracteres HTML', () => {
      const result = sanitizeString('<div>test</div>');
      // A função remove tags HTML, então não deve conter < ou >
      expect(result).not.toContain('<');
      expect(result).not.toContain('>');
      expect(result).toContain('test');
    });

    test('remove newlines se allowNewlines=false', () => {
      const result = sanitizeString('line1\nline2', { allowNewlines: false });
      expect(result).not.toContain('\n');
    });

    test('limita tamanho', () => {
      const long = 'a'.repeat(200);
      const result = sanitizeString(long, { maxLength: 100 });
      expect(result.length).toBe(100);
    });
  });
});

