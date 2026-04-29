'use strict';

/**
 * Script: create-launch-project.js
 * Cria o projeto "Lançamento RAP — 1/6/2026" com todas as tarefas
 * necessárias para concluir o trabalho antes do lançamento.
 *
 * Uso:
 *   node scripts/create-launch-project.js
 *
 * Requer a API rodando em http://localhost:3001
 */

const http = require('http');

const BASE_URL = 'http://localhost:3001';
const USERNAME = 'systemadmin';
const PASSWORD = 'Admin123!';
let TENANT_ID = 'system'; // será atualizado após login

function request(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const options = {
      hostname: 'localhost',
      port: 3001,
      path,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}`, 'X-Tenant-Id': TENANT_ID } : {}),
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
      },
    };
    const req = http.request(options, (res) => {
      let raw = '';
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(raw) });
        } catch {
          resolve({ status: res.statusCode, body: raw });
        }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function login() {
  const res = await request('POST', '/api/auth/login', { username: USERNAME, password: PASSWORD });
  if (!res.body.token) throw new Error(`Login falhou: ${JSON.stringify(res.body)}`);
  TENANT_ID = res.body.agent?.tenantId || 'system';
  return res.body.token;
}

async function createProject(token, payload) {
  const res = await request('POST', '/projects', payload, token);
  if (!res.body.ok) throw new Error(`Erro ao criar projeto: ${JSON.stringify(res.body)}`);
  return res.body.project;
}

async function getLists(token, projectId) {
  const res = await request('GET', `/projects/${projectId}/lists`, null, token);
  if (!res.body.ok) throw new Error(`Erro ao obter listas: ${JSON.stringify(res.body)}`);
  return res.body.lists;
}

async function createItem(token, projectId, payload) {
  const res = await request('POST', `/projects/${projectId}/items`, payload, token);
  if (!res.body.ok) {
    console.warn(`  ⚠ Item não criado: ${payload.title} — ${JSON.stringify(res.body)}`);
    return null;
  }
  return res.body.item;
}

async function addMember(token, projectId, payload) {
  const res = await request('POST', `/projects/${projectId}/members`, payload, token);
  return res.body;
}

// ─── Definição de tarefas ──────────────────────────────────────────────────
// Cada grupo mapeia para uma lista (coluna) do board.
// listSlug: 'backlog' | 'todo' | 'doing' | 'review' | 'blocked' | 'done'
// priority: 'critical' | 'high' | 'medium' | 'low'
// dueDate: 'YYYY-MM-DD'

const TASKS = [
  // ── P0 BLOQUEADORES DE RELEASE ──────────────────────────────────────────
  {
    title: 'Executar gate de release D-7 (npm run system:release-gate)',
    description: 'Validar que todos os smokes L-01 a L-05 estão em PASS. Gerar qa/release-gate-report.json com status=PASS.',
    listSlug: 'todo',
    itemType: 'task',
    priority: 'critical',
    dueDate: '2026-05-24',
  },
  {
    title: 'Formalizar decisão go/no-go D-7 com owners (npm run system:release-decision)',
    description: 'Registrar branch/tag candidata, owners de plantão (engenharia + operação) e escopo congelado em qa/release-decision.json.',
    listSlug: 'todo',
    itemType: 'task',
    priority: 'critical',
    dueDate: '2026-05-24',
  },
  {
    title: 'Executar rollback drill (npm run system:rollback-drill)',
    description: 'Validar procedimento de rollback completo. Resultado esperado: drill OK com evidência PBX L-03/L-04.',
    listSlug: 'todo',
    itemType: 'task',
    priority: 'critical',
    dueDate: '2026-05-28',
  },
  {
    title: 'Executar go/no-go técnico D-1 (npm run system:go-no-go)',
    description: 'Gerar qa/go-no-go-report.json com decision=GO. Rerodar gate completo em janela controlada. Selftest sem FAIL.',
    listSlug: 'todo',
    itemType: 'task',
    priority: 'critical',
    dueDate: '2026-05-30',
  },
  {
    title: 'Executar janela de release D0 e deploy em produção',
    description: 'npm run system:release-window + deploy da versão candidata + smoke pós-release imediato passando.',
    listSlug: 'todo',
    itemType: 'task',
    priority: 'critical',
    dueDate: '2026-06-01',
  },
  {
    title: 'Validar smoke pós-deploy: omnichannel, filas e PBX',
    description: 'Confirmar operação mínima por suíte: Fast Service (kiosk/panel/station), Orders/Delivery, PBX TTS/ASR e ChatPro.',
    listSlug: 'todo',
    itemType: 'task',
    priority: 'critical',
    dueDate: '2026-06-01',
  },

  // ── CONVERGÊNCIA ARQUITETURAL ────────────────────────────────────────────
  {
    title: 'Decompor api/server.js em handlers/serviços menores',
    description: 'Reduzir hotspot de api/server.js movendo handlers para módulos alinhados à arquitetura técnica. Critério: mudanças novas passam a seguir arquitetura-alvo.',
    listSlug: 'todo',
    itemType: 'task',
    priority: 'high',
    dueDate: '2026-05-20',
  },
  {
    title: 'Reduzir validações e mensagens canônicas duplicadas no frontend',
    description: 'Migrar regras compartilháveis para backend e módulos compartilhados. Remover expansão de estilos inline estáticos nas áreas críticas.',
    listSlug: 'backlog',
    itemType: 'task',
    priority: 'medium',
    dueDate: '2026-05-25',
  },

  // ── ATENDIMENTO OMNICHANNEL ──────────────────────────────────────────────
  {
    title: 'Hardening conversa↔ticket 1:1 em todos os canais',
    description: 'Garantir consistência em WhatsApp, ChatPro, Inbox e demais canais. Idempotência de mensagem no ticket (retry sem duplicar).',
    listSlug: 'todo',
    itemType: 'task',
    priority: 'critical',
    dueDate: '2026-05-18',
  },
  {
    title: 'Status por mensagem no console do atendente (sent/delivered/read/failed)',
    description: 'Exibir status de entrega de cada mensagem na visão do atendente em todos os canais suportados.',
    listSlug: 'todo',
    itemType: 'task',
    priority: 'high',
    dueDate: '2026-05-18',
  },
  {
    title: 'SLA operacional por fila/departamento com alertas e trilha auditável',
    description: 'Configurar SLA mínimos por fila e departamento. Alertas quando SLA estiver próximo de vencer. Evidência no gate.',
    listSlug: 'todo',
    itemType: 'task',
    priority: 'high',
    dueDate: '2026-05-20',
  },
  {
    title: 'Roteamento por skills/capacidade/horário (além de round_robin/least_busy)',
    description: 'Implementar roteamento avançado: skills do atendente, capacidade atual e horário de atendimento.',
    listSlug: 'backlog',
    itemType: 'task',
    priority: 'medium',
    dueDate: '2026-05-22',
  },
  {
    title: 'Customer 360 operacional — histórico unificado por cliente',
    description: 'Consolidar histórico de mensagens, tickets, pedidos e eventos por cliente em uma visão única.',
    listSlug: 'backlog',
    itemType: 'task',
    priority: 'medium',
    dueDate: '2026-05-25',
  },
  {
    title: 'Validar operação omnichannel com evidência no gate (L-05)',
    description: 'Executar scripts/test-inbox-runtime-smoke.js e confirmar L-05 em PASS com operações assign/transfer/note/tags/quick replies.',
    listSlug: 'todo',
    itemType: 'task',
    priority: 'critical',
    dueDate: '2026-05-22',
  },

  // ── FILAS FÍSICAS ────────────────────────────────────────────────────────
  {
    title: 'Regras por unidade/serviço/horário/capacidade para filas físicas',
    description: 'Configuração avançada de regras de fila: por unidade, tipo de serviço, horário de funcionamento e capacidade máxima.',
    listSlug: 'todo',
    itemType: 'task',
    priority: 'high',
    dueDate: '2026-05-18',
  },
  {
    title: 'Priorização robusta: preferencial/agendado/triagem',
    description: 'Implementar lógica de priorização de tickets de fila por tipo: preferencial, agendado e triagem.',
    listSlug: 'todo',
    itemType: 'task',
    priority: 'high',
    dueDate: '2026-05-18',
  },
  {
    title: 'Métricas consistentes de fila (wait_time, throughput, abandon_rate)',
    description: 'Garantir cálculo correto de wait_time, throughput e abandon_rate por unidade/serviço/faixa horária.',
    listSlug: 'todo',
    itemType: 'task',
    priority: 'high',
    dueDate: '2026-05-20',
  },
  {
    title: 'Validar jornada kiosk→station→panel com evidência no gate (L-01)',
    description: 'Executar scripts/test-physical-queue-smoke.js. Confirmar L-01 em PASS com operações call/start/finish/skip/transfer.',
    listSlug: 'todo',
    itemType: 'task',
    priority: 'critical',
    dueDate: '2026-05-22',
  },

  // ── PBX / VOZ ────────────────────────────────────────────────────────────
  {
    title: 'Validar PBX v1 com chamada real (click2call/originate)',
    description: 'Confirmar originated=true em chamada real via POST /api/cc/click2call. CDR validado em GET /api/pbx/cdr.',
    listSlug: 'todo',
    itemType: 'task',
    priority: 'critical',
    dueDate: '2026-05-20',
  },
  {
    title: 'Fechar TTS+ASR funcional no fluxo de voz',
    description: 'Smoke TTS+ASR dedicado passando. Evidência em qa/l03-pbx-voice-tts-asr-evidence.json.',
    listSlug: 'todo',
    itemType: 'task',
    priority: 'critical',
    dueDate: '2026-05-20',
  },
  {
    title: 'Validar call events (ringing/answered/ended) com trigger de runtime (L-03/L-04)',
    description: 'Confirmar trigger CallEnded no runtime com executionId e node_executions registrados. Gate PASS com evidência de voz real.',
    listSlug: 'todo',
    itemType: 'task',
    priority: 'critical',
    dueDate: '2026-05-22',
  },
  {
    title: 'Endurecer integrações PBX com protocolos reais de dispositivos/vendors',
    description: 'Validar integração com Grandstream e Avaya em staging. Provisionamento em lote e rotação de token com trilha auditável.',
    listSlug: 'backlog',
    itemType: 'task',
    priority: 'medium',
    dueDate: '2026-05-25',
  },

  // ── ACCESS CONTROL ───────────────────────────────────────────────────────
  {
    title: 'Completar overrides operacionais de acesso/presença',
    description: 'Implementar overrides manuais de decisão de acesso com trilha auditável. Completar analytics específicos de acesso.',
    listSlug: 'backlog',
    itemType: 'task',
    priority: 'medium',
    dueDate: '2026-05-25',
  },

  // ── ANALYTICS / ROI v1 ───────────────────────────────────────────────────
  {
    title: 'Funil visual básico com atribuição mínima por canal (Analytics v1)',
    description: 'Evoluir Analytics/ROI do v0 para v1. Funil visual de conversão com atribuição por canal de origem.',
    listSlug: 'todo',
    itemType: 'task',
    priority: 'high',
    dueDate: '2026-05-22',
  },
  {
    title: 'Custos por canal + KPIs de SLA mínimos no Analytics',
    description: 'Adicionar métricas de custo por canal e KPIs order_to_ready/order_to_deliver no painel de analytics.',
    listSlug: 'todo',
    itemType: 'task',
    priority: 'high',
    dueDate: '2026-05-22',
  },
  {
    title: 'Dashboards operacionais por suíte (Fast Service + Orders/Delivery)',
    description: 'Criar dashboards dedicados por suíte com métricas operacionais em tempo real.',
    listSlug: 'backlog',
    itemType: 'task',
    priority: 'medium',
    dueDate: '2026-05-25',
  },

  // ── TESTES E QA ──────────────────────────────────────────────────────────
  {
    title: 'Testes unitários frontend: DashboardPage',
    description: 'Criar DashboardPage.test.jsx com casos de renderização, carregamento de dados e interações principais.',
    listSlug: 'doing',
    itemType: 'task',
    priority: 'high',
    dueDate: '2026-05-15',
  },
  {
    title: 'Testes unitários frontend: SupportPage (cobertura crítica)',
    description: 'Ampliar cobertura de SupportPage com testes de omnichannel, SLA e ações de atendente.',
    listSlug: 'doing',
    itemType: 'task',
    priority: 'high',
    dueDate: '2026-05-15',
  },
  {
    title: 'Testes unitários frontend: páginas de projetos (Board, Timeline, List)',
    description: 'Criar testes para ProjectBoardPage, ProjectTimelinePage e ProjectListPage.',
    listSlug: 'doing',
    itemType: 'task',
    priority: 'medium',
    dueDate: '2026-05-18',
  },
  {
    title: 'Testes unitários frontend: AgentsPage, ConfigPage, AuditPage',
    description: 'Criar suíte de testes para páginas administrativas críticas.',
    listSlug: 'backlog',
    itemType: 'task',
    priority: 'medium',
    dueDate: '2026-05-20',
  },
  {
    title: 'Testes unitários frontend: AnalyticsPage e KnowledgeBasePage',
    description: 'Criar testes para páginas de analytics e base de conhecimento.',
    listSlug: 'backlog',
    itemType: 'task',
    priority: 'medium',
    dueDate: '2026-05-22',
  },
  {
    title: 'Cobertura de testes backend: RAG Service (dependências ausentes)',
    description: 'Resolver problema de dependências do RAG Service para executar ~15 testes pendentes.',
    listSlug: 'todo',
    itemType: 'task',
    priority: 'high',
    dueDate: '2026-05-15',
  },
  {
    title: 'Validar npm run test:unit e npm run qa:mesh passando (pré-release)',
    description: 'Garantir 100% dos testes unitários passando. Mesh QA sem regressões nos L-01 a L-05.',
    listSlug: 'todo',
    itemType: 'task',
    priority: 'critical',
    dueDate: '2026-05-28',
  },

  // ── GERENCIADOR DE PROJETOS ──────────────────────────────────────────────
  {
    title: 'Validar Board Kanban: drag-and-drop de itens entre colunas',
    description: 'Testar e corrigir funcionalidade de arrastar e soltar itens entre as listas do board de projetos.',
    listSlug: 'doing',
    itemType: 'task',
    priority: 'high',
    dueDate: '2026-05-10',
  },
  {
    title: 'Validar Timeline: visualização de milestones e datas',
    description: 'Garantir que a timeline mostra corretamente milestones e itens com datas de vencimento.',
    listSlug: 'doing',
    itemType: 'task',
    priority: 'medium',
    dueDate: '2026-05-12',
  },
  {
    title: 'Dashboard de projeto: KPIs de progresso e saúde',
    description: 'Validar que o dashboard de projeto exibe totalItems, doneItems, overdueItems e health corretamente.',
    listSlug: 'doing',
    itemType: 'task',
    priority: 'medium',
    dueDate: '2026-05-12',
  },
  {
    title: 'Testes de integração: módulo project-management (API)',
    description: 'Criar testes E2E cobrindo CRUD de projetos, listas, itens, membros, comentários e templates.',
    listSlug: 'todo',
    itemType: 'task',
    priority: 'high',
    dueDate: '2026-05-18',
  },
  {
    title: 'Notificações em tempo real ao adicionar item/comentário no projeto',
    description: 'Integrar WebSocket para atualização em tempo real do board quando outro membro adicionar item ou comentário.',
    listSlug: 'backlog',
    itemType: 'task',
    priority: 'medium',
    dueDate: '2026-05-22',
  },

  // ── INFRAESTRUTURA / DEPLOY ──────────────────────────────────────────────
  {
    title: 'Revisar e validar docker-compose.prod.yml para produção',
    description: 'Auditar configurações de produção: variáveis de ambiente, volumes, redes, health checks e limites de recursos.',
    listSlug: 'todo',
    itemType: 'task',
    priority: 'critical',
    dueDate: '2026-05-22',
  },
  {
    title: 'Configurar ENCRYPTION_KEY e secrets de produção',
    description: 'Gerar e armazenar ENCRYPTION_KEY segura para produção. Validar que nenhum secret está em texto plano.',
    listSlug: 'todo',
    itemType: 'task',
    priority: 'critical',
    dueDate: '2026-05-20',
  },
  {
    title: 'Configurar monitoramento e alertas de produção (health + selftest)',
    description: 'Configurar alertas para /health/selftest retornando FAIL. Dashboard de saúde do sistema operacional.',
    listSlug: 'todo',
    itemType: 'task',
    priority: 'high',
    dueDate: '2026-05-25',
  },
  {
    title: 'Executar npm run system:release-clean-check (workspace limpo)',
    description: 'Validar que não há pendências fora da pasta qa/ antes do deploy. Workspace de release sem artefatos temporários.',
    listSlug: 'todo',
    itemType: 'task',
    priority: 'high',
    dueDate: '2026-05-30',
  },
  {
    title: 'Configurar backup automático do banco de dados em produção',
    description: 'Garantir backup diário do PostgreSQL com retenção de 30 dias e teste de restore documentado.',
    listSlug: 'backlog',
    itemType: 'task',
    priority: 'high',
    dueDate: '2026-05-25',
  },

  // ── DOCUMENTAÇÃO ────────────────────────────────────────────────────────
  {
    title: 'Runbook operacional pós-lançamento (incidentes, escalada, rollback)',
    description: 'Documentar procedimentos de resposta a incidentes, critérios de escalada e passos de rollback para produção.',
    listSlug: 'todo',
    itemType: 'task',
    priority: 'high',
    dueDate: '2026-05-25',
  },
  {
    title: 'Documentação de usuário: onboarding e guia de primeiros passos',
    description: 'Criar documentação de usuário básica cobrindo onboarding, configuração inicial e principais funcionalidades.',
    listSlug: 'backlog',
    itemType: 'task',
    priority: 'medium',
    dueDate: '2026-05-28',
  },
  {
    title: 'Release notes v1.0 — changelog público',
    description: 'Redigir release notes com funcionalidades principais, limitações conhecidas e breaking changes.',
    listSlug: 'backlog',
    itemType: 'task',
    priority: 'medium',
    dueDate: '2026-05-30',
  },
  {
    title: 'Atualizar README com instruções de deploy em produção',
    description: 'Documentar o fluxo completo: clone → bootstrap → validate → release → deploy, com requisitos de hardware e rede.',
    listSlug: 'backlog',
    itemType: 'task',
    priority: 'medium',
    dueDate: '2026-05-28',
  },

  // ── SEGURANÇA ────────────────────────────────────────────────────────────
  {
    title: 'Auditoria de segurança: validar OWASP Top 10 nas rotas críticas',
    description: 'Revisar endpoints de autenticação, tokens públicos e upload de arquivos contra vulnerabilidades OWASP Top 10.',
    listSlug: 'todo',
    itemType: 'task',
    priority: 'critical',
    dueDate: '2026-05-22',
  },
  {
    title: 'Validar rate-limit por tenant em todas as rotas públicas',
    description: 'Garantir que rate-limit está ativo e configurado corretamente para tokens públicos e endpoints /storefront e /physical.',
    listSlug: 'todo',
    itemType: 'task',
    priority: 'high',
    dueDate: '2026-05-20',
  },
  {
    title: 'Revisar permissões RBAC: nenhum endpoint sem autenticação indevida',
    description: 'Auditar todos os módulos para garantir que endpoints privados exigem autenticação e autorização adequadas.',
    listSlug: 'todo',
    itemType: 'task',
    priority: 'high',
    dueDate: '2026-05-22',
  },
];

// ── Milestones ────────────────────────────────────────────────────────────
const MILESTONES = [
  { title: 'Freeze técnico D-7', dueDate: '2026-05-24', description: 'Gate PASS, escopo congelado, owners confirmados.' },
  { title: 'Go/No-Go D-1', dueDate: '2026-05-30', description: 'Decisão GO formalizada com data/hora e responsáveis.' },
  { title: 'Lançamento D0', dueDate: '2026-06-01', description: 'Deploy em produção, smoke pós-release PASS, sistema operacional.' },
];

async function main() {
  console.log('🚀 Criando projeto de lançamento RAP 1/6/2026...\n');

  // 1. Login
  console.log('1. Autenticando...');
  const token = await login();
  console.log('   ✓ Token obtido\n');

  // 2. Criar projeto
  console.log('2. Criando projeto...');
  const project = await createProject(token, {
    name: 'Lançamento RAP — 1/6/2026',
    description:
      'Projeto de acompanhamento de todas as entregas necessárias para o lançamento da Results Autonomous Platform em 1 de junho de 2026. ' +
      'Cobre: gates de release, hardening de atendimento omnichannel, PBX/Voz, filas físicas, ' +
      'analytics/ROI v1, testes, infraestrutura, segurança e documentação.',
    priority: 'critical',
    visibility: 'team',
    health: 'on_track',
  });
  console.log(`   ✓ Projeto criado: ${project.name} (código: ${project.code}, id: ${project.id})\n`);

  // 3. Buscar listas padrão
  console.log('3. Carregando listas (colunas)...');
  const lists = await getLists(token, project.id);
  const listBySlug = {};
  for (const list of lists) {
    listBySlug[list.slug] = list;
    console.log(`   - ${list.name} (${list.slug})`);
  }
  console.log();

  // 4. Criar milestones como itens de tipo 'milestone' na coluna To Do
  console.log('4. Criando milestones...');
  const todoList = listBySlug['todo'];
  for (const ms of MILESTONES) {
    const item = await createItem(token, project.id, {
      title: `🏁 ${ms.title}`,
      description: ms.description,
      itemType: 'milestone',
      priority: 'critical',
      status: 'todo',
      listId: todoList?.id,
      dueDate: ms.dueDate,
    });
    if (item) console.log(`   ✓ ${ms.title}`);
  }
  console.log();

  // 5. Criar tarefas
  console.log('5. Criando tarefas...');
  let created = 0;
  let failed = 0;
  for (const task of TASKS) {
    const list = listBySlug[task.listSlug] || todoList;
    if (!list) {
      console.warn(`   ⚠ Lista não encontrada: ${task.listSlug}`);
      failed++;
      continue;
    }
    const item = await createItem(token, project.id, {
      title: task.title,
      description: task.description,
      itemType: task.itemType || 'task',
      priority: task.priority || 'medium',
      status: task.listSlug === 'doing' ? 'in_progress' : task.listSlug === 'done' ? 'done' : 'todo',
      listId: list.id,
      dueDate: task.dueDate,
    });
    if (item) {
      console.log(`   ✓ [${task.priority.toUpperCase()}] ${task.title}`);
      created++;
    } else {
      failed++;
    }
  }
  console.log();

  // 6. Resumo
  console.log('─'.repeat(60));
  console.log('✅ Projeto criado com sucesso!\n');
  console.log(`   Projeto : ${project.name}`);
  console.log(`   Código  : ${project.code}`);
  console.log(`   ID      : ${project.id}`);
  console.log(`   Itens   : ${created} criados, ${MILESTONES.length} milestones`);
  if (failed > 0) console.log(`   ⚠ Falhas : ${failed}`);
  console.log(`\n   Acesse: http://127.0.0.1:5173/projects/${project.id}/board`);
}

main().catch((err) => {
  console.error('Erro fatal:', err.message);
  process.exit(1);
});
