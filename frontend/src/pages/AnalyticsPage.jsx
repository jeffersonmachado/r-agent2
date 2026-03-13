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
        getRoiMetrics({ windowDays: selectedWindowDays }),
        getFunnelMetrics({ windowDays: selectedWindowDays }),
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
      <div className="support-page">
        <div style={{ padding: '40px', textAlign: 'center' }}>
          <p>Carregando...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return null; // Será redirecionado pelo useEffect
  }

  if (loading && !metrics) {
    return (
      <div className="support-page">
        <div className="support-header">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
            <h1>📈 Analytics & Métricas</h1>
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
      </div>
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
    done_count: 'Done',
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
    <div className="support-page">
      <div className="support-header">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
          <h1>📈 Analytics & Métricas</h1>
        </div>
        <p className="text-text-secondary" style={{ marginBottom: '20px' }}>
          Dashboard com KPIs e indicadores em tempo real
        </p>
      </div>

      <div className="bg-bg-elevated rounded-xl border border-border-default p-6 mb-6 shadow-lg">
        <div className="flex flex-col lg:flex-row lg:items-end gap-4 mb-4">
          <div className="flex-1">
            <h3 className="text-xl font-semibold text-text-primary">ROI v1</h3>
            <p className="text-sm text-text-secondary">Funil + custos por canal + KPIs operacionais</p>
          </div>
          <div className="flex flex-col sm:flex-row gap-3">
            <label className="text-sm text-text-secondary">
              Período
              <select
                value={selectedWindowDays}
                onChange={(e) => setSelectedWindowDays(Number(e.target.value))}
                className="ml-2 px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary"
              >
                <option value={7}>Últimos 7 dias</option>
                <option value={30}>Últimos 30 dias</option>
                <option value={90}>Últimos 90 dias</option>
              </select>
            </label>
            <label className="text-sm text-text-secondary">
              Unidade (`locationId`)
              <input
                value={selectedLocationId}
                onChange={(e) => setSelectedLocationId(e.target.value)}
                placeholder="ex.: loja-centro"
                className="ml-2 px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary"
              />
            </label>
            <label className="text-sm text-text-secondary">
              Canal
              <select
                value={selectedChannel}
                onChange={(e) => setSelectedChannel(e.target.value)}
                className="ml-2 px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary"
              >
                <option value="all">Todos</option>
                {channelOptions.map((channel) => (
                  <option key={channel} value={channel}>{channel}</option>
                ))}
              </select>
            </label>
            <button
              type="button"
              onClick={exportRoiCsv}
              className="px-4 py-2 rounded-lg border border-border-default bg-bg-secondary text-text-primary hover:bg-bg-hover transition-colors"
            >
              Exportar CSV
            </button>
            <button
              type="button"
              onClick={copyFiltersLink}
              className="px-4 py-2 rounded-lg border border-border-default bg-bg-secondary text-text-primary hover:bg-bg-hover transition-colors"
            >
              Copiar link
            </button>
            <button
              type="button"
              onClick={resetAnalyticsFilters}
              className="px-4 py-2 rounded-lg border border-border-default bg-bg-secondary text-text-primary hover:bg-bg-hover transition-colors"
            >
              Limpar filtros
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <div className="p-4 rounded-lg border border-border-default bg-bg-secondary">
            <div className="text-sm text-text-secondary">Receita</div>
            <div className="text-xl font-semibold text-text-primary">{formatMoney(roiRevenue)}</div>
          </div>
          <div className="p-4 rounded-lg border border-border-default bg-bg-secondary">
            <div className="text-sm text-text-secondary">Custo</div>
            <div className="text-xl font-semibold text-text-primary">{formatMoney(roiCost)}</div>
          </div>
          <div className="p-4 rounded-lg border border-border-default bg-bg-secondary">
            <div className="text-sm text-text-secondary">ROI</div>
            <div className="text-xl font-semibold text-text-primary">{roiPercent == null ? 'N/A' : formatRate(roiPercent)}</div>
          </div>
          <div className="p-4 rounded-lg border border-border-default bg-bg-secondary">
            <div className="text-sm text-text-secondary">Margem</div>
            <div className="text-xl font-semibold text-text-primary">{formatMoney(roiMargin)}</div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <div className="p-4 rounded-lg border border-border-default bg-bg-secondary">
            <div className="text-sm text-text-secondary">Custo operacional</div>
            <div className="text-lg font-semibold text-text-primary">{formatMoney(operationalCosts?.total || 0)}</div>
            <div className="text-xs text-text-secondary">
              Voz: {formatMoney(operationalCosts?.voice?.estimatedCost || 0)}
            </div>
          </div>
          <div className="p-4 rounded-lg border border-border-default bg-bg-secondary">
            <div className="text-sm text-text-secondary">Custo blended</div>
            <div className="text-lg font-semibold text-text-primary">{formatMoney(blendedCost)}</div>
            <div className="text-xs text-text-secondary">
              Marketing + operacional ponta a ponta
            </div>
          </div>
          <div className="p-4 rounded-lg border border-border-default bg-bg-secondary">
            <div className="text-sm text-text-secondary">ROI blended</div>
            <div className="text-lg font-semibold text-text-primary">
              {blendedRoiPercent == null ? 'N/A' : formatRate(blendedRoiPercent)}
            </div>
            <div className="text-xs text-text-secondary">Margem blended: {formatMoney(blendedMargin)}</div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          <div className="p-4 rounded-lg border border-border-default bg-bg-secondary">
            <div className="text-sm font-medium text-text-primary mb-3">Funil (visual)</div>
            {(funnelMetrics?.stages || []).map((s) => (
              <div key={s.stage} className="mb-3">
                <div className="flex justify-between text-xs text-text-secondary mb-1">
                  <span>{s.stage}</span>
                  <span>{s.total}</span>
                </div>
                <div style={{ background: 'rgba(255,255,255,0.06)', borderRadius: 6, height: 8, width: '100%' }}>
                  <div
                    style={{
                      width: `${Math.max(2, Math.round((Number(s.total || 0) / funnelStageMax) * 100))}%`,
                      height: 8,
                      borderRadius: 6,
                      background: 'linear-gradient(90deg, #22c55e, #16a34a)',
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
          <div className="p-4 rounded-lg border border-border-default bg-bg-secondary">
            <div className="text-sm font-medium text-text-primary mb-3">Conversão</div>
            <div className="space-y-2 text-sm text-text-secondary">
              <div className="flex justify-between"><span>Visitante → Lead</span><strong className="text-text-primary">{formatRate(funnelMetrics?.conversionRates?.visitorToLead)}</strong></div>
              <div className="flex justify-between"><span>Lead → Cliente</span><strong className="text-text-primary">{formatRate(funnelMetrics?.conversionRates?.leadToCustomer)}</strong></div>
              <div className="flex justify-between"><span>Pedidos</span><strong className="text-text-primary">{funnelMetrics?.totals?.orders || 0}</strong></div>
              <div className="flex justify-between"><span>Receita</span><strong className="text-text-primary">{formatMoney(funnelMetrics?.totals?.revenue || 0)}</strong></div>
            </div>
          </div>
        </div>

        <div className="overflow-auto mb-6">
          <table style={{ width: '100%', fontSize: '13px' }}>
            <thead>
              <tr>
                <th align="left">Canal</th>
                <th align="right">Leads</th>
                <th align="right">Pedidos</th>
                <th align="right">Receita</th>
                <th align="right">Custo</th>
                <th align="right">ROI</th>
                <th align="right">CPL</th>
                <th align="right">CPA</th>
              </tr>
            </thead>
            <tbody>
              {filteredChannels.map((channel) => {
                const leads = Number(leadsByChannel.get(channel) || 0);
                const order = orderByChannel.get(channel) || {};
                const orders = Number(order.orders || 0);
                const revenue = Number(order.revenue || 0);
                const cost = Number(order.cost || 0);
                const rowRoi = cost > 0 ? ((revenue - cost) / cost) : null;
                const cpl = leads > 0 ? (cost / leads) : null;
                const cpa = orders > 0 ? (cost / orders) : null;
                return (
                  <tr key={channel}>
                    <td>{channel}</td>
                    <td align="right">{leads}</td>
                    <td align="right">{orders}</td>
                    <td align="right">{formatMoney(revenue)}</td>
                    <td align="right">{formatMoney(cost)}</td>
                    <td align="right">{rowRoi == null ? '-' : formatRate(rowRoi)}</td>
                    <td align="right">{cpl == null ? '-' : formatMoney(cpl)}</td>
                    <td align="right">{cpa == null ? '-' : formatMoney(cpa)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="overflow-auto mb-6">
          <div className="text-sm font-medium text-text-primary mb-3">Atribuição ponta a ponta por canal</div>
          <table style={{ width: '100%', fontSize: '13px' }}>
            <thead>
              <tr>
                <th align="left">Canal</th>
                <th align="right">Pedidos</th>
                <th align="right">Receita</th>
                <th align="right">Custo marketing</th>
                <th align="right">Custo operacional</th>
                <th align="right">Custo blended</th>
                <th align="right">Margem</th>
                <th align="right">ROI blended</th>
              </tr>
            </thead>
            <tbody>
              {attributionRows.map((row) => (
                <tr key={`attr-${row.source}`}>
                  <td>{row.source}</td>
                  <td align="right">{Number(row.orders || 0)}</td>
                  <td align="right">{formatMoney(row.revenue || 0)}</td>
                  <td align="right">{formatMoney(row.cost || 0)}</td>
                  <td align="right">{formatMoney(row.operationalCost || 0)}</td>
                  <td align="right">{formatMoney(row.blendedCost || (Number(row.cost || 0) + Number(row.operationalCost || 0)))}</td>
                  <td align="right">{formatMoney(row.margin || 0)}</td>
                  <td align="right">{row.blendedRoi == null ? '-' : formatRate(row.blendedRoi)}</td>
                </tr>
              ))}
              {attributionRows.length === 0 && (
                <tr>
                  <td colSpan={8} className="text-text-secondary" align="left">Sem dados de atribuição para o filtro atual.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {attributionAlerts.length > 0 && (
          <div className="p-4 rounded-lg border border-border-default bg-bg-secondary mb-6">
            <div className="text-sm font-medium text-text-primary mb-2">Alertas de eficiência</div>
            <ul className="text-sm text-text-secondary space-y-1">
              {attributionAlerts.map((alert) => (
                <li key={alert}>• {alert}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="p-4 rounded-lg border border-border-default bg-bg-secondary">
            <div className="text-sm text-text-secondary">Order → Ready</div>
            <div className="text-lg font-semibold text-text-primary">{formatSeconds(orderMetrics?.today?.avgOrderToReadySeconds)}</div>
            <div className="text-xs text-text-secondary">
              SLA {orderMetrics?.today?.slaOrderToReadyMinutes || 0}m • Estouro {orderMetrics?.today?.slaOrderToReadyBreachedCount || 0}
            </div>
          </div>
          <div className="p-4 rounded-lg border border-border-default bg-bg-secondary">
            <div className="text-sm text-text-secondary">Order → Deliver</div>
            <div className="text-lg font-semibold text-text-primary">{formatSeconds(orderMetrics?.today?.avgOrderToDeliverSeconds)}</div>
            <div className="text-xs text-text-secondary">
              SLA {orderMetrics?.today?.slaOrderToDeliverMinutes || 0}m • Estouro {orderMetrics?.today?.slaOrderToDeliverBreachedCount || 0}
            </div>
          </div>
        </div>
      </div>

      <div className="bg-bg-elevated rounded-xl border border-border-default p-6 mb-6 shadow-lg">
        <h3 className="text-xl font-semibold text-text-primary mb-4 flex items-center gap-2">
          <span>💰</span>
          <span>ROI (janela {selectedWindowDays} dias)</span>
        </h3>
        {roiMetrics?.ok ? (
          <>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <div className="text-sm text-text-secondary">Receita</div>
                <div className="text-lg font-semibold">{formatMoney(roiMetrics.orders?.totalRevenue || 0)}</div>
                <div className="text-xs text-text-secondary">Pedidos: {roiMetrics.orders?.total || 0}</div>
              </div>
              <div>
                <div className="text-sm text-text-secondary">Leads</div>
                <div className="text-lg font-semibold">{roiMetrics.leads?.total || 0}</div>
                <div className="text-xs text-text-secondary">Receita por lead: {formatMoney(roiMetrics.revenuePerLead || 0)}</div>
              </div>
              <div>
                <div className="text-sm text-text-secondary">ROI</div>
                <div className="text-lg font-semibold">
                  {roiMetrics.roi == null ? 'N/A' : `${Math.round(roiMetrics.roi * 100)}%`}
                </div>
                <div className="text-xs text-text-secondary">
                  Custo total: {formatMoney(roiMetrics.marketingCost || 0)} • Custo por canal: {formatMoney(roiMetrics.totalChannelCost || 0)}
                </div>
              </div>
            </div>
            {(roiMetrics.orderSources || []).length > 0 && (
              <div className="overflow-auto mt-4">
                <table style={{ width: '100%', fontSize: '13px' }}>
                  <thead>
                    <tr>
                      <th align="left">Fonte</th>
                      <th align="right">Pedidos</th>
                      <th align="right">Receita</th>
                      <th align="right">Custo</th>
                      <th align="right">Custo/Pedido</th>
                      <th align="right">ROI</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(roiMetrics.orderSources || []).map((row) => (
                      <tr key={row.source}>
                        <td>{row.source}</td>
                        <td align="right">{row.orders || 0}</td>
                        <td align="right">{formatMoney(row.revenue || 0)}</td>
                        <td align="right">{formatMoney(row.cost || 0)}</td>
                        <td align="right">{row.costPerOrder == null ? '-' : formatMoney(row.costPerOrder)}</td>
                        <td align="right">{row.roi == null ? '-' : formatRate(row.roi)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        ) : (
          <div className="text-text-secondary">ROI indisponível.</div>
        )}
      </div>

      <div className="bg-bg-elevated rounded-xl border border-border-default p-6 mb-6 shadow-lg">
        <h3 className="text-xl font-semibold text-text-primary mb-4 flex items-center gap-2">
          <span>🧭</span>
          <span>Funil (janela {selectedWindowDays} dias)</span>
        </h3>
        {funnelMetrics?.ok ? (
          <>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4">
              <div>
                <div className="text-sm text-text-secondary">Leads</div>
                <div className="text-lg font-semibold">{funnelMetrics.totals?.leads || 0}</div>
              </div>
              <div>
                <div className="text-sm text-text-secondary">Submissões</div>
                <div className="text-lg font-semibold">{funnelMetrics.totals?.formSubmissions || 0}</div>
              </div>
              <div>
                <div className="text-sm text-text-secondary">Pedidos</div>
                <div className="text-lg font-semibold">{funnelMetrics.totals?.orders || 0}</div>
              </div>
              <div>
                <div className="text-sm text-text-secondary">Receita</div>
                <div className="text-lg font-semibold">R$ {Number(funnelMetrics.totals?.revenue || 0).toFixed(2)}</div>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
              <div>
                <div className="text-sm text-text-secondary">Conversão Lead → Cliente</div>
                <div className="text-lg font-semibold">{formatRate(funnelMetrics.conversionRates?.leadToCustomer)}</div>
              </div>
              <div>
                <div className="text-sm text-text-secondary">Leads com Form</div>
                <div className="text-lg font-semibold">{funnelMetrics.totals?.formSubmissionLeads || 0}</div>
              </div>
              <div>
                <div className="text-sm text-text-secondary">Canais (leads)</div>
                <div className="text-lg font-semibold">{funnelMetrics.channels?.length || 0}</div>
              </div>
            </div>
            <div className="overflow-auto">
              <table style={{ width: '100%', fontSize: '13px' }}>
                <thead>
                  <tr>
                    <th align="left">Etapa</th>
                    <th align="left">Total</th>
                    <th align="left">Visual</th>
                  </tr>
                </thead>
                <tbody>
                  {(funnelMetrics.stages || []).map((s) => (
                    <tr key={s.stage}>
                      <td>{s.stage}</td>
                      <td>{s.total}</td>
                      <td>
                        <div style={{ background: 'rgba(255,255,255,0.06)', borderRadius: 6, height: 8, width: '100%' }}>
                          <div
                            style={{
                              width: `${Math.max(2, Math.round((Number(s.total || 0) / funnelStageMax) * 100))}%`,
                              height: 8,
                              borderRadius: 6,
                              background: 'linear-gradient(90deg, #22c55e, #16a34a)',
                            }}
                          />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {(funnelMetrics.channels || []).length > 0 && (
              <div className="overflow-auto mt-4">
                <table style={{ width: '100%', fontSize: '13px' }}>
                  <thead>
                    <tr>
                      <th align="left">Canal</th>
                      <th align="right">Leads</th>
                      <th align="right">Custo</th>
                      <th align="right">Custo/Lead</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(funnelMetrics.channels || []).map((c) => (
                      <tr key={c.channel}>
                        <td>{c.channel}</td>
                        <td align="right">{c.leads || 0}</td>
                        <td align="right">{formatMoney(c.cost || 0)}</td>
                        <td align="right">{c.costPerLead == null ? '-' : formatMoney(c.costPerLead)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {(funnelMetrics.orderSources || []).length > 0 && (
              <div className="overflow-auto mt-4">
                <table style={{ width: '100%', fontSize: '13px' }}>
                  <thead>
                    <tr>
                      <th align="left">Fonte (Pedidos)</th>
                      <th align="right">Pedidos</th>
                      <th align="right">Receita</th>
                      <th align="right">Custo</th>
                      <th align="right">Custo/Pedido</th>
                      <th align="right">ROI</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(funnelMetrics.orderSources || []).map((row) => (
                      <tr key={row.source}>
                        <td>{row.source}</td>
                        <td align="right">{row.orders || 0}</td>
                        <td align="right">{formatMoney(row.revenue || 0)}</td>
                        <td align="right">{formatMoney(row.cost || 0)}</td>
                        <td align="right">{row.costPerOrder == null ? '-' : formatMoney(row.costPerOrder)}</td>
                        <td align="right">{row.roi == null ? '-' : formatRate(row.roi)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        ) : (
          <div className="text-text-secondary">Funil indisponível.</div>
        )}
      </div>

      <div className="bg-bg-elevated rounded-xl border border-border-default p-6 mb-6 shadow-lg">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-xl font-semibold text-text-primary flex items-center gap-2">
            <span>🧾</span>
            <span>Pedidos (hoje{selectedLocationId ? ` • ${selectedLocationId}` : ''})</span>
          </h3>
          <button
            type="button"
            onClick={exportOrdersByHourCsv}
            className="px-3 py-2 rounded-lg border border-border-default bg-bg-secondary text-text-primary hover:bg-bg-hover transition-colors text-sm"
          >
            Exportar por hora
          </button>
        </div>
        {orderMetrics?.ok ? (
          <>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
              <div>
                <div className="text-sm text-text-secondary">Criados</div>
                <div className="text-lg font-semibold">{orderMetrics.today?.createdCount || 0}</div>
                <div className="text-xs text-text-secondary">Cancelados: {orderMetrics.today?.cancelledCount || 0}</div>
              </div>
              <div>
                <div className="text-sm text-text-secondary">Order → Ready</div>
                <div className="text-lg font-semibold">{formatSeconds(orderMetrics.today?.avgOrderToReadySeconds)}</div>
                <div className="text-xs text-text-secondary">
                  SLA {orderMetrics.today?.slaOrderToReadyMinutes || 0}m • Estourados: {orderMetrics.today?.slaOrderToReadyBreachedCount || 0}
                </div>
              </div>
              <div>
                <div className="text-sm text-text-secondary">Order → Deliver</div>
                <div className="text-lg font-semibold">{formatSeconds(orderMetrics.today?.avgOrderToDeliverSeconds)}</div>
                <div className="text-xs text-text-secondary">
                  SLA {orderMetrics.today?.slaOrderToDeliverMinutes || 0}m • Estourados: {orderMetrics.today?.slaOrderToDeliverBreachedCount || 0}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
              <div className="p-3 rounded-lg border border-border-default bg-bg-secondary">
                <div className="text-xs text-text-secondary">Confirmados</div>
                <div className="text-lg font-semibold">{orderMetrics.today?.confirmedCount || 0}</div>
              </div>
              <div className="p-3 rounded-lg border border-border-default bg-bg-secondary">
                <div className="text-xs text-text-secondary">Preparando</div>
                <div className="text-lg font-semibold">{orderMetrics.today?.preparingCount || 0}</div>
              </div>
              <div className="p-3 rounded-lg border border-border-default bg-bg-secondary">
                <div className="text-xs text-text-secondary">Prontos</div>
                <div className="text-lg font-semibold">{orderMetrics.today?.readyCount || 0}</div>
              </div>
              <div className="p-3 rounded-lg border border-border-default bg-bg-secondary">
                <div className="text-xs text-text-secondary">Despachados</div>
                <div className="text-lg font-semibold">{orderMetrics.today?.dispatchedCount || 0}</div>
              </div>
              <div className="p-3 rounded-lg border border-border-default bg-bg-secondary">
                <div className="text-xs text-text-secondary">Entregues</div>
                <div className="text-lg font-semibold">{orderMetrics.today?.deliveredCount || 0}</div>
              </div>
              <div className="p-3 rounded-lg border border-border-default bg-bg-secondary">
                <div className="text-xs text-text-secondary">Cancelados</div>
                <div className="text-lg font-semibold">{orderMetrics.today?.cancelledCount || 0}</div>
              </div>
            </div>

            {(orderMetrics.byHour || []).length > 0 && (
              <div className="mt-4">
                <div className="flex flex-col md:flex-row gap-3 mb-3">
                  <label className="text-xs text-text-secondary">
                    Métrica
                    <select
                      value={selectedOrderHourMetric}
                      onChange={(e) => setSelectedOrderHourMetric(e.target.value)}
                      className="ml-2 px-2 py-1 bg-bg-secondary border border-border-default rounded text-text-primary"
                    >
                      {Object.entries(orderMetricLabels).map(([value, label]) => (
                        <option key={value} value={value}>{label}</option>
                      ))}
                    </select>
                  </label>
                  <label className="text-xs text-text-secondary">
                    Hora início
                    <input
                      type="number"
                      min={0}
                      max={23}
                      value={hourStart}
                      onChange={(e) => {
                        setSelectedHourPreset('custom');
                        setHourStart(e.target.value);
                      }}
                      className="ml-2 w-16 px-2 py-1 bg-bg-secondary border border-border-default rounded text-text-primary"
                    />
                  </label>
                  <label className="text-xs text-text-secondary">
                    Hora fim
                    <input
                      type="number"
                      min={0}
                      max={23}
                      value={hourEnd}
                      onChange={(e) => {
                        setSelectedHourPreset('custom');
                        setHourEnd(e.target.value);
                      }}
                      className="ml-2 w-16 px-2 py-1 bg-bg-secondary border border-border-default rounded text-text-primary"
                    />
                  </label>
                </div>
                <div className="flex flex-wrap gap-2 mb-3">
                  {Object.entries(HOUR_PRESETS)
                    .filter(([key]) => key !== 'custom')
                    .map(([key, preset]) => (
                      <button
                        key={key}
                        type="button"
                        onClick={() => applyHourPreset(key)}
                        className={`px-2 py-1 rounded border text-xs ${
                          selectedHourPreset === key
                            ? 'border-accent-primary text-accent-primary'
                            : 'border-border-default text-text-secondary'
                        }`}
                      >
                        {preset.label}
                      </button>
                    ))}
                </div>
                <div className="text-sm font-medium text-text-primary mb-3">Volume por hora ({orderMetricLabels[selectedOrderHourMetric] || 'Criados'})</div>
                <div className="space-y-2 mb-4">
                  {filteredOrderByHour.map((row) => (
                    <div key={row.hour}>
                      <div className="flex justify-between text-xs text-text-secondary mb-1">
                        <span>{String(row.hour).padStart(2, '0')}:00</span>
                        <span>{row[selectedOrderHourMetric] || 0}</span>
                      </div>
                      <div style={{ background: 'rgba(255,255,255,0.06)', borderRadius: 6, height: 8, width: '100%' }}>
                        <div
                          style={{
                            width: `${Math.max(2, Math.round((Number(row[selectedOrderHourMetric] || 0) / orderByHourMax) * 100))}%`,
                            height: 8,
                            borderRadius: 6,
                            background: 'linear-gradient(90deg, #38bdf8, #0284c7)',
                          }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
                <div className="overflow-auto">
                  <table style={{ width: '100%', fontSize: '13px' }}>
                    <thead>
                      <tr>
                        <th align="left">Hora</th>
                        <th align="right">Criados</th>
                        <th align="right">Confirmados</th>
                        <th align="right">Preparando</th>
                        <th align="right">Prontos</th>
                        <th align="right">Despachados</th>
                        <th align="right">Entregues</th>
                        <th align="right">Cancelados</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredOrderByHour.map((row) => (
                        <tr key={row.hour}>
                          <td>{String(row.hour).padStart(2, '0')}:00</td>
                          <td align="right">{row.created_count || 0}</td>
                          <td align="right">{row.confirmed_count || 0}</td>
                          <td align="right">{row.preparing_count || 0}</td>
                          <td align="right">{row.ready_count || 0}</td>
                          <td align="right">{row.dispatched_count || 0}</td>
                          <td align="right">{row.delivered_count || 0}</td>
                          <td align="right">{row.cancelled_count || 0}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="text-text-secondary">Métricas de pedidos indisponíveis.</div>
        )}
      </div>

      <div className="bg-bg-elevated rounded-xl border border-border-default p-6 mb-6 shadow-lg">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-xl font-semibold text-text-primary flex items-center gap-2">
            <span>🏷️</span>
            <span>Filas físicas (hoje{selectedLocationId ? ` • ${selectedLocationId}` : ''})</span>
          </h3>
          <button
            type="button"
            onClick={exportPhysicalByHourCsv}
            className="px-3 py-2 rounded-lg border border-border-default bg-bg-secondary text-text-primary hover:bg-bg-hover transition-colors text-sm"
          >
            Exportar por hora
          </button>
        </div>
        {physicalMetrics?.ok ? (
          <>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
              <div>
                <div className="text-sm text-text-secondary">Atendidas</div>
                <div className="text-lg font-semibold">{physicalMetrics.today?.doneCount || 0}</div>
                <div className="text-xs text-text-secondary">Abandonos: {physicalMetrics.today?.abandonedCount || 0}</div>
              </div>
              <div>
                <div className="text-sm text-text-secondary">Espera média</div>
                <div className="text-lg font-semibold">{formatSeconds(physicalMetrics.today?.avgWaitSeconds)}</div>
                <div className="text-xs text-text-secondary">Ativas: {physicalMetrics.today?.activeCount || 0}</div>
              </div>
              <div>
                <div className="text-sm text-text-secondary">Atendimento médio</div>
                <div className="text-lg font-semibold">{formatSeconds(physicalMetrics.today?.avgServiceSeconds)}</div>
                <div className="text-xs text-text-secondary">Abandono: {formatRate(physicalMetrics.today?.abandonmentRate)}</div>
              </div>
            </div>

            {(physicalMetrics.byQueue || []).length > 0 && (
              <div className="overflow-auto mt-4">
                <table style={{ width: '100%', fontSize: '13px' }}>
                  <thead>
                    <tr>
                      <th align="left">Fila</th>
                      <th align="right">Done</th>
                      <th align="right">Abandonados</th>
                      <th align="right">Ativos</th>
                      <th align="right">Espera média</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(physicalMetrics.byQueue || []).map((row) => (
                      <tr key={row.physical_queue_id}>
                        <td>{row.physical_queue_id}</td>
                        <td align="right">{row.done_count || 0}</td>
                        <td align="right">{row.abandoned_count || 0}</td>
                        <td align="right">{row.active_count || 0}</td>
                        <td align="right">{formatSeconds(row.avg_wait_seconds)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {(physicalMetrics.byStation || []).length > 0 && (
              <div className="overflow-auto mt-4">
                <table style={{ width: '100%', fontSize: '13px' }}>
                  <thead>
                    <tr>
                      <th align="left">Estação</th>
                      <th align="right">Done</th>
                      <th align="right">Abandonados</th>
                      <th align="right">Atendimento médio</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(physicalMetrics.byStation || []).map((row) => (
                      <tr key={row.station_id}>
                        <td>{row.station_id}</td>
                        <td align="right">{row.done_count || 0}</td>
                        <td align="right">{row.abandoned_count || 0}</td>
                        <td align="right">{formatSeconds(row.avg_service_seconds)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {(physicalMetrics.byHour || []).length > 0 && (
              <div className="mt-4">
                <div className="flex flex-col md:flex-row gap-3 mb-3">
                  <label className="text-xs text-text-secondary">
                    Métrica
                    <select
                      value={selectedPhysicalHourMetric}
                      onChange={(e) => setSelectedPhysicalHourMetric(e.target.value)}
                      className="ml-2 px-2 py-1 bg-bg-secondary border border-border-default rounded text-text-primary"
                    >
                      {Object.entries(physicalMetricLabels).map(([value, label]) => (
                        <option key={value} value={value}>{label}</option>
                      ))}
                    </select>
                  </label>
                  <div className="text-xs text-text-secondary">Faixa horária compartilhada com Pedidos: {String(rangeStartHour).padStart(2, '0')}:00-{String(rangeEndHour).padStart(2, '0')}:59</div>
                </div>
                <div className="text-sm font-medium text-text-primary mb-3">Volume por hora ({physicalMetricLabels[selectedPhysicalHourMetric] || 'Criados'})</div>
                <div className="space-y-2 mb-4">
                  {filteredPhysicalByHour.map((row) => (
                    <div key={row.hour}>
                      <div className="flex justify-between text-xs text-text-secondary mb-1">
                        <span>{String(row.hour).padStart(2, '0')}:00</span>
                        <span>{row[selectedPhysicalHourMetric] || 0}</span>
                      </div>
                      <div style={{ background: 'rgba(255,255,255,0.06)', borderRadius: 6, height: 8, width: '100%' }}>
                        <div
                          style={{
                            width: `${Math.max(2, Math.round((Number(row[selectedPhysicalHourMetric] || 0) / physicalByHourMax) * 100))}%`,
                            height: 8,
                            borderRadius: 6,
                            background: 'linear-gradient(90deg, #f59e0b, #d97706)',
                          }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
                <div className="overflow-auto">
                  <table style={{ width: '100%', fontSize: '13px' }}>
                    <thead>
                      <tr>
                        <th align="left">Hora</th>
                        <th align="right">Criados</th>
                        <th align="right">Done</th>
                        <th align="right">Abandonados</th>
                        <th align="right">Espera média</th>
                        <th align="right">Atendimento médio</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredPhysicalByHour.map((row) => (
                        <tr key={row.hour}>
                          <td>{String(row.hour).padStart(2, '0')}:00</td>
                          <td align="right">{row.created_count || 0}</td>
                          <td align="right">{row.done_count || 0}</td>
                          <td align="right">{row.abandoned_count || 0}</td>
                          <td align="right">{formatSeconds(row.avg_wait_seconds)}</td>
                          <td align="right">{formatSeconds(row.avg_service_seconds)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="text-text-secondary">Métricas de filas físicas indisponíveis.</div>
        )}
      </div>

      <div className="bg-bg-elevated rounded-xl border border-border-default p-6 mb-6 shadow-lg">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-xl font-semibold text-text-primary flex items-center gap-2">
            <span>📞</span>
            <span>Voz (últimos 7 dias)</span>
          </h3>
          <button
            type="button"
            onClick={exportVoiceCsv}
            className="px-3 py-2 rounded-lg border border-border-default bg-bg-secondary text-text-primary hover:bg-bg-hover transition-colors text-sm"
          >
            Exportar CSV
          </button>
        </div>
        {voiceMetrics?.ok ? (
          <>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
              <div>
                <div className="text-sm text-text-secondary">Chamadas</div>
                <div className="text-lg font-semibold">{voiceMetrics.totals?.totalCalls || 0}</div>
              </div>
              <div>
                <div className="text-sm text-text-secondary">Minutos</div>
                <div className="text-lg font-semibold">{voiceMetrics.totals?.totalMinutes || 0}</div>
              </div>
              <div>
                <div className="text-sm text-text-secondary">Custo estimado</div>
                <div className="text-lg font-semibold">{formatMoney(voiceMetrics.totals?.estimatedCost || 0)}</div>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {Object.entries(voiceMetrics.byType || {}).map(([type, total]) => (
                <div key={type}>
                  <div className="text-sm text-text-secondary">{type}</div>
                  <div className="text-lg font-semibold">{total}</div>
                </div>
              ))}
            </div>
          </>
        ) : (
          <div className="text-text-secondary">Métricas de voz indisponíveis.</div>
        )}
      </div>

      <div className="bg-bg-elevated rounded-xl border border-border-default p-6 mb-6 shadow-lg">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-xl font-semibold text-text-primary flex items-center gap-2">
            <span>🔑</span>
            <span>Tokens públicos</span>
          </h3>
          <button
            type="button"
            onClick={exportPublicTokensCsv}
            className="px-3 py-2 rounded-lg border border-border-default bg-bg-secondary text-text-primary hover:bg-bg-hover transition-colors text-sm"
          >
            Exportar CSV
          </button>
        </div>
        {publicTokenStats?.ok ? (
          <>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4">
              <div>
                <div className="text-sm text-text-secondary">Total</div>
                <div className="text-lg font-semibold">{publicTokenStats.totals?.total || 0}</div>
              </div>
              <div>
                <div className="text-sm text-text-secondary">Ativos</div>
                <div className="text-lg font-semibold">{publicTokenStats.totals?.active || 0}</div>
              </div>
              <div>
                <div className="text-sm text-text-secondary">Revogados</div>
                <div className="text-lg font-semibold">{publicTokenStats.totals?.revoked || 0}</div>
              </div>
              <div>
                <div className="text-sm text-text-secondary">Expirados</div>
                <div className="text-lg font-semibold">{publicTokenStats.totals?.expired || 0}</div>
              </div>
            </div>
            <div className="overflow-auto">
              <table style={{ width: '100%', fontSize: '13px' }}>
                <thead>
                  <tr>
                    <th align="left">Kind</th>
                    <th align="left">Total</th>
                    <th align="left">Ativos</th>
                    <th align="left">Usados 24h</th>
                    <th align="left">Último uso</th>
                  </tr>
                </thead>
                <tbody>
                  {(publicTokenStats.items || []).map((item) => (
                    <tr key={item.kind}>
                      <td>{item.kind}</td>
                      <td>{item.total}</td>
                      <td>{item.active}</td>
                      <td>{item.usedLastDay}</td>
                      <td>{item.lastUsedAtMax || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <div className="text-text-secondary">Stats de tokens indisponíveis.</div>
        )}
      </div>

        {/* Filtros de Data */}
        <div className="bg-bg-elevated rounded-xl border border-border-default p-6 mb-6 shadow-lg">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-xl font-semibold text-text-primary flex items-center gap-2">
              <span>🔍</span>
              <span>Filtros</span>
            </h3>
            <button
              type="button"
              onClick={resetAnalyticsFilters}
              className="px-3 py-2 rounded-lg border border-border-default bg-bg-secondary text-text-primary hover:bg-bg-hover transition-colors text-sm"
            >
              Resetar
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block mb-2 text-sm font-medium text-text-primary">
                Data Inicial
              </label>
              <input
                type="date"
                value={dateRange.startDate}
                onChange={(e) => setDateRange({ ...dateRange, startDate: e.target.value })}
                className="w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary focus:border-transparent transition-all"
              />
            </div>
            <div>
              <label className="block mb-2 text-sm font-medium text-text-primary">
                Data Final
              </label>
              <input
                type="date"
                value={dateRange.endDate}
                onChange={(e) => setDateRange({ ...dateRange, endDate: e.target.value })}
                className="w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary focus:border-transparent transition-all"
              />
            </div>
          </div>
        </div>

        {metrics && (
          <>
            <div className="flex justify-end mb-3">
              <button
                type="button"
                onClick={exportSupportMetricsCsv}
                className="px-3 py-2 rounded-lg border border-border-default bg-bg-secondary text-text-primary hover:bg-bg-hover transition-colors text-sm"
              >
                Exportar atendimento CSV
              </button>
            </div>
            {/* Métricas Gerais */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-6">
              <div className="bg-bg-elevated rounded-xl border border-border-default p-6 shadow-lg">
                <div className="text-sm text-text-secondary mb-1">Total de Tickets</div>
                <div className="text-3xl font-bold text-text-primary">
                  {metrics.general?.totalTickets || 0}
                </div>
              </div>
              
              <div className="bg-bg-elevated rounded-xl border border-border-default p-6 shadow-lg">
                <div className="text-sm text-text-secondary mb-1">Tickets Abertos</div>
                <div className="text-3xl font-bold text-status-warning">
                  {metrics.general?.openTickets || 0}
                </div>
              </div>
              
              <div className="bg-bg-elevated rounded-xl border border-border-default p-6 shadow-lg">
                <div className="text-sm text-text-secondary mb-1">Tickets Fechados</div>
                <div className="text-3xl font-bold text-status-success">
                  {metrics.general?.closedTickets || 0}
                </div>
              </div>
              
              <div className="bg-bg-elevated rounded-xl border border-border-default p-6 shadow-lg">
                <div className="text-sm text-text-secondary mb-1">Tempo Médio de Resolução</div>
                <div className="text-3xl font-bold text-accent-primary">
                  {formatTime(metrics.general?.avgResolutionTime)}
                </div>
              </div>
            </div>

            {/* SLA */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-6">
              <div className="bg-bg-elevated rounded-xl border border-border-default p-6 shadow-lg">
                <div className="text-sm text-text-secondary mb-1">TME (1ª resposta)</div>
                <div className="text-3xl font-bold text-accent-primary">
                  {formatSeconds(metrics.general?.avgFirstResponseTimeSeconds)}
                </div>
              </div>

              <div className="bg-bg-elevated rounded-xl border border-border-default p-6 shadow-lg">
                <div className="text-sm text-text-secondary mb-1">TMA (atendimento)</div>
                <div className="text-3xl font-bold text-accent-primary">
                  {formatSeconds(metrics.general?.avgHandlingTimeSeconds)}
                </div>
              </div>

              <div className="bg-bg-elevated rounded-xl border border-border-default p-6 shadow-lg">
                <div className="text-sm text-text-secondary mb-1">Taxa de Abandono</div>
                <div className="text-3xl font-bold text-status-warning">
                  {formatRate(metrics.general?.abandonmentRate)}
                </div>
              </div>

              <div className="bg-bg-elevated rounded-xl border border-border-default p-6 shadow-lg">
                <div className="text-sm text-text-secondary mb-1">Contenção Bot</div>
                <div className="text-3xl font-bold text-status-success">
                  {formatRate(metrics.general?.botContainmentRate)}
                </div>
              </div>
            </div>

            {/* Métricas por Agente */}
            {metrics.agents && metrics.agents.length > 0 && (
              <div className="bg-bg-elevated rounded-xl border border-border-default p-6 mb-6 shadow-lg">
                <h2 className="text-xl font-semibold text-text-primary mb-4">
                  Métricas por Agente
                </h2>
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse">
                    <thead>
                      <tr className="bg-bg-secondary border-b border-border-default">
                        <th className="text-left py-3 px-4 text-sm font-semibold text-text-primary">Agente</th>
                        <th className="text-right py-3 px-4 text-sm font-semibold text-text-primary">Total</th>
                        <th className="text-right py-3 px-4 text-sm font-semibold text-text-primary">Fechados</th>
                        <th className="text-right py-3 px-4 text-sm font-semibold text-text-primary">Abertos</th>
                        <th className="text-right py-3 px-4 text-sm font-semibold text-text-primary">Tempo Médio</th>
                      </tr>
                    </thead>
                    <tbody>
                      {metrics.agents.map((agent) => (
                        <tr key={agent.agentId} className="border-b border-border-default hover:bg-bg-hover transition-colors">
                          <td className="py-3 px-4 text-text-primary">{agent.agentName}</td>
                          <td className="py-3 px-4 text-right text-text-primary">{agent.totalTickets}</td>
                          <td className="py-3 px-4 text-right text-status-success">{agent.closedTickets}</td>
                          <td className="py-3 px-4 text-right text-status-warning">{agent.openTickets}</td>
                          <td className="py-3 px-4 text-right text-text-secondary">
                            {formatTime(agent.avgResolutionTime)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Métricas por Departamento */}
            {metrics.departments && metrics.departments.length > 0 && (
              <div className="bg-bg-elevated rounded-xl border border-border-default p-6 mb-6 shadow-lg">
                <h2 className="text-xl font-semibold text-text-primary mb-4">
                  Métricas por Departamento
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {metrics.departments.map((dept) => (
                    <div key={dept.departmentId} className="border border-border-default rounded-xl p-4 bg-bg-secondary">
                      <h3 className="font-semibold text-text-primary mb-2">
                        {dept.departmentName}
                      </h3>
                      <div className="text-sm text-text-secondary space-y-1">
                        <div>Total: {dept.totalTickets}</div>
                        <div>Fechados: {dept.closedTickets}</div>
                        <div>Tempo Médio: {formatTime(dept.avgResolutionTime)}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Métricas por Fila */}
            {metrics.queues && metrics.queues.length > 0 && (
              <div className="bg-bg-elevated rounded-xl border border-border-default p-6 shadow-lg">
                <h2 className="text-xl font-semibold text-text-primary mb-4">
                  Métricas por Fila
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {metrics.queues.map((queue) => (
                    <div key={queue.queueName} className="border border-border-default rounded-xl p-4 bg-bg-secondary">
                      <h3 className="font-semibold text-text-primary mb-2">
                        {queue.queueName}
                      </h3>
                      <div className="text-sm text-text-secondary space-y-1">
                        <div>Total: {queue.totalTickets}</div>
                        <div>Esperando: {queue.waitingTickets}</div>
                        <div>Em Andamento: {queue.inProgressTickets}</div>
                        <div>Fechados: {queue.closedTickets}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      <ToastContainer />
    </div>
  );
}
