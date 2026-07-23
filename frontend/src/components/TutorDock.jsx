/**
 * TutorDock — dica contextual do Learning Core (Tutor nível 1).
 *
 * Assina o evento WebSocket `tutor.hint` (emitido pelo tutorService quando
 * detecta dificuldade na tela atual) e apresenta um cartão discreto com a
 * dica. Não interrompe o trabalho: sem modal, sem bloqueio; fecha com um
 * clique ou sozinho após 60s.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useWebSocketContext } from '../context/WebSocketContext';
import { useRouter } from '../hooks/useRouter';
import logger from '../utils/logger';
import './TutorDock.css';

const AUTO_DISMISS_MS = 60000;

export function TutorDock() {
  const [hint, setHint] = useState(null);
  const timerRef = useRef(null);
  const { navigate } = useRouter();

  const dismiss = useCallback(() => {
    setHint(null);
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const onEvent = useCallback((event, data) => {
    if (event !== 'tutor.hint' || !data || !data.hint) return;
    setHint(data);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setHint(null), AUTO_DISMISS_MS);
  }, []);

  useWebSocketContext({ onEvent, subscribeEvents: ['tutor.hint'] });

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

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
      <div className="tutor-dock-footer">
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
