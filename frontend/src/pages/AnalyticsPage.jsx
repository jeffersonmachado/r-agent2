import React, { useState, useEffect } from 'react';
import {
  getAllMetrics,
  getAgentMetrics,
  getDepartmentMetrics,
  getQueueMetrics,
  getTrendMetrics,
  getRoiMetrics,
  getFunnelMetrics,
  getOrderMetrics,
  getPhysicalMetrics,
  getPublicTokenStats,
  getVoiceMetrics,
} from '../api/analytics';
import { useToast } from '../components/Toast';
import { useAuth } from '../context/authContext';
import { useRouter } from '../hooks/useRouter';
import logger from '../utils/logger';
import { CrudPageBase } from '../modules/crud-base';
import { AnalyticsVoiceAndTokensSection } from './analytics/AnalyticsVoiceAndTokensSection';
import { AnalyticsSupportMetricsSection } from './analytics/AnalyticsSupportMetricsSection';
import { AnalyticsRoiAndFunnelSection } from './analytics/AnalyticsRoiAndFunnelSection';
import { AnalyticsOrdersAndPhysicalSection } from './analytics/AnalyticsOrdersAndPhysicalSection';

export function AnalyticsPage() {
  const ORDER_HOUR_METRICS = ['created_count', 'confirmed_count', 'preparing_count', 'ready_count', 'dispatched_count', 'delivered_count', 'cancelled_count'];
  const PHYSICAL_HOUR_METRICS = ['created_count', 'done_count', 'abandoned_count'];
  const HOUR_PRESETS = {
    full_day: { label: 'Dia completo', start: 0, end: 23 },
    lunch_peak: { label: 'Pico almoço', start: 11, end: 14 },
    afternoon: { label: 'Tarde', start: 15, end: 18 },
    dinner_peak: { label: 'Pico jantar', start: 19, end: 22 },
    custom: { label: 'Custom', start: null, end: null },
  };
  const { isAuthenticated, loading: authLoading } = useAuth();
  const { navigate } = useRouter();
  const { showToast, ToastContainer } = useToast();
  
  // Proteção: redireciona para login se não estiver autenticado
  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      navigate('/login');
    }
  }, [isAuthenticated, authLoading, navigate]);

  const [metrics, setMetrics] = useState(null);
  const [roiMetrics, setRoiMetrics] = useState(null);
  const [funnelMetrics, setFunnelMetrics] = useState(null);
  const [orderMetrics, setOrderMetrics] = useState(null);
  const [physicalMetrics, setPhysicalMetrics] = useState(null);
  const [publicTokenStats, setPublicTokenStats] = useState(null);
  const [voiceMetrics, setVoiceMetrics] = useState(null);
  const [loading, setLoading] = useState(false);
  const [selectedWindowDays, setSelectedWindowDays] = useState(30);
  const [selectedChannel, setSelectedChannel] = useState('all');
  const [selectedLocationId, setSelectedLocationId] = useState('');
  const [hourStart, setHourStart] = useState('');
  const [hourEnd, setHourEnd] = useState('');
  const [selectedHourPreset, setSelectedHourPreset] = useState('full_day');
  const [selectedOrderHourMetric, setSelectedOrderHourMetric] = useState('created_count');
  const [selectedPhysicalHourMetric, setSelectedPhysicalHourMetric] = useState('created_count');
  const [locationSearch, setLocationSearch] = useState(() => window.location.search || '');
  const [dateRange, setDateRange] = useState({
    startDate: '',
    endDate: '',
  });

  useEffect(() => {
    if (isAuthenticated) {
      loadMetrics();
    }
  }, [dateRange, isAuthenticated, selectedWindowDays, selectedLocationId]);

  useEffect(() => {
    const updateSearch = () => setLocationSearch(window.location.search || '');
    window.addEventListener('popstate', updateSearch);
    window.addEventListener('router:change', updateSearch);
    return () => {
      window.removeEventListener('popstate', updateSearch);
      window.removeEventListener('router:change', updateSearch);
    };
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(locationSearch || '');

    const wd = Number(params.get('wd'));
    if ([7, 30, 90].includes(wd)) setSelectedWindowDays(wd);
    else setSelectedWindowDays(30);

    const channel = params.get('ch');
    setSelectedChannel(channel || 'all');

    const loc = params.get('loc');
    setSelectedLocationId(loc || '');

    const hs = params.get('hs');
    setHourStart(hs != null ? hs : '');

    const he = params.get('he');
    setHourEnd(he != null ? he : '');

    const hp = params.get('hp');
    if (hp && Object.prototype.hasOwnProperty.call(HOUR_PRESETS, hp)) setSelectedHourPreset(hp);
    else setSelectedHourPreset('custom');

    const om = params.get('om');
    if (om && ORDER_HOUR_METRICS.includes(om)) setSelectedOrderHourMetric(om);
    else setSelectedOrderHourMetric('created_count');

    const pm = params.get('pm');
    if (pm && PHYSICAL_HOUR_METRICS.includes(pm)) setSelectedPhysicalHourMetric(pm);
    else setSelectedPhysicalHourMetric('created_count');
  }, [locationSearch]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search || '');
    params.set('wd', String(selectedWindowDays));
    if (selectedChannel && selectedChannel !== 'all') params.set('ch', selectedChannel);
    else params.delete('ch');
    if (selectedLocationId) params.set('loc', selectedLocationId);
    else params.delete('loc');
    if (hourStart !== '') params.set('hs', String(hourStart));
    else params.delete('hs');
    if (hourEnd !== '') params.set('he', String(hourEnd));
    else params.delete('he');
    if (selectedHourPreset && selectedHourPreset !== 'custom') params.set('hp', selectedHourPreset);
    else params.delete('hp');
    if (selectedOrderHourMetric !== 'created_count') params.set('om', selectedOrderHourMetric);
    else params.delete('om');
    if (selectedPhysicalHourMetric !== 'created_count') params.set('pm', selectedPhysicalHourMetric);
    else params.delete('pm');

    const nextSearch = params.toString() ? `?${params.toString()}` : '';
    if (nextSearch !== (window.location.search || '')) {
      window.history.replaceState({}, '', `${window.location.pathname}${nextSearch}`);
      setLocationSearch(nextSearch);
    }
  }, [
    selectedWindowDays,
    selectedChannel,
    selectedLocationId,
    hourStart,
    hourEnd,
    selectedOrderHourMetric,
    selectedPhysicalHourMetric,
    selectedHourPreset,
  ]);

  const loadMetrics = async () => {
    setLoading(true);
    try {
      const options = {};
      if (dateRange.startDate) options.startDate = dateRange.startDate;
      if (dateRange.endDate) options.endDate = dateRange.endDate;
      const locationOptions = selectedLocationId ? { locationId: selectedLocationId } : {};
      
      const [data, roi, funnel, orders, physical, tokenStats, voice] = await Promise.all([
        getAllMetrics(options),
        getRoiMetrics({ windowDays: selectedWindowDays, locationId: selectedLocationId || undefined }),
        getFunnelMetrics({ windowDays: selectedWindowDays, locationId: selectedLocationId || undefined }),
        getOrderMetrics(locationOptions),
        getPhysicalMetrics(locationOptions),
        getPublicTokenStats(),
        getVoiceMetrics({ windowDays: 7 }),
      ]);
      setMetrics(data);
      setRoiMetrics(roi);
      setFunnelMetrics(funnel);
      setOrderMetrics(orders);
      setPhysicalMetrics(physical);
      setPublicTokenStats(tokenStats);
      setVoiceMetrics(voice);
    } catch (error) {
      logger.error('Erro ao carregar métricas:', error);
      showToast('Erro ao carregar métricas', 'error');
    } finally {
      setLoading(false);
    }
  };

  const formatTime = (minutes) => {
    if (!minutes) return '0 min';
    if (minutes < 60) return `${minutes} min`;
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${hours}h ${mins}min`;
  };

  const formatSeconds = (seconds) => {
    if (seconds === null || seconds === undefined) return '-';
    const s = Number(seconds);
    if (!Number.isFinite(s) || s < 0) return '-';
    const mins = Math.round(s / 60);
    return formatTime(mins);
  };

  const formatRate = (rate) => {
    if (rate === null || rate === undefined) return '-';
    const r = Number(rate);
    if (!Number.isFinite(r)) return '-';
    return `${Math.round(r * 100)}%`;
  };

  const formatMoney = (value) => {
    const n = Number(value || 0);
    if (!Number.isFinite(n)) return 'R$ 0,00';
    return `R$ ${n.toFixed(2)}`;
  };

  const exportRoiCsv = () => {
    try {
      const rows = [['Canal', 'Leads', 'Pedidos', 'Receita', 'Custo', 'ROI', 'CPL', 'CPA']];
      const leadsByChannel = new Map(
        (funnelMetrics?.channels || []).map((c) => [String(c.channel || 'unknown'), Number(c.leads || 0)])
      );
      const ordersByChannel = new Map(
        (roiMetrics?.orderSources || []).map((o) => [String(o.source || 'unknown'), o])
      );
      const channels = Array.from(new Set([...leadsByChannel.keys(), ...ordersByChannel.keys()]));
      const selectedChannels = selectedChannel === 'all'
        ? channels
        : channels.filter((c) => c.toLowerCase() === selectedChannel.toLowerCase());

      selectedChannels.forEach((channel) => {
        const leads = Number(leadsByChannel.get(channel) || 0);
        const order = ordersByChannel.get(channel) || {};
        const orders = Number(order.orders || 0);
        const revenue = Number(order.revenue || 0);
        const cost = Number(order.cost || 0);
        const roi = cost > 0 ? ((revenue - cost) / cost) : null;
        const cpl = leads > 0 ? cost / leads : null;
        const cpa = orders > 0 ? cost / orders : null;
        rows.push([
          channel,
          String(leads),
          String(orders),
          revenue.toFixed(2),
          cost.toFixed(2),
          roi == null ? '' : `${Math.round(roi * 100)}%`,
          cpl == null ? '' : cpl.toFixed(2),
          cpa == null ? '' : cpa.toFixed(2),
        ]);
      });

      const csv = rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `roi-v1-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showToast('CSV de ROI exportado com sucesso', 'success');
    } catch (error) {
      logger.error('Erro ao exportar CSV de ROI', error);
      showToast('Erro ao exportar CSV de ROI', 'error');
    }
  };

  const downloadCsv = (rows, filename) => {
    const csv = rows.map((r) => r.map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const exportOrdersByHourCsv = () => {
    try {
      const rows = [[
        'Hora',
        'Criados',
        'Confirmados',
        'Preparando',
        'Prontos',
        'Despachados',
        'Entregues',
        'Cancelados',
      ]];
      filteredOrderByHour.forEach((row) => {
        rows.push([
          `${String(row.hour).padStart(2, '0')}:00`,
          String(row.created_count || 0),
          String(row.confirmed_count || 0),
          String(row.preparing_count || 0),
          String(row.ready_count || 0),
          String(row.dispatched_count || 0),
          String(row.delivered_count || 0),
          String(row.cancelled_count || 0),
        ]);
      });
      const csv = rows.map((r) => r.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `orders-by-hour${selectedLocationId ? `-${selectedLocationId}` : ''}-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showToast('CSV de pedidos por hora exportado', 'success');
    } catch (error) {
      logger.error('Erro ao exportar CSV de pedidos por hora', error);
      showToast('Erro ao exportar CSV de pedidos por hora', 'error');
    }
  };

  const exportPhysicalByHourCsv = () => {
    try {
      const rows = [[
        'Hora',
        'Criados',
        'Done',
        'Abandonados',
        'Espera Media (s)',
        'Atendimento Medio (s)',
      ]];
      filteredPhysicalByHour.forEach((row) => {
        rows.push([
          `${String(row.hour).padStart(2, '0')}:00`,
          String(row.created_count || 0),
          String(row.done_count || 0),
          String(row.abandoned_count || 0),
          String(row.avg_wait_seconds == null ? '' : Number(row.avg_wait_seconds).toFixed(2)),
          String(row.avg_service_seconds == null ? '' : Number(row.avg_service_seconds).toFixed(2)),
        ]);
      });
      const csv = rows.map((r) => r.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `physical-by-hour${selectedLocationId ? `-${selectedLocationId}` : ''}-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showToast('CSV de filas físicas por hora exportado', 'success');
    } catch (error) {
      logger.error('Erro ao exportar CSV de filas físicas por hora', error);
      showToast('Erro ao exportar CSV de filas físicas por hora', 'error');
    }
  };

  const exportVoiceCsv = () => {
    try {
      const rows = [['Tipo', 'Total']];
      Object.entries(voiceMetrics?.byType || {}).forEach(([type, total]) => {
        rows.push([type, String(total || 0)]);
      });
      rows.push([]);
      rows.push(['Resumo', 'Valor']);
      rows.push(['Chamadas', String(voiceMetrics?.totals?.totalCalls || 0)]);
      rows.push(['Minutos', String(voiceMetrics?.totals?.totalMinutes || 0)]);
      rows.push(['Custo estimado', Number(voiceMetrics?.totals?.estimatedCost || 0).toFixed(2)]);
      downloadCsv(rows, `voice-metrics-${new Date().toISOString().slice(0, 10)}.csv`);
      showToast('CSV de voz exportado', 'success');
    } catch (error) {
      logger.error('Erro ao exportar CSV de voz', error);
      showToast('Erro ao exportar CSV de voz', 'error');
    }
  };

  const exportPublicTokensCsv = () => {
    try {
      const rows = [['Kind', 'Total', 'Ativos', 'Usados 24h', 'Último uso']];
      (publicTokenStats?.items || []).forEach((item) => {
        rows.push([
          item.kind || '',
          String(item.total || 0),
          String(item.active || 0),
          String(item.usedLastDay || 0),
          item.lastUsedAtMax || '-',
        ]);
      });
      downloadCsv(rows, `public-tokens-${new Date().toISOString().slice(0, 10)}.csv`);
      showToast('CSV de tokens públicos exportado', 'success');
    } catch (error) {
      logger.error('Erro ao exportar CSV de tokens públicos', error);
      showToast('Erro ao exportar CSV de tokens públicos', 'error');
    }
  };

  const exportSupportMetricsCsv = () => {
    try {
      const rows = [['Métrica', 'Valor']];
      rows.push(['Total Tickets', String(metrics?.general?.totalTickets || 0)]);
      rows.push(['Tickets Abertos', String(metrics?.general?.openTickets || 0)]);
      rows.push(['Tickets Fechados', String(metrics?.general?.closedTickets || 0)]);
      rows.push(['Tempo Médio de Resolução (min)', String(metrics?.general?.avgResolutionTime || 0)]);
      rows.push(['TME (s)', String(metrics?.general?.avgFirstResponseTimeSeconds || 0)]);
      rows.push(['TMA (s)', String(metrics?.general?.avgHandlingTimeSeconds || 0)]);
      rows.push(['Taxa de Abandono', String(metrics?.general?.abandonmentRate || 0)]);
      rows.push(['Contenção Bot', String(metrics?.general?.botContainmentRate || 0)]);
      rows.push([]);
      rows.push(['Agente', 'Total', 'Fechados', 'Abertos', 'Tempo Médio']);
      (metrics?.agents || []).forEach((a) => {
        rows.push([
          a.agentName || a.agentId || '',
          String(a.totalTickets || 0),
          String(a.closedTickets || 0),
          String(a.openTickets || 0),
          String(a.avgResolutionTime || 0),
        ]);
      });
      rows.push([]);
      rows.push(['Departamento', 'Total', 'Fechados', 'Tempo Médio']);
      (metrics?.departments || []).forEach((d) => {
        rows.push([
          d.departmentName || d.departmentId || '',
          String(d.totalTickets || 0),
          String(d.closedTickets || 0),
          String(d.avgResolutionTime || 0),
        ]);
      });
      rows.push([]);
      rows.push(['Fila', 'Total', 'Esperando', 'Em Andamento', 'Fechados']);
      (metrics?.queues || []).forEach((q) => {
        rows.push([
          q.queueName || '',
          String(q.totalTickets || 0),
          String(q.waitingTickets || 0),
          String(q.inProgressTickets || 0),
          String(q.closedTickets || 0),
        ]);
      });
      downloadCsv(rows, `support-metrics-${new Date().toISOString().slice(0, 10)}.csv`);
      showToast('CSV de métricas de atendimento exportado', 'success');
    } catch (error) {
      logger.error('Erro ao exportar CSV de métricas de atendimento', error);
      showToast('Erro ao exportar CSV de métricas de atendimento', 'error');
    }
  };

  const resetAnalyticsFilters = () => {
    setSelectedWindowDays(30);
    setSelectedChannel('all');
    setSelectedLocationId('');
    setSelectedHourPreset('full_day');
    setHourStart('0');
    setHourEnd('23');
    setSelectedOrderHourMetric('created_count');
    setSelectedPhysicalHourMetric('created_count');
    setDateRange({ startDate: '', endDate: '' });
    showToast('Filtros resetados', 'success');
  };

  const copyFiltersLink = async () => {
    try {
      const fullUrl = `${window.location.origin}${window.location.pathname}${window.location.search || ''}`;
      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        await navigator.clipboard.writeText(fullUrl);
      } else {
        const input = document.createElement('input');
        input.value = fullUrl;
        document.body.appendChild(input);
        input.select();
        document.execCommand('copy');
        document.body.removeChild(input);
      }
      showToast('Link com filtros copiado', 'success');
    } catch (error) {
      logger.error('Erro ao copiar link com filtros', error);
      showToast('Erro ao copiar link com filtros', 'error');
    }
  };

  if (authLoading) {
    return (
      <CrudPageBase>
        <div style={{ padding: '40px', textAlign: 'center' }}>
          <p>Carregando...</p>
        </div>
      </CrudPageBase>
    );
  }

  if (!isAuthenticated) {
    return null; // Será redirecionado pelo useEffect
  }

  if (loading && !metrics) {
    return (
      <CrudPageBase>
        <div className="support-header">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
            <h1>📈 Analises e Metricas</h1>
          </div>
        
        <div className="support-controls">
          <button
            type="button"
            className="btn-default px-4 py-2 text-sm"
            onClick={() => window.location.reload()}
          >
            🔄 Atualizar
          </button>
        </div>
      </div>
        <div className="text-center py-12">
          <p className="text-text-secondary">Carregando métricas...</p>
        </div>
      </CrudPageBase>
    );
  }

  const funnelStageMax = (funnelMetrics?.stages || []).reduce((max, s) => {
    const total = Number(s?.total || 0);
    return total > max ? total : max;
  }, 1);

  const roiRevenue = Number(roiMetrics?.orders?.totalRevenue || 0);
  const roiCost = Number(roiMetrics?.totalChannelCost || roiMetrics?.marketingCost || 0);
  const roiMargin = roiRevenue - roiCost;
  const roiPercent = roiCost > 0 ? ((roiRevenue - roiCost) / roiCost) : null;
  const blendedCost = Number(roiMetrics?.blendedCost || roiCost);
  const blendedMargin = roiRevenue - blendedCost;
  const blendedRoiPercent = blendedCost > 0 ? ((roiRevenue - blendedCost) / blendedCost) : null;
  const operationalCosts = roiMetrics?.operationalCosts || null;

  const leadsByChannel = new Map(
    (funnelMetrics?.channels || []).map((c) => [String(c.channel || 'unknown'), Number(c.leads || 0)])
  );
  const orderByChannel = new Map(
    (roiMetrics?.orderSources || []).map((o) => [String(o.source || 'unknown'), o])
  );
  const channelOptions = Array.from(new Set([...leadsByChannel.keys(), ...orderByChannel.keys()]));
  const filteredChannels = selectedChannel === 'all'
    ? channelOptions
    : channelOptions.filter((c) => c.toLowerCase() === selectedChannel.toLowerCase());
  const attributionRows = (roiMetrics?.orderSources || [])
    .filter((row) => selectedChannel === 'all' || String(row?.source || '').toLowerCase() === selectedChannel.toLowerCase())
    .sort((a, b) => Number(b?.margin || 0) - Number(a?.margin || 0));
  const attributionAlerts = [];
  if (operationalCosts && Number(operationalCosts?.voice?.estimatedCost || 0) > 0) {
    const voiceCost = Number(operationalCosts.voice.estimatedCost || 0);
    if (roiRevenue > 0 && (voiceCost / roiRevenue) > 0.12) {
      attributionAlerts.push(`Custo de voz acima de 12% da receita (${formatMoney(voiceCost)}).`);
    }
  }
  const lowMarginChannels = attributionRows.filter((row) => Number(row?.margin || 0) < 0);
  if (lowMarginChannels.length > 0) {
    attributionAlerts.push(
      `Canais com margem negativa: ${lowMarginChannels.slice(0, 3).map((row) => row.source).join(', ')}.`,
    );
  }
  const minHour = hourStart === '' ? 0 : Math.max(0, Math.min(23, Number(hourStart) || 0));
  const maxHour = hourEnd === '' ? 23 : Math.max(0, Math.min(23, Number(hourEnd) || 23));
  const rangeStartHour = Math.min(minHour, maxHour);
  const rangeEndHour = Math.max(minHour, maxHour);
  const orderByHour = orderMetrics?.byHour || [];
  const physicalByHour = physicalMetrics?.byHour || [];
  const filteredOrderByHour = orderByHour.filter((row) => {
    const h = Number(row?.hour);
    if (!Number.isFinite(h)) return false;
    return h >= rangeStartHour && h <= rangeEndHour;
  });
  const filteredPhysicalByHour = physicalByHour.filter((row) => {
    const h = Number(row?.hour);
    if (!Number.isFinite(h)) return false;
    return h >= rangeStartHour && h <= rangeEndHour;
  });
  const orderMetricLabels = {
    created_count: 'Criados',
    confirmed_count: 'Confirmados',
    preparing_count: 'Preparando',
    ready_count: 'Prontos',
    dispatched_count: 'Despachados',
    delivered_count: 'Entregues',
    cancelled_count: 'Cancelados',
  };
  const physicalMetricLabels = {
    created_count: 'Criados',
    done_count: 'Concluidos',
    abandoned_count: 'Abandonados',
  };
  const orderByHourMax = filteredOrderByHour.reduce((max, row) => {
    const total = Number(row?.[selectedOrderHourMetric] || 0);
    return total > max ? total : max;
  }, 1);
  const physicalByHourMax = filteredPhysicalByHour.reduce((max, row) => {
    const total = Number(row?.[selectedPhysicalHourMetric] || 0);
    return total > max ? total : max;
  }, 1);

  const applyHourPreset = (presetKey) => {
    const preset = HOUR_PRESETS[presetKey];
    if (!preset || preset.start == null || preset.end == null) return;
    setSelectedHourPreset(presetKey);
    setHourStart(String(preset.start));
    setHourEnd(String(preset.end));
  };

  return (
    <CrudPageBase>
      <div className="support-header">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
          <h1>📈 Analises e Metricas</h1>
        </div>
        <p className="text-text-secondary" style={{ marginBottom: '20px' }}>
          Painel com KPIs e indicadores em tempo real
        </p>
      </div>

      <AnalyticsRoiAndFunnelSection
        selectedWindowDays={selectedWindowDays}
        selectedChannel={selectedChannel}
        setSelectedWindowDays={setSelectedWindowDays}
        setSelectedChannel={setSelectedChannel}
        selectedLocationId={selectedLocationId}
        setSelectedLocationId={setSelectedLocationId}
        channelOptions={channelOptions}
        exportRoiCsv={exportRoiCsv}
        copyFiltersLink={copyFiltersLink}
        resetAnalyticsFilters={resetAnalyticsFilters}
        formatMoney={formatMoney}
        formatRate={formatRate}
        formatSeconds={formatSeconds}
        roiRevenue={roiRevenue}
        roiCost={roiCost}
        roiPercent={roiPercent}
        roiMargin={roiMargin}
        operationalCosts={operationalCosts}
        blendedCost={blendedCost}
        blendedRoiPercent={blendedRoiPercent}
        blendedMargin={blendedMargin}
        funnelMetrics={funnelMetrics}
        funnelStageMax={funnelStageMax}
        filteredChannels={filteredChannels}
        leadsByChannel={leadsByChannel}
        orderByChannel={orderByChannel}
        attributionRows={attributionRows}
        attributionAlerts={attributionAlerts}
        roiMetrics={roiMetrics}
        orderMetrics={orderMetrics}
      />

      <AnalyticsOrdersAndPhysicalSection
        selectedLocationId={selectedLocationId}
        exportOrdersByHourCsv={exportOrdersByHourCsv}
        orderMetrics={orderMetrics}
        formatSeconds={formatSeconds}
        selectedOrderHourMetric={selectedOrderHourMetric}
        setSelectedOrderHourMetric={setSelectedOrderHourMetric}
        hourStart={hourStart}
        setHourStart={setHourStart}
        hourEnd={hourEnd}
        setHourEnd={setHourEnd}
        setSelectedHourPreset={setSelectedHourPreset}
        HOUR_PRESETS={HOUR_PRESETS}
        applyHourPreset={applyHourPreset}
        orderMetricLabels={orderMetricLabels}
        filteredOrderByHour={filteredOrderByHour}
        orderByHourMax={orderByHourMax}
        exportPhysicalByHourCsv={exportPhysicalByHourCsv}
        physicalMetrics={physicalMetrics}
        formatRate={formatRate}
        selectedPhysicalHourMetric={selectedPhysicalHourMetric}
        setSelectedPhysicalHourMetric={setSelectedPhysicalHourMetric}
        physicalMetricLabels={physicalMetricLabels}
        rangeStartHour={rangeStartHour}
        rangeEndHour={rangeEndHour}
        filteredPhysicalByHour={filteredPhysicalByHour}
        physicalByHourMax={physicalByHourMax}
      />

      <AnalyticsVoiceAndTokensSection
        voiceMetrics={voiceMetrics}
        publicTokenStats={publicTokenStats}
        formatMoney={formatMoney}
        exportVoiceCsv={exportVoiceCsv}
        exportPublicTokensCsv={exportPublicTokensCsv}
      />

      <AnalyticsSupportMetricsSection
        dateRange={dateRange}
        setDateRange={setDateRange}
        resetAnalyticsFilters={resetAnalyticsFilters}
        metrics={metrics}
        exportSupportMetricsCsv={exportSupportMetricsCsv}
        formatTime={formatTime}
        formatSeconds={formatSeconds}
        formatRate={formatRate}
      />

      <ToastContainer />
    </CrudPageBase>
  );
}
