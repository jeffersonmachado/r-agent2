/**
 * Sistema de métricas para monitorar eficiência de WebSocket vs Polling
 * 
 * Rastreia:
 * - Número de eventos WebSocket recebidos
 * - Número de requisições HTTP (polling)
 * - Economia de requisições
 * - Status da conexão WebSocket
 */

class WebSocketMetrics {
  constructor() {
    this.metrics = {
      websocketEvents: 0,
      pollingRequests: 0,
      websocketConnected: false,
      startTime: Date.now(),
      lastEventTime: null,
      lastPollingTime: null,
    };
  }

  /**
   * Registra um evento WebSocket recebido
   */
  recordWebSocketEvent(eventType) {
    this.metrics.websocketEvents++;
    this.metrics.lastEventTime = Date.now();
    
    if (process.env.NODE_ENV === 'development') {
      console.debug('[WebSocketMetrics] Evento recebido:', eventType, {
        total: this.metrics.websocketEvents,
        tempoDesdeUltimo: this.metrics.lastEventTime - (this.metrics.lastPollingTime || this.metrics.startTime),
      });
    }
  }

  /**
   * Registra uma requisição HTTP de polling
   */
  recordPollingRequest() {
    this.metrics.pollingRequests++;
    this.metrics.lastPollingTime = Date.now();
    
    if (process.env.NODE_ENV === 'development') {
      console.debug('[WebSocketMetrics] Polling request:', {
        total: this.metrics.pollingRequests,
        economia: this.calculateSavings(),
      });
    }
  }

  /**
   * Atualiza status da conexão WebSocket
   */
  setWebSocketStatus(connected) {
    this.metrics.websocketConnected = connected;
  }

  /**
   * Calcula economia de requisições (estimativa)
   * Assumindo que sem WebSocket, faríamos polling a cada 30s
   */
  calculateSavings() {
    const uptimeMinutes = (Date.now() - this.metrics.startTime) / 60000;
    const estimatedPollingRequests = Math.floor(uptimeMinutes * 2); // 2 requisições por minuto (30s)
    const actualRequests = this.metrics.pollingRequests;
    const savings = estimatedPollingRequests - actualRequests;
    const savingsPercentage = estimatedPollingRequests > 0 
      ? ((savings / estimatedPollingRequests) * 100).toFixed(1)
      : 0;
    
    return {
      estimatedWithoutWebSocket: estimatedPollingRequests,
      actualRequests,
      saved: savings,
      savingsPercentage: `${savingsPercentage}%`,
    };
  }

  /**
   * Obtém métricas atuais
   */
  getMetrics() {
    const uptimeMinutes = ((Date.now() - this.metrics.startTime) / 60000).toFixed(1);
    const savings = this.calculateSavings();
    
    return {
      ...this.metrics,
      uptimeMinutes: parseFloat(uptimeMinutes),
      savings,
      efficiency: {
        websocketEventsPerMinute: (this.metrics.websocketEvents / parseFloat(uptimeMinutes)).toFixed(2),
        pollingRequestsPerMinute: (this.metrics.pollingRequests / parseFloat(uptimeMinutes)).toFixed(2),
      },
    };
  }

  /**
   * Reseta métricas
   */
  reset() {
    this.metrics = {
      websocketEvents: 0,
      pollingRequests: 0,
      websocketConnected: false,
      startTime: Date.now(),
      lastEventTime: null,
      lastPollingTime: null,
    };
  }

  /**
   * Loga métricas resumidas
   */
  logSummary() {
    const metrics = this.getMetrics();
    console.log('[WebSocketMetrics] Resumo:', {
      'Tempo ativo (min)': metrics.uptimeMinutes,
      'Eventos WebSocket': metrics.websocketEvents,
      'Requisições Polling': metrics.pollingRequests,
      'WebSocket conectado': metrics.websocketConnected ? 'Sim' : 'Não',
      'Economia estimada': metrics.savings.saved,
      'Percentual economizado': metrics.savings.savingsPercentage,
      'Eventos/min': metrics.efficiency.websocketEventsPerMinute,
      'Polling/min': metrics.efficiency.pollingRequestsPerMinute,
    });
  }
}

// Instância singleton
const metricsInstance = new WebSocketMetrics();

// Loga métricas periodicamente em desenvolvimento
if (typeof window !== 'undefined' && process.env.NODE_ENV === 'development') {
  // Loga a cada 5 minutos
  setInterval(() => {
    metricsInstance.logSummary();
  }, 5 * 60 * 1000);
  
  // Expõe no console para debug
  if (typeof window !== 'undefined') {
    window.__websocketMetrics = metricsInstance;
  }
}

export default metricsInstance;

