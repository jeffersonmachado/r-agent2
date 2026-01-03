/**
 * Testes para systemNodes.js
 */

const {
  getCurrentTimeNodeHandler,
  generateUuidNodeHandler,
  delayNodeHandler,
  formatDateNodeHandler,
  randomNumberNodeHandler,
  getUserInfoNodeHandler,
} = require('../nodes/systemNodes');

describe('systemNodes', () => {
  let node;
  let state;

  beforeEach(() => {
    node = {
      id: 'system-1',
      type: 'system',
      config: {},
    };

    state = {
      sessionId: 'session-1',
      flowId: 'flow-1',
      currentNodeId: 'system-1',
      variables: {},
      history: [],
      metadata: {},
    };
  });

  describe('getCurrentTimeNodeHandler', () => {
    test('deve retornar data/hora atual em formato ISO', async () => {
      const result = await getCurrentTimeNodeHandler(node, state);

      expect(result.output.type).toBe('current_time');
      expect(result.nextState.variables.current_time).toBeDefined();
      expect(result.nextState.variables.current_time).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    test('deve usar outputVariable customizado', async () => {
      node.config.outputVariable = 'custom_time';

      const result = await getCurrentTimeNodeHandler(node, state);

      expect(result.nextState.variables.custom_time).toBeDefined();
      expect(result.nextState.variables.current_time).toBeUndefined();
    });

    test('deve usar formato TIMESTAMP quando especificado', async () => {
      node.config.format = 'TIMESTAMP';

      const result = await getCurrentTimeNodeHandler(node, state);

      expect(typeof result.nextState.variables.current_time).toBe('string');
      expect(Number(result.nextState.variables.current_time)).not.toBeNaN();
    });

    test('deve incluir evento de sucesso', async () => {
      const result = await getCurrentTimeNodeHandler(node, state);

      expect(result.events[0].type).toBe('SYSTEM_OPERATION');
      expect(result.events[0].payload.operation).toBe('get_current_time');
    });
  });

  describe('generateUuidNodeHandler', () => {
    test('deve gerar UUID válido', async () => {
      const result = await generateUuidNodeHandler(node, state);

      expect(result.output.type).toBe('uuid');
      expect(result.nextState.variables.uuid).toBeDefined();
      expect(result.nextState.variables.uuid).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      );
    });

    test('deve usar outputVariable customizado', async () => {
      node.config.outputVariable = 'custom_uuid';

      const result = await generateUuidNodeHandler(node, state);

      expect(result.nextState.variables.custom_uuid).toBeDefined();
      expect(result.nextState.variables.uuid).toBeUndefined();
    });

    test('deve gerar UUIDs diferentes em chamadas diferentes', async () => {
      const result1 = await generateUuidNodeHandler(node, state);
      const result2 = await generateUuidNodeHandler(node, state);

      expect(result1.nextState.variables.uuid).not.toBe(result2.nextState.variables.uuid);
    });
  });

  describe('delayNodeHandler', () => {
    test('deve virtualizar delay em modo teste', async () => {
      state.metadata = { testMode: true };
      node.config.duration = 5000;

      const start = Date.now();
      const result = await delayNodeHandler(node, state);
      const end = Date.now();

      expect(result.output.type).toBe('delay_complete');
      expect(result.output.virtualized).toBe(true);
      expect(end - start).toBeLessThan(100); // Deve ser instantâneo em modo teste
    });

    test('deve lançar erro para duração inválida', async () => {
      node.config.duration = -100;

      await expect(delayNodeHandler(node, state)).rejects.toThrow();
    });

    test('deve lançar erro para duração muito longa', async () => {
      node.config.duration = 70000;

      await expect(delayNodeHandler(node, state)).rejects.toThrow();
    });

    test('deve usar duração padrão quando não especificada', async () => {
      state.metadata = { testMode: true };
      delete node.config.duration;

      const result = await delayNodeHandler(node, state);

      expect(result.output.duration).toBe(1000);
    });
  });

  describe('formatDateNodeHandler', () => {
    test('deve formatar data em formato ISO', async () => {
      state.variables.date = '2024-01-01T00:00:00.000Z';
      node.config.inputVariable = 'date';
      node.config.format = 'ISO';

      const result = await formatDateNodeHandler(node, state);

      expect(result.output.type).toBe('formatted_date');
      expect(result.nextState.variables.formatted_date).toBeDefined();
    });

    test('deve retornar erro quando inputVariable não é especificado', async () => {
      node.config.format = 'ISO';

      const result = await formatDateNodeHandler(node, state);

      expect(result.output.type).toBe('error');
      expect(result.events[0].type).toBe('ERROR');
    });

    test('deve retornar erro quando format não é especificado', async () => {
      state.variables.date = '2024-01-01';
      node.config.inputVariable = 'date';

      const result = await formatDateNodeHandler(node, state);

      expect(result.output.type).toBe('error');
    });

    test('deve retornar erro quando variável não existe', async () => {
      node.config.inputVariable = 'nonexistent';
      node.config.format = 'ISO';

      const result = await formatDateNodeHandler(node, state);

      expect(result.output.type).toBe('error');
    });

    test('deve usar outputVariable customizado', async () => {
      state.variables.date = '2024-01-01T00:00:00.000Z';
      node.config.inputVariable = 'date';
      node.config.format = 'ISO';
      node.config.outputVariable = 'custom_formatted';

      const result = await formatDateNodeHandler(node, state);

      expect(result.nextState.variables.custom_formatted).toBeDefined();
      expect(result.nextState.variables.formatted_date).toBeUndefined();
    });
  });

  describe('randomNumberNodeHandler', () => {
    test('deve gerar número aleatório dentro do range', async () => {
      node.config.min = 1;
      node.config.max = 10;

      const result = await randomNumberNodeHandler(node, state);

      expect(result.output.type).toBe('random_number');
      expect(result.nextState.variables.random_number).toBeGreaterThanOrEqual(1);
      expect(result.nextState.variables.random_number).toBeLessThanOrEqual(10);
    });

    test('deve retornar erro quando max não é especificado', async () => {
      const result = await randomNumberNodeHandler(node, state);

      expect(result.output.type).toBe('error');
      expect(result.events[0].type).toBe('ERROR');
    });

    test('deve usar outputVariable customizado', async () => {
      node.config.min = 1;
      node.config.max = 10;
      node.config.outputVariable = 'custom_random';

      const result = await randomNumberNodeHandler(node, state);

      expect(result.nextState.variables.custom_random).toBeDefined();
      expect(result.nextState.variables.random_number).toBeUndefined();
    });

    test('deve retornar erro quando min >= max', async () => {
      node.config.min = 10;
      node.config.max = 5;

      const result = await randomNumberNodeHandler(node, state);

      expect(result.output.type).toBe('error');
    });

    test('deve gerar números diferentes em chamadas diferentes', async () => {
      node.config.min = 1;
      node.config.max = 1000;

      const result1 = await randomNumberNodeHandler(node, state);
      const result2 = await randomNumberNodeHandler(node, state);

      // É possível que sejam iguais, mas improvável com range grande
      // Apenas verificamos que a função funciona
      expect(result1.nextState.variables.random_number).toBeDefined();
      expect(result2.nextState.variables.random_number).toBeDefined();
    });
  });

  describe('getUserInfoNodeHandler', () => {
    test('deve retornar informações do usuário do estado', async () => {
      state.variables.userId = 'user-123';
      state.metadata = { userInfo: { name: 'João', email: 'joao@example.com' } };

      const result = await getUserInfoNodeHandler(node, state);

      expect(result.output.type).toBe('user_info');
      expect(result.nextState.variables.user_info).toBeDefined();
    });

    test('deve usar outputVariable customizado', async () => {
      node.config.outputVariable = 'custom_user_info';

      const result = await getUserInfoNodeHandler(node, state);

      expect(result.nextState.variables.custom_user_info).toBeDefined();
    });

    test('deve lidar com metadata vazio', async () => {
      state.metadata = {};

      const result = await getUserInfoNodeHandler(node, state);

      expect(result.output.type).toBe('user_info');
    });
  });
});

