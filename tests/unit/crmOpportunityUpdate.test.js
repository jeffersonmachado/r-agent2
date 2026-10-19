'use strict';

/**
 * P1 (auditoria 2026-10-19) — EDIÇÃO DE OPORTUNIDADE NÃO PODE CRIAR DUPLICATA.
 *
 * Defeito reproduzido: o formulário de edição montava o payload SEM `id` e o
 * backend só tinha `POST /api/crm/opportunities` (que gera id novo quando o corpo
 * não traz um). Editar virava criar.
 *
 * Correção: `PUT/PATCH /api/crm/opportunities/:id` exige registro existente,
 * valida tenant e permissão, preserva o id, rejeita id divergente e NUNCA cria.
 */

const express = require('express');
const http = require('http');

jest.mock('../../api/services/websocketService', () => ({
  emitEvent: () => {},
  broadcastToTenant: () => {},
  broadcastToExecution: () => {},
}));

function criarModeloFake() {
  const linhas = new Map();
  const materializar = (dados) => {
    const registro = { ...dados };
    registro.toJSON = () => ({ ...registro });
    registro.update = async (novo) => { Object.assign(registro, novo); linhas.set(registro.id, registro); };
    return registro;
  };
  const casa = (registro, where) => Object.entries(where).every(([campo, valor]) => registro[campo] === valor);
  return {
    __linhas: linhas,
    async findAndCountAll({ where, limit = 20, offset = 0 } = {}) {
      const itens = [...linhas.values()].filter((r) => casa(r, where));
      return { rows: itens.slice(offset, offset + limit), count: itens.length };
    },
    async findOne({ where } = {}) {
      return [...linhas.values()].find((r) => casa(r, where)) || null;
    },
    async create(dados) { const r = materializar(dados); linhas.set(r.id, r); return r; },
    // `Model.update` estático, como no Sequelize real: aplica em TODAS as linhas
    // que casam com o WHERE (inclusive tenant_key) e devolve [afetados].
    async update(dados, { where } = {}) {
      let afetados = 0;
      for (const r of linhas.values()) {
        if (casa(r, where)) { Object.assign(r, dados); afetados += 1; }
      }
      return [afetados];
    },
    async upsert() {
      // O código de produção NÃO PODE usar upsert (P0-02). Se voltar, o teste
      // falha aqui em vez de passar silenciosamente.
      throw new Error('upsert proibido no CRM (P0-02)');
    },
    async destroy({ where } = {}) {
      let n = 0;
      for (const [id, r] of [...linhas.entries()]) if (casa(r, where)) { linhas.delete(id); n += 1; }
      return n;
    },
  };
}

const mockRegistros = criarModeloFake();
const mockPessoas = criarModeloFake();

jest.mock('../../api/db/models', () => ({
  get CrmRecord() { return () => mockRegistros; },
  get MarketingLead() { return () => mockPessoas; },
}));

const { createCrmRoutes } = require('../../api/modules/crm/routes');

const permissoes = { allowed: true };
let tenantAtual = 'tenant-a';

function buildDeps() {
  return {
    requireAuth: () => ({ valid: true }),
    requireTenant: () => tenantAtual,
    requirePermission: () => permissoes,
    sendJson: (res, status, body) => { res.status(status).json(body); },
    badRequest: (res, message) => { res.status(400).json({ error: 'bad_request', message }); },
    parseJsonBody: async (req) => {
      const partes = [];
      for await (const p of req) partes.push(p);
      return JSON.parse(Buffer.concat(partes).toString('utf8') || '{}');
    },
  };
}

let servidor;
let base;

beforeAll(async () => {
  const app = express();
  app.use(createCrmRoutes({ buildDeps }));
  servidor = http.createServer(app);
  await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${servidor.address().port}`;
});

afterAll(() => new Promise((r) => servidor.close(r)));

beforeEach(() => {
  mockRegistros.__linhas.clear();
  mockPessoas.__linhas.clear();
  permissoes.allowed = true;
  tenantAtual = 'tenant-a';
});

async function req(metodo, caminho, corpo) {
  const resp = await fetch(`${base}${caminho}`, {
    method: metodo,
    headers: { 'Content-Type': 'application/json' },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  const texto = await resp.text();
  return { status: resp.status, json: texto ? JSON.parse(texto) : null };
}

async function criarOportunidade(extra = {}) {
  return req('POST', '/api/crm/opportunities', { name: 'Venda Original', pipelineId: 'p1', stageId: 's1', value: 100, ...extra });
}

describe('P1 edição de oportunidade — nunca cria registro novo', () => {
  test('PUT atualiza o mesmo registro e a quantidade NÃO aumenta', async () => {
    const criada = await criarOportunidade();
    const antes = await req('GET', '/api/crm/opportunities');

    const atualizada = await req('PUT', `/api/crm/opportunities/${criada.json.id}`, {
      id: criada.json.id, name: 'Venda Revisada', value: 250,
    });

    expect(atualizada.status).toBe(200);
    expect(atualizada.json.id).toBe(criada.json.id);
    expect(atualizada.json.name).toBe('Venda Revisada');
    expect(atualizada.json.value).toBe(250);

    const depois = await req('GET', '/api/crm/opportunities');
    expect(depois.json.total).toBe(antes.json.total);
    expect(depois.json.items.filter((o) => o.name === 'Venda Revisada')).toHaveLength(1);
    expect(depois.json.items.filter((o) => o.name === 'Venda Original')).toHaveLength(0);
  });

  test('PATCH também atualiza sem criar', async () => {
    const criada = await criarOportunidade();
    const atualizada = await req('PATCH', `/api/crm/opportunities/${criada.json.id}`, { notes: 'ajuste' });
    expect(atualizada.status).toBe(200);
    expect(atualizada.json.id).toBe(criada.json.id);
    expect((await req('GET', '/api/crm/opportunities')).json.total).toBe(1);
  });

  test('atualizar oportunidade inexistente ⇒ 404 (nunca cria)', async () => {
    const r = await req('PUT', '/api/crm/opportunities/nao-existe', { name: 'Fantasma' });
    expect(r.status).toBe(404);
    expect((await req('GET', '/api/crm/opportunities')).json.total).toBe(0);
  });

  test('id divergente entre URL e corpo ⇒ 400 e nada é alterado', async () => {
    const criada = await criarOportunidade();
    const r = await req('PUT', `/api/crm/opportunities/${criada.json.id}`, { id: 'outro-id', name: 'Sequestro' });
    expect(r.status).toBe(400);
    expect(r.json.error).toBe('id_divergente');
    const depois = await req('GET', `/api/crm/opportunities/${criada.json.id}`);
    expect(depois.json.name).toBe('Venda Original');
    expect((await req('GET', '/api/crm/opportunities')).json.total).toBe(1);
  });

  test('sem permissão de edição ⇒ 403 e nada muda', async () => {
    const criada = await criarOportunidade();
    permissoes.allowed = false;
    const r = await req('PUT', `/api/crm/opportunities/${criada.json.id}`, { name: 'Sem permissão' });
    expect(r.status).toBe(403);
    permissoes.allowed = true;
    expect((await req('GET', `/api/crm/opportunities/${criada.json.id}`)).json.name).toBe('Venda Original');
  });

  test('isolamento de tenant: outro tenant não atualiza e não enxerga', async () => {
    const criada = await criarOportunidade();
    tenantAtual = 'tenant-b';
    const r = await req('PUT', `/api/crm/opportunities/${criada.json.id}`, { name: 'Invasão' });
    expect(r.status).toBe(404);
    expect((await req('GET', '/api/crm/opportunities')).json.total).toBe(0);

    tenantAtual = 'tenant-a';
    expect((await req('GET', `/api/crm/opportunities/${criada.json.id}`)).json.name).toBe('Venda Original');
  });

  test('name vazio ⇒ 400 (validação de entrada)', async () => {
    const criada = await criarOportunidade();
    const r = await req('PUT', `/api/crm/opportunities/${criada.json.id}`, { name: '   ' });
    expect(r.status).toBe(400);
    expect((await req('GET', `/api/crm/opportunities/${criada.json.id}`)).json.name).toBe('Venda Original');
  });

  test('campos não permitidos são ignorados (id/tenantId/createdAt imutáveis)', async () => {
    const criada = await criarOportunidade();
    const r = await req('PUT', `/api/crm/opportunities/${criada.json.id}`, {
      name: 'Venda OK', id: criada.json.id, tenantId: 'tenant-b', createdAt: '2000-01-01T00:00:00.000Z',
    });
    expect(r.status).toBe(200);
    // O tenant é a chave de escopo (`tenant_key`), não um campo do payload:
    // comprova-se pelo acesso — visível em A, invisível em B.
    tenantAtual = 'tenant-b';
    expect((await req('GET', `/api/crm/opportunities/${criada.json.id}`)).status).toBe(404);
    tenantAtual = 'tenant-a';
    expect(r.json.createdAt).toBe(criada.json.createdAt);
  });

  test('criações concorrentes de ids distintos não se perdem', async () => {
    await Promise.all(
      Array.from({ length: 8 }, (_, i) => req('POST', '/api/crm/opportunities', { name: `Concorrente ${i}`, value: i })),
    );
    const lista = await req('GET', '/api/crm/opportunities?limit=50');
    expect(lista.json.total).toBe(8);
    expect(new Set(lista.json.items.map((o) => o.id)).size).toBe(8);
  });

  test('atualizações concorrentes do MESMO registro mantêm 1 registro (sem duplicata)', async () => {
    const criada = await criarOportunidade();
    await Promise.all(
      Array.from({ length: 6 }, (_, i) => req('PUT', `/api/crm/opportunities/${criada.json.id}`, { value: i })),
    );
    const lista = await req('GET', '/api/crm/opportunities?limit=50');
    expect(lista.json.total).toBe(1);
    expect(lista.json.items[0].id).toBe(criada.json.id);
  });

  test('repetir a mesma atualização é idempotente (1 registro, mesmo conteúdo)', async () => {
    const criada = await criarOportunidade();
    await req('PUT', `/api/crm/opportunities/${criada.json.id}`, { name: 'Idem', value: 10 });
    const segunda = await req('PUT', `/api/crm/opportunities/${criada.json.id}`, { name: 'Idem', value: 10 });
    expect(segunda.status).toBe(200);
    const lista = await req('GET', '/api/crm/opportunities');
    expect(lista.json.total).toBe(1);
    expect(lista.json.items[0]).toMatchObject({ name: 'Idem', value: 10 });
  });
});
