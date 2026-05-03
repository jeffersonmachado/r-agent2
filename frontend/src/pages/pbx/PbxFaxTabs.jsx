import React, { useState, useCallback } from 'react';
import { listCdr } from '../../api/pbx';

const PANEL_CLASS =
  'bg-bg-primary border border-border-default rounded-xl p-6 space-y-4';
const LABEL_CLASS = 'block text-sm font-medium text-text-secondary mb-1';
const INPUT_CLASS =
  'w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary focus:border-transparent transition-all';
const BTN_PRIMARY =
  'px-4 py-2 bg-accent-primary text-white rounded-lg hover:bg-accent-hover transition-colors text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed';

function FaxReportTab() {
  const today = new Date().toISOString().slice(0, 10);
  const monthStart = today.slice(0, 8) + '01';
  const [dateFrom, setDateFrom] = useState(monthStart);
  const [dateTo, setDateTo] = useState(today);
  const [rows, setRows] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const buscar = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Filtra CDR por contexto fax ou canal contendo "fax" (case-insensitive)
      const res = await listCdr({ dateFrom, dateTo, context: 'fax', limit: 500 });
      const data = Array.isArray(res?.data) ? res.data : Array.isArray(res) ? res : [];
      // Filtra localmente por contexto ou canal com "fax"
      const faxRows = data.filter(
        (r) =>
          String(r?.context || '').toLowerCase().includes('fax') ||
          String(r?.channel || '').toLowerCase().includes('fax') ||
          String(r?.dstchannel || '').toLowerCase().includes('fax'),
      );
      setRows(faxRows);
    } catch (e) {
      setError(String(e?.message || 'Erro ao carregar dados'));
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo]);

  const exportCsv = useCallback(() => {
    if (!rows || rows.length === 0) return;
    const headers = ['Data/Hora', 'Origem', 'Destino', 'Duração (s)', 'Status', 'Canal'];
    const lines = rows.map((r) =>
      [
        r.calldate || '',
        r.src || '',
        r.dst || '',
        r.billsec ?? r.duration ?? '',
        r.disposition || '',
        r.channel || '',
      ]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(','),
    );
    const csv = [headers.join(','), ...lines].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `fax_relatorio_${dateFrom}_${dateTo}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [rows, dateFrom, dateTo]);

  return (
    <div className="space-y-6">
      <div className={PANEL_CLASS}>
        <h2 className="text-lg font-semibold text-text-primary">Relatório de Fax</h2>
        <p className="text-sm text-text-secondary">
          Exibe chamadas CDR associadas ao contexto ou canal de fax no período selecionado.
        </p>
        <div className="flex flex-wrap gap-4 items-end">
          <div>
            <label className={LABEL_CLASS}>De</label>
            <input
              type="date"
              className={INPUT_CLASS + ' w-40'}
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
            />
          </div>
          <div>
            <label className={LABEL_CLASS}>Até</label>
            <input
              type="date"
              className={INPUT_CLASS + ' w-40'}
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
            />
          </div>
          <button className={BTN_PRIMARY} onClick={buscar} disabled={loading}>
            {loading ? 'Buscando…' : 'Buscar'}
          </button>
          {rows && rows.length > 0 && (
            <button
              className="px-4 py-2 border border-border-default text-text-primary rounded-lg hover:bg-bg-secondary transition-colors text-sm"
              onClick={exportCsv}
            >
              Exportar CSV
            </button>
          )}
        </div>
        {error && <p className="text-sm text-red-500">{error}</p>}
      </div>

      {rows !== null && (
        <div className={PANEL_CLASS}>
          {rows.length === 0 ? (
            <p className="text-sm text-text-secondary">
              Nenhuma chamada de fax encontrada no período.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-text-secondary border-b border-border-default">
                    <th className="pb-2 pr-4">Data/Hora</th>
                    <th className="pb-2 pr-4">Origem</th>
                    <th className="pb-2 pr-4">Destino</th>
                    <th className="pb-2 pr-4">Duração (s)</th>
                    <th className="pb-2 pr-4">Status</th>
                    <th className="pb-2">Canal</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr
                      key={r.uniqueid || i}
                      className="border-b border-border-default/50 hover:bg-bg-secondary/50 transition-colors"
                    >
                      <td className="py-2 pr-4 text-text-primary">{r.calldate || '—'}</td>
                      <td className="py-2 pr-4 font-mono text-xs">{r.src || '—'}</td>
                      <td className="py-2 pr-4 font-mono text-xs">{r.dst || '—'}</td>
                      <td className="py-2 pr-4">{r.billsec ?? r.duration ?? '—'}</td>
                      <td className="py-2 pr-4">
                        <span
                          className={
                            r.disposition === 'ANSWERED'
                              ? 'text-green-500'
                              : r.disposition === 'BUSY'
                                ? 'text-amber-500'
                                : 'text-red-400'
                          }
                        >
                          {r.disposition || '—'}
                        </span>
                      </td>
                      <td className="py-2 font-mono text-xs text-text-secondary">
                        {r.channel || '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-2 text-xs text-text-secondary">{rows.length} registro(s)</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function FaxConfigTab() {
  return (
    <div className="space-y-6">
      <div className={PANEL_CLASS}>
        <h2 className="text-lg font-semibold text-text-primary">Configuração de Fax</h2>
        <p className="text-sm text-text-secondary leading-relaxed">
          O suporte a fax nesta plataforma é gerenciado via Asterisk com o módulo{' '}
          <strong>res_fax</strong> (ou SpanDSP/T.38). A configuração de hardware (ATA, modem ou
          gateway T.38) é realizada fora da interface web, diretamente nos arquivos de configuração
          do servidor.
        </p>
      </div>

      <div className={PANEL_CLASS}>
        <h3 className="text-base font-semibold text-text-primary mb-3">Parâmetros de referência</h3>
        <div className="space-y-3 text-sm">
          <InfoRow label="Módulo Asterisk" value="res_fax / res_fax_spandsp" />
          <InfoRow label="Protocolo padrão" value="T.38 (sobre SIP/TLS) ou G.711 pass-through" />
          <InfoRow label="Arquivo de configuração" value="/etc/asterisk/res_fax.conf" />
          <InfoRow label="Contexto de recebimento" value="[fax] — configurar no dialplan/IVR" />
          <InfoRow label="Destino de armazenamento" value="/var/spool/asterisk/fax/" />
          <InfoRow
            label="Integração RAP"
            value="Configurar rota de entrada (DID) apontando para contexto fax; relatório disponível na aba Relatório Fax."
          />
        </div>
      </div>

      <div className={PANEL_CLASS}>
        <h3 className="text-base font-semibold text-text-primary mb-2">Como configurar</h3>
        <ol className="list-decimal list-inside space-y-2 text-sm text-text-secondary">
          <li>
            Certifique-se de que o módulo <code className="font-mono text-xs bg-bg-secondary px-1 rounded">res_fax_spandsp.so</code> está carregado em{' '}
            <code className="font-mono text-xs bg-bg-secondary px-1 rounded">modules.conf</code>.
          </li>
          <li>
            Configure <code className="font-mono text-xs bg-bg-secondary px-1 rounded">res_fax.conf</code> com o diretório de spooling e formato de saída (PDF/TIFF).
          </li>
          <li>
            Crie ou edite o contexto <code className="font-mono text-xs bg-bg-secondary px-1 rounded">[fax]</code> no dialplan para receber e processar os faxes recebidos.
          </li>
          <li>
            Associe o DID de fax à rota de entrada via aba <strong>Rotas</strong> ou <strong>IVR</strong>.
          </li>
          <li>
            Após configuração, as chamadas de fax aparecerão no CDR e serão visíveis na aba{' '}
            <strong>Relatório Fax</strong>.
          </li>
        </ol>
      </div>
    </div>
  );
}

function InfoRow({ label, value }) {
  return (
    <div className="flex gap-2">
      <span className="text-text-secondary w-52 flex-shrink-0">{label}:</span>
      <span className="text-text-primary">{value}</span>
    </div>
  );
}

const FAX_TABS = [
  { key: 'faxReport', label: 'Relatório Fax' },
  { key: 'faxConfig', label: 'Configuração Fax' },
];

export function PbxFaxTabs({ tab }) {
  const active = FAX_TABS.some((t) => t.key === tab);
  if (!active) return null;

  return (
    <div className="space-y-4">
      <div className="flex gap-2 border-b border-border-default pb-2">
        {FAX_TABS.map((t) => (
          <span
            key={t.key}
            className={
              tab === t.key
                ? 'px-3 py-1 text-sm rounded-t font-medium text-accent-primary border-b-2 border-accent-primary'
                : 'px-3 py-1 text-sm rounded-t text-text-secondary'
            }
          >
            {t.label}
          </span>
        ))}
      </div>
      {tab === 'faxReport' && <FaxReportTab />}
      {tab === 'faxConfig' && <FaxConfigTab />}
    </div>
  );
}
