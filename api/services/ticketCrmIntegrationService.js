/**
 * Serviço de integração entre Tickets de Atendimento e CRM
 * 
 * Responsabilidades:
 * - Criar/atualizar contatos CRM automaticamente a partir de tickets
 * - Vincular tickets a contatos existentes
 * - Registrar atividades no CRM
 * - Converter tickets em oportunidades
 */

const crypto = require('crypto');
const { getSequelize } = require('../db/sequelize');
const logger = require('../utils/logger');

function newId(prefix) {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
}

function readEntityValue(entities, key) {
  if (!entities || typeof entities !== 'object') return null;
  const entry = entities[key];
  if (!entry) return null;
  if (Array.isArray(entry)) {
    const first = entry[0];
    if (first && typeof first === 'object' && Object.prototype.hasOwnProperty.call(first, 'value')) return first.value;
    return first || null;
  }
  if (entry && typeof entry === 'object' && Object.prototype.hasOwnProperty.call(entry, 'value')) return entry.value;
  return entry;
}

function pickFirstNonEmpty(...values) {
  for (const value of values) {
    if (value === null || value === undefined) continue;
    const str = String(value).trim();
    if (str) return str;
  }
  return null;
}

class TicketCrmIntegrationService {
  constructor() {
    this.sequelize = null;
    this.models = null;
  }

  /**
   * Inicializa o serviço com conexão ao banco
   */
  init() {
    if (!this.sequelize) {
      this.sequelize = getSequelize();
      if (this.sequelize) {
        this.models = this.sequelize.models;
      }
    }
  }

  /**
   * Sincroniza um ticket com o CRM
   * - Busca ou cria contato CRM
   * - Vincula ticket ao contato
   * - Registra atividade
   */
  async syncTicketToCrm(ticket, options = {}) {
    this.init();
    if (!this.models) return null;

    const { CrmContact, CrmActivity, CrmAccount } = this.models;
    const transaction = options.transaction;

    try {
      // Extrai informações do cliente do ticket
      const normalizedContext = ticket?.context?.normalized_context
        || ticket?.context?.metadata?.normalized_context
        || null;
      const contextEntities = normalizedContext?.entities || {};
      const phoneNumber = pickFirstNonEmpty(
        ticket.phone_number,
        ticket.phoneNumber,
        ticket?.context?.phoneNumber,
        ticket?.context?.phone_number,
        ticket?.context?.metadata?.phoneNumber,
        ticket?.context?.metadata?.phone_number,
      )
        || readEntityValue(contextEntities, 'phone')
        || null;
      
      // Prioriza o nome do perfil do WhatsApp quando disponível
      const customerName = pickFirstNonEmpty(
        ticket.context?.customer_name,                 // Nome do WhatsApp/perfil do canal
        ticket.context?.customerName,                  // Variante camelCase
        ticket.customer_name,                          // Campo direto snake_case
        ticket.customerName,                           // Campo direto camelCase
        ticket.context?.metadata?.contactName,         // Nome em metadata
        ticket.context?.variables?.customerName,       // Nome em variáveis de contexto
        ticket.context?.name,                          // Nome fornecido pelo usuário
        ticket.context?.userName,                      // Nome alternativo
      );
      
      const email = readEntityValue(contextEntities, 'email')
        || ticket.context?.email
        || ticket.context?.userEmail
        || null;

      // Se não temos telefone ou email, não podemos criar contato
      if (!phoneNumber && !email) {
        logger.info('[TicketCRM] Ticket sem telefone/email, pulando sincronização', {
          ticketId: ticket.id,
          tenantId: ticket.tenant_key || ticket.tenantId,
        });
        return null;
      }

      // Gera nome de fallback se necessário (baseado no telefone ou email)
      const defaultName = phoneNumber 
        ? `Cliente ${phoneNumber.replace(/^(\+55)?(\d{2})(\d{5})(\d{4})$/, '($2) $3-$4')}` 
        : `Cliente ${email?.split('@')[0] || 'Sem Nome'}`;
      
      const finalName = customerName && customerName.trim() !== '' 
        ? customerName.trim() 
        : defaultName;

      // Busca ou cria contato CRM
      const [contact, created] = await CrmContact.findOrCreate({
        where: { 
          tenant_key: ticket.tenant_key || ticket.tenantId,
          ...(phoneNumber ? { phone: phoneNumber } : { email })
        },
        defaults: {
          id: newId('crmctt'),
          tenantId: ticket.tenant_key || ticket.tenantId,
          tenant_key: ticket.tenant_key || ticket.tenantId,
          name: finalName,
          phone: phoneNumber,
          email: email,
          status: 'active',
          attributes: {
            source: 'ticket',
            tags: Array.isArray(normalizedContext?.tags) ? normalizedContext.tags : ['atendimento'],
            customFields: {
              first_contact_channel: ticket.channel_type || ticket.channelType,
              first_contact_date: ticket.created_at || ticket.createdAt,
              origin_ticket_id: ticket.id,
              funnel_stage: normalizedContext?.funnel_state?.stage || null,
              funnel_intent: normalizedContext?.funnel_state?.intent || null,
              funnel_severity: normalizedContext?.funnel_state?.severity || null,
            },
          },
        },
        transaction
      });

      if (created) {
        logger.info('[TicketCRM] Novo contato CRM criado', {
          contactId: contact.id,
          contactName: finalName,
          ticketId: ticket.id,
          tenantId: ticket.tenant_key || ticket.tenantId,
          phone: phoneNumber,
          email: email,
          source: 'auto_from_ticket',
        });
      }

      // Atualiza informações do contato se temos um nome real (não fallback)
      if (!created && customerName && customerName.trim() !== '') {
        const updates = {};
        
        // Atualiza nome se o atual é genérico ou se temos um nome melhor
        if (!contact.name || 
            contact.name.startsWith('Cliente ') || 
            (customerName && contact.name !== customerName)) {
          updates.name = finalName;
        }
        
        if (email && !contact.email) {
          updates.email = email;
        }
        
        if (phoneNumber && !contact.phone) {
          updates.phone = phoneNumber;
        }
        
        if (Object.keys(updates).length > 0) {
          await contact.update(updates, { transaction });
          logger.info('[TicketCRM] Contato CRM atualizado', {
            contactId: contact.id,
            ticketId: ticket.id,
            tenantId: ticket.tenant_key || ticket.tenantId,
            updates,
          });
        }
      }

      // Vincula ticket ao contato se ainda não vinculado
      if (!ticket.crm_contact_id) {
        await ticket.update({ 
          crm_contact_id: contact.id,
          crm_account_id: contact.accountId // Herda a conta se existir
        }, { transaction });
        logger.info('[TicketCRM] Ticket vinculado ao contato', {
          ticketId: ticket.id,
          contactId: contact.id,
          tenantId: ticket.tenant_key || ticket.tenantId,
        });
      }

      // Registra atividade no CRM
      await CrmActivity.create({
        id: newId('crmact'),
        tenantId: ticket.tenant_key || ticket.tenantId,
        tenant_key: ticket.tenant_key || ticket.tenantId,
        contactId: contact.id,
        accountId: contact.accountId,
        type: 'ticket',
        subject: `Ticket de Atendimento #${ticket.id}`,
        description: ticket.last_user_message || ticket.lastUserMessage || 'Ticket criado',
        status: 'completed',
        dueDate: new Date(),
        completedAt: new Date(),
        customFields: {
          ticket_id: ticket.id,
          ticket_status: ticket.status,
          ticket_queue: ticket.queue,
          ticket_channel: ticket.channel_type || ticket.channelType
        }
      }, { transaction });

      return contact;

    } catch (error) {
      console.error('[TicketCRM] Erro ao sincronizar ticket com CRM:', error);
      throw error;
    }
  }

  /**
   * Converte um ticket em oportunidade CRM
   */
  async convertToOpportunity(ticketId, opportunityData, tenantId) {
    this.init();
    if (!this.models) throw new Error('Models não inicializados');

    const { Ticket, CrmOpportunity, CrmActivity } = this.models;

    const transaction = await this.sequelize.transaction();

    try {
      // Busca ticket
      const ticket = await Ticket.findOne({
        where: { id: ticketId, tenant_key: tenantId }
      });

      if (!ticket) {
        throw new Error('Ticket não encontrado');
      }

      // Sincroniza com CRM se ainda não sincronizado
      if (!ticket.crm_contact_id) {
        await this.syncTicketToCrm(ticket, { transaction });
        await ticket.reload({ transaction });
      }

      if (!ticket.crm_contact_id) {
        throw new Error('Não foi possível criar contato CRM para o ticket');
      }

      // Cria oportunidade
      const opportunity = await CrmOpportunity.create({
        id: newId('crmopp'),
        tenantId: tenantId,
        tenant_key: tenantId,
        accountId: ticket.crm_account_id,
        contactId: ticket.crm_contact_id,
        name: opportunityData.name || `Oportunidade - Ticket #${ticket.id}`,
        value: opportunityData.value || 0,
        stage: opportunityData.stage || 'qualification',
        probability: opportunityData.probability || 10,
        expectedCloseDate: opportunityData.expectedCloseDate || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        source: 'ticket',
        description: opportunityData.description || ticket.last_user_message,
        customFields: {
          origin_ticket_id: ticket.id,
          origin_channel: ticket.channel_type,
          origin_queue: ticket.queue
        }
      }, { transaction });

      // Vincula oportunidade ao ticket
      await ticket.update({ 
        crm_opportunity_id: opportunity.id 
      }, { transaction });

      // Registra atividade
      await CrmActivity.create({
        id: newId('crmact'),
        tenantId: tenantId,
        tenant_key: tenantId,
        contactId: ticket.crm_contact_id,
        accountId: ticket.crm_account_id,
        opportunityId: opportunity.id,
        type: 'opportunity_created',
        subject: `Oportunidade criada a partir do Ticket #${ticket.id}`,
        description: `Oportunidade ${opportunity.name} gerada automaticamente`,
        status: 'completed',
        dueDate: new Date(),
        completedAt: new Date()
      }, { transaction });

      await transaction.commit();

      logger.info('[TicketCRM] Oportunidade criada a partir do ticket', {
        opportunityId: opportunity.id,
        ticketId: ticket.id,
        tenantId: ticket.tenant_key,
        value: opportunity.value,
      });
      return opportunity;

    } catch (error) {
      await transaction.rollback();
      console.error('[TicketCRM] Erro ao converter ticket em oportunidade:', error);
      throw error;
    }
  }

  /**
   * Busca informações CRM relacionadas a um ticket
   */
  async getTicketCrmData(ticketId, tenantId) {
    this.init();
    if (!this.models) return null;

    const { Ticket, CrmContact, CrmAccount, CrmOpportunity, CrmActivity } = this.models;

    try {
      const ticket = await Ticket.findOne({
        where: { id: ticketId, tenant_key: tenantId }
      });

      if (!ticket) return null;

      const result = {
        ticket: ticket,
        contact: null,
        account: null,
        opportunity: null,
        relatedTickets: [],
        activities: []
      };

      // Busca contato
      if (ticket.crm_contact_id) {
        result.contact = await CrmContact.findByPk(ticket.crm_contact_id);
      }

      // Busca conta
      if (ticket.crm_account_id) {
        result.account = await CrmAccount.findByPk(ticket.crm_account_id);
      }

      // Busca oportunidade
      if (ticket.crm_opportunity_id) {
        result.opportunity = await CrmOpportunity.findByPk(ticket.crm_opportunity_id);
      }

      // Busca tickets relacionados (mesmo contato)
      if (ticket.crm_contact_id) {
        result.relatedTickets = await Ticket.findAll({
          where: {
            tenant_key: tenantId,
            crm_contact_id: ticket.crm_contact_id,
            id: { [this.sequelize.Sequelize.Op.ne]: ticketId }
          },
          order: [['created_at', 'DESC']],
          limit: 10
        });

        // Busca atividades do contato
        result.activities = await CrmActivity.findAll({
          where: {
            tenantId: tenantId,
            contactId: ticket.crm_contact_id
          },
          order: [['createdAt', 'DESC']],
          limit: 20
        });
      }

      return result;

    } catch (error) {
      console.error('[TicketCRM] Erro ao buscar dados CRM do ticket:', error);
      throw error;
    }
  }

  /**
   * Registra atualização de ticket como atividade no CRM
   */
  async logTicketUpdate(ticket, action, description) {
    this.init();
    if (!this.models || !ticket.crm_contact_id) return;

    const { CrmActivity } = this.models;

    try {
      await CrmActivity.create({
        id: newId('crmact'),
        tenantId: ticket.tenant_key,
        tenant_key: ticket.tenant_key,
        contactId: ticket.crm_contact_id,
        accountId: ticket.crm_account_id,
        opportunityId: ticket.crm_opportunity_id,
        type: 'ticket_update',
        subject: `Ticket #${ticket.id} - ${action}`,
        description: description || `Ticket atualizado: ${action}`,
        status: 'completed',
        dueDate: new Date(),
        completedAt: new Date(),
        customFields: {
          ticket_id: ticket.id,
          action: action,
          ticket_status: ticket.status
        }
      });
    } catch (error) {
      console.error('[TicketCRM] Erro ao registrar atividade:', error);
      // Não propaga erro para não quebrar fluxo principal
    }
  }
}

// Exporta instância única (singleton)
module.exports = new TicketCrmIntegrationService();
