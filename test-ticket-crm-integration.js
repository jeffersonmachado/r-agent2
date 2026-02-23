/**
 * Script de teste para integração Ticket ↔ CRM
 * 
 * Testa:
 * - Criação automática de contato CRM a partir de ticket
 * - Busca de dados CRM relacionados
 * - Conversão de ticket em oportunidade
 */

const ticketCrmService = require('../api/services/ticketCrmIntegrationService');
const {  getSequelize } = require('../api/db/sequelize');

async function testTicketCrmIntegration() {
  console.log('\n=== TESTE DE INTEGRAÇÃO TICKET ↔ CRM ===\n');

  try {
    // Conecta ao banco
    const sequelize = await getSequelize();
    await sequelize.authenticate();
    console.log('✅ Conectado ao banco de dados');

    const { Ticket, CrmContact, CrmOpportunity } = sequelize.models;

    // Busca um ticket de teste
    const ticket = await Ticket.findOne({
      where: {
        phone_number: { [sequelize.Sequelize.Op.ne]: null }
      },
      order: [['created_at', 'DESC']]
    });

    if (!ticket) {
      console.log('❌ Nenhum ticket encontrado para teste');
      return;
    }

    console.log(`\n📩 Ticket encontrado: ${ticket.id}`);
    console.log(`   Telefone: ${ticket.phone_number}`);
    console.log(`   TenantID: ${ticket.tenant_key}`);
    console.log(`   Status: ${ticket.status}`);

    // Teste 1: Sincronização com CRM
    console.log('\n--- Teste 1: Sincronização com CRM ---');
    const contact = await ticketCrmService.syncTicketToCrm(ticket);
    
    if (contact) {
      console.log('✅ Contato CRM criado/atualizado');
      console.log(`   ID: ${contact.id}`);
      console.log(`   Nome: ${contact.name}`);
      console.log(`   Telefone: ${contact.phone}`);
    } else {
      console.log('⚠️  Nenhum contato criado (ticket sem telefone/email)');
    }

    // Recarrega ticket para ver as mudanças
    await ticket.reload();
    console.log(`   CRM Contact ID vinculado: ${ticket.crm_contact_id}`);

    // Teste 2: Buscar dados CRM do ticket
    console.log('\n--- Teste 2: Buscar dados CRM do ticket ---');
    const crmData = await ticketCrmService.getTicketCrmData(ticket.id, ticket.tenant_key);
    
    if (crmData) {
      console.log('✅ Dados CRM recuperados');
      console.log(`   Contato: ${crmData.contact?.name || 'N/A'}`);
      console.log(`   Tickets relacionados: ${crmData.relatedTickets?.length || 0}`);
      console.log(`   Atividades: ${crmData.activities?.length || 0}`);
    }

    // Teste 3: Converter em oportunidade
    if (contact && !ticket.crm_opportunity_id) {
      console.log('\n--- Teste 3: Converter em oportunidade ---');
      
      const opportunity = await ticketCrmService.convertToOpportunity(
        ticket.id,
        {
          name: `Oportunidade - Ticket #${ticket.id}`,
          value: 1000,
          stage: 'qualification',
          probability: 20,
          description: 'Oportunidade criada automaticamente por teste'
        },
        ticket.tenant_key
      );

      console.log('✅ Oportunidade criada');
      console.log(`   ID: ${opportunity.id}`);
      console.log(`   Nome: ${opportunity.name}`);
      console.log(`   Valor: R$ ${opportunity.value}`);
      console.log(`   Estágio: ${opportunity.stage}`);

      // Recarrega ticket
      await ticket.reload();
      console.log(`   CRM Opportunity ID vinculado: ${ticket.crm_opportunity_id}`);
    } else {
      console.log('\n⏭️  Teste 3 pulado (ticket já tem oportunidade ou sem contato)');
    }

    // Estatísticas finais
    console.log('\n=== ESTATÍSTICAS ===');
    
    const totalContacts = await CrmContact.count({
      where: { tenant_id: ticket.tenant_key }
    });
    console.log(`Total de contatos CRM: ${totalContacts}`);

    const totalOpportunities = await CrmOpportunity.count({
      where: { tenant_id: ticket.tenant_key }
    });
    console.log(`Total de oportunidades: ${totalOpportunities}`);

    const ticketsWithCrm = await Ticket.count({
      where: {
        tenant_key: ticket.tenant_key,
        crm_contact_id: { [sequelize.Sequelize.Op.ne]: null }
      }
    });
    console.log(`Tickets vinculados ao CRM: ${ticketsWithCrm}`);

    console.log('\n✅ TESTE CONCLUÍDO COM SUCESSO!\n');

  } catch (error) {
    console.error('\n❌ ERRO no teste:', error);
    console.error(error.stack);
  }
}

// Executa se chamado diretamente
if (require.main === module) {
  testTicketCrmIntegration()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Erro fatal:', err);
      process.exit(1);
    });
}

module.exports = { testTicketCrmIntegration };
