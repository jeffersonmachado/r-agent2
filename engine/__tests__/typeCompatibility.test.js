/**
 * Testes para typeCompatibility.js
 */

const { TYPE_COMPATIBILITY } = require('../utils/typeCompatibility');

describe('typeCompatibility', () => {
  describe('TYPE_COMPATIBILITY', () => {
    test('deve ter compatibilidade definida para start', () => {
      expect(TYPE_COMPATIBILITY.start).toBeDefined();
      expect(Array.isArray(TYPE_COMPATIBILITY.start)).toBe(true);
      expect(TYPE_COMPATIBILITY.start.length).toBeGreaterThan(0);
    });

    test('deve ter compatibilidade definida para message', () => {
      expect(TYPE_COMPATIBILITY.message).toBeDefined();
      expect(Array.isArray(TYPE_COMPATIBILITY.message)).toBe(true);
    });

    test('deve ter compatibilidade definida para user_input', () => {
      expect(TYPE_COMPATIBILITY.user_input).toBeDefined();
      expect(Array.isArray(TYPE_COMPATIBILITY.user_input)).toBe(true);
    });

    test('deve ter compatibilidade definida para router', () => {
      expect(TYPE_COMPATIBILITY.router).toBeDefined();
      expect(Array.isArray(TYPE_COMPATIBILITY.router)).toBe(true);
    });

    test('deve ter compatibilidade definida para end', () => {
      expect(TYPE_COMPATIBILITY.end).toBeDefined();
      expect(Array.isArray(TYPE_COMPATIBILITY.end)).toBe(true);
      expect(TYPE_COMPATIBILITY.end.length).toBe(0); // end não pode ter próximos nós
    });

    test('deve ter compatibilidade definida para handoff', () => {
      expect(TYPE_COMPATIBILITY.handoff).toBeDefined();
      expect(Array.isArray(TYPE_COMPATIBILITY.handoff)).toBe(true);
      expect(TYPE_COMPATIBILITY.handoff).toContain('end');
    });

    test('deve permitir que start conecte para message', () => {
      expect(TYPE_COMPATIBILITY.start).toContain('message');
    });

    test('deve permitir que message conecte para user_input', () => {
      expect(TYPE_COMPATIBILITY.message).toContain('user_input');
    });

    test('deve permitir que user_input conecte para router', () => {
      expect(TYPE_COMPATIBILITY.user_input).toContain('router');
    });

    test('deve permitir que router conecte para message', () => {
      expect(TYPE_COMPATIBILITY.router).toContain('message');
    });

    test('deve incluir nós de sistema nas compatibilidades', () => {
      const systemNodes = [
        'get_flow_info',
        'get_queue_status',
        'get_config_value',
        'get_current_time',
        'generate_uuid',
      ];

      systemNodes.forEach(nodeType => {
        expect(TYPE_COMPATIBILITY.start).toContain(nodeType);
        expect(TYPE_COMPATIBILITY.message).toContain(nodeType);
      });
    });

    test('deve permitir que ai conecte para message', () => {
      expect(TYPE_COMPATIBILITY.ai).toContain('message');
    });

    test('deve permitir que ai_task conecte para message', () => {
      expect(TYPE_COMPATIBILITY.ai_task).toContain('message');
    });

    test('deve permitir que set_variable conecte para message', () => {
      expect(TYPE_COMPATIBILITY.set_variable).toContain('message');
    });
  });
});

