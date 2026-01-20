/**
 * Marketplace de templates de fluxo (DB-only) com cache e seed.
 *
 * - Templates globais: tenant_key = 'system'
 * - Templates por tenant: tenant_key = <tenantId>
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const logger = require('../utils/logger');
const { getSequelize } = require('../db/sequelize');
const { FlowTemplate: FlowTemplateGetter } = require('../db/models');
const { validateFlow } = require('../../engine/validator');

/** @type {Map<string, any>} */
const cache = new Map(); // id -> template

function dbAvailable() {
  return !!getSequelize();
}

function model() {
  return typeof FlowTemplateGetter === 'function' ? FlowTemplateGetter() : FlowTemplateGetter;
}

function nowIso(d) {
  try { return new Date(d).toISOString(); } catch { return new Date().toISOString(); }
}

function fromDbRow(row) {
  return {
    id: row.id,
    tenantId: row.tenant_key,
    name: row.name,
    description: row.description || '',
    icon: row.icon || '📋',
    tags: Array.isArray(row.tags) ? row.tags : [],
    flow: row.flow || {},
    active: row.active !== false,
    createdBy: row.created_by || null,
    createdAt: row.created_at ? nowIso(row.created_at) : (row.createdAt?.toISOString?.() || null),
    updatedAt: row.updated_at ? nowIso(row.updated_at) : (row.updatedAt?.toISOString?.() || null),
    scope: row.tenant_key === 'system' ? 'global' : 'tenant',
  };
}

function toDbPayload(tpl) {
  return {
    id: tpl.id,
    tenant_key: tpl.tenantId,
    name: tpl.name,
    description: tpl.description || '',
    icon: tpl.icon || '📋',
    tags: Array.isArray(tpl.tags) ? tpl.tags : [],
    flow: tpl.flow || {},
    active: tpl.active !== false,
    created_by: tpl.createdBy || null,
  };
}

function newId(prefix = 'tpl') {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
}

function getSeedSpec() {
  // Mapeia templates existentes em frontend/public/templates para o marketplace.
  // Mantém 10 padrões "Blip-like", com tags alinhadas ao pedido:
  // - captação lead
  // - agendamento
  // - cobrança
  // - pesquisa satisfação
  // - FAQ + RAG
  // - handover padrão
  // - suporte técnico triagem
  // - onboarding cliente
  // - atualização cadastral
  // - status de pedido/serviço
  return [
    {
      id: 'lead-captacao',
      file: 'template-ai-task-entity-extraction.json',
      name: 'Captação de lead (cadastro rápido)',
      description: 'Saudação + coleta de dados (nome, email, interesse) com extração de entidades para follow-up.',
      tags: ['lead', 'captacao', 'cadastro', 'entidades'],
      icon: '🧲',
    },
    {
      id: 'agendamento',
      file: 'schedule-router-example.json',
      name: 'Agendamento (roteamento por intenção)',
      description: 'Roteia para opções de agenda, confirma horário e cria contexto para atendimento/triagem.',
      tags: ['agendamento', 'roteamento', 'triagem'],
      icon: '📅',
    },
    {
      id: 'cobranca',
      file: 'teste-whatsapp-atendimento.json',
      name: 'Cobrança (negociação e lembrete)',
      description: 'Fluxo base para lembretes, negociação e encaminhamento para humano quando necessário.',
      tags: ['cobranca', 'financeiro', 'atendimento'],
      icon: '💳',
    },
    {
      id: 'pesquisa-satisfacao',
      file: 'user-input.json',
      name: 'Pesquisa de satisfação (CSAT/NPS)',
      description: 'Coleta feedback do cliente e registra respostas no contexto.',
      tags: ['pesquisa_satisfacao', 'csat', 'nps', 'coleta'],
      icon: '📝',
    },
    {
      id: 'faq-rag',
      file: 'template-ai-task-assisted-response.json',
      name: 'FAQ + RAG (resposta assistida)',
      description: 'Usa IA para sugerir respostas baseadas em base de conhecimento (RAG) e contexto.',
      tags: ['faq_rag', 'rag', 'faq', 'ia', 'assistido'],
      icon: '🤖',
    },
    {
      id: 'handover-padrao',
      file: 'handoff-support.json',
      name: 'Handover padrão (bot → humano)',
      description: 'Escalonamento para atendimento humano com contexto e orientação operacional.',
      tags: ['handover', 'humano', 'atendimento', 'suporte'],
      icon: '🧑‍💼',
    },
    {
      id: 'suporte-tecnico-triagem',
      file: 'template-ai-task-intent-classification.json',
      name: 'Suporte técnico (triagem por intenção)',
      description: 'Classifica intenção e direciona para filas/roteamento; ideal para suporte técnico.',
      tags: ['suporte', 'triagem', 'intent', 'roteamento', 'tecnico'],
      icon: '🧰',
    },
    {
      id: 'onboarding-cliente',
      file: 'template-completo.json',
      name: 'Onboarding do cliente (primeiros passos)',
      description: 'Fluxo base para orientar primeiros passos, capturar dados e preparar atendimento.',
      tags: ['onboarding', 'cliente', 'inicio', 'completo'],
      icon: '🚀',
    },
    {
      id: 'atualizacao-cadastral',
      file: 'get-user-info-example.json',
      name: 'Atualização cadastral',
      description: 'Coleta/consulta dados do usuário e atualiza variáveis do contexto para uso posterior.',
      tags: ['cadastro', 'atualizacao_cadastral', 'dados', 'perfil'],
      icon: '🪪',
    },
    {
      id: 'status-pedido-servico',
      file: 'api-example.json',
      name: 'Status de pedido/serviço',
      description: 'Consulta status via API e responde ao cliente; inclui fallback e mensagens claras.',
      tags: ['status', 'pedido', 'servico', 'api'],
      icon: '📦',
    },
  ];
}

function templatesDir() {
  return path.join(__dirname, '..', '..', 'frontend', 'public', 'templates');
}

function tryLoadSeedTemplate(fileName) {
  const dir = templatesDir();
  const filePath = path.join(dir, fileName);
  if (!fs.existsSync(filePath)) return null;
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const tpl = JSON.parse(content);
    if (!tpl?.id || !tpl?.name || !tpl?.flow) return null;
    return tpl;
  } catch (err) {
    logger.warn('[FlowTemplateMarketplace] Falha ao carregar seed template', { fileName, error: err.message });
    return null;
  }
}

async function upsertToDbBestEffort(tpl) {
  if (!dbAvailable()) return;
  const FlowTemplateModel = model();
  const payload = toDbPayload(tpl);
  const now = new Date();
  try {
    const existing = await FlowTemplateModel.findByPk(tpl.id);
    if (existing) {
      await existing.update({ ...payload, updated_at: now });
    } else {
      await FlowTemplateModel.create({ ...payload, created_at: now, updated_at: now });
    }
  } catch (err) {
    logger.warn('[FlowTemplateMarketplace] Falha ao persistir template', { id: tpl.id, error: err.message });
  }
}

async function seedSystemTemplatesBestEffort() {
  if (!dbAvailable()) return;
  const FlowTemplateModel = model();
  // Importante: não limita a "se estiver vazio".
  // Queremos garantir que os templates padrão existam mesmo após upgrades (best-effort).
  // Não removemos templates existentes, apenas upsert dos padrões definidos em getSeedSpec().

  const specs = getSeedSpec();
  let created = 0;

  for (const spec of specs) {
    const loaded = tryLoadSeedTemplate(spec.file);
    if (!loaded) continue;

    const validation = validateFlow(loaded.flow);
    if (!validation.valid && validation.errors?.length) {
      logger.warn('[FlowTemplateMarketplace] Seed template falhou validação, pulando', {
        id: spec.id || loaded.id,
        file: spec.file,
        errorCount: validation.errors.length,
      });
      continue;
    }

    const tpl = {
      id: `mkt-${spec.id || loaded.id}`,
      tenantId: 'system',
      name: spec.name || loaded.name,
      description: spec.description || loaded.description || '',
      icon: spec.icon || loaded.icon || '📋',
      tags: spec.tags || [],
      flow: loaded.flow,
      active: true,
      createdBy: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    cache.set(tpl.id, tpl);
    // eslint-disable-next-line no-await-in-loop
    await upsertToDbBestEffort(tpl);
    created += 1;
  }

  logger.info('[FlowTemplateMarketplace] Seed concluído', { created });
}

async function initialize() {
  if (!dbAvailable()) return;
  try {
    const FlowTemplateModel = model();
    const rows = await FlowTemplateModel.findAll();
    cache.clear();
    for (const row of rows) {
      const tpl = fromDbRow(row);
      cache.set(tpl.id, tpl);
    }

    await seedSystemTemplatesBestEffort();
  } catch (err) {
    logger.warn('[FlowTemplateMarketplace] Falha ao inicializar cache', { error: err.message });
  }
}

function listTemplates({ tenantId, tag, q, scope = 'all', activeOnly = true } = {}) {
  let list = Array.from(cache.values());

  if (activeOnly !== false) list = list.filter(t => t.active !== false);

  if (scope === 'global') {
    list = list.filter(t => t.tenantId === 'system');
  } else if (scope === 'tenant') {
    list = list.filter(t => tenantId && t.tenantId === tenantId);
  } else {
    // all: global + tenant
    if (tenantId) {
      list = list.filter(t => t.tenantId === 'system' || t.tenantId === tenantId);
    } else {
      list = list.filter(t => t.tenantId === 'system');
    }
  }

  if (tag) {
    const tagLower = String(tag).toLowerCase();
    list = list.filter(t => (t.tags || []).some(x => String(x).toLowerCase() === tagLower));
  }

  if (q) {
    const qLower = String(q).toLowerCase();
    list = list.filter(t =>
      String(t.name || '').toLowerCase().includes(qLower) ||
      String(t.description || '').toLowerCase().includes(qLower) ||
      String(t.id || '').toLowerCase().includes(qLower) ||
      (t.tags || []).some(x => String(x).toLowerCase().includes(qLower))
    );
  }

  list.sort((a, b) => {
    const ag = a.tenantId === 'system' ? 0 : 1;
    const bg = b.tenantId === 'system' ? 0 : 1;
    if (ag !== bg) return ag - bg;
    return String(a.name || '').localeCompare(String(b.name || ''));
  });

  // Retorna sem o flow para listagem
  return list.map(({ flow, ...rest }) => rest);
}

function getTemplate({ tenantId, id } = {}) {
  const tpl = cache.get(id);
  if (!tpl) return null;
  if (tpl.tenantId !== 'system' && tenantId && tpl.tenantId !== tenantId) return null;
  if (tpl.tenantId !== 'system' && !tenantId) return null;
  return tpl;
}

async function createTemplate({ tenantId, name, description = '', icon = '📋', tags = [], flow, createdBy = null, id = null }) {
  if (!tenantId) return { success: false, error: 'tenantId é obrigatório' };
  if (!name || !String(name).trim()) return { success: false, error: 'name é obrigatório' };
  if (!flow || typeof flow !== 'object') return { success: false, error: 'flow é obrigatório' };

  const validation = validateFlow(flow);
  if (!validation.valid && validation.errors?.length) {
    return { success: false, error: 'validation_failed', details: validation.errors };
  }

  const tpl = {
    id: id || newId('tpl'),
    tenantId,
    name: String(name).trim(),
    description: String(description || ''),
    icon: String(icon || '📋').substring(0, 2),
    tags: Array.isArray(tags) ? tags.map(t => String(t).trim()).filter(Boolean) : [],
    flow,
    active: true,
    createdBy,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    scope: 'tenant',
  };

  cache.set(tpl.id, tpl);
  await upsertToDbBestEffort(tpl);
  return { success: true, template: tpl };
}

async function deleteTemplate({ tenantId, id }) {
  const tpl = cache.get(id);
  if (!tpl) return { success: false, error: 'not_found' };
  if (tpl.tenantId === 'system') return { success: false, error: 'forbidden' };
  if (!tenantId || tpl.tenantId !== tenantId) return { success: false, error: 'forbidden' };

  cache.delete(id);

  if (!dbAvailable()) return { success: true, deletedId: id };
  try {
    const FlowTemplateModel = model();
    await FlowTemplateModel.destroy({ where: { id } });
  } catch (err) {
    logger.warn('[FlowTemplateMarketplace] Falha ao deletar template (best-effort)', { id, error: err.message });
  }

  return { success: true, deletedId: id };
}

module.exports = {
  initialize,
  listTemplates,
  getTemplate,
  createTemplate,
  deleteTemplate,
};

