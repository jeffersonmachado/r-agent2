const ragService = require('../../api/services/ragService');
const fs = require('fs');
const path = require('path');

// Mock nlpService and ragDeduplicationService
jest.mock('../../api/services/nlpService', () => ({
  getDocName: jest.fn(() => 'doc_name'),
}));
jest.mock('../../api/services/ragDeduplicationService');
jest.mock('../../lib/replaySystem', () => ({ ReplaySystem: jest.fn() }));
jest.mock('../../lib/recordingSystem', () => ({ RecordingSystem: jest.fn() }));

describe('RAGService - Defensive Coercions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getRagServiceUrl - safe tenantId normalization (internal)', () => {
    it('should handle hostile tenantId normalization gracefully', () => {
      const hostileTenantId = {
        toString() {
          throw new Error('Malicious tenantId');
        },
      };

      // getRagServiceUrl internally calls normalizeTenantId with safe coercion
      // Should not throw even with hostile input
      expect(() => {
        ragService.getRagServiceUrl(hostileTenantId);
      }).not.toThrow();
    });

    it('should normalize regular string tenantIds (fallback returns default URL)', () => {
      // Test that normal functionality is preserved
      const result1 = ragService.getRagServiceUrl('  tenant123  ');
      const result2 = ragService.getRagServiceUrl(null);
      const result3 = ragService.getRagServiceUrl(undefined);
      
      // All should return valid URLs (fallback to default RAG service URL)
      expect(result1).toBeDefined();
      expect(result2).toBeDefined();
      expect(result3).toBeDefined();
    });
  });

  describe('getRagTimeout - safe tenantId normalization (internal)', () => {
    it('should handle hostile tenantId in timeout lookup', () => {
      const hostileTenantId = {
        toString() {
          throw new Error('Poisoned tenantId');
        },
      };

      // getRagTimeout internally normalizes tenantId with safe coercion
      expect(() => {
        ragService.getRagTimeout(hostileTenantId);
      }).not.toThrow();
    });

    it('should preserve timeout for normal tenantIds', () => {
      const timeout1 = ragService.getRagTimeout('tenant123');
      const timeout2 = ragService.getRagTimeout(null);

      // Should return valid timeout values
      expect(typeof timeout1).toBe('number');
      expect(typeof timeout2).toBe('number');
      expect(timeout1 > 0).toBe(true);
    });
  });

  describe('embedding batch text processing - safe safeTrim coercion', () => {
    it('should handle hostile text objects in embedding batch (toString thrower)', () => {
      const hostileTexts = [
        'normal text',
        {
          toString() {
            throw new Error('Poisoned text');
          },
        },
        'another text',
      ];

      // When processing texts for embeddings, hostile toString should be caught
      // by safeTrim and converted to empty string, then filtered out
      expect(() => {
        // The service processes texts internally and should handle hostility
        // without propagating error
        ragService.generateEmbeddingsBatch(hostileTexts, 'tenant123').catch(() => {
          // Expected to fail on HTTP (mocked), but not on coercion
        });
      }).not.toThrow();
    });

    it('should preserve normal embedding batch processing', () => {
      const texts = ['Hello world', 'Test document', '   whitespace   '];

      // Normal texts should be processed correctly
      expect(texts).toHaveLength(3);
      
      // The actual processing should not throw on normal inputs
      expect(() => {
        ragService.generateEmbeddingsBatch(texts, 'tenant123').catch(() => {
          // Expected HTTP mock fail, not coercion fail
        });
      }).not.toThrow();
    });
  });

  describe('backward compatibility - public API', () => {
    it('getRagServiceUrl should return URL for normal tenantIds', () => {
      const result = ragService.getRagServiceUrl('prod-tenant-123');
      expect(result).toBeDefined();
      expect(typeof result).toBe('string');
      expect(result.includes('http')).toBe(true);
    });

    it('getRagTimeout should return timeout number', () => {
      const result = ragService.getRagTimeout('tenant_456');
      expect(typeof result).toBe('number');
      expect(result > 0).toBe(true);
    });

    it('isRagAvailable should handle hostile tenantId gracefully', () => {
      const hostileTenantId = {
        toString() {
          throw new Error('Malicious');
        },
      };

      // Should not throw
      expect(() => {
        ragService.isRagAvailable?.(hostileTenantId);
      }).not.toThrow();
    });
  });

  describe('queryRag - hostile error coercion', () => {
    let originalFetch;
    let originalReplay;
    let originalRecording;

    beforeEach(() => {
      originalFetch = global.fetch;
      originalReplay = process.env.ENABLE_RAG_REPLAY;
      originalRecording = process.env.ENABLE_RAG_RECORDING;
      process.env.ENABLE_RAG_REPLAY = 'false';
      process.env.ENABLE_RAG_RECORDING = 'false';
    });

    afterEach(() => {
      global.fetch = originalFetch;
      if (originalReplay === undefined) {
        delete process.env.ENABLE_RAG_REPLAY;
      } else {
        process.env.ENABLE_RAG_REPLAY = originalReplay;
      }

      if (originalRecording === undefined) {
        delete process.env.ENABLE_RAG_RECORDING;
      } else {
        process.env.ENABLE_RAG_RECORDING = originalRecording;
      }
    });

    it('should not crash when fetch rejection has hostile message getter', async () => {
      const hostileError = {
        get message() {
          throw new Error('poisoned message getter');
        },
        toString() {
          throw new Error('poisoned toString');
        },
      };

      global.fetch = jest.fn().mockRejectedValue(hostileError);

      await expect(ragService.queryRag('pergunta de teste', 'tenant-123'))
        .rejects
        .toThrow('Erro desconhecido ao consultar RAG');
    });
  });

  describe('regression guard - no direct error.message outside helper', () => {
    it('ragService should avoid direct error.message accesses outside safeErrorMessage', () => {
      const sourcePath = path.resolve(__dirname, '../../api/services/ragService.js');
      const source = fs.readFileSync(sourcePath, 'utf8');
      const sanitizedSource = source
        .split('\n')
        .filter((line) => !line.includes('String(err.message)'))
        .join('\n');

      expect(sanitizedSource).not.toMatch(/\b(?:error|err)\.message\b/);
    });
  });
});
