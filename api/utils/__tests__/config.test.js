/**
 * Testes unitários para api/utils/config.js
 * 
 * Testa:
 * - getDatabaseUrl() com prioridade config.json > env vars
 * - getDatabasePool() com valores padrão
 * - getDatabaseSsl() com fallback
 * - parseDatabaseUrlSafe() para logs
 */

const fs = require('fs');
const path = require('path');
const config = require('../config');

// Backup do config.json original
let originalConfigContent = null;
const configFile = path.join(__dirname, '..', '..', 'data', 'config.json');

// Helper para garantir que o diretório existe
function ensureConfigFile() {
  const configDir = path.dirname(configFile);
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }
  if (!fs.existsSync(configFile)) {
    fs.writeFileSync(configFile, '{}', 'utf8');
  }
}

beforeAll(() => {
  // Garante que o arquivo existe
  ensureConfigFile();
  // Salva conteúdo original
  if (fs.existsSync(configFile)) {
    originalConfigContent = fs.readFileSync(configFile, 'utf8');
  }
});

afterAll(() => {
  // Restaura conteúdo original
  if (originalConfigContent) {
    fs.writeFileSync(configFile, originalConfigContent, 'utf8');
  }
  // Limpa cache do config
  config.reload();
  // Limpa env vars de teste
  delete process.env.DATABASE_URL;
  delete process.env.PGHOST;
  delete process.env.PGUSER;
  delete process.env.PGPASSWORD;
  delete process.env.PGDATABASE;
  delete process.env.PGPORT;
});

describe('Config - Database', () => {
  beforeEach(() => {
    // Limpa cache e env vars antes de cada teste
    config.reload();
    delete process.env.DATABASE_URL;
    delete process.env.PGHOST;
    delete process.env.PGUSER;
    delete process.env.PGPASSWORD;
    delete process.env.PGDATABASE;
    delete process.env.PGPORT;
  });

  describe('getDatabaseUrl()', () => {
    test('deve usar config.json quando disponível', () => {
      // Cria config.json com database.url
      const testConfig = {
        api: { port: 3000 },
        database: {
          url: 'postgres://user:pass@localhost:5432/testdb',
        },
      };
      fs.writeFileSync(configFile, JSON.stringify(testConfig, null, 2), 'utf8');
      config.reload();

      const url = config.getDatabaseUrl();
      expect(url).toBe('postgres://user:pass@localhost:5432/testdb');
    });

    test('deve usar DATABASE_URL (env) como fallback quando config.json não tem database.url', () => {
      // Config sem database.url
      const testConfig = {
        api: { port: 3000 },
      };
      fs.writeFileSync(configFile, JSON.stringify(testConfig, null, 2), 'utf8');
      config.reload();

      // Define env var
      process.env.DATABASE_URL = 'postgres://envuser:envpass@envhost:5433/envdb';

      const url = config.getDatabaseUrl();
      expect(url).toBe('postgres://envuser:envpass@envhost:5433/envdb');
    });

    test('deve construir URL a partir de variáveis individuais quando não há DATABASE_URL', () => {
      // Config sem database.url
      const testConfig = {
        api: { port: 3000 },
      };
      fs.writeFileSync(configFile, JSON.stringify(testConfig, null, 2), 'utf8');
      config.reload();

      // Define env vars individuais
      process.env.PGHOST = 'customhost';
      process.env.PGPORT = '5434';
      process.env.PGUSER = 'customuser';
      process.env.PGPASSWORD = 'custompass';
      process.env.PGDATABASE = 'customdb';

      const url = config.getDatabaseUrl();
      expect(url).toBe('postgres://customuser:custompass@customhost:5434/customdb');
    });

    test('deve usar valores padrão quando não há configuração', () => {
      // Config sem database
      const testConfig = {
        api: { port: 3000 },
      };
      fs.writeFileSync(configFile, JSON.stringify(testConfig, null, 2), 'utf8');
      config.reload();

      const url = config.getDatabaseUrl();
      expect(url).toBe('postgres://postgres:postgres@localhost:5432/r_agent2');
    });
  });

  describe('getDatabasePool()', () => {
    test('deve usar valores de config.json', () => {
      const testConfig = {
        api: { port: 3000 },
        database: {
          pool: {
            min: 2,
            max: 20,
          },
        },
      };
      fs.writeFileSync(configFile, JSON.stringify(testConfig, null, 2), 'utf8');
      config.reload();

      const pool = config.getDatabasePool();
      expect(pool.min).toBe(2);
      expect(pool.max).toBe(20);
    });

    test('deve usar valores padrão quando não configurado', () => {
      const testConfig = {
        api: { port: 3000 },
      };
      fs.writeFileSync(configFile, JSON.stringify(testConfig, null, 2), 'utf8');
      config.reload();

      const pool = config.getDatabasePool();
      expect(pool.min).toBe(0);
      expect(pool.max).toBe(10);
    });

    test('deve usar env vars como fallback', () => {
      const testConfig = {
        api: { port: 3000 },
      };
      fs.writeFileSync(configFile, JSON.stringify(testConfig, null, 2), 'utf8');
      config.reload();

      process.env.DB_POOL_MIN = '5';
      process.env.DB_POOL_MAX = '15';

      const pool = config.getDatabasePool();
      expect(pool.min).toBe(5);
      expect(pool.max).toBe(15);
    });
  });

  describe('getDatabaseSsl()', () => {
    test('deve usar valor de config.json', () => {
      const testConfig = {
        api: { port: 3000 },
        database: {
          ssl: true,
        },
      };
      fs.writeFileSync(configFile, JSON.stringify(testConfig, null, 2), 'utf8');
      config.reload();

      const ssl = config.getDatabaseSsl();
      expect(ssl).toBe(true);
    });

    test('deve retornar false quando não configurado', () => {
      const testConfig = {
        api: { port: 3000 },
      };
      fs.writeFileSync(configFile, JSON.stringify(testConfig, null, 2), 'utf8');
      config.reload();

      const ssl = config.getDatabaseSsl();
      expect(ssl).toBe(false);
    });

    test('deve detectar SSL em DATABASE_URL', () => {
      const testConfig = {
        api: { port: 3000 },
      };
      fs.writeFileSync(configFile, JSON.stringify(testConfig, null, 2), 'utf8');
      config.reload();

      process.env.DATABASE_URL = 'postgres://user:pass@host:5432/db?sslmode=require';

      const ssl = config.getDatabaseSsl();
      expect(ssl).toBe(true);
    });
  });

  describe('parseDatabaseUrlSafe()', () => {
    test('deve extrair informações da URL sem senha', () => {
      const url = 'postgres://myuser:mypass@myhost:5432/mydb';
      const info = config.parseDatabaseUrlSafe(url);

      expect(info.host).toBe('myhost');
      expect(info.port).toBe(5432);
      expect(info.database).toBe('mydb');
      expect(info.username).toBe('myuser');
      expect(info).not.toHaveProperty('password');
    });

    test('deve retornar valores padrão para URL inválida', () => {
      const url = 'invalid-url';
      const info = config.parseDatabaseUrlSafe(url);

      expect(info.host).toBe('unknown');
      expect(info.port).toBe(5432);
      expect(info.database).toBe('unknown');
      expect(info.username).toBe('unknown');
    });
  });
});
