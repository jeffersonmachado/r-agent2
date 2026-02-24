/**
 * Seed de CRM - Dados de exemplo completos para testar o funil de vendas
 * 
 * Cria:
 * - 3 Pipelines (funis) diferentes
 * - 15 Contas (empresas)
 * - 30 Contatos
 * - 25 Leads
 * - 40 Oportunidades distribuídas pelos estágios
 * - 50 Atividades
 * 
 * Uso: node api/db/seedCrm.js
 */

try {
  require('dotenv').config();
} catch (e) {
  const fs = require('fs');
  const path = require('path');
  const envPath = path.join(__dirname, '../../.env');
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    envContent.split('\n').forEach(line => {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        const [key, ...valueParts] = trimmed.split('=');
        if (key && valueParts.length > 0) {
          const value = valueParts.join('=').replace(/^["']|["']$/g, '');
          if (!process.env[key]) {
            process.env[key] = value;
          }
        }
      }
    });
  }
}
const { connect, getSequelize, close } = require('./sequelize');
const logger = require('../utils/logger');
const crmService = require('../services/crm/crmService');
const SEED_TAG = 'crm_demo_2026';

async function seedCrm() {
  logger.info('🌱 [CRM Seed] Iniciando seed do CRM...');
  
  await connect();
  const sequelize = getSequelize();
  
  if (!sequelize) {
    throw new Error('Banco de dados não conectado');
  }

  // Pega o primeiro tenant disponível (ou usa 'system')
  const [tenants] = await sequelize.query(
    `SELECT tenant_key FROM tenants WHERE status = 'active' LIMIT 1`
  );
  
  const tenantId = tenants && tenants[0] ? tenants[0].tenant_key : 'system';
  logger.info(`🔑 [CRM Seed] Usando tenant: ${tenantId}`);

  logger.info('🧹 [CRM Seed] Limpando dados anteriores deste seed...');
  await sequelize.query(
    `DELETE FROM crm_activities WHERE tenant_key = :tenantKey AND payload->>'seed_tag' = :seedTag`,
    { replacements: { tenantKey: tenantId, seedTag: SEED_TAG } }
  );
  await sequelize.query(
    `DELETE FROM crm_opportunities WHERE tenant_key = :tenantKey AND attributes->>'seed_tag' = :seedTag`,
    { replacements: { tenantKey: tenantId, seedTag: SEED_TAG } }
  );
  await sequelize.query(
    `DELETE FROM crm_leads WHERE tenant_key = :tenantKey AND attributes->>'seed_tag' = :seedTag`,
    { replacements: { tenantKey: tenantId, seedTag: SEED_TAG } }
  );
  await sequelize.query(
    `DELETE FROM crm_contacts WHERE tenant_key = :tenantKey AND attributes->>'seed_tag' = :seedTag`,
    { replacements: { tenantKey: tenantId, seedTag: SEED_TAG } }
  );
  await sequelize.query(
    `DELETE FROM crm_accounts WHERE tenant_key = :tenantKey AND attributes->>'seed_tag' = :seedTag`,
    { replacements: { tenantKey: tenantId, seedTag: SEED_TAG } }
  );
  await sequelize.query(
    `DELETE FROM crm_pipelines WHERE tenant_key = :tenantKey AND attributes->>'seed_tag' = :seedTag`,
    { replacements: { tenantKey: tenantId, seedTag: SEED_TAG } }
  );

  // ====================
  // 1. PIPELINES (FUNIS)
  // ====================
  logger.info('📊 [CRM Seed] Criando pipelines...');
  
  const pipelines = [];
  
  // Pipeline 1: Vendas B2B (padrão)
  const pipelineB2B = await crmService.upsertPipeline({
    tenantId,
    name: 'Vendas B2B',
    description: 'Funil principal para vendas corporativas',
    isDefault: true,
    status: 'active',
    stages: [
      { id: 'prospeccao', name: 'Prospecção', order: 1 },
      { id: 'qualificacao', name: 'Qualificação', order: 2 },
      { id: 'descoberta', name: 'Descoberta', order: 3 },
      { id: 'proposta', name: 'Proposta Enviada', order: 4 },
      { id: 'negociacao', name: 'Negociação', order: 5 },
      { id: 'fechamento', name: 'Fechamento', order: 6 },
    ],
    attributes: { color: '#3b82f6', icon: '🏢', seed_tag: SEED_TAG },
  });
  pipelines.push(pipelineB2B.pipeline);
  
  // Pipeline 2: Vendas SaaS
  const pipelineSaaS = await crmService.upsertPipeline({
    tenantId,
    name: 'Vendas SaaS',
    description: 'Funil para vendas de software como serviço',
    isDefault: false,
    status: 'active',
    stages: [
      { id: 'trial', name: 'Trial Iniciado', order: 1 },
      { id: 'ativacao', name: 'Ativação', order: 2 },
      { id: 'demonstracao', name: 'Demo Agendada', order: 3 },
      { id: 'proposta', name: 'Proposta Anual', order: 4 },
      { id: 'conversao', name: 'Conversão', order: 5 },
    ],
    attributes: { color: '#10b981', icon: '☁️', seed_tag: SEED_TAG },
  });
  pipelines.push(pipelineSaaS.pipeline);
  
  // Pipeline 3: Parcerias
  const pipelineParcerias = await crmService.upsertPipeline({
    tenantId,
    name: 'Parcerias',
    description: 'Funil para desenvolvimento de parcerias estratégicas',
    isDefault: false,
    status: 'active',
    stages: [
      { id: 'identificacao', name: 'Identificação', order: 1 },
      { id: 'primeiro_contato', name: 'Primeiro Contato', order: 2 },
      { id: 'alinhamento', name: 'Alinhamento Estratégico', order: 3 },
      { id: 'negociacao_termos', name: 'Negociação de Termos', order: 4 },
      { id: 'assinatura', name: 'Assinatura', order: 5 },
    ],
    attributes: { color: '#8b5cf6', icon: '🤝', seed_tag: SEED_TAG },
  });
  pipelines.push(pipelineParcerias.pipeline);
  
  logger.info(`✅ [CRM Seed] ${pipelines.length} pipelines criados`);

  // ====================
  // 2. CONTAS (EMPRESAS)
  // ====================
  logger.info('🏢 [CRM Seed] Criando contas...');
  
  const empresas = [
    { name: 'Tech Solutions Brasil', industry: 'Tecnologia', size: 'enterprise', revenue: 50000000 },
    { name: 'Varejo Digital Ltda', industry: 'Varejo', size: 'large', revenue: 30000000 },
    { name: 'Indústria Alimentos SA', industry: 'Alimentos', size: 'large', revenue: 80000000 },
    { name: 'Consultoria ABC', industry: 'Consultoria', size: 'medium', revenue: 5000000 },
    { name: 'Startup Inovadora', industry: 'Tecnologia', size: 'small', revenue: 500000 },
    { name: 'Logística Express', industry: 'Logística', size: 'medium', revenue: 15000000 },
    { name: 'HealthTech Solutions', industry: 'Saúde', size: 'medium', revenue: 8000000 },
    { name: 'EduPlus Educação', industry: 'Educação', size: 'small', revenue: 2000000 },
    { name: 'FinServ Pagamentos', industry: 'Fintech', size: 'large', revenue: 40000000 },
    { name: 'Marketing Pro Agency', industry: 'Marketing', size: 'small', revenue: 1500000 },
    { name: 'E-commerce XYZ', industry: 'Varejo', size: 'medium', revenue: 12000000 },
    { name: 'TeleCom Brasil', industry: 'Telecomunicações', size: 'enterprise', revenue: 120000000 },
    { name: 'Agro Fazendas S.A', industry: 'Agronegócio', size: 'large', revenue: 60000000 },
    { name: 'Construtora Moderna', industry: 'Construção', size: 'medium', revenue: 20000000 },
    { name: 'Software House Dev', industry: 'Tecnologia', size: 'small', revenue: 3000000 },
  ];
  
  const accounts = [];
  for (let idx = 0; idx < empresas.length; idx++) {
    const emp = empresas[idx];
    const result = await crmService.upsertAccount({
      tenantId,
      externalId: `seed-account-${idx + 1}`,
      name: emp.name,
      industry: emp.industry,
      attributes: {
        seed_tag: SEED_TAG,
        size: emp.size,
        annual_revenue: emp.revenue,
        employees: emp.size === 'enterprise' ? 1000 : emp.size === 'large' ? 500 : emp.size === 'medium' ? 100 : 20,
      },
    });
    accounts.push(result.account);
  }
  
  logger.info(`✅ [CRM Seed] ${accounts.length} contas criadas`);

  // ====================
  // 3. CONTATOS
  // ====================
  logger.info('👤 [CRM Seed] Criando contatos...');
  
  const nomes = ['João Silva', 'Maria Santos', 'Pedro Oliveira', 'Ana Costa', 'Carlos Ferreira'];
  const cargos = ['CEO', 'CTO', 'Head de Vendas', 'Diretor Comercial', 'Gerente de TI', 'Coordenador'];
  
  const contacts = [];
  for (let i = 0; i < accounts.length; i++) {
    const account = accounts[i];
    // Cada empresa tem 2 contatos
    for (let j = 0; j < 2; j++) {
      const nome = nomes[Math.floor(Math.random() * nomes.length)];
      const sobrenome = ['Santos', 'Silva', 'Oliveira', 'Costa', 'Ferreira', 'Lima', 'Souza'][Math.floor(Math.random() * 7)];
      const fullName = `${nome.split(' ')[0]} ${sobrenome}`;
      const cargo = cargos[j % cargos.length];
      
      const result = await crmService.upsertContact({
        tenantId,
        externalId: `seed-contact-${i + 1}-${j + 1}`,
        name: fullName,
        email: `${fullName.toLowerCase().replace(' ', '.')}@${account.name.toLowerCase().replace(/[^a-z]/g, '')}.com.br`,
        phone: `+5511${Math.floor(Math.random() * 900000000 + 100000000)}`,
        accountId: account.id,
        attributes: {
          seed_tag: SEED_TAG,
          position: cargo,
          department: j === 0 ? 'Diretoria' : 'Comercial',
        },
      });
      contacts.push(result.contact);
    }
  }
  
  logger.info(`✅ [CRM Seed] ${contacts.length} contatos criados`);

  // ====================
  // 4. LEADS
  // ====================
  logger.info('🎯 [CRM Seed] Criando leads...');
  
  const leadSources = ['site', 'linkedin', 'indicacao', 'evento', 'cold_call'];
  const leadStages = ['visitor', 'lead', 'mql', 'sql'];
  
  const leads = [];
  for (let i = 0; i < 25; i++) {
    const nome = `Lead ${i + 1}`;
    const empresa = `Empresa Lead ${i + 1}`;
    const score = Math.floor(Math.random() * 100);
    
    const result = await crmService.upsertLead({
      tenantId,
      externalId: `seed-lead-${i + 1}`,
      name: nome,
      email: `lead${i + 1}@empresa${i + 1}.com`,
      phone: i % 2 === 0 ? `+5511${Math.floor(Math.random() * 900000000 + 100000000)}` : null,
      source: leadSources[Math.floor(Math.random() * leadSources.length)],
      stage: leadStages[Math.floor(Math.random() * leadStages.length)],
      score,
      attributes: {
        seed_tag: SEED_TAG,
        company: empresa,
        interest: ['automacao', 'crm', 'analytics'][Math.floor(Math.random() * 3)],
      },
    });
    leads.push(result.lead);
  }
  
  logger.info(`✅ [CRM Seed] ${leads.length} leads criados`);

  // ====================
  // 5. OPORTUNIDADES
  // ====================
  logger.info('💼 [CRM Seed] Criando oportunidades...');
  
  const opportunities = [];
  
  // Pipeline B2B - 20 oportunidades
  const stagesB2B = pipelineB2B.pipeline.stages;
  for (let i = 0; i < 20; i++) {
    const account = accounts[i % accounts.length];
    const contact = contacts.find(c => c.account_id === account.id);
    const stage = stagesB2B[Math.floor(Math.random() * stagesB2B.length)];
    
    // Valor aleatório entre 10k e 500k
    const value = Math.floor(Math.random() * 490000 + 10000);
    
    // Probabilidade aumenta conforme avança no funil
    const stageIndex = stagesB2B.findIndex(s => s.id === stage.id);
    const probability = Math.min(90, 20 + (stageIndex * 15));
    
    // Data de fechamento: 1 a 90 dias
    const daysToClose = Math.floor(Math.random() * 90 + 1);
    const expectedCloseAt = new Date();
    expectedCloseAt.setDate(expectedCloseAt.getDate() + daysToClose);
    
    const result = await crmService.upsertOpportunity({
      tenantId,
      id: `seed-opp-b2b-${i + 1}`,
      pipelineId: pipelineB2B.pipeline.id,
      stageId: stage.id,
      title: `${account.name} - Projeto ${i + 1}`,
      accountId: account.id,
      contactId: contact?.id || null,
      valueCents: value * 100,
      currency: 'BRL',
      status: 'open',
      expectedCloseAt: expectedCloseAt.toISOString(),
      attributes: {
        seed_tag: SEED_TAG,
        probability,
        description: `Oportunidade de venda para ${account.name}. Interesse em solução de automação e CRM.`,
        deal_type: ['new_business', 'upsell', 'renewal'][Math.floor(Math.random() * 3)],
      },
    });
    opportunities.push(result.opportunity);
  }
  
  // Pipeline SaaS - 12 oportunidades
  const stagesSaaS = pipelineSaaS.pipeline.stages;
  for (let i = 0; i < 12; i++) {
    const account = accounts[(i + 5) % accounts.length];
    const contact = contacts.find(c => c.account_id === account.id);
    const stage = stagesSaaS[Math.floor(Math.random() * stagesSaaS.length)];
    
    // SaaS: valores menores, recorrentes
    const value = Math.floor(Math.random() * 20000 + 1000);
    const stageIndex = stagesSaaS.findIndex(s => s.id === stage.id);
    const probability = Math.min(85, 25 + (stageIndex * 15));
    
    const daysToClose = Math.floor(Math.random() * 60 + 1);
    const expectedCloseAt = new Date();
    expectedCloseAt.setDate(expectedCloseAt.getDate() + daysToClose);
    
    const result = await crmService.upsertOpportunity({
      tenantId,
      id: `seed-opp-saas-${i + 1}`,
      pipelineId: pipelineSaaS.pipeline.id,
      stageId: stage.id,
      title: `${account.name} - SaaS Anual`,
      accountId: account.id,
      contactId: contact?.id || null,
      valueCents: value * 100,
      currency: 'BRL',
      status: 'open',
      expectedCloseAt: expectedCloseAt.toISOString(),
      attributes: {
        seed_tag: SEED_TAG,
        probability,
        plan: ['starter', 'professional', 'enterprise'][Math.floor(Math.random() * 3)],
        billing: 'annual',
      },
    });
    opportunities.push(result.opportunity);
  }
  
  // Pipeline Parcerias - 8 oportunidades
  const stagesParcerias = pipelineParcerias.pipeline.stages;
  for (let i = 0; i < 8; i++) {
    const account = accounts[(i + 10) % accounts.length];
    const contact = contacts.find(c => c.account_id === account.id);
    const stage = stagesParcerias[Math.floor(Math.random() * stagesParcerias.length)];
    
    // Parcerias: valores variados
    const value = Math.floor(Math.random() * 200000 + 50000);
    const stageIndex = stagesParcerias.findIndex(s => s.id === stage.id);
    const probability = Math.min(80, 20 + (stageIndex * 15));
    
    const daysToClose = Math.floor(Math.random() * 120 + 30);
    const expectedCloseAt = new Date();
    expectedCloseAt.setDate(expectedCloseAt.getDate() + daysToClose);
    
    const result = await crmService.upsertOpportunity({
      tenantId,
      id: `seed-opp-parceria-${i + 1}`,
      pipelineId: pipelineParcerias.pipeline.id,
      stageId: stage.id,
      title: `Parceria ${account.name}`,
      accountId: account.id,
      contactId: contact?.id || null,
      valueCents: value * 100,
      currency: 'BRL',
      status: 'open',
      expectedCloseAt: expectedCloseAt.toISOString(),
      attributes: {
        seed_tag: SEED_TAG,
        probability,
        partnership_type: ['reseller', 'technology', 'strategic'][Math.floor(Math.random() * 3)],
      },
    });
    opportunities.push(result.opportunity);
  }
  
  // Adiciona algumas oportunidades GANHAS e PERDIDAS
  for (let i = 0; i < 5; i++) {
    const account = accounts[i];
    const contact = contacts.find(c => c.account_id === account.id);
    const value = Math.floor(Math.random() * 100000 + 20000);
    
    const wonOrLost = i < 3 ? 'won' : 'lost';
    const lastStage = wonOrLost === 'won' 
      ? stagesB2B[stagesB2B.length - 1]
      : stagesB2B[Math.floor(Math.random() * stagesB2B.length)];
    
    const closedDate = new Date();
    closedDate.setDate(closedDate.getDate() - Math.floor(Math.random() * 30));
    
    const result = await crmService.upsertOpportunity({
      tenantId,
      id: `seed-opp-closed-${i + 1}`,
      pipelineId: pipelineB2B.pipeline.id,
      stageId: lastStage.id,
      title: `${account.name} - Projeto Finalizado ${i + 1}`,
      accountId: account.id,
      contactId: contact?.id || null,
      valueCents: value * 100,
      currency: 'BRL',
      status: wonOrLost,
      expectedCloseAt: closedDate.toISOString(),
      attributes: {
        seed_tag: SEED_TAG,
        probability: wonOrLost === 'won' ? 100 : 0,
        closed_at: closedDate.toISOString(),
        won_reason: wonOrLost === 'won' ? 'Melhor proposta' : null,
        lost_reason: wonOrLost === 'lost' ? 'Preço muito alto' : null,
      },
    });
    opportunities.push(result.opportunity);
  }
  
  logger.info(`✅ [CRM Seed] ${opportunities.length} oportunidades criadas`);

  // ====================
  // 6. ATIVIDADES
  // ====================
  logger.info('📝 [CRM Seed] Criando atividades...');
  
  const activityTypes = ['call', 'email', 'meeting', 'task', 'note'];
  const activityStatus = ['open', 'completed', 'cancelled'];
  
  const activities = [];
  for (let i = 0; i < 50; i++) {
    const opportunity = opportunities[i % opportunities.length];
    const type = activityTypes[Math.floor(Math.random() * activityTypes.length)];
    const status = activityStatus[Math.floor(Math.random() * activityStatus.length)];
    
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + Math.floor(Math.random() * 14 - 7)); // -7 a +7 dias
    
    const result = await crmService.logActivity({
      tenantId,
      type,
      status,
      subjectType: 'crm_opportunity',
      subjectId: opportunity.id,
      accountId: opportunity.account_id,
      contactId: opportunity.contact_id,
      opportunityId: opportunity.id,
      dueAt: dueDate.toISOString(),
      completedAt: status === 'completed' ? new Date().toISOString() : null,
      payload: {
        seed_tag: SEED_TAG,
        title: `${type === 'call' ? '📞 Ligação' : type === 'email' ? '📧 Email' : type === 'meeting' ? '🤝 Reunião' : type === 'task' ? '✅ Tarefa' : '📝 Nota'} - ${opportunity.title}`,
        description: `${type === 'call' ? 'Ligação de acompanhamento' : type === 'email' ? 'Email enviado com proposta' : type === 'meeting' ? 'Reunião de apresentação' : type === 'task' ? 'Enviar follow-up' : 'Anotações da conversa'}`,
      },
    });
    activities.push(result.activity);
  }
  
  logger.info(`✅ [CRM Seed] ${activities.length} atividades criadas`);

  // ====================
  // RESUMO
  // ====================
  logger.info('\n' + '='.repeat(60));
  logger.info('🎉 [CRM Seed] SEED CONCLUÍDO COM SUCESSO!');
  logger.info('='.repeat(60));
  logger.info(`\n📊 Dados criados:\n`);
  logger.info(`   🎯 Pipelines:      ${pipelines.length}`);
  logger.info(`   🏢 Contas:         ${accounts.length}`);
  logger.info(`   👤 Contatos:       ${contacts.length}`);
  logger.info(`   🎯 Leads:          ${leads.length}`);
  logger.info(`   💼 Oportunidades:  ${opportunities.length}`);
  logger.info(`   📝 Atividades:     ${activities.length}`);
  logger.info(`\n💡 Distribuição de oportunidades:\n`);
  
  for (const pipeline of pipelines) {
    const oppsNoPipeline = opportunities.filter(o => o.pipeline_id === pipeline.id);
    logger.info(`   ${pipeline.attributes?.icon || '📈'} ${pipeline.name}: ${oppsNoPipeline.length} oportunidades`);
    
    for (const stage of pipeline.stages) {
      const oppsNoStage = oppsNoPipeline.filter(o => o.stage_id === stage.id);
      const valorTotal = oppsNoStage.reduce((sum, o) => sum + (o.value_cents || 0), 0) / 100;
      if (oppsNoStage.length > 0) {
        logger.info(`      ├─ ${stage.name}: ${oppsNoStage.length} (R$ ${valorTotal.toLocaleString('pt-BR')})`);
      }
    }
  }
  
  const oppsGanhas = opportunities.filter(o => o.status === 'won').length;
  const oppsPerdidas = opportunities.filter(o => o.status === 'lost').length;
  const oppsAbertas = opportunities.filter(o => o.status === 'open').length;
  const valorTotal = opportunities.reduce((sum, o) => sum + (o.value_cents || 0), 0) / 100;
  
  logger.info(`\n📈 Estatísticas:\n`);
  logger.info(`   Abertas:  ${oppsAbertas}`);
  logger.info(`   Ganhas:   ${oppsGanhas}`);
  logger.info(`   Perdidas: ${oppsPerdidas}`);
  logger.info(`   Valor total do pipeline: R$ ${valorTotal.toLocaleString('pt-BR')}`);
  logger.info(`\n✅ Acesse o CRM em http://localhost:3000/crm para visualizar!\n`);
  logger.info('='.repeat(60) + '\n');

  await close();
  process.exit(0);
}

// Executa o seed
seedCrm().catch((err) => {
  logger.error('❌ [CRM Seed] Erro ao executar seed:', err);
  process.exit(1);
});
