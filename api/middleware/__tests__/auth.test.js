/**
 * Testes para middleware/auth.js
 */

const { extractToken, requireAuth, requirePermission } = require('../auth');
const { validateToken } = require('../../services/authService');
const { hasPermission } = require('../../services/rbacService');

// Mock dos serviços
jest.mock('../../services/authService');
jest.mock('../../services/rbacService');

describe('auth middleware', () => {
  let mockReq;

  beforeEach(() => {
    jest.clearAllMocks();
    mockReq = {
      headers: {},
    };
  });

  describe('extractToken', () => {
    test('deve extrair token do header Authorization com Bearer', () => {
      mockReq.headers.authorization = 'Bearer token123';
      const token = extractToken(mockReq);
      
      expect(token).toBe('token123');
    });

    test('deve extrair token do header Authorization sem Bearer', () => {
      mockReq.headers.authorization = 'token123';
      const token = extractToken(mockReq);
      
      expect(token).toBe('token123');
    });

    test('deve retornar null quando não há header Authorization', () => {
      const token = extractToken(mockReq);
      
      expect(token).toBeNull();
    });

    test('deve retornar null quando header Authorization está vazio', () => {
      mockReq.headers.authorization = '';
      const token = extractToken(mockReq);
      
      expect(token).toBeNull();
    });

    test('deve extrair token mesmo com espaços extras', () => {
      mockReq.headers.authorization = 'Bearer  token123  ';
      const token = extractToken(mockReq);
      
      // extractToken remove apenas "Bearer " (7 caracteres), não remove espaços do token
      expect(token).toBe(' token123  ');
    });
  });

  describe('requireAuth', () => {
    test('deve retornar erro quando token não é fornecido', () => {
      const result = requireAuth(mockReq);
      
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Token de autenticação não fornecido');
    });

    test('deve retornar erro quando token é inválido', () => {
      mockReq.headers.authorization = 'Bearer invalid-token';
      validateToken.mockReturnValue({ valid: false, error: 'Token expirado' });
      
      const result = requireAuth(mockReq);
      
      expect(result.valid).toBe(false);
      expect(result.error).toBe('Token expirado');
      expect(validateToken).toHaveBeenCalledWith('invalid-token');
    });

    test('deve retornar sucesso quando token é válido', () => {
      const mockAgent = { id: 'agent-1', tenantId: 'tenant-1' };
      const mockSession = { id: 'session-1' };
      
      mockReq.headers.authorization = 'Bearer valid-token';
      validateToken.mockReturnValue({
        valid: true,
        agent: mockAgent,
        session: mockSession,
      });
      
      const result = requireAuth(mockReq);
      
      expect(result.valid).toBe(true);
      expect(result.agent).toEqual(mockAgent);
      expect(result.session).toEqual(mockSession);
      expect(mockReq.agent).toEqual(mockAgent);
      expect(mockReq.session).toEqual(mockSession);
      expect(mockReq.token).toBe('valid-token');
      expect(mockReq.tenantId).toBe('tenant-1');
    });

    test('deve definir tenantId como null quando agente não tem tenantId', () => {
      const mockAgent = { id: 'agent-1' };
      const mockSession = { id: 'session-1' };
      
      mockReq.headers.authorization = 'Bearer valid-token';
      validateToken.mockReturnValue({
        valid: true,
        agent: mockAgent,
        session: mockSession,
      });
      
      requireAuth(mockReq);
      
      expect(mockReq.tenantId).toBeNull();
    });

    test('deve reutilizar req.agent/req.session quando o mesmo token já foi validado no request', () => {
      const mockAgent = { id: 'agent-1', tenantId: 'tenant-1' };
      const mockSession = { id: 'session-1' };

      mockReq.headers.authorization = 'Bearer valid-token';
      validateToken.mockReturnValue({
        valid: true,
        agent: mockAgent,
        session: mockSession,
      });

      const first = requireAuth(mockReq);
      expect(first.valid).toBe(true);
      expect(validateToken).toHaveBeenCalledTimes(1);

      const second = requireAuth(mockReq);
      expect(second.valid).toBe(true);
      expect(second.agent).toEqual(mockAgent);
      expect(second.session).toEqual(mockSession);
      // Não re-valida o token (evita 2x validateToken por request)
      expect(validateToken).toHaveBeenCalledTimes(1);
      // Contrato preservado: campos do request continuam populados
      expect(mockReq.agent).toEqual(mockAgent);
      expect(mockReq.session).toEqual(mockSession);
      expect(mockReq.tenantId).toBe('tenant-1');
    });

    test('deve re-validar quando o token do header difere do token já validado', () => {
      const mockAgent = { id: 'agent-1', tenantId: 'tenant-1' };
      const mockSession = { id: 'session-1' };

      mockReq.headers.authorization = 'Bearer token-a';
      validateToken.mockReturnValue({
        valid: true,
        agent: mockAgent,
        session: mockSession,
      });

      requireAuth(mockReq);
      expect(validateToken).toHaveBeenCalledTimes(1);

      mockReq.headers.authorization = 'Bearer token-b';
      const result = requireAuth(mockReq);
      expect(result.valid).toBe(true);
      expect(validateToken).toHaveBeenCalledTimes(2);
      expect(validateToken).toHaveBeenLastCalledWith('token-b');
      expect(mockReq.token).toBe('token-b');
    });
  });

  describe('requirePermission', () => {
    test('deve retornar erro quando agente não está autenticado', () => {
      const result = requirePermission(mockReq, 'tickets', 'create');
      
      expect(result.allowed).toBe(false);
      expect(result.error).toContain('Autenticação necessária');
    });

    test('deve retornar erro quando permissão é negada', () => {
      mockReq.agent = { id: 'agent-1' };
      hasPermission.mockReturnValue(false);
      
      const result = requirePermission(mockReq, 'tickets', 'create');
      
      expect(result.allowed).toBe(false);
      expect(result.error).toContain('Permissão negada');
      expect(hasPermission).toHaveBeenCalledWith(mockReq.agent, 'tickets', 'create');
    });

    test('deve retornar sucesso quando permissão é concedida', () => {
      mockReq.agent = { id: 'agent-1' };
      hasPermission.mockReturnValue(true);
      
      const result = requirePermission(mockReq, 'tickets', 'create');
      
      expect(result.allowed).toBe(true);
      expect(hasPermission).toHaveBeenCalledWith(mockReq.agent, 'tickets', 'create');
    });

    test('deve verificar diferentes recursos e ações', () => {
      mockReq.agent = { id: 'agent-1' };
      hasPermission.mockReturnValue(true);
      
      requirePermission(mockReq, 'queues', 'read');
      expect(hasPermission).toHaveBeenCalledWith(mockReq.agent, 'queues', 'read');
      
      requirePermission(mockReq, 'agents', 'update');
      expect(hasPermission).toHaveBeenCalledWith(mockReq.agent, 'agents', 'update');
    });
  });
});

