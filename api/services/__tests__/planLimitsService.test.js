/**
 * Testes para planLimitsService.js
 */

const {
  getPlanLimits,
  checkLimit,
  PLAN_LIMITS,
} = require('../planLimitsService');
const { getTenant, getTenantUsage } = require('../tenantService');

// Mock dos serviços
jest.mock('../tenantService');

describe('planLimitsService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getPlanLimits', () => {
    test('deve retornar limites do plano free', () => {
      const limits = getPlanLimits('free');
      
      expect(limits).toEqual(PLAN_LIMITS.free);
      expect(limits.usuarios).toBe(1);
      expect(limits.agentes_ia).toBe(1);
    });

    test('deve retornar limites do plano trial', () => {
      const limits = getPlanLimits('trial');
      
      expect(limits).toEqual(PLAN_LIMITS.trial);
      expect(limits.usuarios).toBe(3);
    });

    test('deve retornar limites do plano pro', () => {
      const limits = getPlanLimits('pro');
      
      expect(limits).toEqual(PLAN_LIMITS.pro);
      expect(limits.usuarios).toBe(10);
    });

    test('deve retornar limites do plano enterprise (ilimitado)', () => {
      const limits = getPlanLimits('enterprise');
      
      expect(limits).toEqual(PLAN_LIMITS.enterprise);
      expect(limits.usuarios).toBe(-1); // Ilimitado
    });

    test('deve retornar limites do trial para plano inválido', () => {
      const limits = getPlanLimits('invalid');
      
      expect(limits).toEqual(PLAN_LIMITS.trial);
    });
  });

  describe('checkLimit', () => {
    test('deve retornar erro quando tenant não existe', () => {
      getTenant.mockReturnValue(null);
      
      const result = checkLimit('tenant-inexistente', 'usuarios', 1);
      
      expect(result.allowed).toBe(false);
      expect(result.error).toContain('Tenant não encontrado');
    });

    test('deve permitir quando plano é enterprise (ilimitado)', () => {
      const mockTenant = {
        id: 'tenant-1',
        plan: 'enterprise',
        limits: PLAN_LIMITS.enterprise,
      };
      getTenant.mockReturnValue(mockTenant);
      getTenantUsage.mockReturnValue({ usuarios: 0 });
      
      const result = checkLimit('tenant-1', 'usuarios', 1000);
      
      expect(result.allowed).toBe(true);
      expect(result.limit).toBe(-1);
    });

    test('deve permitir quando está dentro do limite', () => {
      const mockTenant = {
        id: 'tenant-1',
        plan: 'pro',
        limits: PLAN_LIMITS.pro,
      };
      getTenant.mockReturnValue(mockTenant);
      getTenantUsage.mockReturnValue({ usuarios: 5 });
      
      const result = checkLimit('tenant-1', 'usuarios', 1);
      
      expect(result.allowed).toBe(true);
      expect(result.limit).toBe(10);
      expect(result.current).toBe(5);
    });

    test('deve negar quando excede o limite', () => {
      const mockTenant = {
        id: 'tenant-1',
        plan: 'free',
        limits: PLAN_LIMITS.free,
      };
      getTenant.mockReturnValue(mockTenant);
      getTenantUsage.mockReturnValue({ usuarios: 1 });
      
      const result = checkLimit('tenant-1', 'usuarios', 1);
      
      expect(result.allowed).toBe(false);
      expect(result.error).toContain('Limite');
      expect(result.limit).toBe(1);
      expect(result.current).toBe(1);
    });

    test('deve usar limites customizados do tenant', () => {
      const mockTenant = {
        id: 'tenant-1',
        plan: 'pro',
        limits: {
          usuarios: 20, // Customizado
          agentes_ia: 5,
          execucoes_rpa: 500,
          tokens_ia: 500000,
          documentos_rag: 500,
          storage_mb: 5000,
        },
      };
      getTenant.mockReturnValue(mockTenant);
      getTenantUsage.mockReturnValue({ usuarios: 15 });
      
      const result = checkLimit('tenant-1', 'usuarios', 1);
      
      expect(result.allowed).toBe(true);
      expect(result.limit).toBe(20);
    });
  });
});
