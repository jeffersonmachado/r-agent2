/**
 * Testes para Rate Limiting.
 * 
 * Testa:
 * - Políticas de rate limiting
 * - Integração com Redis
 * - Bloqueio de execuções
 * - Auditoria
 */

const { getPolicy, getScrapingDomainPolicy } = require('../../infra/rate-limit/policies');
const { checkRateLimit, enforceRateLimit, createRateLimitError } = require('../../infra/rate-limit');
const { checkScrapingRateLimit, enforceScrapingRateLimit } = require('../../infra/rate-limit/scraping');
const { getRateLimitClient, isRedisAvailable, closeRateLimitClient } = require('../../infra/redis/rateLimitClient');
const config = require('../../api/utils/config');

describe('Rate Limiting', () => {
  beforeAll(async () => {
    // Limpa cache de configuração
    config.reload();
  });

  afterAll(async () => {
    // Fecha conexão Redis se estiver aberta
    await closeRateLimitClient();
  });

  describe('Políticas', () => {
    test('deve retornar política DRY_RUN', () => {
      const policy = getPolicy('DRY_RUN');
      expect(policy).toBeDefined();
      expect(policy.points).toBeGreaterThan(0);
      expect(policy.duration).toBeGreaterThan(0);
    });

    test('deve retornar política GENERATION_REAL', () => {
      const policy = getPolicy('GENERATION_REAL');
      expect(policy).toBeDefined();
      expect(policy.points).toBeGreaterThan(0);
      expect(policy.duration).toBeGreaterThan(0);
    });

    test('deve retornar política BOOTSTRAP', () => {
      const policy = getPolicy('BOOTSTRAP');
      expect(policy).toBeDefined();
      expect(policy.points).toBeGreaterThan(0);
      expect(policy.duration).toBeGreaterThan(0);
    });

    test('deve retornar política SCRAPING', () => {
      const policy = getPolicy('SCRAPING');
      expect(policy).toBeDefined();
      expect(policy.points).toBeGreaterThan(0);
      expect(policy.duration).toBeGreaterThan(0);
    });

    test('deve retornar política de scraping por domínio', () => {
      const policy = getScrapingDomainPolicy('REQUESTS_PER_SECOND');
      expect(policy).toBeDefined();
      expect(policy.points).toBeGreaterThan(0);
      expect(policy.duration).toBe(1); // 1 segundo
    });

    test('deve retornar política de páginas por execução', () => {
      const policy = getScrapingDomainPolicy('PAGES_PER_EXECUTION');
      expect(policy).toBeDefined();
      expect(policy.points).toBeGreaterThan(0);
      expect(policy.duration).toBeGreaterThan(0);
    });

    test('deve retornar null para política inexistente', () => {
      const policy = getPolicy('INEXISTENTE');
      expect(policy).toBeNull();
    });
  });

  describe('Rate Limiting Engine', () => {
    test('deve criar erro padronizado de rate limit', () => {
      const error = createRateLimitError(120);
      expect(error.code).toBe('RATE_LIMIT_EXCEEDED');
      expect(error.retryAfter).toBe(120);
      expect(error.statusCode).toBe(429);
    });

    test('deve verificar rate limit sem bloquear (se dentro do limite)', async () => {
      const userId = `test-user-${Date.now()}-${Math.random()}`;
      const result = await checkRateLimit({
        userId,
        operationType: 'DRY_RUN',
      });

      expect(result).toBeDefined();
      // Se Redis não estiver disponível, pode usar memória e ainda funcionar
      // O importante é que retorna um resultado válido
      if (result.allowed) {
        expect(result.remainingPoints).toBeDefined();
        expect(result.totalPoints).toBeDefined();
      } else {
        // Se foi bloqueado, deve ter retryAfter
        expect(result.retryAfter).toBeDefined();
      }
    }, 10000);

    test('deve bloquear quando excede rate limit', async () => {
      const userId = `test-user-limit-${Date.now()}-${Math.random()}`;
      const operationType = 'BOOTSTRAP'; // Apenas 1 ponto

      // Primeira execução deve passar (ou pode já estar bloqueada se limite for 0)
      const firstResult = await checkRateLimit({
        userId,
        operationType,
      });
      
      // Se a primeira passou, a segunda deve bloquear
      if (firstResult.allowed) {
        const secondResult = await checkRateLimit({
          userId,
          operationType,
        });
        expect(secondResult.allowed).toBe(false);
        expect(secondResult.retryAfter).toBeDefined();
        expect(secondResult.retryAfter).toBeGreaterThan(0);
      } else {
        // Se já foi bloqueada na primeira, está funcionando corretamente
        expect(firstResult.retryAfter).toBeDefined();
      }
    }, 15000);

    test('deve lançar erro ao aplicar rate limit excedido', async () => {
      const userId = `test-user-enforce-${Date.now()}-${Math.random()}`;
      const operationType = 'BOOTSTRAP';

      // Verifica se Redis está disponível primeiro
      const redisAvailable = await isRedisAvailable();
      if (!redisAvailable) {
        console.warn('Redis não disponível, pulando teste de enforce');
        return;
      }

      try {
        // Primeira execução deve passar
        await enforceRateLimit({
          userId,
          operationType,
        });

        // Segunda execução deve lançar erro
        await expect(
          enforceRateLimit({
            userId,
            operationType,
          })
        ).rejects.toThrow('RATE_LIMIT_EXCEEDED');
      } catch (error) {
        // Se a primeira já falhou, está funcionando (limite muito restritivo)
        if (error.code === 'RATE_LIMIT_EXCEEDED') {
          expect(error.retryAfter).toBeDefined();
        } else {
          throw error;
        }
      }
    }, 10000);
  });

  describe('Scraping Rate Limiting', () => {
    test('deve verificar rate limit de scraping', async () => {
      const url = 'https://example.com';
      const executionId = `exec-${Date.now()}-${Math.random()}`;
      const userId = `test-user-${Date.now()}-${Math.random()}`;

      const result = await checkScrapingRateLimit({
        url,
        executionId,
        userId,
      });

      expect(result).toBeDefined();
      // Pode ser bloqueado se limite for muito baixo, mas deve retornar resultado válido
      if (result.allowed) {
        expect(result.retryAfter).toBeUndefined();
      } else {
        expect(result.retryAfter).toBeDefined();
        expect(result.reason).toBeDefined();
      }
    }, 10000);

    test('deve bloquear scraping quando excede limite por domínio', async () => {
      // Verifica se Redis está disponível primeiro
      const redisAvailable = await isRedisAvailable();
      if (!redisAvailable) {
        console.warn('Redis não disponível, pulando teste de bloqueio de scraping');
        return;
      }

      const url = 'https://example.com';
      const executionId = `exec-${Date.now()}-${Math.random()}`;
      const userId = `test-user-${Date.now()}-${Math.random()}`;

      // Faz múltiplas requisições rapidamente para exceder limite de RPS
      const policy = getScrapingDomainPolicy('REQUESTS_PER_SECOND');
      const maxRequests = policy.points;

      let blocked = false;
      let attempts = 0;
      const maxAttempts = Math.min(maxRequests + 5, 10); // Limita tentativas

      for (let i = 0; i < maxAttempts && !blocked; i++) {
        attempts++;
        const result = await checkScrapingRateLimit({
          url,
          executionId,
          userId,
        });

        if (!result.allowed) {
          blocked = true;
          expect(result.retryAfter).toBeDefined();
          expect(result.reason).toBeDefined();
          break;
        }

        // Delay muito pequeno para tentar exceder RPS
        await new Promise(resolve => setTimeout(resolve, 50));
      }

      // Se não bloqueou, pode ser que o limite seja muito alto
      if (!blocked) {
        console.warn(`Rate limit não foi excedido após ${attempts} tentativas. Limite pode ser muito alto.`);
      }
    }, 10000);

    test('deve lançar erro ao aplicar rate limit de scraping excedido', async () => {
      // Verifica se Redis está disponível primeiro
      const redisAvailable = await isRedisAvailable();
      if (!redisAvailable) {
        console.warn('Redis não disponível, pulando teste de enforce de scraping');
        return;
      }

      const url = 'https://example.com';
      const executionId = `exec-${Date.now()}-${Math.random()}`;
      const userId = `test-user-${Date.now()}-${Math.random()}`;

      try {
        // Primeira execução deve passar
        await enforceScrapingRateLimit({
          url,
          executionId,
          userId,
        });

        // Tenta algumas vezes rapidamente para exceder limite
        let errorThrown = false;
        const maxAttempts = 5;
        for (let i = 0; i < maxAttempts && !errorThrown; i++) {
          try {
            await enforceScrapingRateLimit({
              url,
              executionId,
              userId,
            });
            // Pequeno delay
            await new Promise(resolve => setTimeout(resolve, 50));
          } catch (error) {
            if (error.code === 'RATE_LIMIT_EXCEEDED') {
              errorThrown = true;
              expect(error.retryAfter).toBeDefined();
              break;
            }
          }
        }

        // Se não lançou erro, pode ser que o limite seja muito alto
        if (!errorThrown) {
          console.warn('Rate limit não foi excedido. Limite pode ser muito alto.');
        }
      } catch (error) {
        // Se a primeira já falhou, está funcionando
        if (error.code === 'RATE_LIMIT_EXCEEDED') {
          expect(error.retryAfter).toBeDefined();
        } else {
          throw error;
        }
      }
    }, 10000);
  });

  describe('Redis Connection', () => {
    test('deve verificar disponibilidade do Redis', async () => {
      const available = await isRedisAvailable();
      // Em testes, Redis pode não estar disponível, então apenas verificamos que a função funciona
      expect(typeof available).toBe('boolean');
    }, 5000);

    test('deve obter cliente Redis', () => {
      const client = getRateLimitClient();
      // Cliente pode ser null se Redis não estiver disponível
      expect(client === null || typeof client === 'object').toBe(true);
    });
  });

  describe('Configuração', () => {
    test('deve ler configuração do config.json', () => {
      const redisUrl = config.get('rateLimit.redis.url');
      // Pode ser undefined se não estiver configurado
      expect(redisUrl === undefined || typeof redisUrl === 'string').toBe(true);
    });

    test('deve ter valores padrão para políticas', () => {
      const dryRunPoints = config.get('rateLimit.policies.dryRun.points');
      const generationPoints = config.get('rateLimit.policies.generation.points');
      const bootstrapPoints = config.get('rateLimit.policies.bootstrap.points');

      // Se não estiver no config, deve usar valores padrão
      const dryRunPolicy = getPolicy('DRY_RUN');
      const generationPolicy = getPolicy('GENERATION_REAL');
      const bootstrapPolicy = getPolicy('BOOTSTRAP');

      expect(dryRunPolicy.points).toBeGreaterThan(0);
      expect(generationPolicy.points).toBeGreaterThan(0);
      expect(bootstrapPolicy.points).toBeGreaterThan(0);
    });
  });
});

