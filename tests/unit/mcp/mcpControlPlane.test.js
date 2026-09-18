'use strict';

/**
 * M1/M3–M12/M19/M20 — CONTROL PLANE persistente de conexões MCP externas.
 *
 * Defeito reproduzido (2026-09-12): `api/runtime/startMcpClient.js` montava as
 * conexões de `config.get('mcp.connections')` (config estática) e o estado vivia
 * em memória no client hub. Não havia tabela, model, migration, ciclo de vida,
 * histórico de saúde, detecção de mudança de schema nem CRUD por tenant.
 */

const crypto = require('crypto');

// ─── Dublê de banco em memória, com a MESMA superfície usada pelo serviço ────
// O contrato REAL do model é: `require('.../McpConnection')` devolve a FACTORY
// diretamente (convenção dos models do projeto). O mock espelha isso — antes ele
// expunha `{ getMcpConnectionModel }`, formato que o módulo NÃO usa, e por isso
// escondia um import quebrado no serviço.
// Nomes prefixados com `mock` porque o factory do jest.mock não pode referenciar
// variáveis fora de escopo sem esse prefixo.
const mockStore = new Map();

function mockClone(row) {
  return JSON.parse(JSON.stringify(row));
}

function mockMatches(row, where) {
  return Object.entries(where).every(([key, value]) => row[key] === value);
}

function mockCreateFakeModel() {
  return {
    async findOne({ where }) {
      for (const row of mockStore.values()) {
        if (mockMatches(row, where)) return { toJSON: () => mockClone(row) };
      }
      return null;
    },
    async findAll({ where, order }) {
      let rows = [...mockStore.values()].filter((row) => mockMatches(row, where));
      const [field, dir] = (order && order[0]) || ['name', 'ASC'];
      rows = rows.sort((a, b) => String(a[field]).localeCompare(String(b[field])) * (dir === 'DESC' ? -1 : 1));
      return rows.map((row) => ({ toJSON: () => mockClone(row) }));
    },
    async create(values) {
      const row = { ...values, created_at: new Date(), updated_at: new Date() };
      if (!row.status) row.status = 'CONFIGURED';
      mockStore.set(row.id, row);
      return { toJSON: () => mockClone(row) };
    },
    async update(values, { where }) {
      let updated = 0;
      for (const [id, row] of mockStore.entries()) {
        if (where.id && id !== where.id) continue;
        if (where.tenant_key && row.tenant_key !== where.tenant_key) continue;
        mockStore.set(id, { ...row, ...values, updated_at: new Date() });
        updated += 1;
      }
      return [updated];
    },
  };
}

jest.mock('../../../api/db/models/McpConnection', () => mockCreateFakeModel);

const service = require('../../../api/services/mcp/mcpConnectionService');

const TENANT_A = 'academia-a';
const TENANT_B = 'academia-b';
const PUBLIC_ENDPOINT = 'https://mcp.provedor-externo.com/rpc';

function resetStore() {
  mockStore.clear();
}

describe('M — MCP control plane persistente', () => {
  beforeEach(() => resetStore());

  describe('M3/M4 — criação e credencial por referência', () => {
    it('cria conexão e persiste lifecycle inicial CONFIGURED', async () => {
      const created = await service.createConnection({
        tenantId: TENANT_A,
        input: { name: 'provedor-a', endpoint: PUBLIC_ENDPOINT, authType: 'bearer', credentialRef: 'MCP_PROVEDOR_A_TOKEN', enabled: true },
      });

      expect(created.id).toMatch(/^mcpc-/);
      expect(created.tenant_key).toBe(TENANT_A);
      expect(created.status).toBe('CONFIGURED');
      expect(created.credential_ref).toBe('MCP_PROVEDOR_A_TOKEN');
    });

    it('nunca persiste segredo: campo de segredo em claro é recusado', async () => {
      await expect(service.createConnection({
        tenantId: TENANT_A,
        input: { name: 'x', endpoint: PUBLIC_ENDPOINT, authType: 'bearer', secret: 'super-secreto-123' },
      })).rejects.toThrow(/segredo em claro recusado/);
    });

    it('nome duplicado no mesmo tenant é recusado', async () => {
      await service.createConnection({ tenantId: TENANT_A, input: { name: 'p', endpoint: PUBLIC_ENDPOINT } });
      await expect(service.createConnection({ tenantId: TENANT_A, input: { name: 'p', endpoint: PUBLIC_ENDPOINT } }))
        .rejects.toThrow(/mcp_connection_duplicate/);
    });

    it('mesmo nome em tenants diferentes é permitido', async () => {
      await service.createConnection({ tenantId: TENANT_A, input: { name: 'p', endpoint: PUBLIC_ENDPOINT } });
      const other = await service.createConnection({ tenantId: TENANT_B, input: { name: 'p', endpoint: PUBLIC_ENDPOINT } });
      expect(other.tenant_key).toBe(TENANT_B);
    });
  });

  describe('M19/M20 — endpoint é validado na ESCRITA, não só no frontend', () => {
    it.each([
      ['loopback', 'http://127.0.0.1:9000/rpc'],
      ['link-local/metadata', 'http://169.254.169.254/latest/meta-data'],
      ['faixa privada', 'https://10.0.0.5/rpc'],
      ['http em PRODUCTION', 'http://mcp.provedor-externo.com/rpc'],
    ])('recusa endpoint %s na criação', async (_label, endpoint) => {
      await expect(service.createConnection({ tenantId: TENANT_A, input: { name: 'ruim', endpoint } }))
        .rejects.toThrow(/mcp_endpoint_blocked/);
    });

    it('recusa também na ALTERAÇÃO', async () => {
      const created = await service.createConnection({ tenantId: TENANT_A, input: { name: 'p', endpoint: PUBLIC_ENDPOINT } });
      await expect(service.updateConnection({
        tenantId: TENANT_A, id: created.id, patch: { endpoint: 'http://127.0.0.1:1/rpc' },
      })).rejects.toThrow(/mcp_endpoint_blocked/);
    });

    // Defeito real reproduzido no runtime (2026-09-18, release #2): o serviço
    // validava o endpoint SEM repassar a `endpointPolicy` declarada da conexão.
    // Como o default da política é estrito, o MCP interno documentado
    // (`http://mcp-research:8080/mcp`, rede privada + HTTP plaintext, teto
    // DEVELOPMENT) era recusado na CRIAÇÃO — o bootstrap governado por
    // MCP_RESEARCH_ENDPOINT falhava sempre, com log de WARN não-bloqueante.
    const PRIVATE_ENDPOINT = 'http://mcp-research:8080/mcp';
    const DEV_EXEMPTIONS = Object.freeze({
      allowPlaintextHttp: true,
      allowPrivateNetwork: true,
      maxRedirects: 0,
    });

    it('ACEITA rede privada + http quando a conexão DECLARA as isenções em DEVELOPMENT', async () => {
      const created = await service.createConnection({
        tenantId: TENANT_A,
        input: {
          name: 'mcp-interno',
          endpoint: PRIVATE_ENDPOINT,
          classificationCeiling: 'DEVELOPMENT',
          endpointPolicy: { ...DEV_EXEMPTIONS },
        },
      });
      expect(created.endpoint).toBe(PRIVATE_ENDPOINT);
      expect(created.endpoint_policy.allowPrivateNetwork).toBe(true);
    });

    it('controle negativo: SEM as isenções declaradas o mesmo endpoint segue bloqueado', async () => {
      await expect(service.createConnection({
        tenantId: TENANT_A,
        input: { name: 'sem-excecao', endpoint: PRIVATE_ENDPOINT, classificationCeiling: 'DEVELOPMENT' },
      })).rejects.toThrow(/mcp_endpoint_blocked/);
    });

    it('controle negativo: loopback NUNCA é isentado, nem com allowPrivateNetwork declarado', async () => {
      await expect(service.createConnection({
        tenantId: TENANT_A,
        input: {
          name: 'loopback-isento',
          endpoint: 'http://127.0.0.1:9000/rpc',
          classificationCeiling: 'DEVELOPMENT',
          endpointPolicy: { ...DEV_EXEMPTIONS },
        },
      })).rejects.toThrow(/mcp_endpoint_blocked/);
    });

    it('controle negativo: http em PRODUCTION segue bloqueado mesmo com allowPlaintextHttp declarado', async () => {
      await expect(service.createConnection({
        tenantId: TENANT_A,
        input: {
          name: 'prod-plaintext',
          endpoint: 'http://mcp.provedor-externo.com/rpc',
          endpointPolicy: { allowPlaintextHttp: true },
        },
      })).rejects.toThrow(/mcp_endpoint_blocked/);
    });

    it('ALTERAÇÃO usa a política efetiva: isenta com declaração e recusa sem ela', async () => {
      const comIsencao = await service.createConnection({ tenantId: TENANT_A, input: { name: 'alt-ok', endpoint: PUBLIC_ENDPOINT } });
      const updated = await service.updateConnection({
        tenantId: TENANT_A,
        id: comIsencao.id,
        patch: {
          endpoint: PRIVATE_ENDPOINT,
          classificationCeiling: 'DEVELOPMENT',
          endpointPolicy: { ...DEV_EXEMPTIONS },
        },
      });
      expect(updated.endpoint).toBe(PRIVATE_ENDPOINT);

      const semIsencao = await service.createConnection({ tenantId: TENANT_A, input: { name: 'alt-nao', endpoint: PUBLIC_ENDPOINT } });
      await expect(service.updateConnection({
        tenantId: TENANT_A,
        id: semIsencao.id,
        patch: { endpoint: PRIVATE_ENDPOINT, classificationCeiling: 'DEVELOPMENT' },
      })).rejects.toThrow(/mcp_endpoint_blocked/);
    });
  });

  describe('M13/M14 — auth mode é validado na escrita', () => {
    it('recusa mtls (UNSUPPORTED) na criação', async () => {
      await expect(service.createConnection({
        tenantId: TENANT_A, input: { name: 'mtls', endpoint: PUBLIC_ENDPOINT, authType: 'mtls' },
      })).rejects.toThrow(/mcp_auth_forbidden/);
    });

    it('recusa no_auth em teto PRODUCTION', async () => {
      await expect(service.createConnection({
        tenantId: TENANT_A, input: { name: 'anon', endpoint: PUBLIC_ENDPOINT, authType: 'no_auth' },
      })).rejects.toThrow(/mcp_auth_forbidden/);
    });

    it('aceita oauth2 sinalizando limitação (PARTIAL)', async () => {
      const use = service.assertAuthAllowed('oauth2', 'PRODUCTION');
      expect(use.partial).toBe(true);
      expect(use.state).toBe('PARTIAL');
    });

    it('o relatório de capacidades expõe estado real por modo', () => {
      const report = service.authCapabilitiesReport();
      const byMode = Object.fromEntries(report.map((item) => [item.mode, item]));
      expect(byMode.mtls.state).toBe('UNSUPPORTED');
      expect(byMode.oauth2.state).toBe('PARTIAL');
      expect(byMode.bearer.state).toBe('IMPLEMENTED');
      expect(byMode.no_auth.state).toBe('TEST_ONLY');
      expect(byMode.mtls.limitation).toBeTruthy();
    });
  });

  describe('M10/M11 — lifecycle e saúde persistidos', () => {
    it('registra saúde OK e falha, com estados distintos', async () => {
      const created = await service.createConnection({
        tenantId: TENANT_A, input: { name: 'p', endpoint: PUBLIC_ENDPOINT, enabled: true },
      });

      const healthy = await service.recordHealth({ tenantId: TENANT_A, id: created.id, ok: true });
      expect(healthy.status).toBe('HEALTHY');
      expect(healthy.last_success_at).toBeTruthy();

      const degraded = await service.recordHealth({ tenantId: TENANT_A, id: created.id, ok: false, error: 'timeout' });
      expect(degraded.status).toBe('DEGRADED');
      expect(degraded.last_error).toBe('timeout');
      expect(degraded.consecutive_failures).toBe(1);

      const down = await service.recordHealth({ tenantId: TENANT_A, id: created.id, ok: false, error: 'timeout', degradedAfter: 2 });
      expect(down.status).toBe('UNAVAILABLE');
    });

    it('disable é ESTADO persistido, não remoção', async () => {
      const created = await service.createConnection({
        tenantId: TENANT_A, input: { name: 'p', endpoint: PUBLIC_ENDPOINT, enabled: true },
      });
      const disabled = await service.setEnabled({ tenantId: TENANT_A, id: created.id, enabled: false });
      expect(disabled.enabled).toBe(false);
      expect(disabled.status).toBe('DISABLED');

      const all = await service.listConnections({ tenantId: TENANT_A });
      expect(all).toHaveLength(1);
    });

    it('o runtime carrega apenas conexões habilitadas', async () => {
      const on = await service.createConnection({ tenantId: TENANT_A, input: { name: 'on', endpoint: PUBLIC_ENDPOINT, enabled: true } });
      await service.createConnection({ tenantId: TENANT_A, input: { name: 'off', endpoint: PUBLIC_ENDPOINT, enabled: false } });
      const enabled = await service.listEnabledConnections({ tenantId: TENANT_A });
      expect(enabled.map((c) => c.id)).toEqual([on.id]);
    });
  });

  describe('M12 — mudança de schema nunca é aceita em silêncio', () => {
    it('mesmo inventário mantém HEALTHY; inventário diferente vira SCHEMA_CHANGED', async () => {
      const created = await service.createConnection({
        tenantId: TENANT_A, input: { name: 'p', endpoint: PUBLIC_ENDPOINT, enabled: true },
      });

      const first = await service.recordDiscovery({
        tenantId: TENANT_A, id: created.id,
        tools: [{ name: 'search', inputSchema: { a: 1 } }],
      });
      expect(first.schemaChanged).toBe(false);
      expect(first.status).toBe('HEALTHY');

      const same = await service.recordDiscovery({
        tenantId: TENANT_A, id: created.id,
        tools: [{ name: 'search', inputSchema: { a: 1 } }],
      });
      expect(same.schemaChanged).toBe(false);

      const changed = await service.recordDiscovery({
        tenantId: TENANT_A, id: created.id,
        tools: [{ name: 'search', inputSchema: { a: 1, b: 2 } }],
      });
      expect(changed.schemaChanged).toBe(true);
      expect(changed.status).toBe('SCHEMA_CHANGED');
    });

    it('fingerprint é estável independente da ordem das tools', () => {
      const a = service.fingerprintTools([{ name: 'b' }, { name: 'a' }]);
      const b = service.fingerprintTools([{ name: 'a' }, { name: 'b' }]);
      expect(a).toBe(b);
      expect(a).toHaveLength(64);
    });

    it('alterar endpoint invalida o schema conhecido', async () => {
      const created = await service.createConnection({
        tenantId: TENANT_A, input: { name: 'p', endpoint: PUBLIC_ENDPOINT, enabled: true },
      });
      await service.recordDiscovery({ tenantId: TENANT_A, id: created.id, tools: [{ name: 'a' }] });
      const updated = await service.updateConnection({
        tenantId: TENANT_A, id: created.id, patch: { endpoint: 'https://outro.provedor.com/rpc' },
      });
      expect(updated.schema_fingerprint).toBeNull();
      expect(updated.status).toBe('CONFIGURED');
    });
  });

  describe('M7 — bootstrap da config legada é idempotente', () => {
    const legacy = [
      { name: 'legado-1', endpoint: PUBLIC_ENDPOINT, authType: 'bearer', credentialRef: 'REF_1' },
      { name: 'legado-2', endpoint: PUBLIC_ENDPOINT, authType: 'api_key', credentialRef: 'REF_2' },
    ];

    it('importa uma vez e não duplica na segunda execução', async () => {
      const first = await service.importFromConfigBootstrap({ tenantId: TENANT_A, connections: legacy });
      expect(first.imported.sort()).toEqual(['legado-1', 'legado-2']);

      const second = await service.importFromConfigBootstrap({ tenantId: TENANT_A, connections: legacy });
      expect(second.imported).toEqual([]);
      expect(second.skipped.map((s) => s.reason)).toEqual(['already_persisted', 'already_persisted']);

      const all = await service.listConnections({ tenantId: TENANT_A });
      expect(all).toHaveLength(2);
      expect(all.every((c) => c.source === 'config-bootstrap')).toBe(true);
    });

    it('conexão legada com endpoint proibido é reportada como inválida, não importada', async () => {
      const result = await service.importFromConfigBootstrap({
        tenantId: TENANT_A,
        connections: [{ name: 'ruim', endpoint: 'http://169.254.169.254/x', authType: 'bearer' }],
      });
      expect(result.imported).toEqual([]);
      expect(result.invalid[0].name).toBe('ruim');
      expect(await service.listConnections({ tenantId: TENANT_A })).toHaveLength(0);
    });
  });

  describe('isolamento por tenant (T8)', () => {
    it('tenant B não lê conexão de A', async () => {
      const created = await service.createConnection({ tenantId: TENANT_A, input: { name: 'p', endpoint: PUBLIC_ENDPOINT } });
      await expect(service.getConnection({ tenantId: TENANT_B, id: created.id }))
        .rejects.toThrow(/mcp_connection_not_found/);
    });

    it('tenant B não altera conexão de A', async () => {
      const created = await service.createConnection({ tenantId: TENANT_A, input: { name: 'p', endpoint: PUBLIC_ENDPOINT } });
      await expect(service.updateConnection({
        tenantId: TENANT_B, id: created.id, patch: { endpoint: 'https://outro.com/rpc' },
      })).rejects.toThrow(/mcp_connection_not_found/);
    });

    it('tenant B não desabilita conexão de A', async () => {
      const created = await service.createConnection({ tenantId: TENANT_A, input: { name: 'p', endpoint: PUBLIC_ENDPOINT, enabled: true } });
      await expect(service.setEnabled({ tenantId: TENANT_B, id: created.id, enabled: false }))
        .rejects.toThrow(/mcp_connection_not_found/);
      const still = await service.getConnection({ tenantId: TENANT_A, id: created.id });
      expect(still.enabled).toBe(true);
    });

    it('listagem é escopada por tenant', async () => {
      await service.createConnection({ tenantId: TENANT_A, input: { name: 'a', endpoint: PUBLIC_ENDPOINT } });
      await service.createConnection({ tenantId: TENANT_B, input: { name: 'b', endpoint: PUBLIC_ENDPOINT } });
      expect((await service.listConnections({ tenantId: TENANT_A })).map((c) => c.name)).toEqual(['a']);
      expect((await service.listConnections({ tenantId: TENANT_B })).map((c) => c.name)).toEqual(['b']);
    });
  });

  describe('provider-neutralidade (M5/M22)', () => {
    it('o serviço não conhece vendor nem remote tool name', () => {
      const fs = require('fs');
      const path = require('path');
      const source = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'api', 'services', 'mcp', 'mcpConnectionService.js'), 'utf8');
      // Palavra inteira: "devolve" (verbo) não pode ser confundido com o vendor.
      for (const vendor of ['evo', 'tecnofit', 'glofox', 'mindbody', 'zenplanner', 'w12']) {
        expect(source.toLowerCase()).not.toMatch(new RegExp(`\\b${vendor}\\b`));
      }
    });

    it('id de conexão é opaco e não embute provedor', async () => {
      const created = await service.createConnection({ tenantId: TENANT_A, input: { name: 'p', endpoint: PUBLIC_ENDPOINT } });
      expect(created.id).toMatch(/^mcpc-\d+-[0-9a-f]{8}$/);
    });
  });
});
