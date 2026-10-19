'use strict';

/**
 * CRM: realtime por PUSH + persistência (H21).
 *
 * DEFEITOS MEDIDOS em 2026-10-19 na jornada real:
 *  - a tela sincronizava com `setInterval` de 60 s (proibido: estado é push);
 *  - leads, contas, funis, oportunidades e atividades viviam em um `Map` por
 *    processo: o registro era aceito com 200, não aparecia na lista seguinte e
 *    desaparecia no restart; o painel contava o BANCO e a escrita ia para o Map,
 *    então criar um lead não movia contador algum;
 *  - quando o banco falhava, havia fallback silencioso para memória (proibido).
 *
 * Este teste monta o router real com servidor HTTP real e modelos FAKE em
 * memória (infra de teste, não fallback de produção) para provar:
 *  - toda mutação emite `crm.metrics.updated` com entidade/ação/tenant;
 *  - o registro criado é lido de volta pelo GET seguinte (mesma fonte);
 *  - DELETE remove de verdade (GET passa a 404);
 *  - falha do modelo vira 500 `persistence_required` — nunca 200 silencioso.
 */

const express = require('express');
const http = require('http');

const mockEventos = [];

jest.mock('../../api/services/websocketService', () => ({
  emitEvent: (event, payload, options) => { mockEventos.push({ event, payload, options }); },
  broadcastToTenant: () => {},
  broadcastToExecution: () => {},
}));

/** Modelo fake com a superfície usada pelas rotas (sem banco). */
function criarModeloFake() {
  const linhas = new Map();
  const materializar = (dados) => {
    const registro = { ...dados };
    registro.toJSON = () => ({ ...registro });
    registro.update = async (novo) => { Object.assign(registro, novo); linhas.set(registro.id, registro); };
    return registro;
  };
  const casa = (registro, where) => Object.entries(where).every(([campo, valor]) => {
    if (valor && typeof valor === 'object' && valor.__or) {
      return valor.__or.some((cond) => String(registro[cond.campo] || '').toLowerCase().includes(String(cond.valor)));
    }
    return registro[campo] === valor;
  });
  return {
    __linhas: linhas,
    __falhar: false,
    async findAndCountAll({ where, limit = 20, offset = 0 } = {}) {
      if (this.__falhar) throw new Error('banco indisponível (teste)');
      const itens = [...linhas.values()].filter((r) => casa(r, where));
      return { rows: itens.slice(offset, offset + limit), count: itens.length };
    },
    async findOne({ where } = {}) {
      if (this.__falhar) throw new Error('banco indisponível (teste)');
      const achado = [...linhas.values()].find((r) => casa(r, where));
      return achado || null;
    },
    async create(dados) {
      if (this.__falhar) throw new Error('banco indisponível (teste)');
      const registro = materializar(dados);
      linhas.set(registro.id, registro);
      return registro;
    },
    async upsert(dados) {
      if (this.__falhar) throw new Error('banco indisponível (teste)');
      const atual = linhas.get(dados.id);
      if (atual) Object.assign(atual, dados);
      else linhas.set(dados.id, materializar(dados));
      return [linhas.get(dados.id)];
    },
    async destroy({ where } = {}) {
      if (this.__falhar) throw new Error('banco indisponível (teste)');
      let removidos = 0;
      for (const [id, registro] of [...linhas.entries()]) {
        if (casa(registro, where)) { linhas.delete(id); removidos += 1; }
      }
      return removidos;
    },
  };
}

const mockModeloRegistros = criarModeloFake();
const mockModeloPessoas = criarModeloFake();

jest.mock('../../api/db/models', () => ({
  get CrmRecord() { return () => mockModeloRegistros; },
  get MarketingLead() { return () => mockModeloPessoas; },
}));

const { createCrmRoutes } = require('../../api/modules/crm/routes');

function buildDeps() {
  return {
    requireAuth: () => ({ valid: true }),
    requireTenant: () => 'tenant-teste',
    requirePermission: () => ({ allowed: true }),
    sendJson: (res, status, body) => { res.status(status).json(body); },
    badRequest: (res, message) => { res.status(400).json({ error: 'bad_request', message }); },
    parseJsonBody: async (req) => {
      const partes = [];
      for await (const parte of req) partes.push(parte);
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
  await new Promise((resolve) => servidor.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${servidor.address().port}`;
});

afterAll(() => new Promise((resolve) => servidor.close(resolve)));

beforeEach(() => {
  mockEventos.length = 0;
  mockModeloRegistros.__linhas.clear();
  mockModeloPessoas.__linhas.clear();
  mockModeloRegistros.__falhar = false;
  mockModeloPessoas.__falhar = false;
});

async function requisitar(metodo, caminho, corpo) {
  const resp = await fetch(`${base}${caminho}`, {
    method: metodo,
    headers: { 'Content-Type': 'application/json' },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  const texto = await resp.text();
  return { status: resp.status, json: texto ? JSON.parse(texto) : null };
}

describe('CRM — toda mutação emite crm.metrics.updated', () => {
  const casos = [
    { entidade: 'accounts', rota: '/api/crm/accounts', corpo: { name: 'Conta Teste' } },
    { entidade: 'contacts', rota: '/api/crm/contacts', corpo: { name: 'Contato Teste' } },
    { entidade: 'leads', rota: '/api/crm/leads', corpo: { name: 'Lead Teste' } },
    { entidade: 'pipelines', rota: '/api/crm/pipelines', corpo: { name: 'Funil Teste' } },
    { entidade: 'opportunities', rota: '/api/crm/opportunities', corpo: { name: 'Oportunidade Teste', value: 100 } },
    { entidade: 'activities', rota: '/api/crm/activities', corpo: { type: 'note', description: 'Ligação' } },
  ];

  it.each(casos)('POST $rota emite evento de criação', async ({ entidade, rota, corpo }) => {
    const resposta = await requisitar('POST', rota, corpo);
    expect(resposta.status).toBe(200);

    const criacao = mockEventos.find((e) => e.payload.action === 'created' && e.payload.entity === entidade);
    expect(criacao).toBeDefined();
    expect(criacao.event).toBe('crm.metrics.updated');
    expect(criacao.payload.tenantId).toBe('tenant-teste');
    expect(criacao.payload.entityId).toBe(resposta.json.id);
    expect(criacao.options).toEqual({ tenantId: 'tenant-teste' });
  });

  it('GET não emite evento (leitura não é mutação)', async () => {
    await requisitar('GET', '/api/crm/accounts');
    await requisitar('GET', '/api/crm/leads');
    expect(mockEventos).toEqual([]);
  });
});

describe('CRM — persistência de verdade (mesma fonte para escrita e leitura)', () => {
  it('conta criada aparece no GET seguinte e sobrevive à releitura', async () => {
    const criada = await requisitar('POST', '/api/crm/accounts', { name: 'Empresa Persistida', status: 'prospect' });
    expect(criada.status).toBe(200);

    const lista = await requisitar('GET', '/api/crm/accounts');
    expect(lista.status).toBe(200);
    expect(lista.json.total).toBe(1);
    expect(lista.json.items[0]).toMatchObject({ id: criada.json.id, name: 'Empresa Persistida', status: 'prospect' });
  });

  it('oportunidade criada é lida de volta com os campos do contrato', async () => {
    await requisitar('POST', '/api/crm/opportunities', {
      name: 'Venda Persistida', pipelineId: 'p1', stageId: 's1', value: 2500, notes: 'detalhe',
    });
    const lista = await requisitar('GET', '/api/crm/opportunities');
    expect(lista.json.items[0]).toMatchObject({ name: 'Venda Persistida', value: 2500, notes: 'detalhe' });
  });

  it('lead criado aparece na lista de leads E na de contatos (marketing_leads)', async () => {
    const criado = await requisitar('POST', '/api/crm/leads', {
      name: 'Maria Persistida', email: 'maria@exemplo.com', stage: 'qualificado', source: 'website', notes: 'quente',
    });
    expect(criado.status).toBe(200);
    expect(criado.json).toMatchObject({ name: 'Maria Persistida', stage: 'qualificado', source: 'website', notes: 'quente' });

    const leads = await requisitar('GET', '/api/crm/leads');
    const contatos = await requisitar('GET', '/api/crm/contacts');
    expect(leads.json.items.map((i) => i.name)).toContain('Maria Persistida');
    expect(contatos.json.items.map((i) => i.name)).toContain('Maria Persistida');
  });

  it('DELETE remove de verdade (GET passa a 404)', async () => {
    const criada = await requisitar('POST', '/api/crm/accounts', { name: 'Conta Efêmera' });
    const removida = await requisitar('DELETE', `/api/crm/accounts/${criada.json.id}`);
    expect(removida.status).toBe(200);
    const busca = await requisitar('GET', `/api/crm/accounts/${criada.json.id}`);
    expect(busca.status).toBe(404);
  });

  it('mover oportunidade persiste a nova etapa', async () => {
    const criada = await requisitar('POST', '/api/crm/opportunities', { name: 'Move Persistido', stageId: 's1' });
    const movida = await requisitar('POST', `/api/crm/opportunities/${criada.json.id}/move`, { toStageId: 's2' });
    expect(movida.json.stageId).toBe('s2');
    const busca = await requisitar('GET', `/api/crm/opportunities/${criada.json.id}`);
    expect(busca.json.stageId).toBe('s2');
  });

  it('falha de banco responde 500 persistence_required (sem fallback em memória)', async () => {
    mockModeloRegistros.__falhar = true;
    const resposta = await requisitar('POST', '/api/crm/accounts', { name: 'Conta sem banco' });
    expect(resposta.status).toBe(500);
    expect(resposta.json.error).toBe('persistence_required');
    expect(mockEventos).toEqual([]);

    mockModeloRegistros.__falhar = false;
    const lista = await requisitar('GET', '/api/crm/accounts');
    expect(lista.json.total).toBe(0);
  });
});
