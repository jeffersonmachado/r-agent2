'use strict';

/**
 * Regressão do defeito multi-tenant do dialplan realtime (2026-09-12).
 *
 * Contexto: `extensions.conf` declarava apenas `[system]`. Como o switch Realtime exige a
 * declaração explícita do contexto, as linhas de dialplan de todo tenant que não fosse
 * `system` eram persistidas na tabela `extensions` e nunca executadas pelo Asterisk.
 * Sintoma: originar `Local/<ramal>@<tenant>` não resolvia contexto, a chamada morria antes
 * do `Answer` e, com `Log unanswered calls: No`, nenhum CDR era gravado — o sinal `cdr` da
 * evidência enterprise ficava `false` por um motivo que não era o suspeito óbvio.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const SEQUELIZE_PATH = '../../api/db/sequelize';
const MODELS_PATH = '../../api/db/models';
const SERVICE_PATH = '../../api/services/pbx/pbxDialplanService';

describe('pbxDialplanService - contextos realtime por tenant', () => {
  let tmpDir;

  beforeEach(() => {
    jest.resetModules();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pbx-ctx-'));
    delete process.env.PBX_ASTERISK_TENANTS_CONF;
    delete process.env.PBX_ASTERISK_STATIC_CONTEXTS;
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (_) {}
  });

  function loadService({ contexts = [], queryError = null } = {}) {
    jest.doMock(SEQUELIZE_PATH, () => ({
      getSequelize: () => ({
        query: async () => {
          if (queryError) throw queryError;
          return [contexts.map((context) => ({ context }))];
        },
      }),
    }));
    jest.doMock(MODELS_PATH, () => ({}));
    return require(SERVICE_PATH);
  }

  describe('buildTenantContextsConf', () => {
    it('emite um bloco de switch Realtime por contexto e exclui os declarados estaticamente', () => {
      const { buildTenantContextsConf } = loadService();

      const { content, declared } = buildTenantContextsConf(['system', 'acme', 'globex']);

      expect(declared).toEqual(['acme', 'globex']);
      expect(content).toContain('[acme]\nswitch => Realtime/acme@extensions');
      expect(content).toContain('[globex]\nswitch => Realtime/globex@extensions');
      // `system` continua declarado no extensions.conf versionado; duplicar geraria aviso de contexto.
      expect(content).not.toContain('[system]');
      // Asterisk não tolera arquivo sem newline final.
      expect(content.endsWith('\n')).toBe(true);
    });

    it('respeita a lista de contextos estaticos configuravel por ambiente', () => {
      process.env.PBX_ASTERISK_STATIC_CONTEXTS = 'system, shared';
      const { buildTenantContextsConf } = loadService();

      const { declared } = buildTenantContextsConf(['system', 'shared', 'acme']);

      expect(declared).toEqual(['acme']);
    });

    it('descarta contextos fora da whitelist para impedir injecao de diretivas no arquivo', () => {
      const { buildTenantContextsConf } = loadService();

      const malicious = [
        'ok-tenant',
        'evil]\nswitch => Realtime/pwn@extensions\n[again', // quebra de linha + colchetes
        'with space',
        'semi;colon',
        '',
        null,
      ];
      const { content, declared } = buildTenantContextsConf(malicious);

      expect(declared).toEqual(['ok-tenant']);
      expect(content).toContain('[ok-tenant]');
      expect(content).not.toContain('pwn@extensions');
      expect(content).not.toContain('with space');
      expect(content).not.toContain('semi;colon');
    });
  });

  describe('syncRealtimeTenantContexts', () => {
    it('nao escreve nada quando o caminho do include nao esta configurado', async () => {
      const { syncRealtimeTenantContexts } = loadService({ contexts: ['acme'] });

      const result = await syncRealtimeTenantContexts();

      expect(result).toEqual({
        ok: false,
        skipped: true,
        reason: 'PBX_ASTERISK_TENANTS_CONF_undefined',
      });
    });

    it('gera o include a partir do banco e nao reescreve quando o conteudo ja coincide', async () => {
      const confPath = path.join(tmpDir, 'conf', 'tenants.conf');
      process.env.PBX_ASTERISK_TENANTS_CONF = confPath;
      const { syncRealtimeTenantContexts } = loadService({ contexts: ['system', 'acme'] });

      const first = await syncRealtimeTenantContexts({ reload: false });

      expect(first.ok).toBe(true);
      expect(first.changed).toBe(true);
      expect(first.contexts).toEqual(['acme']);
      expect(fs.readFileSync(confPath, 'utf8')).toContain('switch => Realtime/acme@extensions');

      const second = await syncRealtimeTenantContexts({ reload: false });

      expect(second.ok).toBe(true);
      expect(second.changed).toBe(false);
    });

    it('reporta falha de leitura do banco sem lancar excecao', async () => {
      process.env.PBX_ASTERISK_TENANTS_CONF = path.join(tmpDir, 'conf', 'tenants.conf');
      const { syncRealtimeTenantContexts } = loadService({
        queryError: new Error('db_unavailable'),
      });

      const result = await syncRealtimeTenantContexts({ reload: false });

      expect(result.ok).toBe(false);
      expect(result.error).toContain('db_unavailable');
      expect(fs.existsSync(result.path)).toBe(false);
    });
  });
});
