'use strict';

jest.mock('../../utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

const logger = require('../../utils/logger');
const {
  requireClassification,
  checkClassification,
  getClassificationForAgent,
} = require('../requireClassification');

function createRes() {
  return {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

describe('getClassificationForAgent', () => {
  test('super_admin é DEVELOPMENT', () => {
    expect(getClassificationForAgent({ role: 'super_admin' })).toBe('DEVELOPMENT');
    expect(getClassificationForAgent({ role: 'SUPER_ADMIN' })).toBe('DEVELOPMENT');
  });

  test('auditor é SUPPORT', () => {
    expect(getClassificationForAgent({ role: 'auditor' })).toBe('SUPPORT');
    expect(getClassificationForAgent({ role: 'Auditor' })).toBe('SUPPORT');
  });

  test('demais papéis operacionais são PRODUCTION', () => {
    for (const role of ['operator', 'manager', 'admin', 'owner', 'supervisor', 'readonly']) {
      expect(getClassificationForAgent({ role })).toBe('PRODUCTION');
    }
  });

  test('agente ausente ou sem role é PRODUCTION', () => {
    expect(getClassificationForAgent(undefined)).toBe('PRODUCTION');
    expect(getClassificationForAgent(null)).toBe('PRODUCTION');
    expect(getClassificationForAgent({})).toBe('PRODUCTION');
  });
});

describe('requireClassification', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('hierarquia: DEVELOPMENT > SUPPORT > PRODUCTION', () => {
    const middleware = requireClassification('SUPPORT');

    const reqDev = { agent: { role: 'super_admin' }, method: 'GET', url: '/x' };
    const nextDev = jest.fn();
    middleware(reqDev, createRes(), nextDev);
    expect(nextDev).toHaveBeenCalledTimes(1);

    const reqSupport = { agent: { role: 'auditor' }, method: 'GET', url: '/x' };
    const nextSupport = jest.fn();
    middleware(reqSupport, createRes(), nextSupport);
    expect(nextSupport).toHaveBeenCalledTimes(1);

    const reqProd = { agent: { role: 'operator' }, method: 'GET', url: '/x' };
    const resProd = createRes();
    const nextProd = jest.fn();
    middleware(reqProd, resProd, nextProd);
    expect(nextProd).not.toHaveBeenCalled();
    expect(resProd.statusCode).toBe(403);
  });

  test('DEVELOPMENT exige super_admin (auditor é negado)', () => {
    const middleware = requireClassification('DEVELOPMENT');
    const res = createRes();
    const next = jest.fn();

    middleware({ agent: { role: 'auditor' }, method: 'GET', url: '/api/qa-waves/waves' }, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({
      error: 'classification_required',
      required: 'DEVELOPMENT',
      classification: 'SUPPORT',
    });
  });

  test('operator recebe 403 com payload padronizado em rota DEVELOPMENT', () => {
    const middleware = requireClassification('DEVELOPMENT');
    const res = createRes();
    const next = jest.fn();

    middleware({ agent: { role: 'operator' }, method: 'GET', url: '/api/qa-waves/waves' }, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({
      error: 'classification_required',
      required: 'DEVELOPMENT',
      classification: 'PRODUCTION',
    });
  });

  test('PRODUCTION permite qualquer usuário autenticado', () => {
    const middleware = requireClassification('PRODUCTION');
    const next = jest.fn();

    middleware({ agent: { role: 'operator' }, method: 'GET', url: '/inbox' }, createRes(), next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  test('registra auditoria via logger.warn ao negar, sem dados sensíveis', () => {
    const middleware = requireClassification('DEVELOPMENT');

    middleware({ agent: { role: 'manager' }, method: 'GET', url: '/qa-mesh/registry' }, createRes(), jest.fn());

    expect(logger.warn).toHaveBeenCalledTimes(1);
    const [message, meta] = logger.warn.mock.calls[0];
    expect(String(message)).toContain('classification_required');
    expect(meta).toEqual(expect.objectContaining({
      required: 'DEVELOPMENT',
      classification: 'PRODUCTION',
      role: 'manager',
    }));
    expect(JSON.stringify(meta)).not.toContain('token');
  });

  test('não registra warn quando o acesso é permitido', () => {
    const middleware = requireClassification('DEVELOPMENT');

    middleware({ agent: { role: 'super_admin' }, method: 'GET', url: '/qa-mesh/registry' }, createRes(), jest.fn());

    expect(logger.warn).not.toHaveBeenCalled();
  });
});

describe('checkClassification (helper para rotas com deps.sendJson)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('retorna allowed=false com classificação derivada para operator em rota DEVELOPMENT', () => {
    const check = checkClassification({ agent: { role: 'operator' }, method: 'GET', url: '/api/qa-waves/waves' }, 'DEVELOPMENT');

    expect(check).toEqual({
      allowed: false,
      required: 'DEVELOPMENT',
      classification: 'PRODUCTION',
    });
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  test('retorna allowed=true para super_admin em rota DEVELOPMENT', () => {
    const check = checkClassification({ agent: { role: 'super_admin' } }, 'DEVELOPMENT');

    expect(check.allowed).toBe(true);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  test('auditor passa em rota SUPPORT mas não em DEVELOPMENT', () => {
    expect(checkClassification({ agent: { role: 'auditor' } }, 'SUPPORT').allowed).toBe(true);
    expect(checkClassification({ agent: { role: 'auditor' } }, 'DEVELOPMENT').allowed).toBe(false);
  });
});
