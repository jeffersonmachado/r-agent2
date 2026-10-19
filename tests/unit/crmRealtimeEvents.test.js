'use strict';

/**
 * Realtime do CRM por PUSH (regra do projeto: PROIBIDO `setInterval` para
 * sincronizar estado).
 *
 * DEFEITO MEDIDO (2026-10-19, aba real em `/crm`): o painel CRM sincronizava as
 * métricas com `setInterval` de 60 s e `fetch` cru. Com a conexão pendurada, as
 * requisições se acumulavam, esgotavam o pool de conexões do browser para a
 * origem e a ABA INTEIRA parava de responder — o console repetia
 * `Unexpected end of JSON input` (200 com corpo vazio lido como `response.ok`).
 *
 * A correção do lado servidor: toda mutação de CRM emite `crm.metrics.updated`
 * via WebSocket (`emitEvent`), para que as telas reajam ao evento em vez de
 * consultar em loop. Este teste prova, com servidor HTTP real e event bus
 * espionado, que:
 *   - POST/DELETE de conta, contato, lead, pipeline, oportunidade e atividade
 *     emitem o evento, e o payload identifica entidade, ação e tenant;
 *   - leitura (GET) NÃO emite;
 *   - a emissão é best-effort: se o emissor lançar, a escrita NÃO falha.
 */

const express = require('express');
const http = require('http');

const mockEventos = [];
const mockControle = { falhar: false };

jest.mock('../../api/services/websocketService', () => ({
  emitEvent: (event, payload, options) => {
    if (mockControle.falhar) throw new Error('falha injetada no emissor');
    mockEventos.push({ event, payload, options });
  },
  broadcastToTenant: () => {},
  broadcastToExecution: () => {},
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

function iniciarServidor() {
  const app = express();
  app.use(createCrmRoutes({ buildDeps }));
  return new Promise((resolve) => {
    const servidor = http.createServer(app);
    servidor.listen(0, '127.0.0.1', () => resolve({ servidor, porta: servidor.address().port }));
  });
}

let servidor;
let base;

beforeAll(async () => {
  const iniciado = await iniciarServidor();
  servidor = iniciado.servidor;
  base = `http://127.0.0.1:${iniciado.porta}`;
});

afterAll(() => new Promise((resolve) => servidor.close(resolve)));

beforeEach(() => { mockEventos.length = 0; mockControle.falhar = false; });

async function requisitar(metodo, caminho, corpo) {
  const resp = await fetch(`${base}${caminho}`, {
    method: metodo,
    headers: { 'Content-Type': 'application/json' },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  const texto = await resp.text();
  return { status: resp.status, json: texto ? JSON.parse(texto) : null };
}

describe('CRM emite crm.metrics.updated em toda mutação', () => {
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

  // `activities` só tem criação no CRM (não existe rota de remoção de atividade).
  const casosComRemocao = casos.filter(({ entidade }) => entidade !== 'activities');

  it.each(casosComRemocao)('DELETE $rota emite evento de remoção', async ({ entidade, rota, corpo }) => {
    const criado = await requisitar('POST', rota, corpo);
    mockEventos.length = 0;

    const removido = await requisitar('DELETE', `${rota}/${criado.json.id}`);
    expect(removido.status).toBe(200);

    const remocao = mockEventos.find((e) => e.payload.action === 'deleted' && e.payload.entity === entidade);
    expect(remocao).toBeDefined();
    expect(remocao.payload.entityId).toBe(criado.json.id);
  });

  it('mover oportunidade de estágio emite evento de atualização', async () => {
    const pipeline = await requisitar('POST', '/api/crm/pipelines', {
      name: 'Funil Move',
      stages: [{ id: 's1', name: 'Prospecção' }, { id: 's2', name: 'Proposta' }],
    });
    const oportunidade = await requisitar('POST', '/api/crm/opportunities', {
      name: 'Oportunidade Move',
      pipelineId: pipeline.json.id,
    });
    mockEventos.length = 0;

    const movida = await requisitar('POST', `/api/crm/opportunities/${oportunidade.json.id}/move`, { toStageId: 's2' });    expect(movida.status).toBe(200);
    expect(movida.json.stageId).toBe('s2');

    const evento = mockEventos.find((e) => e.payload.action === 'moved');
    expect(evento).toBeDefined();
    expect(evento.payload.entityId).toBe(oportunidade.json.id);
  });

  it('GET não emite evento (leitura não é mutação)', async () => {
    await requisitar('GET', '/api/crm/accounts');
    await requisitar('GET', '/api/crm/leads');
    expect(mockEventos).toEqual([]);
  });

  it('emissor indisponível não derruba a escrita (best-effort)', async () => {
    mockControle.falhar = true;
    const resposta = await requisitar('POST', '/api/crm/accounts', { name: 'Conta com emissor quebrado' });
    expect(resposta.status).toBe(200);
    expect(resposta.json.name).toBe('Conta com emissor quebrado');
    expect(mockEventos).toEqual([]);
  });
});
