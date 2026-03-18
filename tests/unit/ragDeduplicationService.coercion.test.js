'use strict';

const fs = require('fs');
const path = require('path');

jest.mock('../../api/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

describe('ragDeduplicationService coercion hardening', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  test('checkSemanticDuplicate tolerates hostile error.message getter from cosineSimilarity', async () => {
    const hostileError = {
      get message() {
        throw new Error('poisoned message getter');
      },
      toString() {
        throw new Error('poisoned toString');
      },
    };

    jest.doMock('../../api/utils/contentNormalization', () => ({
      normalizeContent: jest.fn((value) => String(value || '')),
      generateContentHash: jest.fn(async () => 'content-hash'),
      generateContentHashSync: jest.fn(() => 'content-hash'),
      generateChunkId: jest.fn(() => 'chunk-generated'),
      generateSemanticHash: jest.fn(() => 'semantic-hash'),
      normalizeEmbedding: jest.fn((embedding) => embedding),
      cosineSimilarity: jest.fn(() => {
        throw hostileError;
      }),
    }));

    const svc = require('../../api/services/ragDeduplicationService');
    svc.clearTenantIndices('tenant-1');
    svc.registerChunk('tenant-1', {
      chunk_id: 'chunk-1',
      document_id: 'doc-1',
      source_id: 'src-1',
      source_version: 1,
      content_hash: 'content-hash-1',
      semantic_hash: 'semantic-hash-1',
      active: true,
    }, [0.1, 0.2]);

    const out = await svc.checkSemanticDuplicate('tenant-1', [0.2, 0.3], 'semantic-hash-2', 'src-2');

    expect(out).toEqual({ isDuplicate: false, similarity: 0 });
  });

  test('static guard: no direct err/error.message outside helper', () => {
    const sourcePath = path.resolve(__dirname, '../../api/services/ragDeduplicationService.js');
    const source = fs.readFileSync(sourcePath, 'utf8');

    expect(source).not.toMatch(/\b(?:error|err)\.message\b/);
  });
});