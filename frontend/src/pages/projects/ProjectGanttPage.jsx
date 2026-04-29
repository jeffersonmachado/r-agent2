import React, { useEffect, useMemo, useState } from 'react';
import { CrudPageBase } from '../../modules/crud-base';
import { useRouter } from '../../hooks/useRouter';
import { useToast } from '../../components/Toast';
import { getProject, getProjectTimeline, listProjects } from '../../api/projects';

function getProjectIdFromPath(path) {
  const parts = String(path || '').split('/').filter(Boolean);
  return parts[1] || null;
}

function toDate(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function formatDate(value) {
  const d = toDate(value);
  if (!d) return '-';
  return d.toLocaleDateString('pt-BR');
}

function formatDateShort(value) {
  const d = toDate(value);
  if (!d) return '-';
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

function normalizeStatus(value) {
  const t = String(value || '').toLowerCase();
  if (t.includes('done') || t.includes('concl')) return 'concluido';
  if (t.includes('block')) return 'bloqueado';
  if (t.includes('hold') || t.includes('review')) return 'em_espera';
  if (t.includes('doing') || t.includes('progress')) return 'em_andamento';
  return 'nao_iniciado';
}

function statusDotColor(status) {
  const k = normalizeStatus(status);
  if (k === 'concluido') return '#0ea5e9';
  if (k === 'em_andamento') return '#22c55e';
  if (k === 'em_espera') return '#facc15';
  if (k === 'bloqueado') return '#ef4444';
  return '#94a3b8';
}

function statusBarColor(status) {
  return statusDotColor(status);
}

function estimarConclusao(status) {
  const k = normalizeStatus(status);
  if (k === 'concluido') return 100;
  if (k === 'em_andamento') return 55;
  if (k === 'em_espera') return 30;
  if (k === 'bloqueado') return 10;
  return 0;
}

function labelPrioridade(priority) {
  const v = String(priority || '').toLowerCase();
  if (v === 'critical') return '!!';
  if (v === 'high') return '!';
  if (v === 'medium') return 'M';
  if (v === 'low') return 'B';
  return '-';
}

function labelResponsavel(item) {
  const raw = item?.assignee_user_id || item?.reporter_user_id || null;
  if (!raw) return '-';
  return `USR-${String(raw).slice(0, 8)}`;
}

function inicioSemana(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const dow = d.getDay();
  d.setDate(d.getDate() - (dow === 0 ? 6 : dow - 1));
  return d;
}

function addDias(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

function fimSemana(date) {
  return addDias(inicioSemana(date), 6);
}

function diffDias(start, end) {
  return Math.floor((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
}

function diaSemanaInicial(date) {
  const nomes = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];
  return nomes[date.getDay()] || 'D';
}

function labelSemana(start) {
  const end = addDias(start, 6);
  return `${formatDateShort(start)} - ${formatDateShort(end)}`;
}

function toRange(item) {
  const due = toDate(item.due_date);
  const start = toDate(item.start_date) || toDate(item.createdAt) || due;
  const end = due || start;
  if (!start || !end) return null;
  if (end.getTime() < start.getTime()) return { start: end, end: start };
  return { start, end };
}

export function ProjectGanttPage() {
  const { currentPath, navigate } = useRouter();
  const { ToastContainer, showToast } = useToast();
  const projectId = getProjectIdFromPath(currentPath);

  const [project, setProject] = useState(null);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [viewMode, setViewMode] = useState('gantt');

  useEffect(() => {
    async function load() {
      if (!projectId) return;
      setLoading(true);
      try {
        const [projectResponse, timelineResponse] = await Promise.all([
          getProject(projectId),
          getProjectTimeline(projectId),
        ]);
        setProject(projectResponse?.project || null);
        const scheduled = Array.isArray(timelineResponse?.timeline?.scheduledItems)
          ? timelineResponse.timeline.scheduledItems
          : [];
        setItems(scheduled);
      } catch (error) {
        const isNumericId = /^\d+$/.test(String(projectId || ''));
        if (isNumericId || error?.status === 404) {
          try {
            const res = await listProjects();
            const first = Array.isArray(res?.projects) && res.projects[0];
            if (first) {
              navigate(`/projects/${first.id}/gantt`);
              showToast('Redirecionando para o primeiro projeto disponível...', 'info');
              return;
            }
          } catch (_) { /* sem fallback */ }
        }
        showToast('Erro ao carregar gráfico de Gantt', 'error');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [projectId, navigate, showToast]);

  const timelineItems = useMemo(() =>
    items
      .map((item) => {
        const range = toRange(item);
        if (!range) return null;
        return { ...item, start: range.start, end: range.end };
      })
      .filter(Boolean)
      .sort((a, b) => a.start.getTime() - b.start.getTime()),
    [items],
  );

  const grid = useMemo(() => {
    if (timelineItems.length === 0) {
      return { days: [], weeks: [], gridStart: null, totalDays: 0 };
    }
    const rawMin = new Date(Math.min(...timelineItems.map((i) => i.start.getTime())));
    const rawMax = new Date(Math.max(...timelineItems.map((i) => i.end.getTime())));
    const gridStart = inicioSemana(rawMin);
    const gridEnd = fimSemana(rawMax);
    const totalDays = diffDias(gridStart, gridEnd) + 1;
    const days = Array.from({ length: totalDays }, (_, idx) => addDias(gridStart, idx));
    const weeks = [];
    for (let idx = 0; idx < totalDays; idx += 7) {
      weeks.push({ start: addDias(gridStart, idx), colIndex: idx });
    }
    return { days, weeks, gridStart, totalDays };
  }, [timelineItems]);

  const rows = useMemo(() => {
    if (!grid.gridStart || grid.totalDays === 0) return [];
    return timelineItems.map((item) => {
      const duracaoDias = Math.max(1, diffDias(item.start, item.end) + 1);
      const offsetInicio = Math.max(0, diffDias(grid.gridStart, item.start));
      const left = (offsetInicio / grid.totalDays) * 100;
      const width = Math.max(1.5, (duracaoDias / grid.totalDays) * 100);
      return { item, left, width, duracaoDias, conclusao: estimarConclusao(item.status) };
    });
  }, [timelineItems, grid]);

  const bucketsSemana = useMemo(() => {
    const map = {};
    timelineItems.forEach((item) => {
      const ws = inicioSemana(item.start);
      const key = ws.toISOString();
      if (!map[key]) map[key] = { ws, total: 0, concluido: 0, em_andamento: 0, em_espera: 0, bloqueado: 0, nao_iniciado: 0, items: [] };
      map[key].total += 1;
      const st = normalizeStatus(item.status);
      map[key][st] = (map[key][st] || 0) + 1;
      map[key].items.push(item);
    });
    return Object.values(map).sort((a, b) => a.ws.getTime() - b.ws.getTime());
  }, [timelineItems]);

  const minDate = grid.gridStart ? formatDate(grid.gridStart) : null;
  const maxDate = grid.days.length ? formatDate(grid.days[grid.days.length - 1]) : null;

  return (
    <CrudPageBase>
      <ToastContainer />
      <div className="support-header">
        <h1>{project?.name || 'Gantt do Projeto'}</h1>
      </div>

      {loading ? (
        <div className="flex justify-center py-12 text-text-secondary">Carregando Gantt...</div>
      ) : (
        <div className="bg-bg-elevated rounded-xl border border-border-default p-5 shadow-lg">

          {/* Cabeçalho */}
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <div>
              <h2 className="text-xl font-semibold text-text-primary">Gráfico de Gantt</h2>
              {minDate && maxDate && (
                <div className="text-xs text-text-secondary mt-0.5">{minDate} até {maxDate} • {rows.length} tarefa(s)</div>
              )}
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                className="px-4 py-2 rounded-lg border border-border-default text-sm font-medium text-text-primary transition-colors cursor-pointer hover:bg-bg-elevated"
                onClick={() => setViewMode('gantt')}
                style={{ opacity: viewMode === 'gantt' ? 1 : 0.55, background: viewMode === 'gantt' ? 'var(--color-bg-elevated)' : 'transparent' }}
              >
                Gantt semanal
              </button>
              <button
                type="button"
                className="px-4 py-2 rounded-lg border border-border-default text-sm font-medium text-text-primary transition-colors cursor-pointer hover:bg-bg-elevated"
                onClick={() => setViewMode('semana')}
                style={{ opacity: viewMode === 'semana' ? 1 : 0.55, background: viewMode === 'semana' ? 'var(--color-bg-elevated)' : 'transparent' }}
              >
                Resumo por semana
              </button>
            </div>
          </div>

          {rows.length === 0 && (
            <div className="text-text-secondary py-10 text-center">Nenhum item com datas para montar o Gantt.</div>
          )}

          {/* ── VISÃO GANTT SEMANAL ── */}
          {rows.length > 0 && viewMode === 'gantt' && (
            <div className="overflow-x-auto">
              <div style={{ minWidth: '1200px' }}>

                {/* Cabeçalho da grade */}
                <div className="flex border border-border-default rounded-t-lg overflow-hidden">
                  {/* Lado esquerdo: colunas de tabela */}
                  <div className="flex-shrink-0 bg-[#0b5e5b]" style={{ width: '56%' }}>
                    <div className="grid text-[11px] font-semibold text-white" style={{ gridTemplateColumns: '38px 1fr 36px 120px 88px 88px 48px 56px' }}>
                      <div className="px-1 py-2 border-r border-white/20 text-center">Sit.</div>
                      <div className="px-2 py-2 border-r border-white/20">Nome da Tarefa</div>
                      <div className="px-1 py-2 border-r border-white/20 text-center">Pri.</div>
                      <div className="px-2 py-2 border-r border-white/20">Responsável</div>
                      <div className="px-2 py-2 border-r border-white/20">Início</div>
                      <div className="px-2 py-2 border-r border-white/20">Término</div>
                      <div className="px-1 py-2 border-r border-white/20 text-center">Dias</div>
                      <div className="px-1 py-2 text-center">% Conc.</div>
                    </div>
                  </div>
                  {/* Lado direito: semanas + dias */}
                  <div className="flex-1 bg-[#0b5e5b] border-l border-white/20">
                    {/* Linha de semanas */}
                    <div
                      className="grid text-[11px] font-semibold text-white border-b border-white/20"
                      style={{ gridTemplateColumns: `repeat(${grid.weeks.length}, minmax(0,1fr))` }}
                    >
                      {grid.weeks.map((week) => (
                        <div key={week.start.toISOString()} className="px-1.5 py-1 border-r border-white/20 truncate">
                          {labelSemana(week.start)}
                        </div>
                      ))}
                    </div>
                    {/* Linha dos dias (inicial do dia) */}
                    <div
                      className="grid text-[10px] text-white/80"
                      style={{ gridTemplateColumns: `repeat(${grid.totalDays}, minmax(0,1fr))` }}
                    >
                      {grid.days.map((day, idx) => (
                        <div
                          key={day.toISOString()}
                          className="text-center py-0.5 border-r border-white/10"
                          style={{ background: idx % 7 === 0 ? 'rgba(255,255,255,0.12)' : 'transparent' }}
                        >
                          {diaSemanaInicial(day)}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Linhas de dados */}
                <div className="border border-t-0 border-border-default rounded-b-lg divide-y divide-border-default/60 overflow-hidden">
                  {rows.map(({ item, left, width, duracaoDias, conclusao }) => (
                    <div key={item.id} className="flex" style={{ minHeight: '36px' }}>
                      {/* Colunas de tabela */}
                      <div className="flex-shrink-0 bg-bg-secondary" style={{ width: '56%' }}>
                        <div className="grid text-[11px] h-full" style={{ gridTemplateColumns: '38px 1fr 36px 120px 88px 88px 48px 56px' }}>
                          <div className="px-1 py-2 border-r border-border-default/60 flex items-center justify-center">
                            <span
                              className="inline-block w-3 h-3 rounded-full"
                              style={{ backgroundColor: statusDotColor(item.status) }}
                            />
                          </div>
                          <div className="px-2 py-2 border-r border-border-default/60 text-text-primary truncate flex items-center" title={item.title}>
                            {item.title}
                          </div>
                          <div className="px-1 py-2 border-r border-border-default/60 text-text-secondary text-center flex items-center justify-center">
                            {labelPrioridade(item.priority)}
                          </div>
                          <div className="px-2 py-2 border-r border-border-default/60 text-text-secondary truncate flex items-center" title={labelResponsavel(item)}>
                            {labelResponsavel(item)}
                          </div>
                          <div className="px-2 py-2 border-r border-border-default/60 text-text-secondary flex items-center">{formatDate(item.start)}</div>
                          <div className="px-2 py-2 border-r border-border-default/60 text-text-secondary flex items-center">{formatDate(item.end)}</div>
                          <div className="px-1 py-2 border-r border-border-default/60 text-text-secondary text-center flex items-center justify-center">{duracaoDias}d</div>
                          <div className="px-1 py-2 text-text-secondary text-center flex items-center justify-center">{conclusao}%</div>
                        </div>
                      </div>

                      {/* Barra Gantt */}
                      <div
                        className="flex-1 relative border-l border-border-default/60"
                        style={{
                          background: 'repeating-linear-gradient(to right, transparent, transparent calc(100% / ' + grid.totalDays + ' * 7 - 1px), rgba(148,163,184,0.15) calc(100% / ' + grid.totalDays + ' * 7 - 1px), rgba(148,163,184,0.15) calc(100% / ' + grid.totalDays + ' * 7))',
                        }}
                      >
                        {/* Barra de fundo (total) */}
                        <div
                          className="absolute top-2 h-5 rounded-sm"
                          style={{
                            left: `${left}%`,
                            width: `${width}%`,
                            backgroundColor: statusBarColor(item.status),
                          }}
                          title={`${item.title} (${formatDate(item.start)} → ${formatDate(item.end)})`}
                        />
                        {/* Barra de progresso (overlay escuro) */}
                        <div
                          className="absolute top-2 h-5 rounded-sm opacity-40"
                          style={{
                            left: `${left}%`,
                            width: `${(width * conclusao) / 100}%`,
                            backgroundColor: '#0f172a',
                          }}
                        />
                      </div>
                    </div>
                  ))}
                </div>

                {/* Legenda */}
                <div className="mt-4 flex flex-wrap gap-4 text-xs text-text-secondary">
                  <div className="font-semibold text-text-primary">Legenda de status:</div>
                  <div className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full" style={{ backgroundColor: '#0ea5e9' }} />Concluído</div>
                  <div className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full" style={{ backgroundColor: '#22c55e' }} />Em andamento</div>
                  <div className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full" style={{ backgroundColor: '#facc15' }} />Em espera</div>
                  <div className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full" style={{ backgroundColor: '#ef4444' }} />Bloqueado</div>
                  <div className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full" style={{ backgroundColor: '#94a3b8' }} />Não iniciado</div>
                </div>
              </div>
            </div>
          )}

          {/* ── VISÃO POR SEMANA (RESUMO) ── */}
          {rows.length > 0 && viewMode === 'semana' && (
            <div className="space-y-3">
              {bucketsSemana.map((bucket) => {
                const totalCols = 5;
                const barWidth = bucket.total > 0 ? Math.round((bucket.concluido / bucket.total) * 100) : 0;
                return (
                  <div key={bucket.ws.toISOString()} className="rounded-lg border border-border-default bg-bg-secondary p-4">
                    <div className="flex items-center justify-between gap-2 mb-3">
                      <div className="text-sm font-semibold text-text-primary">
                        Semana {labelSemana(bucket.ws)}
                      </div>
                      <div className="text-xs text-text-secondary">{bucket.total} tarefa(s)</div>
                    </div>

                    {/* Indicadores de status */}
                    <div className={`grid gap-2 text-xs mb-3`} style={{ gridTemplateColumns: `repeat(${totalCols}, minmax(0,1fr))` }}>
                      <div className="rounded bg-bg-elevated px-2 py-1.5 flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: '#0ea5e9' }} />
                        <span className="text-text-secondary">Concluído: <span className="text-text-primary font-medium">{bucket.concluido}</span></span>
                      </div>
                      <div className="rounded bg-bg-elevated px-2 py-1.5 flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: '#22c55e' }} />
                        <span className="text-text-secondary">Andamento: <span className="text-text-primary font-medium">{bucket.em_andamento}</span></span>
                      </div>
                      <div className="rounded bg-bg-elevated px-2 py-1.5 flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: '#facc15' }} />
                        <span className="text-text-secondary">Espera: <span className="text-text-primary font-medium">{bucket.em_espera}</span></span>
                      </div>
                      <div className="rounded bg-bg-elevated px-2 py-1.5 flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: '#ef4444' }} />
                        <span className="text-text-secondary">Bloqueado: <span className="text-text-primary font-medium">{bucket.bloqueado}</span></span>
                      </div>
                      <div className="rounded bg-bg-elevated px-2 py-1.5 flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: '#94a3b8' }} />
                        <span className="text-text-secondary">Não inic.: <span className="text-text-primary font-medium">{bucket.nao_iniciado}</span></span>
                      </div>
                    </div>

                    {/* Barra de progresso geral */}
                    <div className="mb-3">
                      <div className="flex justify-between text-xs text-text-secondary mb-1">
                        <span>Progresso da semana</span>
                        <span>{barWidth}% concluído</span>
                      </div>
                      <div className="w-full h-2 rounded-full bg-bg-elevated overflow-hidden">
                        <div className="h-full rounded-full" style={{ width: `${barWidth}%`, backgroundColor: '#0ea5e9' }} />
                      </div>
                    </div>

                    {/* Lista de tarefas */}
                    <div className="space-y-1">
                      {bucket.items.slice(0, 6).map((item) => (
                        <div key={item.id} className="flex items-center gap-2 text-xs text-text-secondary">
                          <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: statusDotColor(item.status) }} />
                          <span className="truncate flex-1" title={item.title}>{item.title}</span>
                          <span className="flex-shrink-0">{formatDate(item.start)} → {formatDate(item.end)}</span>
                        </div>
                      ))}
                      {bucket.items.length > 6 && (
                        <div className="text-xs text-text-secondary pl-4">+{bucket.items.length - 6} tarefa(s)</div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

        </div>
      )}
    </CrudPageBase>
  );
}

export default ProjectGanttPage;
