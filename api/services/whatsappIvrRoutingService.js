'use strict';

const {
  buildMenuOptions,
  isWithinBusinessHours,
  normalizeText,
} = require('./whatsappIvrService');

function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}

function resolveBindingMap(config) {
  return new Map(ensureArray(config.departmentBindings).map((item) => [String(item.departmentId), item]));
}

function resolveDepartmentMap(departments) {
  return new Map(ensureArray(departments).map((item) => [String(item.id), item]));
}

function resolveQueueForDepartmentBinding({ binding, department }) {
  if (!binding || !department) return null;
  const queueNames = ensureArray(department.queueNames).map((item) => String(item).trim()).filter(Boolean);
  if (binding.defaultQueueName && queueNames.includes(binding.defaultQueueName)) return binding.defaultQueueName;
  if (queueNames.length === 1) return queueNames[0];
  return null;
}

function matchRule({ config, text, departments }) {
  const normalizedText = normalizeText(text);
  const departmentMap = resolveDepartmentMap(departments);

  return ensureArray(config.rules)
    .filter((rule) => rule.enabled !== false)
    .sort((a, b) => Number(b.priority || 0) - Number(a.priority || 0))
    .find((rule) => {
      if (!departmentMap.has(String(rule.departmentId))) return false;
      const keyword = normalizeText(rule.keyword);
      return keyword && normalizedText.includes(keyword);
    }) || null;
}

function resolveMenuChoice({ config, departments, text }) {
  const options = buildMenuOptions(config, departments);
  const normalizedInput = normalizeText(text);
  const numericChoice = Number.parseInt(String(text || '').trim(), 10);

  if (Number.isFinite(numericChoice) && numericChoice > 0) {
    const byNumber = options.find((item) => item.optionNumber === numericChoice);
    if (byNumber) return { option: byNumber, selectedVia: 'menu' };
  }

  if (config?.menu?.allowTextAliases !== false) {
    const byAlias = options.find((item) => ensureArray(item.aliases).some((alias) => normalizeText(alias) === normalizedInput));
    if (byAlias) return { option: byAlias, selectedVia: 'menu' };
  }

  return null;
}

function buildRoutingResult({
  modeUsed,
  selectedVia,
  department,
  binding,
  queueName,
  matchedRule = null,
  confidence = null,
  aiIntent = null,
  aiSecondaryIntent = null,
  aiEntities = null,
  aiReasoning = null,
  aiExplanation = null,
  contextUsed = null,
  ragUsed = false,
  providerStatus = null,
  offHours = false,
  action = 'route',
  offHoursMessage = null,
}) {
  return {
    action,
    modeUsed,
    selectedVia,
    departmentId: department?.id || null,
    departmentName: department?.name || null,
    queueName: queueName || null,
    matchedRuleId: matchedRule?.id || null,
    confidence,
    offHours,
    offHoursMessage,
    ticketContext: {
      whatsappIvr: {
        enabled: true,
        modeUsed,
        departmentId: department?.id || null,
        departmentName: department?.name || null,
        queueName: queueName || null,
        matchedRuleId: matchedRule?.id || null,
        selectedVia,
        confidence,
        aiIntent: aiIntent || null,
        aiSecondaryIntent: aiSecondaryIntent || null,
        aiEntities: aiEntities || null,
        aiReasoning: aiReasoning || null,
        aiExplanation: aiExplanation || null,
        contextUsed: contextUsed || null,
        ragUsed: ragUsed === true,
        providerStatus: providerStatus || null,
        offHours,
      },
    },
    binding: binding || null,
  };
}

function buildOffHoursResult({ policy, config, defaultDepartment, defaultBinding, queueName, businessHoursResult }) {
  const message = policy === 'create_ticket'
    ? 'Estamos fora do horario de atendimento. Seu chamado foi registrado e retornaremos assim que possivel.'
    : 'Estamos fora do horario de atendimento. Pode enviar os dados que continuaremos no proximo horario util.';

  return buildRoutingResult({
    action: policy === 'create_ticket' ? 'create_ticket' : 'collect_info',
    modeUsed: 'off_hours',
    selectedVia: 'off_hours',
    department: defaultDepartment,
    binding: defaultBinding,
    queueName,
    offHours: true,
    offHoursMessage: message,
    confidence: null,
  });
}

function resolveWhatsAppIvrRouting({
  config,
  departments = [],
  text = '',
  aiResult = null,
  now = new Date(),
  menuState = null,
}) {
  const safeConfig = config && typeof config === 'object' ? config : {};
  const departmentMap = resolveDepartmentMap(departments);
  const bindingMap = resolveBindingMap(safeConfig);
  const defaultDepartment = safeConfig.defaultDepartmentId ? departmentMap.get(String(safeConfig.defaultDepartmentId)) || null : null;
  const defaultBinding = defaultDepartment ? bindingMap.get(String(defaultDepartment.id)) || null : null;
  const defaultQueueName = resolveQueueForDepartmentBinding({ binding: defaultBinding, department: defaultDepartment });

  if (safeConfig.enabled !== true) {
    return { action: 'noop', modeUsed: 'disabled', selectedVia: 'disabled', offHours: false };
  }

  const globalHours = isWithinBusinessHours(safeConfig.businessHours, { now });
  if (!globalHours.open) {
    return buildOffHoursResult({
      policy: safeConfig.businessHours?.offHoursPolicy || 'create_ticket',
      config: safeConfig,
      defaultDepartment,
      defaultBinding,
      queueName: defaultQueueName,
      businessHoursResult: globalHours,
    });
  }

  if (safeConfig.aiEnabled === true) {
    const aiDepartmentId = aiResult && aiResult.confidence >= (safeConfig.aiMinConfidence || 0.75)
      ? String(aiResult.departmentId || '')
      : '';
    const aiDepartment = aiDepartmentId ? departmentMap.get(aiDepartmentId) || null : null;
    const aiBinding = aiDepartment ? bindingMap.get(aiDepartmentId) || null : null;
    const aiQueueName = resolveQueueForDepartmentBinding({ binding: aiBinding, department: aiDepartment });
    if (aiDepartment && aiBinding?.enabled === true && aiQueueName) {
      return buildRoutingResult({
        action: 'route',
        modeUsed: 'ai',
        selectedVia: 'ai',
        department: aiDepartment,
        binding: aiBinding,
        queueName: aiQueueName,
        confidence: aiResult.confidence,
        aiIntent: aiResult.intent || null,
        aiSecondaryIntent: aiResult.secondaryIntent || null,
        aiEntities: aiResult.entities || null,
        aiReasoning: aiResult.reasoning || null,
        aiExplanation: aiResult.explanation || null,
        contextUsed: aiResult.contextUsed || null,
        ragUsed: aiResult.ragUsed === true,
        providerStatus: aiResult.providerStatus || null,
      });
    }
  }

  const fallbackMode = safeConfig.fallbackMode || 'rules_then_menu';
  const matchedRule = fallbackMode === 'menu' ? null : matchRule({ config: safeConfig, text, departments });
  if (matchedRule) {
    const ruleDepartment = departmentMap.get(String(matchedRule.departmentId)) || null;
    const ruleBinding = ruleDepartment ? bindingMap.get(String(ruleDepartment.id)) || null : null;
    const queueName = resolveQueueForDepartmentBinding({ binding: ruleBinding, department: ruleDepartment });
    if (ruleDepartment && queueName) {
      return buildRoutingResult({
        action: 'route',
        modeUsed: 'rules',
        selectedVia: 'rule',
        department: ruleDepartment,
        binding: ruleBinding,
        queueName,
        matchedRule,
      });
    }
  }

  if (fallbackMode === 'rules' && defaultDepartment && defaultQueueName) {
    return buildRoutingResult({
      action: 'route',
      modeUsed: 'rules',
      selectedVia: 'default',
      department: defaultDepartment,
      binding: defaultBinding,
      queueName: defaultQueueName,
    });
  }

  const menuChoice = resolveMenuChoice({ config: safeConfig, departments, text });
  if (menuChoice) {
    const department = departmentMap.get(String(menuChoice.option.departmentId)) || null;
    const binding = department ? bindingMap.get(String(department.id)) || null : null;
    const queueName = resolveQueueForDepartmentBinding({ binding, department });
    if (department && queueName) {
      return buildRoutingResult({
        action: 'route',
        modeUsed: 'menu',
        selectedVia: menuChoice.selectedVia,
        department,
        binding,
        queueName,
      });
    }
  }

  if (fallbackMode === 'menu' || fallbackMode === 'rules_then_menu') {
    return {
      action: 'show_menu',
      modeUsed: 'menu',
      selectedVia: menuState?.status === 'awaiting_choice' ? 'menu_retry' : 'menu_prompt',
      menuOptions: buildMenuOptions(safeConfig, departments),
      offHours: false,
    };
  }

  return {
    action: 'noop',
    modeUsed: fallbackMode,
    selectedVia: 'none',
    offHours: false,
  };
}

function buildTicketPatchFromRouting({ ticket, routingResult }) {
  if (!routingResult || !ticket) return null;
  const currentTags = ensureArray(ticket.tags);
  const context = ticket.context && typeof ticket.context === 'object' ? ticket.context : {};
  const metadata = context.metadata && typeof context.metadata === 'object' ? context.metadata : {};

  const nextTags = routingResult.offHours
    ? Array.from(new Set([...currentTags, 'fora_do_horario']))
    : currentTags.slice();

  return {
    queue: routingResult.queueName || ticket.queue,
    tags: nextTags,
    context: {
      ...context,
      whatsappIvr: routingResult.ticketContext?.whatsappIvr || null,
      metadata: {
        ...metadata,
        whatsappIvr: routingResult.ticketContext?.whatsappIvr || null,
      },
    },
  };
}

module.exports = {
  resolveQueueForDepartmentBinding,
  matchRule,
  resolveMenuChoice,
  resolveWhatsAppIvrRouting,
  buildTicketPatchFromRouting,
};
