# 📊 Adicionar Widget de Mensagens Falhadas no `/chat-humano`

## Opção 1: Card de Alerta (Recomendado - Simples)

Adicione um **5º card** na grid já existente para mostrar mensagens falhadas:

### Código a Adicionar

```jsx
import React, { useMemo, useState, useEffect } from 'react';
import { useRouter } from '../hooks/useRouter';

export function ChatHumanoDashboardPage() {
  const { navigate } = useRouter();
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('');
  
  // ✅ NOVO: Estado para dados de mensagens falhadas
  const [failedMessages, setFailedMessages] = useState({
    pending: 0,
    failed: 0,
    errors: []
  });
  const [loadingMetrics, setLoadingMetrics] = useState(true);

  // ✅ NOVO: Carregar dados de falhas quando componente monta
  useEffect(() => {
    const fetchFailedMessages = async () => {
      try {
        const response = await fetch('/api/support/dashboard', {
          headers: {
            'Authorization': `Bearer ${localStorage.getItem('authToken')}`
          }
        });
        if (response.ok) {
          const data = await response.json();
          setFailedMessages({
            pending: data.outboundPendingCount || 0,
            failed: data.outboundFailedCount || 0,
            errors: data.recentErrors || []
          });
        }
      } catch (err) {
        console.error('Erro ao carregar métricas:', err);
      } finally {
        setLoadingMetrics(false);
      }
    };

    fetchFailedMessages();
    const interval = setInterval(fetchFailedMessages, 30000); // Atualiza a cada 30s
    return () => clearInterval(interval);
  }, []);

  // ... resto do código (features, categories, etc)

  return (
    <div className="support-page">
      <div className="support-header">
        <h1>Dashboard Chat Humano</h1>
        <p>Pilar 1: cockpit operacional para atendimento omnichannel.</p>
      
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

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        {/* Cards Existentes */}
        <div className="bg-bg-elevated rounded-xl border border-border-default p-4 shadow-lg">
          <div className="text-xs text-text-tertiary">Módulos</div>
          <div className="text-2xl font-semibold text-text-primary">{features.length}</div>
          <div className="text-xs text-text-secondary">atalhos do pilar</div>
        </div>
        
        {/* ✅ NOVO: Card de Mensagens Falhadas */}
        <div 
          className={`rounded-xl border p-4 shadow-lg cursor-pointer transition-all ${
            failedMessages.failed > 0 
              ? 'bg-red-50 border-red-300 hover:shadow-xl' 
              : 'bg-bg-elevated border-border-default'
          }`}
          onClick={() => navigate('/inbox')}
        >
          <div className="text-xs text-text-tertiary flex items-center gap-2">
            {failedMessages.failed > 0 ? '⚠️' : '✅'} Mensagens Falhadas
          </div>
          <div className={`text-2xl font-semibold ${failedMessages.failed > 0 ? 'text-red-600' : 'text-text-primary'}`}>
            {failedMessages.failed}
          </div>
          <div className="text-xs text-text-secondary mt-1">
            {failedMessages.pending} pendentes • Clique para ver
          </div>
        </div>

        {/* Cards Existentes continuam... */}
        <div className="bg-bg-elevated rounded-xl border border-border-default p-4 shadow-lg">
          <div className="text-xs text-text-tertiary">Categorias</div>
          <div className="text-2xl font-semibold text-text-primary">{categories.length}</div>
          <div className="text-xs text-text-secondary">grupos de navegação</div>
        </div>
        
        <div className="bg-bg-elevated rounded-xl border border-border-default p-4 shadow-lg">
          <div className="text-xs text-text-tertiary">Core</div>
          <div className="text-2xl font-semibold text-text-primary">Atendimento + Inbox</div>
          <div className="text-xs text-text-secondary">execução diária</div>
        </div>
        
        <div className="bg-bg-elevated rounded-xl border border-border-default p-4 shadow-lg">
          <div className="text-xs text-text-tertiary">Indicadores</div>
          <div className="text-2xl font-semibold text-text-primary">Supervisor + Analytics</div>
          <div className="text-xs text-text-secondary">medição e ajuste</div>
        </div>
      </div>

      {/* ✅ NOVO: Seção de Erros Recentes */}
      {failedMessages.errors.length > 0 && (
        <div className="bg-bg-elevated rounded-xl border border-border-default p-6 mb-6 shadow-lg">
          <h3 className="text-xl font-semibold text-text-primary mb-4 flex items-center gap-2">
            <span>🚨</span>
            <span>Erros Recentes</span>
          </h3>
          <div className="space-y-2">
            {failedMessages.errors.slice(0, 5).map((error, idx) => (
              <div 
                key={idx} 
                className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm cursor-pointer hover:bg-red-100 transition-colors"
                onClick={() => navigate(`/tickets/${error.id}/delivery-failures`)}
              >
                <div className="flex justify-between items-start">
                  <div>
                    <div className="font-mono text-xs text-red-700">{error.id}</div>
                    <div className="text-text-secondary">{error.last_error}</div>
                  </div>
                  <div className="text-xs text-text-tertiary">
                    {error.attempts} tentativas
                  </div>
                </div>
              </div>
            ))}
          </div>
          <button
            onClick={() => navigate('/inbox')}
            className="mt-4 w-full px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors text-sm font-medium"
          >
            Ver Todas as Falhas
          </button>
        </div>
      )}

      {/* Filtros e Grid Existentes continuam... */}
      <div className="bg-bg-elevated rounded-xl border border-border-default p-6 mb-6 shadow-lg">
        <h3 className="text-xl font-semibold text-text-primary mb-6 flex items-center gap-2">
          <span>🔍</span>
          <span>Filtros da Navegação</span>
        </h3>
        {/* ... resto do código */}
      </div>
    </div>
  );
}

export default ChatHumanoDashboardPage;
```

---

## Opção 2: Widget Minimalista (Extra Compacto)

Se quer só um badge pequeno no header:

```jsx
<div className="support-header">
  <div className="flex items-center justify-between">
    <div>
      <h1>Dashboard Chat Humano</h1>
      <p>Pilar 1: cockpit operacional para atendimento omnichannel.</p>
    </div>
    {/* ✅ Badge de Alertas */}
    {failedMessages.failed > 0 && (
      <button
        onClick={() => navigate('/inbox')}
        className="px-4 py-2 bg-red-100 border border-red-300 text-red-700 rounded-lg font-semibold hover:bg-red-200 transition-colors"
      >
        ⚠️ {failedMessages.failed} Mensagens Falhadas
      </button>
    )}
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
```

---

## Opção 3: Seção Dedicada Acima (A Mais Completa)

```jsx
{/* NOVO: Seção de Status Operacional */}
<div className="mb-6">
  <h2 className="text-lg font-semibold text-text-primary mb-3">⚡ Status Operacional</h2>
  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
    {/* Card: Pendentes */}
    <div 
      className="bg-yellow-50 border border-yellow-300 rounded-xl p-4 cursor-pointer hover:shadow-lg transition-all"
      onClick={() => navigate('/inbox')}
    >
      <div className="text-sm text-yellow-700">📋 Pendentes</div>
      <div className="text-3xl font-bold text-yellow-600 mt-2">{failedMessages.pending}</div>
      <div className="text-xs text-yellow-600 mt-1">aguardando envio</div>
    </div>

    {/* Card: Falhadas */}
    <div 
      className={`rounded-xl p-4 cursor-pointer hover:shadow-lg transition-all ${
        failedMessages.failed > 0 
          ? 'bg-red-50 border border-red-300' 
          : 'bg-green-50 border border-green-300'
      }`}
      onClick={() => navigate('/inbox')}
    >
      <div className={`text-sm ${failedMessages.failed > 0 ? 'text-red-700' : 'text-green-700'}`}>
        {failedMessages.failed > 0 ? '🚨 Falhadas' : '✅ Sem Falhas'}
      </div>
      <div className={`text-3xl font-bold mt-2 ${failedMessages.failed > 0 ? 'text-red-600' : 'text-green-600'}`}>
        {failedMessages.failed}
      </div>
      <div className={`text-xs mt-1 ${failedMessages.failed > 0 ? 'text-red-600' : 'text-green-600'}`}>
        {failedMessages.failed > 0 ? 'requerem atenção' : 'operação normal'}
      </div>
    </div>

    {/* Card: Taxa de Sucesso (Calculada) */}
    <div 
      className="bg-blue-50 border border-blue-300 rounded-xl p-4 cursor-pointer hover:shadow-lg transition-all"
      onClick={() => navigate('/analytics')}
    >
      <div className="text-sm text-blue-700">📊 Taxa de Sucesso</div>
      <div className="text-3xl font-bold text-blue-600 mt-2">
        {failedMessages.pending + failedMessages.failed === 0 
          ? '100' 
          : Math.round((failedMessages.pending / (failedMessages.pending + failedMessages.failed)) * 100)}%
      </div>
      <div className="text-xs text-blue-600 mt-1">últimas 24h</div>
    </div>
  </div>
</div>
```

---

## Implementação Passo a Passo

1. **Abra** `frontend/src/pages/ChatHumanoDashboardPage.jsx`

2. **Adicione imports** no topo:
```jsx
import React, { useMemo, useState, useEffect } from 'react';
```

3. **Adicione useState e useEffect**:
```jsx
const [failedMessages, setFailedMessages] = useState({ pending: 0, failed: 0, errors: [] });
const [loadingMetrics, setLoadingMetrics] = useState(true);

useEffect(() => {
  const fetchFailedMessages = async () => {
    try {
      const response = await fetch('/api/support/dashboard', {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('authToken')}` }
      });
      if (response.ok) {
        const data = await response.json();
        setFailedMessages({
          pending: data.outboundPendingCount || 0,
          failed: data.outboundFailedCount || 0,
          errors: data.recentErrors || []
        });
      }
    } catch (err) {
      console.error('Erro:', err);
    } finally {
      setLoadingMetrics(false);
    }
  };
  
  fetchFailedMessages();
  const interval = setInterval(fetchFailedMessages, 30000);
  return () => clearInterval(interval);
}, []);
```

4. **Escolha uma das 3 opções acima** e adicione o JSX no seu `return`

5. **Teste**: `npm run dev` no frontend

---

## Qual Escolher?

| Opção | Quando Usar |
|-------|-----------|
| **Opção 1** (Recomendada) | Dashboard completo com card + seção de erros |
| **Opção 2** | Se quiser apenas um badge/alerta rápido |
| **Opção 3** | Se quiser 3 cards (pendentes, falhadas, taxa de sucesso) |

---

## API que Será Chamada

```bash
GET /api/support/dashboard

Response:
{
  "outboundPendingCount": 0,
  "outboundFailedCount": 3,
  "recentErrors": [
    {
      "id": "outq-1771537081965-443f643ac58b",
      "channel_type": "whatsapp",
      "last_error": "Cannot read properties of undefined",
      "attempts": 4,
      "next_attempt_at": "2026-02-19T21:39:12.977Z",
      "updated_at": "2026-02-19T21:38:36.972Z"
    }
  ]
}
```

Todos os dados já existem na API! 🎯
