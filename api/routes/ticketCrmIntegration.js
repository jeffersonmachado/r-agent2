/**
 * Rotas de integração Tickets ↔ CRM
 */

const express = require('express');
const router = express.Router();
const ticketCrmService = require('../services/ticketCrmIntegrationService');
const { authenticateToken } = require('../middleware/auth');

/**
 * GET /api/tickets/:ticketId/crm
 * Busca dados CRM relacionados a um ticket
 */
router.get('/:ticketId/crm', authenticateToken, async (req, res) => {
  try {
    const { ticketId } = req.params;
    const tenantId = req.user.tenantId;

    const crmData = await ticketCrmService.getTicketCrmData(ticketId, tenantId);

    if (!crmData) {
      return res.status(404).json({ error: 'Ticket não encontrado' });
    }

    res.json({
      success: true,
      data: crmData
    });

  } catch (error) {
    console.error('[API] Erro ao buscar dados CRM do ticket:', error);
    res.status(500).json({ 
      error: 'Erro ao buscar dados CRM',
      details: error.message 
    });
  }
});

/**
 * POST /api/tickets/:ticketId/crm/sync
 * Força sincronização manual do ticket com o CRM
 */
router.post('/:ticketId/crm/sync', authenticateToken, async (req, res) => {
  try {
    const { ticketId } = req.params;
    const tenantId = req.user.tenantId;
    
    const { getSequelize } = require('../db/sequelize');
    const sequelize = getSequelize();
    const { Ticket } = sequelize.models;

    const ticket = await Ticket.findOne({
      where: { id: ticketId, tenant_key: tenantId }
    });

    if (!ticket) {
      return res.status(404).json({ error: 'Ticket não encontrado' });
    }

    const contact = await ticketCrmService.syncTicketToCrm(ticket);

    res.json({
      success: true,
      message: 'Ticket sincronizado com CRM',
      data: {
        contactId: contact?.id,
        ticketId: ticket.id
      }
    });

  } catch (error) {
    console.error('[API] Erro ao sincronizar ticket:', error);
    res.status(500).json({ 
      error: 'Erro ao sincronizar',
      details: error.message 
    });
  }
});

/**
 * POST /api/tickets/:ticketId/crm/convert-to-opportunity
 * Converte ticket em oportunidade CRM
 */
router.post('/:ticketId/crm/convert-to-opportunity', authenticateToken, async (req, res) => {
  try {
    const { ticketId } = req.params;
    const tenantId = req.user.tenantId;
    const opportunityData = req.body;

    const opportunity = await ticketCrmService.convertToOpportunity(
      ticketId,
      opportunityData,
      tenantId
    );

    res.json({
      success: true,
      message: 'Oportunidade criada com sucesso',
      data: opportunity
    });

  } catch (error) {
    console.error('[API] Erro ao converter em oportunidade:', error);
    res.status(500).json({ 
      error: 'Erro ao criar oportunidade',
      details: error.message 
    });
  }
});

/**
 * POST /api/tickets/:ticketId/crm/link-contact
 * Vincula ticket a um contato CRM existente
 */
router.post('/:ticketId/crm/link-contact', authenticateToken, async (req, res) => {
  try {
    const { ticketId } = req.params;
    const { contactId } = req.body;
    const tenantId = req.user.tenantId;

    const { getSequelize } = require('../db/sequelize');
    const sequelize = getSequelize();
    const { Ticket, CrmContact, CrmActivity } = sequelize.models;

    const transaction = await sequelize.transaction();

    try {
      const ticket = await Ticket.findOne({
        where: { id: ticketId, tenant_key: tenantId },
        transaction
      });

      if (!ticket) {
        await transaction.rollback();
        return res.status(404).json({ error: 'Ticket não encontrado' });
      }

      const contact = await CrmContact.findOne({
        where: { id: contactId, tenantId: tenantId },
        transaction
      });

      if (!contact) {
        await transaction.rollback();
        return res.status(404).json({ error: 'Contato CRM não encontrado' });
      }

      // Vincula ticket
      await ticket.update({
        crm_contact_id: contact.id,
        crm_account_id: contact.accountId
      }, { transaction });

      // Registra atividade
      await CrmActivity.create({
        tenantId: tenantId,
        contactId: contact.id,
        accountId: contact.accountId,
        type: 'ticket',
        subject: `Ticket #${ticket.id} vinculado manualmente`,
        description: ticket.last_user_message || 'Ticket vinculado',
        status: 'completed',
        dueDate: new Date(),
        completedAt: new Date(),
        customFields: {
          ticket_id: ticket.id,
          linked_manually: true
        }
      }, { transaction });

      await transaction.commit();

      res.json({
        success: true,
        message: 'Ticket vinculado ao contato',
        data: {
          ticketId: ticket.id,
          contactId: contact.id
        }
      });

    } catch (error) {
      await transaction.rollback();
      throw error;
    }

  } catch (error) {
    console.error('[API] Erro ao vincular contato:', error);
    res.status(500).json({ 
      error: 'Erro ao vincular',
      details: error.message 
    });
  }
});

module.exports = router;
