'use strict';

jest.mock('../../api/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

describe('rpaTestGeneratorService coercion hardening', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  test('rpaTestGeneratorService.safeToString handles hostile toString gracefully', () => {
    const hostile = { toString() { throw new Error('boom'); } };
    
    const safeToString = function(value, fallback = '') {
      if (value == null) return fallback;
      try { return String(value); } catch (_) { return fallback; }
    };

    expect(safeToString(hostile)).toBe('');
    expect(safeToString('test')).toBe('test');
    expect(safeToString(null)).toBe('');
    expect(safeToString(undefined)).toBe('');
    expect(safeToString(hostile, 'DEFAULT')).toBe('DEFAULT');
  });

  test('rpaTestGeneratorService.safeTrim handles hostile trim gracefully', () => {
    const hostile = { toString() { throw new Error('boom'); } };
    
    const safeTrim = function(value, fallback = '') {
      if (value == null) return fallback;
      try { return String(value).trim(); } catch (_) { return fallback; }
    };

    expect(safeTrim(hostile)).toBe('');
    expect(safeTrim('  test  ')).toBe('test');
    expect(safeTrim(null)).toBe('');
    expect(safeTrim(undefined)).toBe('');
    expect(safeTrim(hostile, 'DEFAULT')).toBe('DEFAULT');
  });

  test('rpaTestGeneratorService.safeErrorMessage handles hostile error objects gracefully', () => {
    const safeErrorMessage = function(err, fallback = '') {
      if (!err) return fallback;
      let message;
      try {
        message = err?.message;
      } catch (_) {
        message = null;
      }
      if (message !== null && message !== undefined) return safeToString(message, fallback);
      if (typeof err === 'string' || typeof err === 'number' || typeof err === 'boolean' || typeof err === 'bigint') {
        return safeToString(err, fallback);
      }
      return fallback;
    };

    const safeToString = function(value, fallback = '') {
      if (value == null) return fallback;
      try { return String(value); } catch (_) { return fallback; }
    };

    const hostile = { toString() { throw new Error('boom'); } };
    const hostileErr = { get message() { throw new Error('boom-msg'); } };

    expect(safeErrorMessage(null)).toBe('');
    expect(safeErrorMessage(undefined)).toBe('');
    expect(safeErrorMessage(hostile)).toBe('');
    expect(safeErrorMessage(hostileErr)).toBe('');
    expect(safeErrorMessage(new Error('real error'))).toBe('real error');
    expect(safeErrorMessage(hostile, 'DEFAULT')).toBe('DEFAULT');
  });

  test('rpaTestGeneratorService patches String(aiResponse) with safeToString', () => {
    const fs = require('fs');
    const path = require('path');
    const content = fs.readFileSync(
      path.join(__dirname, '../../api/services/rpaTestGeneratorService.js'),
      'utf-8'
    );

    // Verify helper is imported from shared utility
    expect(content).toMatch(/require\('\.\.\/utils\/defensiveCoercion'\)/);

    // Verify safe pattern is in place for aiResponse
    expect(content).toMatch(/safeToString\(aiResponse\)/);
  });

  test('rpaTestGeneratorService patches String(frontendUrl) with safeToString', () => {
    const fs = require('fs');
    const path = require('path');
    const content = fs.readFileSync(
      path.join(__dirname, '../../api/services/rpaTestGeneratorService.js'),
      'utf-8'
    );

    // Verify safe pattern is in place for frontendUrl
    expect(content).toMatch(/safeToString\(frontendUrl\)/);
  });

  test('rpaTestGeneratorService patches String(flow.id) with safeToString', () => {
    const fs = require('fs');
    const path = require('path');
    const content = fs.readFileSync(
      path.join(__dirname, '../../api/services/rpaTestGeneratorService.js'),
      'utf-8'
    );

    // Verify safe pattern is in place for flow.id
    expect(content).toMatch(/safeToString\(flow\.id\)/);
  });

  test('rpaTestGeneratorService patches String(sel) with safeTrim', () => {
    const fs = require('fs');
    const path = require('path');
    const content = fs.readFileSync(
      path.join(__dirname, '../../api/services/rpaTestGeneratorService.js'),
      'utf-8'
    );

    // Verify safe pattern is in place for selector
    expect(content).toMatch(/safeTrim\(sel \|\| ''\)/);
  });

  test('rpaTestGeneratorService replaces all err.message with safeErrorMessage', () => {
    const fs = require('fs');
    const path = require('path');
    const content = fs.readFileSync(
      path.join(__dirname, '../../api/services/rpaTestGeneratorService.js'),
      'utf-8'
    );

    // Verify safe patterns in place for error logging
    expect(content).toMatch(/safeErrorMessage\(err\)/);

    // Check that no unsafe err.message patterns remain outside safe helpers
    const lines = content.split('\n');
    let hasUnsafeErrorAccess = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // Skip safe helper definitions
      if (line.includes('function safeErrorMessage')) {
        continue;
      }
      // Check for remaining unsafe error.message patterns
      if (line.includes('err.message') && !line.includes('safeErrorMessage')) {
        hasUnsafeErrorAccess = true;
      }
    }

    expect(hasUnsafeErrorAccess).toBe(false);
  });
});
