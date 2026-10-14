'use strict';

/**
 * INTEGRATION TEST — importação/sincronização EVO → domínios canônicos do RAP,
 * contra o Postgres real (mesma config da API) e o fake EVO server local.
 *
 * Prova os critérios de aceite da missão:
 * - membro → MarketingLead → WorkspaceEntity/Link → AccessSubject;
 * - matrícula → AccessMembership com campos mapeados (datas/plano/status);
 * - entrada → VerticalAttendance sem duplicação (reimportação e overlap);
 * - venda/recebível → BillingTransaction sem duplicação;
 * - idempotência fundamental: rodar a MESMA sincronização 2x não duplica nada;
 * - isolamento multi-tenant: mesmo external id em tenants diferentes;
 * - external id NUNCA é PK interna.
 *
 * Todo dado criado é escopado em tenants de teste (`itest-evo-*`) e removido ao
 * final.
 */

const crypto = require('crypto');

jest.setTimeout(120000);

const { connect, close, getSequelize } = require('../../api/db/sequelize');
const {
  MarketingLead, AccessSubject, AccessMembership, VerticalAttendance,
  BillingTransaction, WorkspaceEntityLink, IntegrationConnection,
  IntegrationObjectLink, IntegrationSyncState,
} = require('../../api/db/models');
const { createFakeEvoServer, labConfig } = require('../helpers/fakeEvoServer');
const { resetRegistry, registerProvider } = require('../../api/services/integration/integrationRegistry');
const evoProvider = require('../../api/services/integration/providers/evo/evoProviderAdapter');
const connectionService = require('../../api/services/integration/integrationConnectionService');
const syncService = require('../../api/services/integration/integrationSyncService');

const TENANT_A = `itest-evo-a-${crypto.randomBytes(4).toString('hex')}`;
const TENANT_B = `itest-evo-b-${crypto.randomBytes(4).toString('hex')}`;

/** Datas fixas: determinismo e independência do dia da execução. */
const DATASET = {
  plans: [
    { idMembershipPlan: 30, name: 'Mensal Fit', type: 'monthly', amount: '199,90', cycle: 'MONTHLY', active: '1' },
  ],
  members: [
    { idMember: 100, name: 'Aluno Um', email: 'aluno.um@example.test', phone: '+5511911111111', status: '1', idBranch: '1', registerDate: '2026-01-05T10:00:00.000Z' },
    { idMember: 200, name: 'Aluno Dois', email: 'aluno.dois@example.test', phone: '+5511922222222', status: '1', idBranch: '1', registerDate: '2026-02-06T10:00:00.000Z' },
  ],
  prospects: [
    { idProspect: 300, name: 'Visitante', email: 'visitante@example.test', stage: 'visitante' },
  ],
  memberships: [
    {
      idMembership: 887,
      idMember: 100,
      idMembershipPlan: 30,
      planName: 'Mensal Fit',
      planType: 'monthly',
      status: 'active',
      billingStatus: 'active',
      startDate: '2026-01-05T00:00:00.000Z',
      endDate: '2027-01-05T00:00:00.000Z',
      dueDate: '2026-10-05T00:00:00.000Z',
      renewalDate: '2026-11-05T00:00:00.000Z',
      idBranch: '1',
    },
    {
      idMembership: 888,
      idMember: 200,
      idMembershipPlan: 30,
      planName: 'Mensal Fit',
      planType: 'monthly',
      status: 'active',
      billingStatus: 'active',
      startDate: '2026-02-06T00:00:00.000Z',
      endDate: '2027-02-06T00:00:00.000Z',
      idBranch: '1',
    },
  ],
  entries: [
    { idEntry: 554423, idMember: 100, date: '2026-09-01T07:30:00.000Z', idBranch: '1', idDevice: 'catraca-1' },
    { idEntry: 554424, idMember: 100, date: '2026-09-03T18:10:00.000Z', idBranch: '1', idDevice: 'catraca-1' },
    { idEntry: 554425, idMember: 200, date: '2026-09-02T08:00:00.000Z', idBranch: '1', idDevice: 'catraca-2' },
  ],
  sales: [
    { idSale: 9001, idMember: 100, status: 'paid', amount: '199.90', currency: 'BRL', type: 'plan', date: '2026-09-01T12:00:00.000Z' },
  ],
  receivables: [
    { idReceivable: 99001, idMember: 100, idSale: 9001, status: 'open', amount: '199.90', currency: 'BRL', dueDate: '2026-10-05T00:00:00.000Z' },
  ],
};

async function countRows(ModelFactory, where) {
  return ModelFactory().count({ where });
}

async function cleanupTenant(tenantId) {
  await BillingTransaction().destroy({ where: { tenant_key: tenantId } });
  await VerticalAttendance().destroy({ where: { tenant_key: tenantId } });
  await AccessMembership().destroy({ where: { tenant_key: tenantId } });
  await AccessSubject().destroy({ where: { tenant_key: tenantId } });
  await WorkspaceEntityLink().destroy({ where: { tenant_id: tenantId } });
  await MarketingLead().destroy({ where: { tenant_key: tenantId } });
  await IntegrationObjectLink().destroy({ where: { tenant_key: tenantId } });
  await IntegrationSyncState().destroy({ where: { tenant_key: tenantId } });
  await IntegrationConnection().destroy({ where: { tenant_key: tenantId } });
}

describe('EVO → RAP: sincronização real contra Postgres', () => {
  let server;
  let connectionId;

  beforeAll(async () => {
    await connect(5, 500);
    resetRegistry();
    registerProvider(evoProvider);
    server = createFakeEvoServer({ datasets: DATASET, pageSize: 2 });
    await server.listen();
    await cleanupTenant(TENANT_A);
    await cleanupTenant(TENANT_B);
    // Conexão com credenciais REAIS do fake server (cifradas em repouso pelo serviço).
    const connection = await connectionService.createConnection({
      tenantId: TENANT_A,
      provider: 'evo',
      label: 'Academia Teste',
      externalUnitId: '1',
      unitLabel: 'Unidade Única',
      config: labConfig(server.baseUrl, { pageSize: 2 }),
      credentials: server.credentials,
      status: 'connected',
    });
    connectionId = connection.id;
  });

  afterAll(async () => {
    await cleanupTenant(TENANT_A);
    await cleanupTenant(TENANT_B);
    if (server) await server.close();
    await close().catch(() => {});
  });

  it('executa o initial sync completo na ordem de dependência', async () => {
    const result = await syncService.runInitialSync({ tenantId: TENANT_A, connectionId });
    expect(result.status).toBe('completed');
    expect(result.resources.map((r) => r.resource)).toEqual(
      ['plans', 'members', 'prospects', 'memberships', 'entries', 'sales', 'receivables'],
    );
    const byResource = Object.fromEntries(result.resources.map((r) => [r.resource, r.stats]));
    expect(byResource.members.created).toBe(2);
    expect(byResource.prospects.created).toBe(1);
    expect(byResource.memberships.created).toBe(2);
    expect(byResource.entries.created).toBe(3);
    expect(byResource.sales.created).toBe(1);
    expect(byResource.receivables.created).toBe(1);
    expect(byResource.members.rejected).toBe(0);
    expect(byResource.entries.rejected).toBe(0);
  });

  it('materializa a cadeia completa do aluno (CRM → Workspace → AccessSubject)', async () => {
    const leads = await MarketingLead().findAll({ where: { tenant_key: TENANT_A } });
    expect(leads).toHaveLength(3); // 2 membros + 1 prospect

    const memberLead = leads.find((l) => l.email === 'aluno.um@example.test');
    expect(memberLead).toBeDefined();

    const links = await IntegrationObjectLink().findAll({
      where: { tenant_key: TENANT_A, resource_type: 'members', external_id: '100' },
    });
    expect(links).toHaveLength(1);
    // O id externo NUNCA é a PK interna.
    expect(links[0].internal_id).toBe(String(memberLead.id));
    expect(links[0].internal_id).not.toBe('100');

    const subjects = await AccessSubject().findAll({ where: { tenant_key: TENANT_A, customer_id: String(memberLead.id) } });
    expect(subjects).toHaveLength(1);

    const entityLink = await WorkspaceEntityLink().findOne({
      where: { tenant_id: TENANT_A, source_type: 'lead', source_id: String(memberLead.id) },
    });
    expect(entityLink).not.toBeNull();
  });

  it('materializa a matrícula com datas e plano mapeados (gap AccessMembership corrigido)', async () => {
    const rows = await AccessMembership().findAll({ where: { tenant_key: TENANT_A } });
    expect(rows).toHaveLength(2);

    // Resolve a matrícula do aluno 100 pelo vínculo externo (não por heurística).
    const link = await IntegrationObjectLink().findOne({
      where: { tenant_key: TENANT_A, resource_type: 'memberships', external_id: '887' },
    });
    expect(link).not.toBeNull();
    const membership = rows.find((r) => String(r.id) === String(link.internal_id));
    expect(membership).toBeDefined();
    expect(membership.plan_name).toBe('Mensal Fit');
    // Campos que antes eram descartados em silêncio pelo model:
    expect(membership.plan_type).toBe('monthly');
    expect(membership.due_date).toBeInstanceOf(Date);
    expect(membership.due_date.toISOString()).toBe('2026-10-05T00:00:00.000Z');
    expect(membership.renewal_at.toISOString()).toBe('2026-11-05T00:00:00.000Z');
    expect(membership.start_at.toISOString()).toBe('2026-01-05T00:00:00.000Z');
    expect(membership.end_at.toISOString()).toBe('2027-01-05T00:00:00.000Z');
    // Id interno determinístico, nunca o id externo do provider.
    expect(String(membership.id)).not.toBe('887');
    expect(membership.id).toMatch(/^amem-/);
  });

  it('cria telemetria de presença sem duplicar', async () => {
    const count = await countRows(VerticalAttendance, { tenant_key: TENANT_A });
    expect(count).toBe(3);
    const entries = await VerticalAttendance().findAll({ where: { tenant_key: TENANT_A }, order: [['checked_in_at', 'ASC']] });
    expect(entries[0].checked_in_at.toISOString()).toBe('2026-09-01T07:30:00.000Z');
    expect(entries.map((e) => e.status)).toEqual(['closed', 'closed', 'closed']);
  });

  it('importa venda e recebível como BillingTransaction', async () => {
    const rows = await BillingTransaction().findAll({ where: { tenant_key: TENANT_A }, order: [['created_at', 'ASC']] });
    expect(rows).toHaveLength(2);
    const sale = rows.find((r) => r.external_transaction_id === '9001');
    const receivable = rows.find((r) => r.external_transaction_id === '99001');
    expect(sale.status).toBe('paid');
    expect(Number(sale.amount)).toBeCloseTo(199.9, 2);
    expect(receivable.status).toBe('pending');
    expect(receivable.external_customer_id).toBe('100');
  });

  it('PROVA DE IDEMPOTÊNCIA: reexecutar o initial sync não duplica nada', async () => {
    const before = {
      leads: await countRows(MarketingLead, { tenant_key: TENANT_A }),
      memberships: await countRows(AccessMembership, { tenant_key: TENANT_A }),
      attendances: await countRows(VerticalAttendance, { tenant_key: TENANT_A }),
      transactions: await countRows(BillingTransaction, { tenant_key: TENANT_A }),
      links: await countRows(IntegrationObjectLink, { tenant_key: TENANT_A }),
      subjects: await countRows(AccessSubject, { tenant_key: TENANT_A }),
    };

    const second = await syncService.runInitialSync({ tenantId: TENANT_A, connectionId });
    const byResource = Object.fromEntries(second.resources.map((r) => [r.resource, r.stats]));
    expect(byResource.members.created).toBe(0);
    expect(byResource.memberships.created).toBe(0);
    expect(byResource.entries.created).toBe(0);
    expect(byResource.sales.created).toBe(0);
    expect(byResource.receivables.created).toBe(0);

    const after = {
      leads: await countRows(MarketingLead, { tenant_key: TENANT_A }),
      memberships: await countRows(AccessMembership, { tenant_key: TENANT_A }),
      attendances: await countRows(VerticalAttendance, { tenant_key: TENANT_A }),
      transactions: await countRows(BillingTransaction, { tenant_key: TENANT_A }),
      links: await countRows(IntegrationObjectLink, { tenant_key: TENANT_A }),
      subjects: await countRows(AccessSubject, { tenant_key: TENANT_A }),
    };
    expect(after).toEqual(before);
  });

  it('isola tenants: mesmo external id em outro tenant é outra identidade', async () => {
    const connectionB = await connectionService.createConnection({
      tenantId: TENANT_B,
      provider: 'evo',
      label: 'Outra academia',
      externalUnitId: '1',
      config: labConfig(server.baseUrl, { pageSize: 2 }),
      credentials: server.credentials,
      status: 'connected',
    });

    await syncService.runInitialSync({ tenantId: TENANT_B, connectionId: connectionB.id });

    const linksA = await IntegrationObjectLink().findAll({
      where: { tenant_key: TENANT_A, resource_type: 'members', external_id: '100' },
    });
    const linksB = await IntegrationObjectLink().findAll({
      where: { tenant_key: TENANT_B, resource_type: 'members', external_id: '100' },
    });
    expect(linksA).toHaveLength(1);
    expect(linksB).toHaveLength(1);
    expect(linksA[0].internal_id).not.toBe(linksB[0].internal_id);

    const leadsB = await countRows(MarketingLead, { tenant_key: TENANT_B });
    const leadsA = await countRows(MarketingLead, { tenant_key: TENANT_A });
    expect(leadsB).toBe(3);
    expect(leadsA).toBe(3);
  });

  it('a inteligência Fitness consome os dados sincronizados (frequência real)', async () => {
    const memberLink = await IntegrationObjectLink().findOne({
      where: { tenant_key: TENANT_A, resource_type: 'members', external_id: '100' },
    });
    const subjectLink = await IntegrationObjectLink().findOne({
      where: { tenant_key: TENANT_A, resource_type: 'members_subject', external_id: '100' },
    });
    expect(subjectLink).not.toBeNull();

    const subject = await AccessSubject().findOne({ where: { tenant_key: TENANT_A, id: subjectLink.internal_id } });
    expect(subject.customer_id).toBe(String(memberLink.internal_id));

    // A agregação canônica de frequência lê VerticalAttendance — prova de que a
    // importação alimenta frequência/churn/timeline sem domínio paralelo.
    const fitnessAttendanceService = require('../../api/services/vertical/fitnessAttendanceService');
    const history = await fitnessAttendanceService.getAttendanceHistory({
      tenantId: TENANT_A,
      subjectId: subjectLink.internal_id,
      windowDays: 365,
    });
    // Entradas importadas: 2026-09-01 e 2026-09-03.
    expect(history.total).toBe(2);
    // As janelas de 7/30 dias são MÓVEIS: calculadas contra o relógio de execução
    // (`fitnessAttendanceService.getAttendanceHistory` compara com `agora - N dias`).
    // Fixar `frequency30d` em 2 produziu um time bomb: as entradas de 01-03/09/2026
    // saíram da janela de 30 dias em 2026-10-03 e o teste passou a falhar sozinho
    // (medido em 2026-10-14, que é como este defeito foi descoberto). A expectativa
    // é derivada da semântica da janela sobre os itens REALMENTE retornados, e
    // combinada com invariantes que valem em qualquer data de execução.
    const agoraMs = Date.now();
    const dentroDaJanela = (dias) =>
      history.items.filter((a) => new Date(a.checked_in_at).getTime() >= agoraMs - dias * 24 * 60 * 60 * 1000).length;
    expect(history.frequency30d).toBe(dentroDaJanela(30));
    expect(history.frequency7d).toBe(dentroDaJanela(7));
    // Invariantes estruturais: 7d ⊆ 30d ⊆ total, e a agregação é real (não um eco
    // do import) — com estas datas, a janela curta é estritamente menor.
    expect(history.frequency7d).toBeLessThanOrEqual(history.frequency30d);
    expect(history.frequency30d).toBeLessThanOrEqual(history.total);
    expect(history.frequency7d).toBe(0);
    expect(history.items.map((a) => a.checked_in_at.toISOString())).toEqual([
      '2026-09-03T18:10:00.000Z',
      '2026-09-01T07:30:00.000Z',
    ]);
  });

  it('persiste watermark e cursor no estado de sync por recurso', async () => {
    const state = await IntegrationSyncState().findOne({
      where: { tenant_key: TENANT_A, connection_id: connectionId, resource_type: 'entries' },
    });
    expect(state).not.toBeNull();
    expect(state.watermark_at).toBeInstanceOf(Date);
    expect(state.status).toBe('idle');
    expect(state.initial_sync_completed_at).toBeInstanceOf(Date);
    expect(state.cursor).toBeNull();
    expect(state.stats.lastRun.fetched).toBe(3);
  });

  it('a conexão persiste credencial cifrada e nunca em claro', async () => {
    const row = await IntegrationConnection().findOne({ where: { tenant_key: TENANT_A, id: connectionId } });
    expect(row).not.toBeNull();
    expect(row.credentials_encrypted).toBeTruthy();
    expect(row.credentials_encrypted).not.toContain(server.credentials.secretKey);
    const publicView = connectionService.toPublicConnection(row);
    expect(publicView.credentials_encrypted).toBeUndefined();
    expect(JSON.stringify(publicView)).not.toContain(server.credentials.secretKey);
  });
});
