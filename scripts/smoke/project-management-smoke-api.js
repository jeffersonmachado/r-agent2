'use strict';

const fs = require('fs');

const BASE_URL = process.env.API_BASE_URL || 'http://localhost:3001';
const REPORT_PATH = '/tmp/project_management_smoke_report.md';
const ADMIN_USERNAME = process.env.TEST_ADMIN_USERNAME || 'systemadmin';
const ADMIN_PASSWORD = process.env.TEST_ADMIN_PASSWORD || 'Admin123!';
const EXPLICIT_TENANT_ID = process.env.TEST_TENANT_ID || '';

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { raw: text };
  }
  return { response, body };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function writeReport(lines) {
  fs.writeFileSync(REPORT_PATH, `${lines.join('\n')}\n`, 'utf8');
}

async function resolveTenantId(token) {
  if (EXPLICIT_TENANT_ID) return EXPLICIT_TENANT_ID;

  const tenantsResult = await fetchJson(`${BASE_URL}/tenants`, {
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
  });

  assert(tenantsResult.response.ok, `Falha ao listar tenants: ${tenantsResult.response.status}`);
  const tenants = Array.isArray(tenantsResult.body?.tenants) ? tenantsResult.body.tenants : [];
  const preferredTenant = tenants.find((tenant) => {
    const key = String(tenant.tenant_key || tenant.key || tenant.slug || '').toLowerCase();
    const id = String(tenant.id || '').toLowerCase();
    return key === 'tenant-demo' || id === 'tenant-demo';
  }) || tenants.find((tenant) => {
    const key = String(tenant.tenant_key || tenant.key || tenant.slug || '').toLowerCase();
    const id = String(tenant.id || '').toLowerCase();
    return key !== 'system' && id !== 'system';
  });

  assert(preferredTenant?.id, 'Nenhum tenant utilizável encontrado para o smoke de projects');
  return preferredTenant.id;
}

(async () => {
  const report = [];
  report.push('# Project Management API Smoke Report');
  report.push(`- Date: ${new Date().toISOString()}`);
  report.push(`- API Base URL: ${BASE_URL}`);

  try {
    const loginResult = await fetchJson(`${BASE_URL}/auth/login`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        username: ADMIN_USERNAME,
        password: ADMIN_PASSWORD,
      }),
    });

    assert(loginResult.response.ok, `Falha no login admin: ${loginResult.response.status}`);
    assert(loginResult.body?.token, 'Resposta de /auth/login sem token');
    const authToken = loginResult.body.token;

    const tenantId = await resolveTenantId(authToken);
    report.push(`- Tenant: ${tenantId}`);

    const authHeaders = {
      authorization: `Bearer ${authToken}`,
      'x-tenant-id': tenantId,
      'content-type': 'application/json',
    };

    const projectsResult = await fetchJson(`${BASE_URL}/projects`, { headers: authHeaders });
    assert(projectsResult.response.ok, `Listagem de projetos falhou: ${projectsResult.response.status}`);
    const initialCount = Array.isArray(projectsResult.body?.projects) ? projectsResult.body.projects.length : 0;
    report.push(`- Projects list OK: ${initialCount} projeto(s) antes do smoke`);

    const createProjectResult = await fetchJson(`${BASE_URL}/projects`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        name: `Projeto Smoke ${Date.now()}`,
        description: 'Projeto criado pelo smoke automatizado do módulo project-management.',
        priority: 'high',
      }),
    });
    assert(createProjectResult.response.ok, `Criação de projeto falhou: ${createProjectResult.response.status}`);
    const project = createProjectResult.body?.project;
    assert(project?.id, 'Criação de projeto não retornou project.id');
    report.push(`- Project created: ${project.id}`);

    const listsResult = await fetchJson(`${BASE_URL}/projects/${project.id}/lists`, { headers: authHeaders });
    assert(listsResult.response.ok, `Listagem de colunas falhou: ${listsResult.response.status}`);
    const lists = Array.isArray(listsResult.body?.lists) ? listsResult.body.lists : [];
    const todoList = lists.find((list) => String(list.slug || '').toLowerCase() === 'todo') || lists[0];
    const doneList = lists.find((list) => String(list.slug || '').toLowerCase() === 'done');
    assert(todoList?.id, 'Nenhuma coluna disponível para criar item');
    assert(doneList?.id, 'Coluna done não encontrada');
    report.push(`- Lists OK: ${lists.length} coluna(s)`);

    const createItemResult = await fetchJson(`${BASE_URL}/projects/${project.id}/items`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        list_id: todoList.id,
        title: 'Item smoke',
        item_type: 'task',
        priority: 'medium',
      }),
    });
    assert(createItemResult.response.ok, `Criação de item falhou: ${createItemResult.response.status}`);
    const item = createItemResult.body?.item;
    assert(item?.id, 'Criação de item não retornou item.id');
    report.push(`- Item created: ${item.id}`);

    const commentResult = await fetchJson(`${BASE_URL}/projects/${project.id}/items/${item.id}/comments`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        body: 'Comentário smoke automatizado.',
      }),
    });
    assert(commentResult.response.ok, `Criação de comentário falhou: ${commentResult.response.status}`);
    assert(commentResult.body?.comment?.id, 'Comentário não retornou id');
    report.push('- Comment created');

    const moveResult = await fetchJson(`${BASE_URL}/projects/${project.id}/items/${item.id}/move`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        list_id: doneList.id,
      }),
    });
    assert(moveResult.response.ok, `Movimentação do item falhou: ${moveResult.response.status}`);
    assert(moveResult.body?.item?.list_id === doneList.id, 'Item não foi movido para a coluna done');
    report.push('- Item moved to done');

    const activityResult = await fetchJson(`${BASE_URL}/projects/${project.id}/activities`, { headers: authHeaders });
    assert(activityResult.response.ok, `Leitura de histórico falhou: ${activityResult.response.status}`);
    const activities = Array.isArray(activityResult.body?.activities) ? activityResult.body.activities : [];
    const eventTypes = new Set(activities.map((activity) => activity.event_type));
    assert(eventTypes.has('project.created'), 'Histórico sem project.created');
    assert(eventTypes.has('project.item_created'), 'Histórico sem project.item_created');
    assert(eventTypes.has('project.comment_created'), 'Histórico sem project.comment_created');
    assert(eventTypes.has('project.item_moved'), 'Histórico sem project.item_moved');
    report.push(`- Activities OK: ${activities.length} evento(s)`);

    report.push('');
    report.push('## Result');
    report.push('- SUCCESS');

    writeReport(report);
    console.log('Project management API smoke succeeded.');
    console.log(`Report: ${REPORT_PATH}`);
  } catch (err) {
    writeReport([
      '# Project Management API Smoke Report',
      `- Date: ${new Date().toISOString()}`,
      '- Result: FAILED',
      `- Error: ${err.message}`,
    ]);
    console.error('Project management API smoke failed:', err.message);
    console.error(`Report: ${REPORT_PATH}`);
    process.exitCode = 1;
  }
})();
