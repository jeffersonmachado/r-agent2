/**
 * Visualização básica de eventos de fallback.
 * 
 * Exibe lista de eventos recentes de fallback:
 * - tipo de fallback
 * - tentativa
 * - nó
 * - timestamp
 * 
 * Read-only, usa logs já existentes.
 */

import React, { useState, useEffect } from 'react';
import logger from '../utils/logger';

export function FallbackEventsViewer() {
  const [events, setEvents] = useState([]);

  useEffect(() => {
    const updateEvents = () => {
      const allLogs = logger.getHistory();
      // Filtra apenas eventos de fallback
      const fallbackEvents = allLogs
        .filter(log => 
          log.message && 
          typeof log.message === 'string' && 
          log.message.includes('[EVENT]') &&
          (log.message.includes('fallback_') || log.data?.eventType?.includes('fallback_'))
        )
        .map(log => {
          // Extrai dados do evento
          const eventType = log.data?.eventType || log.message.match(/\[EVENT\]\s+(\w+)/)?.[1] || 'unknown';
          const payload = log.data || {};
          
          return {
            id: `${log.timestamp}-${eventType}`,
            timestamp: log.timestamp,
            eventType,
            fallbackType: payload.fallbackType || 'unknown',
            attempt: payload.attempt || 1,
            nodeId: payload.nodeId || 'unknown',
            sessionId: payload.sessionId || 'unknown',
            action: payload.action || 'unknown',
            hasLoop: payload.hasLoop || false,
            hasFrustration: payload.hasFrustration || false,
          };
        })
        .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)) // Mais recentes primeiro
        .slice(0, 20); // Últimos 20 eventos
      
      setEvents(fallbackEvents);
    };

    updateEvents();
    const interval = setInterval(updateEvents, 1000);
    return () => clearInterval(interval);
  }, []);

  const getFallbackTypeLabel = (type) => {
    const labels = {
      intent: 'Intenção',
      flow: 'Fluxo',
      data: 'Dados',
      system: 'Sistema',
      timeout: 'Timeout',
      no_match: 'Sem Correspondência',
    };
    return labels[type] || type;
  };

  const getActionLabel = (action) => {
    const labels = {
      retry: 'Tentar Novamente',
      options: 'Opções',
      human: 'Atendimento Humano',
      end: 'Encerrar',
    };
    return labels[action] || action;
  };

  if (events.length === 0) {
    return (
      <div className="fallback-events-viewer-empty">
        <div className="text-sm text-gray-500 dark:text-gray-400">
          Nenhum evento de fallback registrado ainda.
        </div>
      </div>
    );
  }

  return (
    <div className="fallback-events-viewer">
      <div className="fallback-events-viewer-header">
        <h3 className="text-sm font-semibold mb-2">Eventos de Fallback Recentes</h3>
        <div className="text-xs text-gray-500 dark:text-gray-400">
          {events.length} evento(s)
        </div>
      </div>
      
      <div className="fallback-events-viewer-list">
        {events.map((event) => (
          <div key={event.id} className="fallback-events-viewer-item">
            <div className="fallback-events-viewer-item-header">
              <span className="fallback-events-viewer-item-time">
                {new Date(event.timestamp).toLocaleString('pt-BR')}
              </span>
              <span className={`fallback-events-viewer-item-type fallback-type-${event.fallbackType}`}>
                {getFallbackTypeLabel(event.fallbackType)}
              </span>
            </div>
            
            <div className="fallback-events-viewer-item-details">
              <div className="fallback-events-viewer-item-detail">
                <span className="detail-label">Tentativa:</span>
                <span className="detail-value">{event.attempt}</span>
              </div>
              <div className="fallback-events-viewer-item-detail">
                <span className="detail-label">Ação:</span>
                <span className="detail-value">{getActionLabel(event.action)}</span>
              </div>
              <div className="fallback-events-viewer-item-detail">
                <span className="detail-label">Nó:</span>
                <span className="detail-value">{event.nodeId}</span>
              </div>
              {event.hasLoop && (
                <div className="fallback-events-viewer-item-flag flag-loop">
                  🔄 Loop detectado
                </div>
              )}
              {event.hasFrustration && (
                <div className="fallback-events-viewer-item-flag flag-frustration">
                  😤 Frustração detectada
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

