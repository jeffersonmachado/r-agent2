'use strict';

/**
 * Testes do @results/auth
 */

const { createAuth, MemoryAdapter, hashPassword, verifyPassword } = require('../index');

describe('@results/auth', () => {
  let auth;
  let adapter;

  beforeEach(async () => {
    adapter = new MemoryAdapter();
    auth = createAuth({
      adapter,
      tokenExpirationHours: 1,
      inactivityTimeoutMinutes: 30,
      maxSessionsPerAgent: 2,
      isSuperAdmin: (user) => user.role === 'super_admin',
      permissionChecker: (user, resource, action) => {
        if (user.role === 'super_admin') return true;
        if (resource === 'tickets' && action === 'read') return true;
        return false;
      },
    });

    await adapter.seedUser({
      id: 'user-1',
      username: 'admin',
      password: 'Admin123!',
      role: 'super_admin',
      tenantId: 'system',
    });

    await adapter.seedUser({
      id: 'user-2',
      username: 'operator',
      password: 'Op123!',
      role: 'operator',
      tenantId: 'tenant-a',
    });
  });

  // ─── Login ─────────────────────────────────────────────────────────────────
  describe('login', () => {
    it('deve autenticar com credenciais válidas', async () => {
      const result = await auth.login({ username: 'admin', password: 'Admin123!' });
      expect(result.success).toBe(true);
      expect(result.token).toBeDefined();
      expect(result.token.length).toBe(64);
      expect(result.user.username).toBe('admin');
      expect(result.user._passwordHash).toBeUndefined();
    });

    it('deve rejeitar senha inválida', async () => {
      const result = await auth.login({ username: 'admin', password: 'wrong' });
      expect(result.success).toBe(false);
      expect(result.error).toBe('Credenciais inválidas');
    });

    it('deve rejeitar usuário inexistente', async () => {
      const result = await auth.login({ username: 'nobody', password: 'x' });
      expect(result.success).toBe(false);
    });

    it('deve rejeitar campos vazios', async () => {
      const result = await auth.login({ username: '', password: '' });
      expect(result.success).toBe(false);
    });
  });

  // ─── Validação de token ───────────────────────────────────────────────────
  describe('validateToken', () => {
    it('deve validar token recém-criado', async () => {
      const { token } = await auth.login({ username: 'admin', password: 'Admin123!' });
      const result = auth.validateToken(token);
      expect(result.valid).toBe(true);
      expect(result.user.username).toBe('admin');
      expect(result.session).toBeDefined();
    });

    it('deve rejeitar token inexistente', () => {
      const result = auth.validateToken('deadbeef1234');
      expect(result.valid).toBe(false);
      expect(result.error).toBe('Sessão não encontrada');
    });

    it('deve rejeitar token vazio', () => {
      const result = auth.validateToken('');
      expect(result.valid).toBe(false);
    });

    it('deve rejeitar token null', () => {
      const result = auth.validateToken(null);
      expect(result.valid).toBe(false);
    });
  });

  // ─── Logout ────────────────────────────────────────────────────────────────
  describe('logout', () => {
    it('deve invalidar token após logout', async () => {
      const { token } = await auth.login({ username: 'admin', password: 'Admin123!' });
      expect(auth.validateToken(token).valid).toBe(true);
      await auth.logout(token);
      expect(auth.validateToken(token).valid).toBe(false);
    });

    it('logout sem token deve retornar erro', async () => {
      const result = await auth.logout('');
      expect(result.success).toBe(false);
    });
  });

  // ─── Middleware ────────────────────────────────────────────────────────────
  describe('middleware', () => {
    it('requireAuth deve extrair token do header', async () => {
      const { token } = await auth.login({ username: 'admin', password: 'Admin123!' });
      const req = { headers: { authorization: `Bearer ${token}` } };
      const result = auth.requireAuth(req);
      expect(result.valid).toBe(true);
      expect(req.agent.username).toBe('admin');
      expect(req.tenantId).toBeNull(); // super_admin sem X-Tenant-Id = null
    });

    it('requireAuth com X-Tenant-Id para super_admin', async () => {
      const { token } = await auth.login({ username: 'admin', password: 'Admin123!' });
      const req = {
        headers: {
          authorization: `Bearer ${token}`,
          'x-tenant-id': 'tenant-b',
        },
      };
      const result = auth.requireAuth(req);
      expect(result.valid).toBe(true);
      expect(req.tenantId).toBe('tenant-b');
    });

    it('requireAuth sem header deve falhar', () => {
      const req = { headers: {} };
      const result = auth.requireAuth(req);
      expect(result.valid).toBe(false);
    });

    it('requirePermission deve verificar permissões', async () => {
      const { token } = await auth.login({ username: 'operator', password: 'Op123!' });
      const req = { headers: { authorization: `Bearer ${token}` } };
      auth.requireAuth(req);

      // Operator pode ler tickets
      expect(auth.requirePermission(req, 'tickets', 'read').allowed).toBe(true);
      // Operator NÃO pode criar tickets
      expect(auth.requirePermission(req, 'tickets', 'create').allowed).toBe(false);
    });

    it('super_admin deve ter todas as permissões', async () => {
      const { token } = await auth.login({ username: 'admin', password: 'Admin123!' });
      const req = { headers: { authorization: `Bearer ${token}` } };
      auth.requireAuth(req);
      expect(auth.requirePermission(req, 'anything', 'delete').allowed).toBe(true);
    });
  });

  // ─── Tenant ────────────────────────────────────────────────────────────────
  describe('tenant resolution', () => {
    it('operador herda tenantId do usuário', async () => {
      const { token } = await auth.login({ username: 'operator', password: 'Op123!' });
      const req = { headers: { authorization: `Bearer ${token}` } };
      auth.requireAuth(req);
      expect(req.tenantId).toBe('tenant-a');
    });
  });

  // ─── Password ──────────────────────────────────────────────────────────────
  describe('password', () => {
    it('hash e verify devem ser compatíveis', async () => {
      const hash = await hashPassword('my-secret');
      expect(hash).toBeDefined();
      expect(hash.length).toBeGreaterThan(10);

      const ok = await verifyPassword('my-secret', hash);
      expect(ok).toBe(true);

      const notOk = await verifyPassword('wrong', hash);
      expect(notOk).toBe(false);
    });
  });

  // ─── Sessões máximas ──────────────────────────────────────────────────────
  describe('max sessions', () => {
    it('deve limpar sessões antigas (max 2)', async () => {
      const r1 = await auth.login({ username: 'admin', password: 'Admin123!' });
      const r2 = await auth.login({ username: 'admin', password: 'Admin123!' });
      const r3 = await auth.login({ username: 'admin', password: 'Admin123!' });

      // Apenas token 1 deve ter sido removido (max 2 = mantém os 2 mais recentes)
      expect(auth.sessionStore.has(r1.token)).toBe(false);
      // r2 e r3 são as 2 sessões mais recentes, ambas devem existir
      expect(auth.sessionStore.has(r2.token)).toBe(true);
      expect(auth.sessionStore.has(r3.token)).toBe(true);
    });
  });

  // ─── Extrato do token ──────────────────────────────────────────────────────
  describe('extractToken', () => {
    it('deve extrair token Bearer', () => {
      const { extractToken } = require('../middleware');
      expect(extractToken({ headers: { authorization: 'Bearer abc123' } })).toBe('abc123');
      expect(extractToken({ headers: { authorization: 'abc123' } })).toBe('abc123');
      expect(extractToken({ headers: {} })).toBe('');
    });
  });

  // ─── Factory ───────────────────────────────────────────────────────────────
  describe('createAuth', () => {
    it('deve lançar erro sem adapter', () => {
      expect(() => createAuth({})).toThrow('Adapter é obrigatório');
    });

    it('deve expor API pública completa', () => {
      expect(auth.login).toBeDefined();
      expect(auth.validateToken).toBeDefined();
      expect(auth.logout).toBeDefined();
      expect(auth.initialize).toBeDefined();
      expect(auth.requireAuth).toBeDefined();
      expect(auth.requirePermission).toBeDefined();
      expect(auth.extractToken).toBeDefined();
    });
  });
});
