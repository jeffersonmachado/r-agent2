'use strict';

/**
 * P0-02 — ISOLAMENTO MULTITENANT DO CRM EM POSTGRESQL REAL.
 *
 * Baseline 511ae5249: `gravarRegistro` usava
 * `Model.upsert({ id, tenant_key, entity, payload })` e a PK de `crm_records` é
 * apenas `id`. O Sequelize traduz para `INSERT ... ON CONFLICT (id) DO UPDATE`,
 * então o tenant B podia, com o id de um registro do tenant A:
 *   - sobrescrever o payload do registro de A;
 *   - trocar o `tenant_key` do registro de A (TRANSFERÊNCIA de propriedade).
 *
 * Este arquivo só certifica com Postgres REAL (nunca mock): roda as migrations
 * de verdade, executa a matriz de ataques pelo código de aplicação e confirma o
 * estado com SQL independente.
 *
 * Sem `CRM_PG_TEST_URL` (ou sem banco acessível), os cenários são SKIPPED com
 * motivo explícito — skip nunca é contado como aprovação (o relatório registra a
 * execução real desta sessão separadamente).
 */

const path = require('path');

const URL_PADRAO = 'postgres://postgres:postgres@127.0.0.1:55432/crm_p0_test';
const PG_URL = process.env.CRM_PG_TEST_URL || URL_PADRAO;
const PG_OBRIGATORIO = process.env.CRM_PG_REQUIRED === '1';

const MIGRATIONS = [
  path.join(__dirname, '..', '..', 'api', 'db', 'migrations', '20261019120000-create-crm-records.js'),
  path.join(__dirname, '..', '..', 'api', 'db', 'migrations', '20261019130000-crm-records-tenant-guard.js'),
];

let Sequelize;
let sequelize;
let queryInterface;
let store;
let disponivel = false;
let motivoIndisponivel = null;

/** SQL INDEPENDENTE da aplicação: lê o estado bruto da tabela. */
async function estadoSql(id) {
  const [linhas] = await sequelize.query(
    'SELECT id, tenant_key, entity, payload FROM crm_records WHERE id = :id',
    { replacements: { id } },
  );
  return linhas[0] || null;
}

async function contarSql() {
  const [linhas] = await sequelize.query('SELECT COUNT(*)::int AS total FROM crm_records');
  return linhas[0].total;
}

beforeAll(async () => {
  ({ Sequelize } = require('sequelize'));
  sequelize = new Sequelize(PG_URL, { logging: false });
  try {
    await sequelize.authenticate();
    disponivel = true;
  } catch (err) {
    motivoIndisponivel = err.message;
    if (PG_OBRIGATORIO) throw new Error(`REQUIRES_POSTGRES: ${err.message}`);
    return;
  }

  queryInterface = sequelize.getQueryInterface();

  // Schema limpo e migrations REAIS aplicadas na ordem do projeto.
  await sequelize.query('DROP TABLE IF EXISTS crm_records CASCADE;');
  for (const arquivo of MIGRATIONS) {
    const migration = require(arquivo);
    await migration.up(queryInterface, Sequelize);
  }

  store = require('../../api/services/crm/crmRecordStore');
  store.__setModelFactory(() => {
    // Modelo ligado a ESTA conexão (não à conexão global da aplicação).
    if (!sequelize.models.CrmRecord) {
      sequelize.define('CrmRecord', {
        id: { type: Sequelize.STRING, primaryKey: true, allowNull: false },
        tenant_key: { type: Sequelize.STRING, allowNull: false },
        entity: { type: Sequelize.STRING, allowNull: false },
        payload: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      }, {
        tableName: 'crm_records',
        timestamps: true,
        underscored: true,
      });
    }
    return sequelize.models.CrmRecord;
  });
}, 60000);

afterAll(async () => {
  if (sequelize) await sequelize.close().catch(() => {});
});

const TENANT_A = 'tenant-a';
const TENANT_B = 'tenant-b';
const ENTITY = 'opportunities';

function registrarCenario(nome, fn) {
  test(nome, async () => {
    if (!disponivel) {
      // Falha explícita, nunca verde: certificação exige banco real.
      throw new Error(`SKIPPED_SEM_POSTGRES: ${motivoIndisponivel}`);
    }
    await fn();
  });
}

describe('P0-02 — matriz adversarial de isolamento (PostgreSQL real)', () => {
  registrarCenario('1. tenant A cria registro e o SQL confirma tenant_key=A', async () => {
    const salvo = await store.criarRegistro({
      tenantId: TENANT_A, entity: ENTITY, id: 'opp-A-1',
      payload: { name: 'Oportunidade A', value: 1000, tenantId: TENANT_A },
    });
    expect(salvo.id).toBe('opp-A-1');
    const linha = await estadoSql('opp-A-1');
    expect(linha.tenant_key).toBe(TENANT_A);
    expect(linha.payload.name).toBe('Oportunidade A');
    // `tenantId` do payload é descartado: propriedade vem do contexto autenticado.
    expect(linha.payload.tenantId).toBeUndefined();
  });

  registrarCenario('2. tenant A lê o próprio registro', async () => {
    const item = await store.lerRegistro({ tenantId: TENANT_A, entity: ENTITY, id: 'opp-A-1' });
    expect(item).toMatchObject({ id: 'opp-A-1', name: 'Oportunidade A' });
  });

  registrarCenario('3. tenant B NÃO lê o registro de A (null, sem dado vazado)', async () => {
    const item = await store.lerRegistro({ tenantId: TENANT_B, entity: ENTITY, id: 'opp-A-1' });
    expect(item).toBeNull();
  });

  registrarCenario('4. tenant B NÃO atualiza o registro de A (0 linhas; SQL intacto)', async () => {
    const antes = await estadoSql('opp-A-1');
    const resultado = await store.atualizarRegistro({
      tenantId: TENANT_B, entity: ENTITY, id: 'opp-A-1',
      payload: { name: 'SEQUESTRADO POR B', value: 1 },
    });
    expect(resultado).toBeNull();
    const depois = await estadoSql('opp-A-1');
    expect(depois.tenant_key).toBe(TENANT_A);
    expect(depois.payload.name).toBe(antes.payload.name);
    expect(depois.payload.value).toBe(antes.payload.value);
  });

  registrarCenario('5. tenant B NÃO exclui o registro de A', async () => {
    const removido = await store.removerRegistro({ tenantId: TENANT_B, entity: ENTITY, id: 'opp-A-1' });
    expect(removido).toBe(false);
    expect(await estadoSql('opp-A-1')).not.toBeNull();
  });

  registrarCenario('6. tenant B NÃO cria registro usando o ID de A (409; A intacto)', async () => {
    const antes = await estadoSql('opp-A-1');
    await expect(store.criarRegistro({
      tenantId: TENANT_B, entity: ENTITY, id: 'opp-A-1',
      payload: { name: 'B com id de A' },
    })).rejects.toMatchObject({ code: 'id_indisponivel' });
    const depois = await estadoSql('opp-A-1');
    expect(depois).toEqual(antes);
    expect(depois.tenant_key).toBe(TENANT_A);
  });

  registrarCenario('7. tenant B NÃO altera tenant_key por payload contaminado', async () => {
    await expect(store.criarRegistro({
      tenantId: TENANT_B, entity: ENTITY, id: 'opp-B-contaminada',
      payload: { name: 'x', tenant_key: TENANT_A, tenantId: TENANT_A, tenantKey: TENANT_A },
    })).resolves.toMatchObject({ id: 'opp-B-contaminada' });
    const linha = await estadoSql('opp-B-contaminada');
    expect(linha.tenant_key).toBe(TENANT_B);
    expect(linha.payload.tenant_key).toBeUndefined();
    expect(linha.payload.tenantId).toBeUndefined();
  });

  registrarCenario('8. atualização com id divergente no payload não troca de registro', async () => {
    await store.criarRegistro({ tenantId: TENANT_B, entity: ENTITY, id: 'opp-B-1', payload: { name: 'B1' } });
    const salvo = await store.atualizarRegistro({
      tenantId: TENANT_B, entity: ENTITY, id: 'opp-B-1',
      payload: { id: 'opp-A-1', name: 'B1 renomeada' },
    });
    expect(salvo.id).toBe('opp-B-1');
    expect((await estadoSql('opp-B-1')).payload.id).toBeUndefined();
    const a = await estadoSql('opp-A-1');
    expect(a.tenant_key).toBe(TENANT_A);
    expect(a.payload.name).toBe('Oportunidade A');
  });

  registrarCenario('9. repetir o ataque anterior continua rejeitado (idempotência da recusa)', async () => {
    for (let tentativa = 0; tentativa < 3; tentativa += 1) {
      await expect(store.criarRegistro({
        tenantId: TENANT_B, entity: ENTITY, id: 'opp-A-1',
        payload: { name: `tentativa ${tentativa}` },
      })).rejects.toMatchObject({ code: 'id_indisponivel' });
    }
    const a = await estadoSql('opp-A-1');
    expect(a.tenant_key).toBe(TENANT_A);
    expect(a.payload.name).toBe('Oportunidade A');
  });

  registrarCenario('10. dados de A permanecem intactos ao final da matriz', async () => {
    const a = await estadoSql('opp-A-1');
    expect(a).toMatchObject({ id: 'opp-A-1', tenant_key: TENANT_A, entity: ENTITY });
    expect(a.payload).toEqual({ name: 'Oportunidade A', value: 1000 });
  });

  registrarCenario('11. B nunca recebe dado confidencial de A em listagens', async () => {
    const listaB = await store.listarRegistros({ tenantId: TENANT_B, entity: ENTITY });
    const nomes = listaB.items.map((i) => i.name);
    expect(nomes).not.toContain('Oportunidade A');
    expect(listaB.items.every((i) => i.id !== 'opp-A-1')).toBe(true);
  });

  registrarCenario('12. operações simultâneas: só o dono atualiza; corrida não transfere', async () => {
    await store.criarRegistro({ tenantId: TENANT_A, entity: ENTITY, id: 'opp-A-race', payload: { name: 'race', value: 1 } });
    const resultados = await Promise.all([
      store.atualizarRegistro({ tenantId: TENANT_A, entity: ENTITY, id: 'opp-A-race', payload: { name: 'A venceu', value: 2 } }),
      store.atualizarRegistro({ tenantId: TENANT_B, entity: ENTITY, id: 'opp-A-race', payload: { name: 'B invadiu', value: 999 } }),
      store.atualizarRegistro({ tenantId: TENANT_B, entity: ENTITY, id: 'opp-A-race', payload: { name: 'B invadiu 2', value: 998 } }),
    ]);
    expect(resultados[0]).not.toBeNull();
    expect(resultados[1]).toBeNull();
    expect(resultados[2]).toBeNull();
    const linha = await estadoSql('opp-A-race');
    expect(linha.tenant_key).toBe(TENANT_A);
    expect(linha.payload.name).toBe('A venceu');
    expect(linha.payload.value).toBe(2);
  });

  registrarCenario('13. transação que falha na atualização não deixa estado parcial', async () => {
    await store.criarRegistro({ tenantId: TENANT_A, entity: ENTITY, id: 'opp-A-tx', payload: { name: 'antes', value: 10 } });
    await expect(sequelize.transaction(async (t) => {
      await sequelize.query(
        "UPDATE crm_records SET payload = jsonb_set(payload, '{name}', '\"parcial\"') WHERE id = 'opp-A-tx'",
        { transaction: t },
      );
      throw new Error('falha injetada no meio da transacao');
    })).rejects.toThrow('falha injetada');
    const linha = await estadoSql('opp-A-tx');
    expect(linha.payload.name).toBe('antes');
  });

  registrarCenario('14. trigger do banco recusa transferência de tenant_key (defesa em profundidade)', async () => {
    await expect(sequelize.query(
      "UPDATE crm_records SET tenant_key = 'tenant-b' WHERE id = 'opp-A-tx'",
    )).rejects.toMatchObject({ parent: expect.objectContaining({ code: '23514' }) });
    expect((await estadoSql('opp-A-tx')).tenant_key).toBe(TENANT_A);
  });

  registrarCenario('15. criação repetida no mesmo tenant não sobrescreve o existente', async () => {
    await expect(store.criarRegistro({
      tenantId: TENANT_A, entity: ENTITY, id: 'opp-A-tx', payload: { name: 'sobrescrita' },
    })).rejects.toMatchObject({ code: 'id_indisponivel' });
    expect((await estadoSql('opp-A-tx')).payload.name).toBe('antes');
  });

  registrarCenario('16. registro de tenant INEXISTENTE não pode ser apropriado', async () => {
    await expect(store.criarRegistro({
      tenantId: TENANT_B, entity: ENTITY, id: 'opp-A-tx', payload: { name: 'apropriacao' },
    })).rejects.toMatchObject({ code: 'id_indisponivel' });
    expect((await estadoSql('opp-A-tx')).tenant_key).toBe(TENANT_A);
  });

  registrarCenario('17. entidade diferente não pode sequestrar registro de outra entidade', async () => {
    const resultado = await store.atualizarRegistro({
      tenantId: TENANT_A, entity: 'accounts', id: 'opp-A-tx', payload: { name: 'via accounts' },
    });
    expect(resultado).toBeNull();
    expect((await estadoSql('opp-A-tx')).entity).toBe(ENTITY);
  });

  registrarCenario('18. permissões de criação e atualização são operações distintas', async () => {
    // A operação de criação nunca atualiza e a de atualização nunca cria.
    const antes = await contarSql();
    const inexistente = await store.atualizarRegistro({
      tenantId: TENANT_A, entity: ENTITY, id: 'nao-existe-123', payload: { name: 'fantasma' },
    });
    expect(inexistente).toBeNull();
    expect(await contarSql()).toBe(antes);
  });

  registrarCenario('19. tenant inválido/vazio não grava nada', async () => {
    await expect(store.criarRegistro({
      tenantId: '   ', entity: ENTITY, id: 'opp-sem-tenant', payload: { name: 'x' },
    })).rejects.toMatchObject({ code: 'dados_invalidos' });
    expect(await estadoSql('opp-sem-tenant')).toBeNull();
  });

  registrarCenario('20. após reconexão (restart da aplicação) o isolamento continua', async () => {
    const modeloAntes = sequelize.models.CrmRecord;
    expect(modeloAntes).toBeDefined();
    // simula restart: nova conexão, mesmo banco
    const outra = new Sequelize(PG_URL, { logging: false });
    try {
      await outra.authenticate();
      const [linhas] = await outra.query("SELECT tenant_key, payload FROM crm_records WHERE id = 'opp-A-1'");
      expect(linhas[0].tenant_key).toBe(TENANT_A);
      expect(linhas[0].payload.name).toBe('Oportunidade A');
      const [b] = await outra.query("SELECT COUNT(*)::int AS total FROM crm_records WHERE id = 'opp-A-1' AND tenant_key = 'tenant-b'");
      expect(b[0].total).toBe(0);
    } finally {
      await outra.close().catch(() => {});
    }
  });
});

describe('P0-02 — métricas e persistência após a matriz', () => {
  registrarCenario('21. contagem por tenant continua consistente (métricas)', async () => {
    const [linhas] = await sequelize.query(
      'SELECT tenant_key, COUNT(*)::int AS total FROM crm_records GROUP BY tenant_key ORDER BY tenant_key',
    );
    const porTenant = Object.fromEntries(linhas.map((l) => [l.tenant_key, l.total]));
    expect(porTenant[TENANT_A]).toBeGreaterThanOrEqual(3); // opp-A-1, opp-A-race, opp-A-tx
    expect(porTenant[TENANT_B]).toBeGreaterThanOrEqual(2); // opp-B-1, opp-B-contaminada
    const [doA] = await sequelize.query(
      "SELECT COUNT(*)::int AS total FROM crm_records WHERE tenant_key = :t",
      { replacements: { t: TENANT_A } },
    );
    expect(doA[0].total).toBe(porTenant[TENANT_A]);
  });

  registrarCenario('22. nenhuma linha tem tenant_key divergente do dono original', async () => {
    const [linhas] = await sequelize.query(
      "SELECT id, tenant_key FROM crm_records WHERE id IN ('opp-A-1','opp-A-race','opp-A-tx')",
    );
    expect(linhas.every((l) => l.tenant_key === TENANT_A)).toBe(true);
  });
});
