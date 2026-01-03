/**
 * Sistema robusto de validação de inputs.
 * 
 * Fornece validação centralizada para todos os tipos de dados de entrada,
 * prevenindo injection attacks, XSS, e outros problemas de segurança.
 * 
 * Uso:
 *   const { validateInput, ValidationError } = require('./utils/inputValidator');
 *   
 *   try {
 *     const validated = validateInput(data, schema);
 *   } catch (error) {
 *     if (error instanceof ValidationError) {
 *       // Tratar erro de validação
 *     }
 *   }
 */

/**
 * Erro customizado para validação.
 */
class ValidationError extends Error {
  constructor(message, field = null, code = 'VALIDATION_ERROR') {
    super(message);
    this.name = 'ValidationError';
    this.field = field;
    this.code = code;
    this.statusCode = 400;
  }
}

/**
 * Sanitiza string removendo caracteres perigosos.
 * 
 * @param {string} str - String a ser sanitizada
 * @param {Object} options - Opções de sanitização
 * @returns {string}
 */
function sanitizeString(str, options = {}) {
  if (typeof str !== 'string') {
    return str;
  }

  const {
    maxLength = 10000,
    allowHtml = false,
    allowNewlines = true,
    trim = true,
  } = options;

  let sanitized = str;

  // Trim se solicitado
  if (trim) {
    sanitized = sanitized.trim();
  }

  // Remove HTML tags se não permitido
  if (!allowHtml) {
    // Remove tags HTML básicas
    sanitized = sanitized.replace(/<[^>]*>/g, '');
    // Escapa caracteres HTML
    sanitized = sanitized
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#x27;');
  }

  // Remove newlines se não permitido
  if (!allowNewlines) {
    sanitized = sanitized.replace(/[\r\n]/g, ' ');
  }

  // Limita tamanho
  if (sanitized.length > maxLength) {
    sanitized = sanitized.substring(0, maxLength);
  }

  return sanitized;
}

/**
 * Valida e sanitiza email.
 * 
 * @param {string} email - Email a ser validado
 * @returns {string} Email sanitizado
 * @throws {ValidationError}
 */
function validateEmail(email) {
  if (typeof email !== 'string') {
    throw new ValidationError('Email deve ser uma string', 'email', 'INVALID_TYPE');
  }

  const sanitized = email.trim().toLowerCase();
  
  // Regex básico para email (RFC 5322 simplificado)
  const emailRegex = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
  
  if (!emailRegex.test(sanitized)) {
    throw new ValidationError('Email inválido', 'email', 'INVALID_EMAIL');
  }

  if (sanitized.length > 254) {
    throw new ValidationError('Email muito longo (máximo 254 caracteres)', 'email', 'EMAIL_TOO_LONG');
  }

  return sanitized;
}

/**
 * Valida e sanitiza URL.
 * 
 * @param {string} url - URL a ser validada
 * @param {Object} options - Opções
 * @returns {string} URL validada
 * @throws {ValidationError}
 */
function validateUrl(url, options = {}) {
  if (typeof url !== 'string') {
    throw new ValidationError('URL deve ser uma string', 'url', 'INVALID_TYPE');
  }

  const { allowedProtocols = ['http:', 'https:'], requireProtocol = true } = options;
  const trimmed = url.trim();

  if (!trimmed) {
    throw new ValidationError('URL não pode ser vazia', 'url', 'EMPTY_URL');
  }

  try {
    const urlObj = new URL(trimmed);
    
    if (!allowedProtocols.includes(urlObj.protocol)) {
      throw new ValidationError(
        `Protocolo não permitido. Permitidos: ${allowedProtocols.join(', ')}`,
        'url',
        'INVALID_PROTOCOL'
      );
    }

    // Valida tamanho da URL
    if (trimmed.length > 2048) {
      throw new ValidationError('URL muito longa (máximo 2048 caracteres)', 'url', 'URL_TOO_LONG');
    }

    return trimmed;
  } catch (err) {
    if (err instanceof ValidationError) {
      throw err;
    }
    
    if (requireProtocol) {
      throw new ValidationError('URL inválida ou protocolo ausente', 'url', 'INVALID_URL');
    }
    
    // Tenta adicionar https:// se não tiver protocolo
    try {
      const urlWithProtocol = `https://${trimmed}`;
      const urlObj = new URL(urlWithProtocol);
      return urlWithProtocol;
    } catch {
      throw new ValidationError('URL inválida', 'url', 'INVALID_URL');
    }
  }
}

/**
 * Valida número dentro de um range.
 * 
 * @param {any} value - Valor a ser validado
 * @param {Object} options - Opções (min, max, integer)
 * @returns {number}
 * @throws {ValidationError}
 */
function validateNumber(value, options = {}) {
  const { min = -Infinity, max = Infinity, integer = false } = options;

  // Converte string para número se possível
  let num = value;
  if (typeof value === 'string') {
    num = Number(value);
    if (Number.isNaN(num)) {
      throw new ValidationError('Valor não é um número válido', 'number', 'INVALID_NUMBER');
    }
  }

  if (typeof num !== 'number' || Number.isNaN(num) || !Number.isFinite(num)) {
    throw new ValidationError('Valor deve ser um número válido', 'number', 'INVALID_NUMBER');
  }

  if (integer && !Number.isInteger(num)) {
    throw new ValidationError('Valor deve ser um número inteiro', 'number', 'NOT_INTEGER');
  }

  if (num < min) {
    throw new ValidationError(`Valor deve ser maior ou igual a ${min}`, 'number', 'BELOW_MIN');
  }

  if (num > max) {
    throw new ValidationError(`Valor deve ser menor ou igual a ${max}`, 'number', 'ABOVE_MAX');
  }

  return num;
}

/**
 * Valida string com opções.
 * 
 * @param {any} value - Valor a ser validado
 * @param {Object} options - Opções de validação
 * @returns {string}
 * @throws {ValidationError}
 */
function validateString(value, options = {}) {
  const {
    required = false,
    minLength = 0,
    maxLength = 10000,
    pattern = null,
    sanitize = true,
    allowHtml = false,
    allowNewlines = true,
  } = options;

  // Verifica se é obrigatório
  if (required && (value === null || value === undefined || value === '')) {
    throw new ValidationError('Campo obrigatório', 'string', 'REQUIRED');
  }

  // Se não é obrigatório e está vazio, retorna string vazia
  if (!required && (value === null || value === undefined || value === '')) {
    return '';
  }

  // Converte para string se necessário
  let str = String(value);

  // Sanitiza se solicitado
  if (sanitize) {
    str = sanitizeString(str, { maxLength, allowHtml, allowNewlines });
  } else {
    // Apenas trim e limita tamanho
    str = str.trim();
    if (str.length > maxLength) {
      str = str.substring(0, maxLength);
    }
  }

  // Valida comprimento
  if (str.length < minLength) {
    throw new ValidationError(
      `String deve ter pelo menos ${minLength} caracteres`,
      'string',
      'TOO_SHORT'
    );
  }

  if (str.length > maxLength) {
    throw new ValidationError(
      `String deve ter no máximo ${maxLength} caracteres`,
      'string',
      'TOO_LONG'
    );
  }

  // Valida padrão regex se fornecido
  if (pattern && !pattern.test(str)) {
    throw new ValidationError('String não corresponde ao padrão esperado', 'string', 'PATTERN_MISMATCH');
  }

  return str;
}

/**
 * Valida array.
 * 
 * @param {any} value - Valor a ser validado
 * @param {Object} options - Opções
 * @returns {Array}
 * @throws {ValidationError}
 */
function validateArray(value, options = {}) {
  const {
    required = false,
    minLength = 0,
    maxLength = 1000,
    itemValidator = null,
  } = options;

  if (required && (!Array.isArray(value) || value.length === 0)) {
    throw new ValidationError('Array obrigatório e não pode estar vazio', 'array', 'REQUIRED');
  }

  if (!required && (!Array.isArray(value) || value.length === 0)) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw new ValidationError('Valor deve ser um array', 'array', 'INVALID_TYPE');
  }

  if (value.length < minLength) {
    throw new ValidationError(
      `Array deve ter pelo menos ${minLength} item(s)`,
      'array',
      'TOO_SHORT'
    );
  }

  if (value.length > maxLength) {
    throw new ValidationError(
      `Array deve ter no máximo ${maxLength} item(s)`,
      'array',
      'TOO_LONG'
    );
  }

  // Valida cada item se validator fornecido
  if (itemValidator) {
    return value.map((item, index) => {
      try {
        return itemValidator(item, index);
      } catch (err) {
        if (err instanceof ValidationError) {
          err.field = err.field ? `[${index}].${err.field}` : `[${index}]`;
          throw err;
        }
        throw new ValidationError(
          `Erro ao validar item no índice ${index}: ${err.message}`,
          `[${index}]`,
          'ITEM_VALIDATION_ERROR'
        );
      }
    });
  }

  return value;
}

/**
 * Valida objeto.
 * 
 * @param {any} value - Valor a ser validado
 * @param {Object} schema - Schema de validação
 * @returns {Object}
 * @throws {ValidationError}
 */
function validateObject(value, schema) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ValidationError('Valor deve ser um objeto', 'object', 'INVALID_TYPE');
  }

  const validated = {};
  const errors = [];

  // Valida cada campo do schema
  for (const [field, fieldSchema] of Object.entries(schema)) {
    try {
      const fieldValue = value[field];
      
      if (fieldSchema.required && (fieldValue === null || fieldValue === undefined)) {
        throw new ValidationError(
          `Campo '${field}' é obrigatório`,
          field,
          'REQUIRED'
        );
      }

      if (fieldValue !== null && fieldValue !== undefined) {
        // Aplica validação específica do tipo
        if (fieldSchema.type === 'string') {
          validated[field] = validateString(fieldValue, fieldSchema);
        } else if (fieldSchema.type === 'number') {
          validated[field] = validateNumber(fieldValue, fieldSchema);
        } else if (fieldSchema.type === 'email') {
          validated[field] = validateEmail(fieldValue);
        } else if (fieldSchema.type === 'url') {
          validated[field] = validateUrl(fieldValue, fieldSchema);
        } else if (fieldSchema.type === 'array') {
          validated[field] = validateArray(fieldValue, fieldSchema);
        } else if (fieldSchema.type === 'object') {
          validated[field] = validateObject(fieldValue, fieldSchema.fields || {});
        } else if (fieldSchema.validator && typeof fieldSchema.validator === 'function') {
          // Validator customizado
          validated[field] = fieldSchema.validator(fieldValue);
        } else {
          // Tipo não especificado, apenas copia o valor
          validated[field] = fieldValue;
        }
      } else if (fieldSchema.default !== undefined) {
        validated[field] = fieldSchema.default;
      }
    } catch (err) {
      if (err instanceof ValidationError) {
        errors.push({
          field: err.field || field,
          message: err.message,
          code: err.code,
        });
      } else {
        errors.push({
          field,
          message: `Erro ao validar campo: ${err.message}`,
          code: 'VALIDATION_ERROR',
        });
      }
    }
  }

  if (errors.length > 0) {
    const firstError = errors[0];
    throw new ValidationError(
      firstError.message,
      firstError.field,
      firstError.code
    );
  }

  return validated;
}

/**
 * Valida input completo usando schema.
 * 
 * @param {any} data - Dados a serem validados
 * @param {Object} schema - Schema de validação
 * @returns {any} Dados validados e sanitizados
 * @throws {ValidationError}
 */
function validateInput(data, schema) {
  if (schema.type === 'object' && schema.fields) {
    return validateObject(data, schema.fields);
  }

  // Schema simples (tipo único)
  if (schema.type === 'string') {
    return validateString(data, schema);
  }

  if (schema.type === 'number') {
    return validateNumber(data, schema);
  }

  if (schema.type === 'email') {
    return validateEmail(data);
  }

  if (schema.type === 'url') {
    return validateUrl(data, schema);
  }

  if (schema.type === 'array') {
    return validateArray(data, schema);
  }

  // Se tem validator customizado, usa ele
  if (schema.validator && typeof schema.validator === 'function') {
    return schema.validator(data);
  }

  // Fallback: retorna dados como estão
  return data;
}

/**
 * Schemas pré-definidos comuns.
 */
const schemas = {
  login: {
    type: 'object',
    fields: {
      username: {
        type: 'string',
        required: true,
        minLength: 1,
        maxLength: 100,
        pattern: /^[a-zA-Z0-9_\-\.]+$/,
      },
      password: {
        type: 'string',
        required: true,
        minLength: 1,
        maxLength: 500,
      },
    },
  },

  createAgent: {
    type: 'object',
    fields: {
      username: {
        type: 'string',
        required: true,
        minLength: 3,
        maxLength: 50,
        pattern: /^[a-zA-Z0-9_\-\.]+$/,
      },
      email: {
        type: 'email',
        required: true,
      },
      password: {
        type: 'string',
        required: true,
        minLength: 8,
        maxLength: 500,
      },
      name: {
        type: 'string',
        required: false,
        maxLength: 200,
      },
      role: {
        type: 'string',
        required: false,
        pattern: /^(admin|supervisor|agent)$/,
        default: 'agent',
      },
      tenantId: {
        type: 'string',
        required: true,
        minLength: 1,
        maxLength: 100,
      },
    },
  },

  createFlow: {
    type: 'object',
    fields: {
      id: {
        type: 'string',
        required: false,
        maxLength: 200,
        pattern: /^[a-zA-Z0-9_\-\.]+$/,
      },
      name: {
        type: 'string',
        required: true,
        minLength: 1,
        maxLength: 500,
      },
      version: {
        type: 'number',
        required: false,
        integer: true,
        min: 1,
        max: 999999,
        default: 1,
      },
    },
  },
};

module.exports = {
  ValidationError,
  validateInput,
  validateString,
  validateNumber,
  validateEmail,
  validateUrl,
  validateArray,
  validateObject,
  sanitizeString,
  schemas,
};

