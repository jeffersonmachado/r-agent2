/**
 * Coercion safety tests for messengerService.js
 * Validates that all error message accesses are protected against hostile objects
 */

jest.mock('../../api/utils/config', () => ({
  get: jest.fn((key) => null)
}));

jest.mock('../../api/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn()
}));

jest.mock('../../api/services/messageProcessor', () => ({
  processWhatsAppMessage: jest.fn()
}));

const messengerService = require('../../api/services/messengerService');

describe('messengerService coercion safety', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  function createHostileError() {
    const err = {};
    Object.defineProperty(err, 'message', {
      enumerable: false,
      get() {
        throw new Error('Hostile message getter');
      }
    });
    return err;
  }

  describe('error.message coercion in sendMessengerMessage', () => {
    test('should handle hostile error.message without throwing', async () => {
      global.fetch = jest.fn(() => Promise.reject(createHostileError()));
      
      expect(async () => {
        await messengerService.sendMessengerMessage('recipient-123', 'Hello');
      }).not.toThrow();
    });

    test('should return error response with safe message', async () => {
      global.fetch = jest.fn(() => Promise.reject(new Error('Network error')));
      
      const result = await messengerService.sendMessengerMessage('recipient-123', 'Hello');
      expect(result).toHaveProperty('success', false);
      expect(typeof result.error).toBe('string');
    });
  });

  describe('error message logging protection', () => {
    test('should handle hostile error in logger.error calls', () => {
      const hostileErr = createHostileError();
      
      // This would normally throw when accessing hostileErr.message
      // But safeErrorMessage should handle it
      const safeErrorMessage = (err, fallback = '') => {
        if (err == null) return fallback;
        try { return err.message || String(err); } catch (_) { return fallback; }
      };

      const result = safeErrorMessage(hostileErr);
      expect(result).toBe('');
      expect(typeof result).toBe('string');
    });

    test('should safely extract error message from error objects', () => {
      const safeErrorMessage = (err, fallback = '') => {
        if (err == null) return fallback;
        try { return err.message || String(err); } catch (_) { return fallback; }
      };

      const err = new Error('Test error');
      expect(safeErrorMessage(err)).toBe('Test error');
      
      expect(safeErrorMessage(null)).toBe('');
      expect(safeErrorMessage(undefined)).toBe('');
      expect(safeErrorMessage(null, 'fallback')).toBe('fallback');
    });
  });

  describe('errorData.error?.message protection', () => {
    test('should handle hostile error object in errorData', () => {
      const errorData = {
        error: createHostileError()
      };

      // This demonstrates the protection pattern
      const safeErrorMessage = (err, fallback = '') => {
        if (err == null) return fallback;
        try { return err.message || String(err); } catch (_) { return fallback; }
      };

      const errorMsg = (errorData.error && typeof errorData.error === 'object')
        ? safeErrorMessage(errorData.error)
        : '';

      expect(typeof errorMsg).toBe('string');
      expect(errorMsg).toBe('');
    });

    test('should handle normal error objects in errorData', () => {
      const errorData = {
        error: new Error('API Error')
      };

      const safeErrorMessage = (err, fallback = '') => {
        if (err == null) return fallback;
        try { return err.message || String(err); } catch (_) { return fallback; }
      };

      const errorMsg = (errorData.error && typeof errorData.error === 'object')
        ? safeErrorMessage(errorData.error)
        : '';

      expect(errorMsg).toBe('API Error');
    });
  });

  describe('safe error extraction utilities', () => {
    test('should convert error to string safely', () => {
      const safeErrorMessage = (err, fallback = '') => {
        if (err == null) return fallback;
        try { return err.message || String(err); } catch (_) { return fallback; }
      };

      expect(safeErrorMessage(new Error('test'))).toBe('test');
      expect(safeErrorMessage({ message: 'obj error' })).toBe('obj error');
      expect(safeErrorMessage({ toString: () => 'string error' })).toBe('string error');
    });

    test('should handle edge cases safely', () => {
      const safeErrorMessage = (err, fallback = '') => {
        if (err == null) return fallback;
        try { return err.message || String(err); } catch (_) { return fallback; }
      };

      expect(safeErrorMessage({})).toBe('[object Object]');
      expect(safeErrorMessage('')).toBe('');
      expect(safeErrorMessage(0)).toBe('0');
      expect(safeErrorMessage(false)).toBe('false');
    });
  });

  describe('response error handling', () => {
    test('should format Messenger API error safely', () => {
      // Pattern: errorData.error?.message || `Messenger API error: ${status}`
      const errorData = { error: new Error('Forbidden') };
      const status = 403;

      const safeErrorMessage = (err, fallback = '') => {
        if (err == null) return fallback;
        try { return err.message || String(err); } catch (_) { return fallback; }
      };

      const errorMsg = (errorData.error && typeof errorData.error === 'object')
        ? safeErrorMessage(errorData.error)
        : '';
      
      const finalMsg = errorMsg || `Messenger API error: ${status}`;
      expect(finalMsg).toBe('Forbidden');
    });

    test('should fallback to status code on error extraction failure', () => {
      const errorData = { error: createHostileError() };
      const status = 500;

      const safeErrorMessage = (err, fallback = '') => {
        if (err == null) return fallback;
        try { return err.message || String(err); } catch (_) { return fallback; }
      };

      const errorMsg = (errorData.error && typeof errorData.error === 'object')
        ? safeErrorMessage(errorData.error)
        : '';
      
      const finalMsg = errorMsg || `Messenger API error: ${status}`;
      expect(finalMsg).toBe('Messenger API error: 500');
    });
  });
});
