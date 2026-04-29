import React, { useEffect, useMemo, useState } from 'react';
import { CrudPageBase } from '../../modules/crud-base';
import { useRouter } from '../../hooks/useRouter';
import { useToast } from '../../components/Toast';
import { getProject, getProjectTimeline, listProjects } from '../../api/projects';
import { useTheme } from '../../styles/themeContext';

function getProjectIdFromPath(path) {
  const parts = String(path || '').split('/').filter(Boolean);
  return parts[1] || null;
}

function formatDate(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('pt-BR');
}

function formatDateShort(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleDateString('pt-BR');
}

function normalizeStatus(value) {
  const text = String(value || '').toLowerCase();
  if (text.includes('done') || text.includes('concl')) return 'done';
  if (text.includes('block')) return 'blocked';
  if (text.includes('review')) return 'review';
  if (text.includes('doing') || text.includes('progress')) return 'in_progress';
  return 'todo';
}

function statusLabel(status) {
  const key = normalizeStatus(status);
  if (key === 'done') return 'Concluído';
  if (key === 'blocked') return 'Bloqueado';
  if (key === 'review') return 'Em revisão';
  if (key === 'in_progress') return 'Em andamento';
  return 'Planejado';
}

function statusBadgeClass(status) {
  const key = normalizeStatus(status);
  if (key === 'done') return 'bg-green-500/15 text-green-300 border-green-500/40';
  if (key === 'blocked') return 'bg-red-500/15 text-red-300 border-red-500/40';
  if (key === 'review') return 'bg-yellow-500/15 text-yellow-300 border-yellow-500/40';
  if (key === 'in_progress') return 'bg-blue-500/15 text-blue-300 border-blue-500/40';
  return 'bg-slate-500/15 text-slate-300 border-slate-500/40';
}

function toDate(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function daysLate(dueDate, status) {
  const due = toDate(dueDate);
  if (!due || normalizeStatus(status) === 'done') return 0;
  const diff = Date.now() - due.getTime();
  if (diff <= 0) return 0;
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

function buildSCurvePoints(items) {
  const sorted = [...items]
    .filter((item) => toDate(item.due_date))
    .sort((a, b) => toDate(a.due_date).getTime() - toDate(b.due_date).getTime());

  if (sorted.length === 0) return [];

  const total = sorted.length;
  return sorted.map((item, index) => {
    const x = total === 1 ? 0 : (index / (total - 1)) * 100;
    const y = ((index + 1) / total) * 100;
    return { x, y, label: formatDateShort(item.due_date) };
  });
}

function toSvgPath(points) {
  if (!points.length) return '';
  return points
    .map((point, index) => {
      const x = point.x;
      const y = 100 - point.y;
      return `${index === 0 ? 'M' : 'L'} ${x} ${y}`;
    })
    .join(' ');
}

function percent(value, total) {
  if (!total) return 0;
  return Math.round((value / total) * 10000) / 100;
}

function traduzirTipo(value) {
  const map = { task: 'Tarefa', milestone: 'Marco', bug: 'Bug', feature: 'Funcionalidade', epic: 'Épico', story: 'História', subtask: 'Sub-tarefa', chore: 'Manutenção', improvement: 'Melhoria' };
  const key = String(value || '').toLowerCase();
  return map[key] || String(value || 'Item');
}

function traduzirPrioridade(value) {
  const map = { critical: 'Crítica', high: 'Alta', medium: 'Média', low: 'Baixa', none: 'Sem prioridade' };
  const key = String(value || '').toLowerCase();
  return map[key] || String(value || 'Média');
}

function getOwnerLabel(item) {
  const raw = item?.assignee_user_id || item?.reporter_user_id || null;
  if (!raw) return 'Não definido';
  return `USR-${String(raw).slice(0, 8)}`;
}

function matchDateWindow(value, range) {
  if (range === 'all') return true;
  const date = toDate(value);
  if (!date) return false;
  const now = new Date();
  const diffDays = Math.ceil((date.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  if (range === '7d') return diffDays >= 0 && diffDays <= 7;
  if (range === '30d') return diffDays >= 0 && diffDays <= 30;
  if (range === '90d') return diffDays >= 0 && diffDays <= 90;
  if (range === 'overdue') return diffDays < 0;
  return true;
}

function buildLoadBuckets(items) {
  const buckets = items.reduce((acc, item) => {
    const due = toDate(item.due_date);
    if (!due) return acc;
    const key = `${due.getUTCFullYear()}-${String(due.getUTCMonth() + 1).padStart(2, '0')}`;
    if (!acc[key]) acc[key] = { key, count: 0, critical: 0 };
    acc[key].count += 1;
    if (String(item.priority || '').toLowerCase() === 'critical') acc[key].critical += 1;
    return acc;
  }, {});

  return Object.values(buckets)
    .sort((a, b) => a.key.localeCompare(b.key))
    .map((entry, index, all) => ({
      ...entry,
      label: entry.key.slice(5).replace('-', '/'),
      x: all.length === 1 ? 10 : 8 + (index * 84) / (all.length - 1),
    }));
}

function buildTypeBuckets(items) {
  const buckets = items.reduce((acc, item) => {
    const key = String(item.item_type || 'item');
    if (!acc[key]) acc[key] = { key, count: 0, critical: 0 };
    acc[key].count += 1;
    if (String(item.priority || '').toLowerCase() === 'critical') acc[key].critical += 1;
    return acc;
  }, {});

  return Object.values(buckets)
    .sort((a, b) => b.count - a.count)
    .map((entry, index, all) => ({
      ...entry,
      label: entry.key,
      x: all.length === 1 ? 10 : 8 + (index * 84) / Math.max(1, all.length - 1),
    }));
}

function buildRoadmapEntries(items) {
  const milestones = items
    .filter((item) => String(item.item_type || '').toLowerCase() === 'milestone' && toDate(item.due_date))
    .sort((a, b) => toDate(a.due_date).getTime() - toDate(b.due_date).getTime());

  if (milestones.length === 0) return [];

  return milestones.map((item, index, all) => ({
    ...item,
    x: all.length === 1 ? 8 : 8 + (index * 84) / Math.max(1, all.length - 1),
  }));
}

export function ProjectTimelinePage() {
  const { currentPath, navigate } = useRouter();
  const { ToastContainer, showToast } = useToast();
  const { theme, themeName } = useTheme();
  const projectId = getProjectIdFromPath(currentPath);
  const [project, setProject] = useState(null);
  const [timeline, setTimeline] = useState({ milestones: [], scheduledItems: [] });
  const [filters, setFilters] = useState({
    search: '',
    status: 'all',
    itemType: 'all',
    priority: 'all',
    owner: 'all',
    dateRange: 'all',
  });
  const [expandedGroups, setExpandedGroups] = useState({});
  const [drilldownMode, setDrilldownMode] = useState('type');
  const [drilldownValue, setDrilldownValue] = useState('all');

  useEffect(() => {
    async function load() {
      try {
        const [projectResponse, timelineResponse] = await Promise.all([
          getProject(projectId),
          getProjectTimeline(projectId),
        ]);
        setProject(projectResponse?.project || null);
        setTimeline(timelineResponse?.timeline || { milestones: [], scheduledItems: [] });
      } catch (error) {
        // Se ID for numérico (tipo "1"), provavelmente é um ID inválido - redireciona para o primeiro projeto
        // O sistema usa UUIDs, não IDs numéricos
        const isNumericId = /^\d+$/.test(String(projectId || ''));
        if (isNumericId || error?.status === 404) {
          try {
            const projectsResponse = await listProjects();
            const firstProject = Array.isArray(projectsResponse?.projects) && projectsResponse.projects[0];
            if (firstProject) {
              navigate(`/projects/${firstProject.id}/timeline`);
              showToast('Redirecionando para o primeiro projeto disponível...', 'info');
              return;
            }
          } catch (fallbackError) {
            // Falhou ao carregar lista de projetos também
          }
        }
        showToast('Erro ao carregar timeline do projeto', 'error');
      }
    }
    load();
  }, [projectId, showToast, navigate]);

  const scheduledItems = Array.isArray(timeline?.scheduledItems) ? timeline.scheduledItems : [];
  const milestones = Array.isArray(timeline?.milestones) ? timeline.milestones : [];

  const filterOptions = useMemo(() => {
    const itemTypes = [...new Set(scheduledItems.map((item) => String(item.item_type || 'item')).filter(Boolean))].sort();
    const priorities = [...new Set(scheduledItems.map((item) => String(item.priority || 'media')).filter(Boolean))].sort();
    const owners = [...new Set(scheduledItems.map((item) => getOwnerLabel(item)).filter(Boolean))].sort();
    return { itemTypes, priorities, owners };
  }, [scheduledItems]);

  const filteredItems = useMemo(() => {
    return scheduledItems.filter((item) => {
      const searchText = `${item.title || ''} ${item.item_type || ''} ${item.priority || ''}`.toLowerCase();
      const matchesSearch = !filters.search || searchText.includes(filters.search.toLowerCase());
      const matchesStatus = filters.status === 'all' || normalizeStatus(item.status) === filters.status;
      const matchesType = filters.itemType === 'all' || String(item.item_type || 'item') === filters.itemType;
      const matchesPriority = filters.priority === 'all' || String(item.priority || 'media') === filters.priority;
      const matchesOwner = filters.owner === 'all' || getOwnerLabel(item) === filters.owner;
      const matchesDate = matchDateWindow(item.due_date, filters.dateRange);
      return matchesSearch && matchesStatus && matchesType && matchesPriority && matchesOwner && matchesDate;
    });
  }, [filters, scheduledItems]);

  const filteredMilestones = useMemo(() => {
    if (!filters.search) return milestones;
    return milestones.filter((milestone) => String(milestone.name || '').toLowerCase().includes(filters.search.toLowerCase()));
  }, [filters.search, milestones]);

  const roadmapEntries = useMemo(() => {
    const explicitMilestones = filteredMilestones.filter((item) => toDate(item.due_date));
    if (explicitMilestones.length > 0) {
      return explicitMilestones
        .sort((a, b) => toDate(a.due_date).getTime() - toDate(b.due_date).getTime())
        .map((item, index, all) => ({
          ...item,
          x: all.length === 1 ? 8 : 8 + (index * 84) / Math.max(1, all.length - 1),
        }));
    }
    return buildRoadmapEntries(filteredItems);
  }, [filteredItems, filteredMilestones]);

  const metrics = useMemo(() => {
    const total = filteredItems.length;
    const byStatus = filteredItems.reduce((acc, item) => {
      const key = normalizeStatus(item.status);
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});

    const done = byStatus.done || 0;
    const blocked = byStatus.blocked || 0;
    const withDueDate = filteredItems.filter((item) => !!toDate(item.due_date));
    const overdue = filteredItems.filter((item) => daysLate(item.due_date, item.status) > 0).length;
    const onTime = withDueDate.length - overdue;
    const adherence = percent(onTime, withDueDate.length);

    return {
      total,
      done,
      blocked,
      overdue,
      withDueDate: withDueDate.length,
      adherence,
      progress: percent(done, total),
      byStatus,
    };
  }, [filteredItems]);

  const donutData = [
    { label: 'Concluído', key: 'done', value: metrics.byStatus.done || 0, color: '#22c55e' },
    { label: 'Em andamento', key: 'in_progress', value: metrics.byStatus.in_progress || 0, color: '#0ea5e9' },
    { label: 'Em revisão', key: 'review', value: metrics.byStatus.review || 0, color: '#eab308' },
    { label: 'Planejado', key: 'todo', value: metrics.byStatus.todo || 0, color: '#64748b' },
    { label: 'Bloqueado', key: 'blocked', value: metrics.byStatus.blocked || 0, color: '#ef4444' },
  ].filter((entry) => entry.value > 0);

  const donutGradient = donutData.length
    ? `conic-gradient(${(() => {
      let cursor = 0;
      return donutData
        .map((entry) => {
          const slice = (entry.value / Math.max(metrics.total, 1)) * 100;
          const start = cursor;
          cursor += slice;
          return `${entry.color} ${start}% ${cursor}%`;
        })
        .join(', ');
    })()})`
    : 'conic-gradient(#1f2937 0% 100%)';

  const sCurvePoints = buildSCurvePoints(filteredItems);
  const sCurvePath = toSvgPath(sCurvePoints);

  const groupedRows = useMemo(() => {
    const drilldownFilteredItems = filteredItems.filter((item) => {
      if (drilldownValue === 'all') return true;
      if (drilldownMode === 'type') return String(item.item_type || 'item') === drilldownValue;
      const due = toDate(item.due_date);
      const periodKey = due ? `${due.getUTCFullYear()}-${String(due.getUTCMonth() + 1).padStart(2, '0')}` : 'sem-data';
      return periodKey === drilldownValue;
    });

    const groups = drilldownFilteredItems.reduce((acc, item) => {
      const key = drilldownMode === 'month'
        ? (toDate(item.due_date) ? `${toDate(item.due_date).getUTCFullYear()}-${String(toDate(item.due_date).getUTCMonth() + 1).padStart(2, '0')}` : 'sem-data')
        : String(item.item_type || 'Sem categoria');
      if (!acc[key]) acc[key] = [];
      acc[key].push(item);
      return acc;
    }, {});

    return Object.entries(groups)
      .sort((a, b) => b[1].length - a[1].length)
      .map(([groupName, items]) => ({
        groupName,
        subtotal: {
          count: items.length,
          overdue: items.filter((item) => daysLate(item.due_date, item.status) > 0).length,
          critical: items.filter((item) => String(item.priority || '').toLowerCase() === 'critical').length,
        },
        items: items.sort((a, b) => {
          const riskDiff = daysLate(b.due_date, b.status) - daysLate(a.due_date, a.status);
          if (riskDiff !== 0) return riskDiff;
          return (toDate(a.due_date)?.getTime() || Number.MAX_SAFE_INTEGER) - (toDate(b.due_date)?.getTime() || Number.MAX_SAFE_INTEGER);
        }),
      }));
  }, [drilldownMode, drilldownValue, filteredItems]);

  useEffect(() => {
    setExpandedGroups((prev) => {
      const next = { ...prev };
      groupedRows.forEach((group) => {
        if (typeof next[group.groupName] !== 'boolean') next[group.groupName] = true;
      });
      return next;
    });
  }, [groupedRows]);

  const loadBuckets = useMemo(() => buildLoadBuckets(filteredItems), [filteredItems]);
  const typeBuckets = useMemo(() => buildTypeBuckets(filteredItems), [filteredItems]);
  const activeBuckets = drilldownMode === 'month' ? loadBuckets : typeBuckets;
  const maxLoad = Math.max(1, ...loadBuckets.map((entry) => entry.count));
  const maxCritical = Math.max(1, ...loadBuckets.map((entry) => entry.critical));
  const criticalLine = loadBuckets
    .map((entry, index) => {
      const y = 90 - (entry.critical / maxCritical) * 70;
      return `${index === 0 ? 'M' : 'L'} ${entry.x} ${y}`;
    })
    .join(' ');
  const maxActiveCount = Math.max(1, ...activeBuckets.map((entry) => entry.count));
  const maxActiveCritical = Math.max(1, ...activeBuckets.map((entry) => entry.critical));
  const activeCriticalLine = activeBuckets
    .map((entry, index) => {
      const y = 90 - (entry.critical / maxActiveCritical) * 70;
      return `${index === 0 ? 'M' : 'L'} ${entry.x} ${y}`;
    })
    .join(' ');

  useEffect(() => {
    setDrilldownValue('all');
  }, [drilldownMode]);

  const palette = useMemo(() => {
    const isLight = themeName === 'light';
    return {
      shellBackground: isLight
        ? 'linear-gradient(180deg, #f8fbff 0%, #eef3f8 100%)'
        : 'linear-gradient(180deg, rgba(31,31,31,0.96) 0%, rgba(17,17,17,0.98) 100%)',
      shellBorder: isLight ? '#d7e1ea' : theme.colors.border.default,
      panelBackground: theme.colors.bg.elevated,
      panelMuted: theme.colors.bg.secondary,
      panelSubtle: theme.colors.bg.tertiary,
      textPrimary: theme.colors.text.primary,
      textSecondary: theme.colors.text.secondary,
      textTertiary: theme.colors.text.tertiary,
      axis: isLight ? '#bfd0dc' : theme.colors.border.hover,
      grid: isLight ? '#e1e9f0' : theme.colors.border.default,
      brand: isLight ? '#10324a' : theme.colors.text.primary,
      brandSoft: isLight ? '#537089' : theme.colors.text.secondary,
      accent: isLight ? '#11879b' : theme.colors.accent.primary,
      accentStrong: isLight ? '#0f6c78' : theme.colors.accent.hover,
      accentAlt: isLight ? '#14a3b8' : theme.colors.status.info,
      warning: isLight ? '#f15b2a' : theme.colors.status.warning,
      danger: theme.colors.status.error,
      success: theme.colors.status.success,
      metricNeutralBg: theme.colors.bg.elevated,
      metricDangerBg: isLight ? '#fff4f5' : 'rgba(239, 68, 68, 0.12)',
      metricDangerBorder: isLight ? '#f2c7cf' : 'rgba(239, 68, 68, 0.28)',
      metricInfoBg: isLight ? '#f0fbfb' : 'rgba(59, 130, 246, 0.12)',
      metricInfoBorder: isLight ? '#b9e4e1' : 'rgba(59, 130, 246, 0.24)',
      metricWarnBg: isLight ? '#fff6ef' : 'rgba(245, 158, 11, 0.12)',
      metricWarnBorder: isLight ? '#f0d4b8' : 'rgba(245, 158, 11, 0.24)',
      tableGroupBg: isLight ? '#eef5fa' : 'rgba(94, 106, 210, 0.12)',
      chartFill: isLight ? '#2bb3c0' : theme.colors.status.info,
      chartFillActive: isLight ? '#0f6c78' : theme.colors.accent.primary,
      chartLine: isLight ? '#f15b2a' : theme.colors.status.warning,
    };
  }, [theme, themeName]);

  return (
    <CrudPageBase>
      <ToastContainer />
      <div className="support-header">
        <h1>{project?.name || 'Linha do Tempo do Projeto'}</h1>
      </div>

      <div
        className="rounded-[28px] border shadow-2xl p-5 lg:p-6"
        style={{
          background: palette.shellBackground,
          borderColor: palette.shellBorder,
          color: palette.textPrimary,
        }}
      >
        <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
          <div>
            <div className="text-xs uppercase tracking-[0.25em]" style={{ color: palette.brandSoft }}>Referência visual: Power BI</div>
            <div className="text-3xl font-semibold mt-2" style={{ color: palette.brand }}>Relatório de acompanhamento do projeto</div>
            <div className="text-sm mt-1" style={{ color: palette.textSecondary }}>
              Visão executiva com filtros, indicadores de prazo e agrupamento operacional.
            </div>
          </div>
          <div className="rounded-2xl border px-4 py-3 min-w-[240px]" style={{ background: palette.panelBackground, borderColor: palette.shellBorder }}>
            <div className="text-xs uppercase tracking-wide" style={{ color: palette.textSecondary }}>Escopo atual</div>
            <div className="font-semibold mt-1" style={{ color: palette.brand }}>{project?.name || 'Projeto'}</div>
            <div className="text-sm mt-1" style={{ color: palette.textSecondary }}>Itens filtrados: {filteredItems.length} de {scheduledItems.length}</div>
          </div>
        </div>

        <div className="rounded-2xl border p-5 shadow-sm mb-6" style={{ background: palette.panelBackground, borderColor: palette.shellBorder }}>
          <div className="flex items-center justify-between gap-4 mb-4">
            <div>
              <div className="text-lg font-semibold" style={{ color: palette.brand }}>Roteiro executivo</div>
              <div className="text-sm" style={{ color: palette.textSecondary }}>Linha temporal horizontal dos principais marcos de entrega.</div>
            </div>
            <div className="text-sm font-medium" style={{ color: palette.brandSoft }}>{roadmapEntries.length} marco(s)</div>
          </div>
          <div className="rounded-2xl border p-4 overflow-auto" style={{ background: palette.panelMuted, borderColor: palette.shellBorder }}>
            {roadmapEntries.length > 0 ? (
              <svg viewBox="0 0 100 28" className="w-full min-w-[720px] h-28">
                <line x1="8" y1="14" x2="92" y2="14" stroke={palette.axis} strokeWidth="0.8" />
                {roadmapEntries.map((entry) => (
                  <g key={entry.id}>
                    <line x1={entry.x} y1="14" x2={entry.x} y2="8" stroke={palette.axis} strokeWidth="0.5" />
                    <circle cx={entry.x} cy="14" r="2.2" fill={normalizeStatus(entry.status) === 'done' ? palette.success : palette.warning} />
                    <text x={entry.x} y="5" fontSize="2.8" textAnchor="middle" fill={palette.textSecondary}>{formatDateShort(entry.due_date)}</text>
                    <text x={entry.x} y="24" fontSize="2.6" textAnchor="middle" fill={palette.brand}>{String(entry.title || '').slice(0, 18)}</text>
                  </g>
                ))}
              </svg>
            ) : (
              <div className="h-24 flex items-center justify-center text-sm" style={{ color: palette.textSecondary }}>Nenhum marco temporal encontrado para o roteiro.</div>
            )}
          </div>
        </div>

        <div className="grid gap-6" style={{ gridTemplateColumns: '280px minmax(0, 1fr)' }}>
          <aside className="rounded-3xl border p-4 h-fit sticky top-4" style={{ background: palette.panelBackground, borderColor: palette.shellBorder }}>
            <div className="text-lg font-semibold mb-4" style={{ color: palette.brand }}>Filtros</div>
            <div className="space-y-4">
              <div>
                <label className="block text-xs uppercase tracking-wide mb-2" style={{ color: palette.textSecondary }}>Busca</label>
                <input
                  value={filters.search}
                  onChange={(event) => setFilters((prev) => ({ ...prev, search: event.target.value }))}
                  placeholder="Título, tipo ou prioridade"
                  className="w-full rounded-xl border px-3 py-2 text-sm"
                  style={{ background: palette.panelMuted, borderColor: palette.shellBorder, color: palette.brand }}
                />
              </div>
              <div>
                <label className="block text-xs uppercase tracking-wide mb-2" style={{ color: palette.textSecondary }}>Fase / status</label>
                <select
                  value={filters.status}
                  onChange={(event) => setFilters((prev) => ({ ...prev, status: event.target.value }))}
                  className="w-full rounded-xl border px-3 py-2 text-sm cursor-pointer"
                  style={{ background: palette.panelMuted, borderColor: palette.shellBorder, color: palette.brand }}
                >
                  <option value="all">Todos</option>
                  <option value="todo">Planejado</option>
                  <option value="in_progress">Em andamento</option>
                  <option value="review">Em revisão</option>
                  <option value="blocked">Bloqueado</option>
                  <option value="done">Concluído</option>
                </select>
              </div>
              <div>
                <label className="block text-xs uppercase tracking-wide mb-2" style={{ color: palette.textSecondary }}>Unidade analítica</label>
                <select
                  value={filters.itemType}
                  onChange={(event) => setFilters((prev) => ({ ...prev, itemType: event.target.value }))}
                  className="w-full rounded-xl border px-3 py-2 text-sm cursor-pointer"
                  style={{ background: palette.panelMuted, borderColor: palette.shellBorder, color: palette.brand }}
                >
                  <option value="all">Todos os tipos</option>
                  {filterOptions.itemTypes.map((itemType) => <option key={itemType} value={itemType}>{traduzirTipo(itemType)}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs uppercase tracking-wide mb-2" style={{ color: palette.textSecondary }}>Prioridade</label>
                <select
                  value={filters.priority}
                  onChange={(event) => setFilters((prev) => ({ ...prev, priority: event.target.value }))}
                  className="w-full rounded-xl border px-3 py-2 text-sm cursor-pointer"
                  style={{ background: palette.panelMuted, borderColor: palette.shellBorder, color: palette.brand }}
                >
                  <option value="all">Todas</option>
                  {filterOptions.priorities.map((priority) => <option key={priority} value={priority}>{traduzirPrioridade(priority)}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs uppercase tracking-wide mb-2" style={{ color: palette.textSecondary }}>Responsável técnico</label>
                <select
                  value={filters.owner}
                  onChange={(event) => setFilters((prev) => ({ ...prev, owner: event.target.value }))}
                  className="w-full rounded-xl border px-3 py-2 text-sm cursor-pointer"
                  style={{ background: palette.panelMuted, borderColor: palette.shellBorder, color: palette.brand }}
                >
                  <option value="all">Todos</option>
                  {filterOptions.owners.map((owner) => <option key={owner} value={owner}>{owner}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs uppercase tracking-wide mb-2" style={{ color: palette.textSecondary }}>Intervalo de datas</label>
                <select
                  value={filters.dateRange}
                  onChange={(event) => setFilters((prev) => ({ ...prev, dateRange: event.target.value }))}
                  className="w-full rounded-xl border px-3 py-2 text-sm cursor-pointer"
                  style={{ background: palette.panelMuted, borderColor: palette.shellBorder, color: palette.brand }}
                >
                  <option value="all">Todas</option>
                  <option value="7d">Próximos 7 dias</option>
                  <option value="30d">Próximos 30 dias</option>
                  <option value="90d">Próximos 90 dias</option>
                  <option value="overdue">Atrasados</option>
                </select>
              </div>
              <button
                type="button"
                onClick={() => setFilters({ search: '', status: 'all', itemType: 'all', priority: 'all', owner: 'all', dateRange: 'all' })}
                className="w-full rounded-xl px-3 py-2 text-sm font-medium cursor-pointer"
                style={{ background: palette.brand, color: themeName === 'light' ? '#f8fbff' : palette.panelBackground }}
              >
                Limpar filtros
              </button>
            </div>
          </aside>

          <div>
            <div className="grid gap-4 mb-6" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
              <div className="rounded-2xl border p-4 shadow-sm" style={{ background: palette.metricNeutralBg, borderColor: palette.shellBorder }}>
                <div className="text-xs uppercase tracking-wide" style={{ color: palette.textSecondary }}>Total de itens</div>
                <div className="text-3xl font-bold mt-2" style={{ color: palette.brand }}>{metrics.total}</div>
              </div>
              <div className="rounded-2xl border p-4 shadow-sm" style={{ background: palette.metricDangerBg, borderColor: palette.metricDangerBorder }}>
                <div className="text-xs uppercase tracking-wide" style={{ color: palette.danger }}>Progresso físico</div>
                <div className="text-3xl font-bold mt-2" style={{ color: palette.danger }}>{metrics.progress}%</div>
                <div className="text-xs mt-1" style={{ color: palette.danger }}>Planejado com status concluído</div>
              </div>
              <div className="rounded-2xl border p-4 shadow-sm" style={{ background: palette.metricInfoBg, borderColor: palette.metricInfoBorder }}>
                <div className="text-xs uppercase tracking-wide" style={{ color: palette.accent }}>Aderência de prazo</div>
                <div className="text-3xl font-bold mt-2" style={{ color: palette.accent }}>{metrics.adherence}%</div>
                <div className="text-xs mt-1" style={{ color: palette.accent }}>{metrics.withDueDate} itens com prazo definido</div>
              </div>
              <div className="rounded-2xl border p-4 shadow-sm" style={{ background: palette.metricWarnBg, borderColor: palette.metricWarnBorder }}>
                <div className="text-xs uppercase tracking-wide" style={{ color: palette.warning }}>Risco atual</div>
                <div className="text-3xl font-bold mt-2" style={{ color: palette.warning }}>{metrics.overdue}</div>
                <div className="text-xs mt-1" style={{ color: palette.warning }}>itens atrasados</div>
              </div>
            </div>

            <div className="grid gap-6 mb-6" style={{ gridTemplateColumns: '1.1fr 1fr' }}>
              <div className="rounded-2xl border p-5 shadow-sm" style={{ background: palette.panelBackground, borderColor: palette.shellBorder }}>
                <div className="text-lg font-semibold mb-4" style={{ color: palette.brand }}>Distribuição por status</div>
                <div className="flex flex-wrap gap-5 items-center">
                  <div className="relative w-40 h-40 rounded-full border" style={{ background: donutGradient, borderColor: palette.shellBorder }}>
                    <div className="absolute inset-5 rounded-full border flex items-center justify-center text-center" style={{ background: palette.panelBackground, borderColor: palette.shellBorder }}>
                      <div>
                        <div className="text-2xl font-bold" style={{ color: palette.brand }}>{metrics.total}</div>
                        <div className="text-xs" style={{ color: palette.textSecondary }}>Itens</div>
                      </div>
                    </div>
                  </div>
                  <div className="flex-1 min-w-[220px] space-y-2">
                    {donutData.map((entry) => (
                      <div key={entry.key} className="flex items-center justify-between text-sm">
                        <div className="flex items-center gap-2" style={{ color: palette.brandSoft }}>
                          <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ backgroundColor: entry.color }} />
                          <span>{entry.label}</span>
                        </div>
                        <div className="font-semibold" style={{ color: palette.brand }}>{entry.value}</div>
                      </div>
                    ))}
                    {donutData.length === 0 ? <div className="text-sm" style={{ color: palette.textSecondary }}>Sem itens com status para consolidar.</div> : null}
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border p-5 shadow-sm" style={{ background: palette.panelBackground, borderColor: palette.shellBorder }}>
                <div className="text-lg font-semibold mb-4" style={{ color: palette.brand }}>Curva de progresso (Curva S)</div>
                <div className="rounded-2xl border p-4" style={{ background: palette.panelMuted, borderColor: palette.shellBorder }}>
                  {sCurvePoints.length > 1 ? (
                    <svg viewBox="0 0 100 100" className="w-full h-48">
                      {[0, 25, 50, 75, 100].map((tick) => (
                        <g key={tick}>
                          <line x1="0" y1={100 - tick} x2="100" y2={100 - tick} stroke={palette.grid} strokeWidth="0.5" />
                          <text x="2" y={100 - tick - 1} fontSize="3" fill={palette.textSecondary}>{tick}%</text>
                        </g>
                      ))}
                      <line x1="0" y1="100" x2="100" y2="100" stroke={palette.axis} strokeWidth="0.5" />
                      <line x1="0" y1="0" x2="0" y2="100" stroke={palette.axis} strokeWidth="0.5" />
                      <path d={sCurvePath} fill="none" stroke={palette.accentAlt} strokeWidth="2" vectorEffect="non-scaling-stroke" />
                      {sCurvePoints.map((point, index) => (
                        <g key={`${point.x}-${index}`}>
                          <circle cx={point.x} cy={100 - point.y} r="1.4" fill={palette.accentAlt} />
                          {index === sCurvePoints.length - 1 ? <text x={point.x - 6} y={100 - point.y - 3} fontSize="3" fill={palette.brand}>{point.y.toFixed(0)}%</text> : null}
                        </g>
                      ))}
                    </svg>
                  ) : (
                    <div className="h-48 flex items-center justify-center text-sm" style={{ color: palette.textSecondary }}>
                      Dados insuficientes para curva de progresso.
                    </div>
                  )}
                  <div className="mt-3 text-xs" style={{ color: palette.textSecondary }}>
                    Evolução acumulada dos itens com data de prazo.
                  </div>
                </div>
              </div>
            </div>

            <div className="grid gap-6 mb-6" style={{ gridTemplateColumns: '1fr 1fr' }}>
              <div className="rounded-2xl border p-5 shadow-sm" style={{ background: palette.panelBackground, borderColor: palette.shellBorder }}>
                <div className="text-lg font-semibold mb-4" style={{ color: palette.brand }}>Carga por período</div>
                <div className="flex flex-wrap items-center gap-2 mb-4">
                  <button
                    type="button"
                    onClick={() => setDrilldownMode('month')}
                    className="px-3 py-1.5 rounded-full text-sm border cursor-pointer"
                    style={{ background: drilldownMode === 'month' ? palette.brand : palette.panelBackground, color: drilldownMode === 'month' ? (themeName === 'light' ? '#f8fbff' : palette.panelBackground) : palette.brandSoft, borderColor: palette.shellBorder }}
                  >
                    Detalhamento por período
                  </button>
                  <button
                    type="button"
                    onClick={() => setDrilldownMode('type')}
                    className="px-3 py-1.5 rounded-full text-sm border cursor-pointer"
                    style={{ background: drilldownMode === 'type' ? palette.brand : palette.panelBackground, color: drilldownMode === 'type' ? (themeName === 'light' ? '#f8fbff' : palette.panelBackground) : palette.brandSoft, borderColor: palette.shellBorder }}
                  >
                    Detalhamento por tipo
                  </button>
                  <button
                    type="button"
                    onClick={() => setDrilldownValue('all')}
                    className="px-3 py-1.5 rounded-full text-sm border cursor-pointer"
                    style={{ background: drilldownValue === 'all' ? palette.accent : palette.panelBackground, color: drilldownValue === 'all' ? (themeName === 'light' ? '#f8fbff' : palette.panelBackground) : palette.brandSoft, borderColor: palette.shellBorder }}
                  >
                    Mostrar tudo
                  </button>
                </div>
                <div className="rounded-2xl border p-4" style={{ background: palette.panelMuted, borderColor: palette.shellBorder }}>
                  {activeBuckets.length > 0 ? (
                    <svg viewBox="0 0 100 100" className="w-full h-52">
                      {[0, 25, 50, 75, 100].map((tick) => (
                        <g key={tick}>
                          <line x1="6" y1={90 - tick * 0.7} x2="96" y2={90 - tick * 0.7} stroke={palette.grid} strokeWidth="0.5" />
                          <text x="0.5" y={90 - tick * 0.7 + 1} fontSize="3" fill={palette.textSecondary}>{Math.round((tick / 100) * maxActiveCount)}</text>
                        </g>
                      ))}
                      <line x1="6" y1="90" x2="96" y2="90" stroke={palette.axis} strokeWidth="0.5" />
                      <line x1="6" y1="12" x2="6" y2="90" stroke={palette.axis} strokeWidth="0.5" />
                      {activeBuckets.map((entry) => {
                        const height = (entry.count / maxActiveCount) * 64;
                        return (
                          <g key={entry.key}>
                            <rect
                              x={entry.x - 4}
                              y={90 - height}
                              width="8"
                              height={height}
                              fill={drilldownValue === entry.key ? palette.chartFillActive : palette.chartFill}
                              rx="1"
                              style={{ cursor: 'pointer' }}
                              onClick={() => setDrilldownValue((prev) => prev === entry.key ? 'all' : entry.key)}
                            />
                            <text x={entry.x} y="97" fontSize="3" textAnchor="middle" fill={palette.textSecondary}>{entry.label}</text>
                            <text x={entry.x} y={88 - height} fontSize="3" textAnchor="middle" fill={palette.brand}>{entry.count}</text>
                          </g>
                        );
                      })}
                      {activeCriticalLine ? <path d={activeCriticalLine} fill="none" stroke={palette.chartLine} strokeWidth="1.5" /> : null}
                    </svg>
                  ) : (
                    <div className="h-52 flex items-center justify-center text-sm" style={{ color: palette.textSecondary }}>Sem datas suficientes para distribuição temporal.</div>
                  )}
                  <div className="mt-3 flex gap-4 text-xs" style={{ color: palette.textSecondary }}>
                    <span className="flex items-center gap-2"><span className="inline-block w-3 h-3 rounded-sm" style={{ background: palette.chartFill }} /> Itens por mês</span>
                    <span className="flex items-center gap-2"><span className="inline-block w-3 h-[2px]" style={{ background: palette.chartLine }} /> Críticos por mês</span>
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border p-5 shadow-sm" style={{ background: palette.panelBackground, borderColor: palette.shellBorder }}>
                <div className="text-lg font-semibold mb-4" style={{ color: palette.brand }}>Distribuição por responsável</div>
                <div className="space-y-3">
                  {filterOptions.owners.length > 0 ? filterOptions.owners.map((owner) => {
                    const ownerItems = filteredItems.filter((item) => getOwnerLabel(item) === owner);
                    const ownerPercent = percent(ownerItems.length, Math.max(filteredItems.length, 1));
                    return (
                      <div key={owner}>
                        <div className="flex items-center justify-between text-sm mb-1">
                          <span style={{ color: palette.brand }}>{owner}</span>
                          <span style={{ color: palette.textSecondary }}>{ownerItems.length} itens • {ownerPercent}%</span>
                        </div>
                        <div className="w-full h-2 rounded-full overflow-hidden" style={{ background: palette.grid }}>
                          <div className="h-full" style={{ width: `${ownerPercent}%`, background: palette.accent }} />
                        </div>
                      </div>
                    );
                  }) : <div className="text-sm" style={{ color: palette.textSecondary }}>Sem responsáveis atribuíveis no conjunto de dados.</div>}
                </div>
              </div>
            </div>

            <div className="grid gap-6 mb-6" style={{ gridTemplateColumns: '1fr 1fr' }}>
              <div className="rounded-2xl border p-5 shadow-sm" style={{ background: palette.panelBackground, borderColor: palette.shellBorder }}>
                <div className="text-lg font-semibold mb-4" style={{ color: palette.brand }}>Marcos</div>
                <div className="space-y-3 max-h-[360px] overflow-auto pr-1">
                  {filteredMilestones.map((milestone) => (
                    <div key={milestone.id} className="rounded-2xl border p-4" style={{ background: palette.panelMuted, borderColor: palette.shellBorder }}>
                      <div className="flex items-center justify-between gap-3 mb-1">
                        <div className="text-base font-semibold" style={{ color: palette.brand }}>{milestone.name}</div>
                        <span className={`text-xs px-2 py-1 rounded-full border ${statusBadgeClass(milestone.status)}`}>
                          {statusLabel(milestone.status)}
                        </span>
                      </div>
                      <div className="text-sm" style={{ color: palette.textSecondary }}>Prazo: {formatDate(milestone.due_date)}</div>
                    </div>
                  ))}
                  {filteredMilestones.length === 0 ? <div className="text-sm" style={{ color: palette.textSecondary }}>Nenhum marco registrado.</div> : null}
                </div>
              </div>

              <div className="rounded-2xl border p-5 shadow-sm" style={{ background: palette.panelBackground, borderColor: palette.shellBorder }}>
                <div className="text-lg font-semibold mb-4" style={{ color: palette.brand }}>Itens programados</div>
                <div className="space-y-3 max-h-[360px] overflow-auto pr-1">
                  {filteredItems.map((item) => (
                    <div key={item.id} className="rounded-2xl border p-4" style={{ background: palette.panelMuted, borderColor: palette.shellBorder }}>
                      <div className="flex items-center justify-between gap-3 mb-1">
                        <div className="text-base font-semibold" style={{ color: palette.brand }}>{item.title}</div>
                        <span className={`text-xs px-2 py-1 rounded-full border ${statusBadgeClass(item.status)}`}>
                          {statusLabel(item.status)}
                        </span>
                      </div>
                      <div className="text-sm mb-1" style={{ color: palette.textSecondary }}>{traduzirTipo(item.item_type)} • {traduzirPrioridade(item.priority)}</div>
                      <div className="text-sm" style={{ color: palette.textSecondary }}>Início: {formatDate(item.start_date)}</div>
                      <div className="text-sm" style={{ color: palette.textSecondary }}>Prazo: {formatDate(item.due_date)}</div>
                    </div>
                  ))}
                  {filteredItems.length === 0 ? <div className="text-sm" style={{ color: palette.textSecondary }}>Nenhum item com agenda definida.</div> : null}
                </div>
              </div>
            </div>

            <div className="rounded-2xl border p-5 shadow-sm" style={{ background: palette.panelBackground, borderColor: palette.shellBorder }}>
              <div className="flex items-center justify-between gap-4 mb-4">
                <div>
                  <div className="text-lg font-semibold" style={{ color: palette.brand }}>Tabela de acompanhamento</div>
                  <div className="text-sm" style={{ color: palette.textSecondary }}>Agrupada por tipo de entrega e ordenada por risco.</div>
                </div>
                <div className="text-sm font-medium" style={{ color: palette.brandSoft }}>Ordenação: atraso desc, prazo asc</div>
              </div>
              <div className="text-sm mb-4" style={{ color: palette.textSecondary }}>
                  Detalhamento ativo: {drilldownMode === 'month' ? 'período' : 'tipo'} {drilldownValue !== 'all' ? `• filtro ${drilldownValue}` : '• sem recorte'}
                </div>
              <div className="overflow-auto">
                <table className="w-full text-sm min-w-[980px]">
                  <thead>
                    <tr style={{ color: palette.textSecondary, borderBottom: `1px solid ${palette.shellBorder}` }}>
                      <th className="py-2 pr-3 text-left">Unidade</th>
                      <th className="py-2 pr-3 text-left">Item</th>
                      <th className="py-2 pr-3 text-left">Status</th>
                      <th className="py-2 pr-3 text-left">Início</th>
                      <th className="py-2 pr-3 text-left">Término</th>
                      <th className="py-2 pr-3 text-left">Desvio dias</th>
                      <th className="py-2 pr-3 text-left">Planejado %</th>
                      <th className="py-2 pr-3 text-left">Realizado %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {groupedRows.map((group) => (
                      <React.Fragment key={group.groupName}>
                        <tr style={{ background: palette.tableGroupBg }}>
                          <td className="py-2 pr-3 font-semibold" style={{ color: palette.brand }}>
                            <button
                              type="button"
                              onClick={() => setExpandedGroups((prev) => ({ ...prev, [group.groupName]: !prev[group.groupName] }))}
                              className="flex items-center gap-2 cursor-pointer"
                              style={{ color: palette.brand }}
                            >
                              <span>{expandedGroups[group.groupName] ? '▾' : '▸'}</span>
                              <span>{traduzirTipo(group.groupName)}</span>
                            </button>
                          </td>
                          <td colSpan={7} className="py-2 pr-3 text-sm" style={{ color: palette.textSecondary }}>
                            {group.subtotal.count} item(ns) • {group.subtotal.critical} críticos • {group.subtotal.overdue} em atraso
                          </td>
                        </tr>
                        {expandedGroups[group.groupName] ? group.items.map((item) => {
                          const lateDays = daysLate(item.due_date, item.status);
                          const itemProgress = normalizeStatus(item.status) === 'done' ? 100 : normalizeStatus(item.status) === 'in_progress' ? 55 : normalizeStatus(item.status) === 'review' ? 80 : 15;
                          const plannedProgress = toDate(item.start_date) && toDate(item.due_date)
                            ? Math.min(100, Math.max(5, Math.round(((Date.now() - toDate(item.start_date).getTime()) / Math.max(1, toDate(item.due_date).getTime() - toDate(item.start_date).getTime())) * 100)))
                            : 0;
                          return (
                            <tr key={item.id} style={{ borderBottom: `1px solid ${palette.grid}` }}>
                              <td className="py-2 pr-3" style={{ color: palette.brandSoft }}>{traduzirPrioridade(item.priority)}</td>
                              <td className="py-2 pr-3 max-w-[340px] truncate" style={{ color: palette.brand }} title={item.title}>{item.title}</td>
                              <td className="py-2 pr-3">
                                <span className={`text-xs px-2 py-1 rounded-full border ${statusBadgeClass(item.status)}`}>
                                  {statusLabel(item.status)}
                                </span>
                              </td>
                              <td className="py-2 pr-3" style={{ color: palette.textSecondary }}>{formatDateShort(item.start_date)}</td>
                              <td className="py-2 pr-3" style={{ color: palette.textSecondary }}>{formatDateShort(item.due_date)}</td>
                              <td className="py-2 pr-3" style={{ color: lateDays > 0 ? palette.danger : palette.textSecondary }}>{lateDays || 0}</td>
                              <td className="py-2 pr-3" style={{ color: palette.brandSoft }}>{plannedProgress}%</td>
                              <td className="py-2 pr-3">
                                <div className="flex items-center gap-2">
                                  <div className="w-24 h-2 rounded-full overflow-hidden" style={{ background: palette.grid }}>
                                    <div className="h-full" style={{ width: `${itemProgress}%`, background: palette.accentAlt }} />
                                  </div>
                                  <span style={{ color: palette.brand }}>{itemProgress}%</span>
                                </div>
                              </td>
                            </tr>
                          );
                        }) : null}
                      </React.Fragment>
                    ))}
                  </tbody>
                </table>
                {groupedRows.length === 0 ? <div className="text-sm py-4" style={{ color: palette.textSecondary }}>Nenhum item para exibir na tabela.</div> : null}
              </div>
            </div>
          </div>
        </div>
      </div>
    </CrudPageBase>
  );
}

export default ProjectTimelinePage;
