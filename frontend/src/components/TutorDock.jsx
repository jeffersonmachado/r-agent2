/**
 * TutorDock — ajuda contextual do Learning Core (Tutor níveis 1-4).
 *
 * Assina o evento WebSocket `tutor.hint` (nível 1, proativo — emitido pelo
 * tutorService quando detecta dificuldade na tela atual) e apresenta um
 * cartão discreto com a dica. A partir da dica, o usuário pode escalar o
 * nível de ajuda sob demanda:
 *   2 — Explicar (explicação detalhada da tela via RAG);
 *   3 — Passo a passo (guia baseado no material de treinamento de replays);
 *   4 — Demonstração (cenários sintéticos do Simulation Engine).
 *
 * Não interrompe o trabalho: sem modal, sem bloqueio; fecha com um clique
 * ou sozinho após 60s.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useWebSocketContext } from '../context/WebSocketContext';
import { useRouter } from '../hooks/useRouter';
import * as academyApi from '../api/academy';
import logger from '../utils/logger';
import './TutorDock.css';

const AUTO_DISMISS_MS = 60000;

const LEVEL_ACTIONS = [
  { level: 2, label: 'Explicar' },
  { level: 3, label: 'Passo a passo' },
  { level: 4, label: 'Demonstração' },
];

export function TutorDock() {
  const [hint, setHint] = useState(null);
  const [escalated, setEscalated] = useState(null);
  const [escalating, setEscalating] = useState(null);
  const timerRef = useRef(null);
  const { navigate } = useRouter();

  const dismiss = useCallback(() => {
    setHint(null);
    setEscalated(null);
    setEscalating(null);
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const onEvent = useCallback((event, data) => {
    if (event !== 'tutor.hint' || !data || !data.hint) return;
    setHint(data);
    setEscalated(null);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setHint(null), AUTO_DISMISS_MS);
  }, []);

  useWebSocketContext({ onEvent, subscribeEvents: ['tutor.hint'] });

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  const handleEscalate = useCallback(async (level) => {
    if (!hint || !hint.route) return;
    setEscalating(level);
    try {
      const result = await academyApi.requestTutorHelp(hint.route, level);
      setEscalated(result);
    } catch (escalateError) {
      logger.warn('[TutorDock] falha ao escalar nível do tutor', { level, error: escalateError.message });
      setEscalated({ level, available: false, reason: 'request_failed' });
    } finally {
      setEscalating(null);
    }
  }, [hint]);

  if (!hint) return null;

  return (
    <aside className="tutor-dock" role="status" aria-live="polite" data-testid="tutor-dock">
      <div className="tutor-dock-header">
        <span className="tutor-dock-badge">Tutor</span>
        <span className="tutor-dock-route">{hint.route}</span>
        <button
          type="button"
          className="tutor-dock-close"
          aria-label="Fechar dica"
          onClick={dismiss}
        >
          ×
        </button>
      </div>
      <p className="tutor-dock-text">{hint.hint}</p>

      {escalated && (
        <div className="tutor-dock-escalated" data-testid="tutor-dock-escalated">
          {escalated.available && escalated.content && escalated.content.text && (
            <p className="tutor-dock-text">{escalated.content.text}</p>
          )}
          {escalated.available && escalated.content && Array.isArray(escalated.content.demonstrations) && (
            <ul className="tutor-dock-demo-list">
              {escalated.content.demonstrations.map((demo) => (
                <li key={demo.id}>
                  {demo.journeyKey} — {demo.seedType} (persona {demo.personaKey})
                </li>
              ))}
            </ul>
          )}
          {!escalated.available && (
            <p className="tutor-dock-text tutor-dock-unavailable">
              {escalated.reason === 'no_simulations'
                ? 'Ainda não há demonstrações geradas para esta jornada.'
                : 'Ajuda detalhada indisponível no momento. Tente novamente em instantes.'}
            </p>
          )}
        </div>
      )}

      <div className="tutor-dock-footer">
        {LEVEL_ACTIONS.map((action) => (
          <button
            key={action.level}
            type="button"
            className="tutor-dock-link"
            disabled={escalating !== null}
            onClick={() => handleEscalate(action.level)}
          >
            {escalating === action.level ? 'Carregando…' : action.label}
          </button>
        ))}
        <button
          type="button"
          className="tutor-dock-link"
          onClick={() => {
            logger.debug('[TutorDock] navegando para Academy a partir de hint', { route: hint.route });
            dismiss();
            navigate('/academy');
          }}
        >
          Ver minha evolução
        </button>
      </div>
    </aside>
  );
}
