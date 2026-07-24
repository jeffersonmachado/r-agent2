'use strict';

const { anonymize } = require('../../src/core/learning/anonymizer');

describe('learning-core anonymizer', () => {
  test('mascara valores de chaves sensiveis independente do conteudo', () => {
    const { value, stats } = anonymize({
      nome: 'Maria Silva',
      email: 'qualquer coisa',
      telefone: 'nao e telefone',
      password: '123',
    });
    expect(value.nome).toBe('[nome]');
    expect(value.email).toBe('[email]');
    expect(value.telefone).toBe('[telefone]');
    expect(value.password).toBe('[credencial]');
    expect(stats.redactions).toBe(4);
  });

  test('mascara padroes em strings livres (email, cpf, telefone, cartao)', () => {
    const { value } = anonymize({
      texto: 'Contato: joao@empresa.com.br, cpf 123.456.789-09, tel (11) 98765-4321, cartao 4111 1111 1111 1111',
    });
    expect(value.texto).not.toContain('joao@empresa.com.br');
    expect(value.texto).not.toContain('123.456.789-09');
    expect(value.texto).not.toContain('4111 1111 1111 1111');
    expect(value.texto).toContain('[email]');
    expect(value.texto).toContain('[documento]');
    expect(value.texto).toContain('[cartao]');
  });

  test('mascara cnpj e jwt', () => {
    const { value } = anonymize({
      doc: 'CNPJ 12.345.678/0001-90',
      auth: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c',
    });
    expect(value.doc).toBe('CNPJ [documento]');
    expect(value.auth).toBe('[credencial]');
  });

  test('nao mascara digitos embutidos em identificadores tecnicos (falso positivo de telefone)', () => {
    const { value } = anonymize({
      replayId: 'qa_wave_replay_1784863794036_b4on3c',
      iso: '2026-07-24T03:29:54.036Z',
      executionId: 'meshq-1784863794036-29uua8',
      telefoneSolto: 'ligue para (11) 98765-4321 amanha',
    });
    expect(value.replayId).toBe('qa_wave_replay_1784863794036_b4on3c');
    expect(value.iso).toBe('2026-07-24T03:29:54.036Z');
    expect(value.executionId).toBe('meshq-1784863794036-29uua8');
    expect(value.telefoneSolto).toBe('ligue para [telefone] amanha');
  });

  test('adversarial: estruturas aninhadas, arrays e casing misto de chaves', () => {
    const input = {
      customer: {
        Nome: 'Carlos',
        contacts: [
          { EMAIL: 'a@b.com', phone: '11999998888' },
          ['nested@array.com'],
        ],
      },
      items: [{ value: 'sem pii' }],
    };
    const { value, stats } = anonymize(input);
    expect(value.customer.Nome).toBe('[nome]');
    expect(value.customer.contacts[0].EMAIL).toBe('[email]');
    expect(value.customer.contacts[0].phone).toBe('[telefone]');
    expect(value.customer.contacts[1][0]).toBe('[email]');
    expect(value.items[0].value).toBe('sem pii');
    expect(stats.redactions).toBeGreaterThanOrEqual(4);
  });

  test('adversarial: tipos nao-string preservados; null/undefined intactos', () => {
    const { value } = anonymize({ numero: 42, ativo: true, nada: null, lista: [1, 2] });
    expect(value).toEqual({ numero: 42, ativo: true, nada: null, lista: [1, 2] });
  });

  test('adversarial: replay RPA real sanitizado por completo (0 PII residual)', () => {
    const replay = {
      id: 'login-flow-1',
      actions: [
        { type: 'fill', selector: 'input[type="text"]', value: 'systemadmin', step: 'fill-username' },
        { type: 'fill', selector: 'input[type="password"]', value: 'Admin123!', step: 'fill-password' },
        { type: 'fill', selector: 'input[name="email"]', value: 'maria.silva@gmail.com', step: 'fill-email' },
        { type: 'navigate', value: { url: 'http://localhost:5173/login?next=/inbox' } },
      ],
      metadata: { tenantId: null, usuario: 'joao' },
    };
    const { value, stats } = anonymize(replay);
    const serialized = JSON.stringify(value);
    expect(serialized).not.toContain('systemadmin');
    expect(serialized).not.toContain('Admin123!');
    expect(serialized).not.toContain('maria.silva@gmail.com');
    expect(serialized).not.toContain('joao');
    // estrutura preservada
    expect(value.actions).toHaveLength(4);
    expect(value.actions[3].value.url).toContain('localhost:5173');
    expect(stats.redactions).toBeGreaterThanOrEqual(4);
  });

  test('idempotente: anonimizar duas vezes nao altera o resultado', () => {
    const once = anonymize({ email: 'a@b.com', texto: 'cpf 123.456.789-09' });
    const twice = anonymize(once.value);
    expect(twice.value).toEqual(once.value);
  });
});
