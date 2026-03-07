'use strict';

const departmentsService = require('./departmentsService');
const queueService = require('./queueService');
const queueDefinitionService = require('./queueDefinitionService');
const tenantSettingsService = require('./tenantSettingsService');

const SETTINGS_KEY = 'whatsapp_ivr';
const FALLBACK_MODES = new Set(['rules', 'menu', 'rules_then_menu']);
const OFF_HOURS_POLICIES = new Set(['create_ticket', 'collect_info', 'route_to_oncall']);
const QUEUE_STRATEGIES = new Set(['default', 'department_default']);
const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const DAY_LABEL_TO_KEY = {
  mon: 'mon',
  monday: 'mon',
  tue: 'tue',
  tuesday: 'tue',
  wed: 'wed',
  wednesday: 'wed',
  thu: 'thu',
  thursday: 'thu',
  fri: 'fri',
  friday: 'fri',
  sat: 'sat',
  saturday: 'sat',
  sun: 'sun',
  sunday: 'sun',
};

const DEFAULT_BUSINESS_HOURS = Object.freeze({
  enabled: false,
  timezone: 'America/Sao_Paulo',
  schedule: {
    mon: [],
    tue: [],
    wed: [],
    thu: [],
    fri: [],
    sat: [],
    sun: [],
  },
  holidays: [],
  offHoursPolicy: 'create_ticket',
});

const DEFAULT_MENU = Object.freeze({
  enabled: true,
  timeoutSeconds: 600,
  maxAttempts: 3,
  showOnlyBoundDepartments: true,
  allowTextAliases: true,
  greetingTemplate: 'Oi! Para te atender melhor, escolha uma opção:',
  retryTemplate: 'Nao entendi. Responda com o numero da opcao.',
  confirmationTemplate: 'Perfeito! Vou te direcionar para {{department}}.',
});

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeString(value) {
  return String(value == null ? '' : value).trim();
}

function normalizeText(value) {
  return normalizeString(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}

function toPositiveInt(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
}

function normalizeTimeZone(value) {
  const timezone = normalizeString(value) || DEFAULT_BUSINESS_HOURS.timezone;
  try {
    Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(new Date());
    return timezone;
  } catch (_) {
    return DEFAULT_BUSINESS_HOURS.timezone;
  }
}

function normalizeHolidayEntry(entry) {
  if (!entry) return null;
  if (typeof entry === 'string') {
    const trimmed = entry.trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : null;
  }
  if (typeof entry === 'object') {
    const date = normalizeString(entry.date || entry.day || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
    return {
      date,
      label: normalizeString(entry.label || entry.name || ''),
    };
  }
  return null;
}

function normalizeTimeRange(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const start = normalizeString(entry.start);
  const end = normalizeString(entry.end);
  if (!/^\d{2}:\d{2}$/.test(start) || !/^\d{2}:\d{2}$/.test(end)) return null;
  if (start >= end) return null;
  return { start, end };
}

function normalizeBusinessHours(input) {
  const base = input && typeof input === 'object' ? input : {};
  const scheduleInput = base.schedule && typeof base.schedule === 'object' ? base.schedule : {};
  const schedule = {};

  for (const key of DAY_KEYS) {
    schedule[key] = ensureArray(scheduleInput[key]).map(normalizeTimeRange).filter(Boolean);
  }

  return {
    enabled: base.enabled === true,
    timezone: normalizeTimeZone(base.timezone),
    schedule,
    holidays: ensureArray(base.holidays).map(normalizeHolidayEntry).filter(Boolean),
    offHoursPolicy: OFF_HOURS_POLICIES.has(base.offHoursPolicy) ? base.offHoursPolicy : DEFAULT_BUSINESS_HOURS.offHoursPolicy,
  };
}

function normalizeMenu(input) {
  const base = input && typeof input === 'object' ? input : {};
  return {
    enabled: base.enabled !== false,
    timeoutSeconds: toPositiveInt(base.timeoutSeconds, DEFAULT_MENU.timeoutSeconds),
    maxAttempts: toPositiveInt(base.maxAttempts, DEFAULT_MENU.maxAttempts),
    showOnlyBoundDepartments: base.showOnlyBoundDepartments !== false,
    allowTextAliases: base.allowTextAliases !== false,
    greetingTemplate: normalizeString(base.greetingTemplate) || DEFAULT_MENU.greetingTemplate,
    retryTemplate: normalizeString(base.retryTemplate) || DEFAULT_MENU.retryTemplate,
    confirmationTemplate: normalizeString(base.confirmationTemplate) || DEFAULT_MENU.confirmationTemplate,
  };
}

function buildDepartmentMaps(departments = []) {
  const byId = new Map();
  const byName = new Map();

  for (const dept of departments) {
    if (!dept || !dept.id) continue;
    byId.set(String(dept.id), dept);
    byName.set(normalizeText(dept.name), dept);
  }

  return { byId, byName };
}

function resolveOfficialDepartment(candidate = {}, maps) {
  const id = normalizeString(candidate.departmentId || candidate.id);
  if (id && maps.byId.has(id)) return maps.byId.get(id);

  const normalizedName = normalizeText(candidate.name || candidate.menuLabel || '');
  if (normalizedName && maps.byName.has(normalizedName)) return maps.byName.get(normalizedName);

  return null;
}

function deriveLegacyMirror(config, departmentsById) {
  return ensureArray(config.departmentBindings)
    .map((binding) => {
      const dept = departmentsById.get(binding.departmentId);
      if (!dept) return null;
      return {
        id: binding.departmentId,
        name: dept.name,
        queue: binding.defaultQueueName || (dept.queueNames.length === 1 ? dept.queueNames[0] : null),
        enabled: binding.enabled === true,
      };
    })
    .filter(Boolean);
}

function getOfficialDepartmentsAndQueues(tenantId) {
  const departments = departmentsService.listDepartments({ tenantId, activeOnly: true });
  const queueDefinitions = queueDefinitionService.listQueues({ tenantId, activeOnly: true }).map((q) => q.name);
  const legacyQueues = queueService.listQueues ? queueService.listQueues() : [];
  const queues = Array.from(new Set([...(legacyQueues || []), ...queueDefinitions].map((item) => normalizeString(item)).filter(Boolean))).sort();

  return { departments, queues };
}

function normalizeBindingInput(input, department, index = 0) {
  const queueNames = Array.isArray(department?.queueNames) ? department.queueNames : [];
  const preferredQueue = normalizeString(input.defaultQueueName);
  const defaultQueueName = preferredQueue && queueNames.includes(preferredQueue)
    ? preferredQueue
    : (queueNames.length === 1 ? queueNames[0] : null);

  return {
    departmentId: String(department.id),
    enabled: input.enabled === true,
    defaultQueueName,
    queueStrategy: QUEUE_STRATEGIES.has(input.queueStrategy) ? input.queueStrategy : 'default',
    menuLabel: normalizeString(input.menuLabel) || normalizeString(department.name),
    menuDescription: normalizeString(input.menuDescription),
    menuOrder: Number.isFinite(Number(input.menuOrder)) ? Number(input.menuOrder) : (index + 1),
    aliases: ensureArray(input.aliases).map((item) => normalizeString(item)).filter(Boolean),
    businessHoursOverride: input.businessHoursOverride ? normalizeBusinessHours(input.businessHoursOverride) : null,
  };
}

function normalizeRuleInput(input) {
  return {
    id: normalizeString(input.id) || `wivr-rule-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    keyword: normalizeString(input.keyword),
    departmentId: normalizeString(input.departmentId),
    priority: Number.isFinite(Number(input.priority)) ? Number(input.priority) : 0,
    enabled: input.enabled !== false,
  };
}

function normalizeMigrationState(input = {}, warnings = []) {
  const migration = input && typeof input === 'object' ? input : {};
  const pendingDepartments = ensureArray(migration.pendingDepartments).map((item) => ({
    legacyId: normalizeString(item.legacyId || item.id),
    name: normalizeString(item.name),
    queue: normalizeString(item.queue),
    reason: normalizeString(item.reason) || 'pending_mapping',
  })).filter((item) => item.legacyId || item.name || item.queue);

  return {
    sourceFormat: normalizeString(migration.sourceFormat) || (warnings.length > 0 ? 'legacy' : 'normalized'),
    pendingDepartments,
    warnings: warnings.slice(),
  };
}

function normalizeWhatsAppIvrConfig(rawConfig, { departments = [], queues = [] } = {}) {
  const raw = rawConfig && typeof rawConfig === 'object' ? rawConfig : {};
  const warnings = [];
  const { byId, byName } = buildDepartmentMaps(departments);
  const legacyDepartments = ensureArray(raw.departments);
  const legacyToOfficial = new Map();
  const pendingDepartments = [];

  for (const legacyDept of legacyDepartments) {
    const officialDept = resolveOfficialDepartment(legacyDept, { byId, byName });
    const legacyKey = normalizeString(legacyDept.id) || normalizeString(legacyDept.name);
    if (!legacyKey) continue;

    if (!officialDept) {
      warnings.push(`Departamento legado "${normalizeString(legacyDept.name) || legacyKey}" nao foi mapeado para um departamento oficial.`);
      pendingDepartments.push({
        legacyId: normalizeString(legacyDept.id) || legacyKey,
        name: normalizeString(legacyDept.name),
        queue: normalizeString(legacyDept.queue),
        reason: 'department_not_found',
      });
      continue;
    }

    if (normalizeString(legacyDept.queue) && !ensureArray(officialDept.queueNames).includes(normalizeString(legacyDept.queue))) {
      warnings.push(`Fila legada "${normalizeString(legacyDept.queue)}" nao existe mais em "${officialDept.name}".`);
    }
    legacyToOfficial.set(legacyKey, officialDept.id);
  }

  const bindingInputs = ensureArray(raw.departmentBindings);
  const legacyBindingInputs = bindingInputs.length > 0
    ? []
    : legacyDepartments.map((legacyDept, index) => {
      const legacyKey = normalizeString(legacyDept.id) || normalizeString(legacyDept.name);
      const officialDepartmentId = legacyToOfficial.get(legacyKey);
      if (!officialDepartmentId) return null;
      return {
        departmentId: officialDepartmentId,
        enabled: legacyDept.enabled === true,
        defaultQueueName: normalizeString(legacyDept.queue),
        queueStrategy: 'default',
        menuLabel: normalizeString(legacyDept.name),
        menuDescription: '',
        menuOrder: index + 1,
        aliases: [],
        businessHoursOverride: null,
      };
    }).filter(Boolean);

  const normalizedBindings = [];
  const seenBindingDepartments = new Set();

  for (const [index, bindingInput] of (bindingInputs.length > 0 ? bindingInputs : legacyBindingInputs).entries()) {
    const department = resolveOfficialDepartment(bindingInput, { byId, byName });
    if (!department) {
      warnings.push(`Binding com departamento "${normalizeString(bindingInput.departmentId || bindingInput.name || bindingInput.id)}" nao corresponde a um departamento oficial ativo.`);
      continue;
    }
    if (seenBindingDepartments.has(department.id)) continue;
    seenBindingDepartments.add(department.id);
    normalizedBindings.push(normalizeBindingInput(bindingInput, department, index));
  }

  const normalizedRules = ensureArray(raw.rules).map((rule) => {
    const next = normalizeRuleInput(rule);
    const legacyDepartmentId = normalizeString(rule.departmentId);
    const mappedDepartmentId = legacyToOfficial.get(legacyDepartmentId);
    if (mappedDepartmentId) {
      next.departmentId = mappedDepartmentId;
      warnings.push(`Regra "${next.keyword}" migrada do departamento legado "${legacyDepartmentId}" para "${next.departmentId}".`);
    } else if (!next.departmentId) {
      next.departmentId = legacyDepartmentId;
    }
    return next;
  }).filter((rule) => rule.keyword);

  const defaultDepartmentId = (() => {
    const rawId = normalizeString(raw.defaultDepartmentId);
    if (rawId && byId.has(rawId)) return rawId;
    const legacyMapped = legacyToOfficial.get(rawId);
    return legacyMapped || null;
  })();

  const normalized = {
    enabled: raw.enabled === true,
    aiEnabled: raw.aiEnabled === true,
    aiContextRagEnabled: raw.aiContextRagEnabled === true || raw.ragEnabled === true,
    aiMinConfidence: Number.isFinite(Number(raw.aiMinConfidence))
      ? Number(Math.max(0, Math.min(1, Number(raw.aiMinConfidence))).toFixed(2))
      : 0.75,
    aiContextTimeoutMs: Number.isFinite(Number(raw.aiContextTimeoutMs))
      ? Math.max(300, Math.min(5000, Math.trunc(Number(raw.aiContextTimeoutMs))))
      : 1200,
    fallbackMode: FALLBACK_MODES.has(raw.fallbackMode) ? raw.fallbackMode : 'rules_then_menu',
    defaultDepartmentId,
    defaultQueueStrategy: QUEUE_STRATEGIES.has(raw.defaultQueueStrategy) ? raw.defaultQueueStrategy : 'department_default',
    businessHours: normalizeBusinessHours(raw.businessHours),
    departmentBindings: normalizedBindings,
    rules: normalizedRules,
    menu: normalizeMenu(raw.menu),
    migration: normalizeMigrationState({
      sourceFormat: raw.departmentBindings ? 'normalized' : (legacyDepartments.length > 0 ? 'legacy' : 'normalized'),
      pendingDepartments: [...pendingDepartments, ...ensureArray(raw.migration?.pendingDepartments)],
    }, warnings),
  };

  return {
    config: normalized,
    warnings,
    legacyMirror: deriveLegacyMirror(normalized, byId),
    departmentsById: byId,
    queues: queues.slice(),
  };
}

function validateBusinessHours(businessHours, path = 'businessHours') {
  const errors = [];
  const normalized = normalizeBusinessHours(businessHours);
  if (!OFF_HOURS_POLICIES.has(normalized.offHoursPolicy)) {
    errors.push(`${path}.offHoursPolicy invalido`);
  }
  for (const day of DAY_KEYS) {
    for (const range of normalized.schedule[day]) {
      if (!/^\d{2}:\d{2}$/.test(range.start) || !/^\d{2}:\d{2}$/.test(range.end) || range.start >= range.end) {
        errors.push(`${path}.schedule.${day} contem faixa invalida`);
      }
    }
  }
  return errors;
}

function validateWhatsAppIvrConfig(config, { departments = [], queues = [] } = {}) {
  const errors = [];
  const warnings = [];
  const byId = new Map(departments.map((item) => [String(item.id), item]));
  const queueSet = new Set(queues.map((item) => normalizeString(item)));
  const seenBindings = new Set();

  if (!FALLBACK_MODES.has(config.fallbackMode)) {
    errors.push('fallbackMode invalido');
  }
  if (!Number.isFinite(Number(config.aiMinConfidence)) || Number(config.aiMinConfidence) < 0 || Number(config.aiMinConfidence) > 1) {
    errors.push('aiMinConfidence invalido');
  }
  if (!Number.isFinite(Number(config.aiContextTimeoutMs)) || Number(config.aiContextTimeoutMs) < 300 || Number(config.aiContextTimeoutMs) > 5000) {
    errors.push('aiContextTimeoutMs invalido');
  }
  if (!QUEUE_STRATEGIES.has(config.defaultQueueStrategy)) {
    errors.push('defaultQueueStrategy invalido');
  }
  errors.push(...validateBusinessHours(config.businessHours));

  for (const binding of ensureArray(config.departmentBindings)) {
    if (!binding || !binding.departmentId) {
      errors.push('Binding sem departmentId');
      continue;
    }
    if (seenBindings.has(binding.departmentId)) {
      errors.push(`Binding duplicado para departamento ${binding.departmentId}`);
      continue;
    }
    seenBindings.add(binding.departmentId);

    const department = byId.get(binding.departmentId);
    if (!department) {
      errors.push(`Departamento ${binding.departmentId} nao existe ou esta inativo`);
      continue;
    }

    const queueNames = ensureArray(department.queueNames).map((item) => normalizeString(item)).filter(Boolean);
    if (queueNames.length === 0) {
      warnings.push(`Departamento "${department.name}" esta sem fila operacional vinculada.`);
    }

    if (binding.defaultQueueName && !queueNames.includes(binding.defaultQueueName)) {
      errors.push(`Fila padrao "${binding.defaultQueueName}" invalida para o departamento "${department.name}"`);
    }
    if (binding.defaultQueueName && !queueSet.has(binding.defaultQueueName)) {
      errors.push(`Fila padrao "${binding.defaultQueueName}" nao existe nas filas oficiais`);
    }
    if (!Array.isArray(binding.aliases)) {
      errors.push(`aliases do departamento "${department.name}" devem ser array`);
    }
    if (!Number.isFinite(Number(binding.menuOrder))) {
      errors.push(`menuOrder do departamento "${department.name}" deve ser numero`);
    }
    if (binding.businessHoursOverride) {
      errors.push(...validateBusinessHours(binding.businessHoursOverride, `departmentBindings.${binding.departmentId}.businessHoursOverride`));
    }
  }

  for (const rule of ensureArray(config.rules)) {
    if (!rule.keyword) {
      errors.push(`Regra ${rule.id || 'sem_id'} sem keyword`);
      continue;
    }
    const department = byId.get(rule.departmentId);
    if (!department) {
      errors.push(`Regra "${rule.keyword}" aponta para departamento inexistente/inativo`);
    }
  }

  if (config.defaultDepartmentId && !byId.has(config.defaultDepartmentId)) {
    errors.push('defaultDepartmentId nao existe entre os departamentos ativos');
  }

  return { errors, warnings };
}

function buildInvalidState(config, departments = [], queues = []) {
  const byId = new Map(departments.map((item) => [String(item.id), item]));
  const queueSet = new Set(queues.map((item) => normalizeString(item)));
  const invalidBindings = [];
  const invalidRules = [];

  for (const binding of ensureArray(config.departmentBindings)) {
    const department = byId.get(binding.departmentId);
    if (!department) {
      invalidBindings.push({ departmentId: binding.departmentId, reason: 'department_not_found' });
      continue;
    }

    const queueNames = ensureArray(department.queueNames).map((item) => normalizeString(item)).filter(Boolean);
    if (queueNames.length === 0) {
      invalidBindings.push({ departmentId: binding.departmentId, reason: 'department_without_queues' });
      continue;
    }
    if (binding.defaultQueueName && !queueNames.includes(binding.defaultQueueName)) {
      invalidBindings.push({ departmentId: binding.departmentId, reason: 'default_queue_not_in_department', defaultQueueName: binding.defaultQueueName });
    } else if (binding.defaultQueueName && !queueSet.has(binding.defaultQueueName)) {
      invalidBindings.push({ departmentId: binding.departmentId, reason: 'default_queue_not_found', defaultQueueName: binding.defaultQueueName });
    } else if (!binding.defaultQueueName && queueNames.length > 1) {
      invalidBindings.push({ departmentId: binding.departmentId, reason: 'default_queue_required' });
    }
  }

  for (const rule of ensureArray(config.rules)) {
    if (!byId.has(rule.departmentId)) {
      invalidRules.push({ id: rule.id, keyword: rule.keyword, departmentId: rule.departmentId, reason: 'department_not_found' });
    }
  }

  return { invalidBindings, invalidRules };
}

function sortMenuOptions(options = []) {
  return options.sort((a, b) => {
    const orderDiff = Number(a.menuOrder || 0) - Number(b.menuOrder || 0);
    if (orderDiff !== 0) return orderDiff;
    return String(a.departmentName || '').localeCompare(String(b.departmentName || ''));
  });
}

function buildMenuOptions(config, departments = []) {
  const byId = new Map(departments.map((item) => [String(item.id), item]));
  const options = ensureArray(config.departmentBindings)
    .filter((binding) => binding.enabled === true)
    .map((binding) => {
      const department = byId.get(binding.departmentId);
      if (!department) return null;
      return {
        departmentId: binding.departmentId,
        departmentName: department.name,
        menuLabel: binding.menuLabel || department.name,
        menuDescription: binding.menuDescription || '',
        menuOrder: Number.isFinite(Number(binding.menuOrder)) ? Number(binding.menuOrder) : 0,
        aliases: ensureArray(binding.aliases),
        defaultQueueName: binding.defaultQueueName || null,
      };
    })
    .filter(Boolean);

  return sortMenuOptions(options).map((item, index) => ({ ...item, optionNumber: index + 1 }));
}

function getCurrentDayParts(now = new Date(), timezone = DEFAULT_BUSINESS_HOURS.timezone) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = fmt.formatToParts(now);
  const lookup = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const dayKey = DAY_LABEL_TO_KEY[String(lookup.weekday || '').toLowerCase()] || 'mon';
  return {
    dayKey,
    dateKey: `${lookup.year}-${lookup.month}-${lookup.day}`,
    timeKey: `${lookup.hour}:${lookup.minute}`,
  };
}

function isWithinBusinessHours(businessHours, { now = new Date() } = {}) {
  const normalized = normalizeBusinessHours(businessHours);
  if (!normalized.enabled) {
    return { open: true, reason: 'disabled', timezone: normalized.timezone };
  }

  const { dayKey, dateKey, timeKey } = getCurrentDayParts(now, normalized.timezone);
  const holidayHit = normalized.holidays.find((item) => (typeof item === 'string' ? item : item.date) === dateKey);
  if (holidayHit) {
    return { open: false, reason: 'holiday', timezone: normalized.timezone, dayKey, dateKey, timeKey };
  }

  const ranges = ensureArray(normalized.schedule[dayKey]);
  const open = ranges.some((range) => range.start <= timeKey && timeKey < range.end);
  return {
    open,
    reason: open ? 'open' : 'outside_schedule',
    timezone: normalized.timezone,
    dayKey,
    dateKey,
    timeKey,
  };
}

async function getNormalizedWhatsAppIvrSetting({ tenantId }) {
  const [settingOut] = await Promise.all([
    tenantSettingsService.getSetting({ tenantId, key: SETTINGS_KEY }),
  ]);
  if (!settingOut.ok) return { ok: false, error: settingOut.error || 'settings_unavailable' };

  const { departments, queues } = getOfficialDepartmentsAndQueues(tenantId);
  const normalized = normalizeWhatsAppIvrConfig(settingOut.value || {}, { departments, queues });
  const validation = validateWhatsAppIvrConfig(normalized.config, { departments, queues });
  const invalid = buildInvalidState(normalized.config, departments, queues);
  const menuOptions = buildMenuOptions(normalized.config, departments);

  return {
    ok: true,
    value: {
      ...normalized.config,
      departments: normalized.legacyMirror,
    },
    departments,
    queues,
    menuOptions,
    warnings: Array.from(new Set([...(normalized.warnings || []), ...(validation.warnings || []), ...ensureArray(normalized.config?.migration?.warnings)])),
    invalidBindings: invalid.invalidBindings,
    invalidRules: invalid.invalidRules,
  };
}

async function saveWhatsAppIvrSetting({ tenantId, payload }) {
  const { departments, queues } = getOfficialDepartmentsAndQueues(tenantId);
  const normalized = normalizeWhatsAppIvrConfig(payload || {}, { departments, queues });
  const validation = validateWhatsAppIvrConfig(normalized.config, { departments, queues });

  if (validation.errors.length > 0) {
    return {
      ok: false,
      error: 'validation_error',
      details: validation.errors,
      warnings: [...normalized.warnings, ...validation.warnings],
    };
  }

  const persistValue = {
    ...normalized.config,
    departments: normalized.legacyMirror,
  };

  const out = await tenantSettingsService.upsertSetting({
    tenantId,
    key: SETTINGS_KEY,
    value: persistValue,
  });

  if (!out.ok) {
    return { ok: false, error: out.error || 'settings_unavailable' };
  }

  return getNormalizedWhatsAppIvrSetting({ tenantId });
}

module.exports = {
  SETTINGS_KEY,
  FALLBACK_MODES,
  OFF_HOURS_POLICIES,
  QUEUE_STRATEGIES,
  DEFAULT_BUSINESS_HOURS,
  DEFAULT_MENU,
  normalizeText,
  normalizeBusinessHours,
  normalizeMenu,
  normalizeWhatsAppIvrConfig,
  validateWhatsAppIvrConfig,
  buildMenuOptions,
  buildInvalidState,
  isWithinBusinessHours,
  getOfficialDepartmentsAndQueues,
  getNormalizedWhatsAppIvrSetting,
  saveWhatsAppIvrSetting,
};
