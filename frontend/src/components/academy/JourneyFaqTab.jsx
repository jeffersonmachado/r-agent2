/**
 * JourneyFaqTab — perguntas e respostas por jornada, com curadoria do admin.
 *
 * As perguntas são geradas deterministicamente a partir das fontes governadas
 * da jornada (contratos, pré-condições, criticidade, skill graph e cenários
 * aprovados de QA Waves) — nunca de inferência livre. O admin do tenant
 * inclui/exclui cada pergunta; usuários comuns veem apenas as incluídas.
 * O FAQ incluído é consumido pelo Tutor como fonte `curated_faq`.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import * as academyApi from '../../api/academy';
import { Button } from '../../styles/Button';
import logger from '../../utils/logger';

const CATEGORY_LABELS = {
  visao_geral: 'Visão geral',
  execucao: 'Execução',
  pre_condicoes: 'Pré-condições',
  capacidades: 'Capacidades',
  regra_negocio: 'Regra de negócio',
  rotas: 'Telas',
};

const STATUS_LABELS = {
  suggested: 'Sugerida',
  included: 'Incluída',
  excluded: 'Excluída',
};

function FaqItem({ item, isAdmin, onSetStatus, updating }) {
  return (
    <article className="academy-manual-card" data-testid={`faq-${item.id}`}>
      <div className="academy-manual-body">
        <h3>{item.question}</h3>
        <p className="academy-faq-answer">{item.answer}</p>
        <p className="academy-muted">
          {CATEGORY_LABELS[item.category] || item.category}
          {' · '}{STATUS_LABELS[item.status] || item.status}
          {item.current === false ? ' · desatualizada (fonte mudou)' : ''}
          {item.curatedBy ? ` · curadoria de ${item.curatedBy}` : ''}
        </p>
        {Array.isArray(item.sources) && item.sources.length > 0 && (
          <p className="academy-muted">Fontes: {item.sources.join(', ')}</p>
        )}
      </div>
      {isAdmin && (
        <div className="academy-manual-actions">
          {item.status !== 'included' && (
            <Button onClick={() => onSetStatus(item.id, 'included')} disabled={updating}>
              Incluir
            </Button>
          )}
          {item.status !== 'excluded' && (
            <Button onClick={() => onSetStatus(item.id, 'excluded')} disabled={updating}>
              Excluir
            </Button>
          )}
        </div>
      )}
    </article>
  );
}

export function JourneyFaqTab({ isAdmin }) {
  const [journeys, setJourneys] = useState(null);
  const [selectedJourney, setSelectedJourney] = useState('');
  const [items, setItems] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    academyApi.getJourneyFaqSummary()
      .then((data) => {
        if (!mountedRef.current) return;
        const list = data.journeys || [];
        setJourneys(list);
        const withItems = list.find((journey) => journey.total > 0);
        setSelectedJourney((current) => current || (withItems || list[0] || {}).journeyKey || '');
      })
      .catch((loadError) => {
        logger.error('[JourneyFaqTab] falha ao carregar resumo de FAQ', loadError);
        if (mountedRef.current) setError(loadError);
      });
  }, []);

  const loadItems = useCallback(async (journeyKey) => {
    if (!journeyKey) { setItems([]); return; }
    try {
      const data = await academyApi.getJourneyFaq(journeyKey);
      if (mountedRef.current) setItems(data.items || []);
    } catch (loadError) {
      logger.error('[JourneyFaqTab] falha ao carregar FAQ da jornada', loadError);
      if (mountedRef.current) setError(loadError);
    }
  }, []);

  useEffect(() => {
    setItems(null);
    loadItems(selectedJourney);
  }, [selectedJourney, loadItems]);

  const handleGenerate = useCallback(async () => {
    if (!selectedJourney) return;
    setGenerating(true);
    setError(null);
    try {
      const result = await academyApi.generateJourneyFaq(selectedJourney);
      if (mountedRef.current) {
        setItems(result.items || []);
        setJourneys((current) => (current || []).map((journey) => (journey.journeyKey === selectedJourney
          ? { ...journey, total: result.generated, suggested: (journey.suggested || 0) + result.created }
          : journey)));
      }
    } catch (generateError) {
      logger.error('[JourneyFaqTab] falha ao gerar FAQ', generateError);
      if (mountedRef.current) setError(generateError);
    } finally {
      if (mountedRef.current) setGenerating(false);
    }
  }, [selectedJourney]);

  const handleSetStatus = useCallback(async (itemId, status) => {
    setUpdating(true);
    setError(null);
    try {
      const { item } = await academyApi.setJourneyFaqStatus(itemId, status);
      if (mountedRef.current) {
        setItems((current) => (current || []).map((entry) => (entry.id === item.id ? item : entry)));
      }
    } catch (updateError) {
      logger.error('[JourneyFaqTab] falha ao atualizar status do FAQ', updateError);
      if (mountedRef.current) setError(updateError);
    } finally {
      if (mountedRef.current) setUpdating(false);
    }
  }, []);

  return (
    <section aria-label="Perguntas e respostas por jornada">
      <h2 className="academy-section-title">Perguntas &amp; Respostas por jornada</h2>
      <p className="academy-muted">
        Perguntas geradas a partir dos contratos, pré-condições, regras de negócio e
        cenários aprovados de cada jornada. O Tutor responde com as perguntas incluídas
        pela administração.
      </p>

      <div className="academy-manual-generator" data-testid="journey-faq-generator">
        {journeys === null ? (
          <p className="academy-muted">Carregando jornadas…</p>
        ) : (
          <div className="academy-manual-generator-form">
            <label>
              Jornada
              <select
                value={selectedJourney}
                onChange={(event) => setSelectedJourney(event.target.value)}
              >
                {journeys.map((journey) => (
                  <option key={journey.journeyKey} value={journey.journeyKey}>
                    {journey.journeyKey} — {journey.total} pergunta(s)
                    {journey.included > 0 ? `, ${journey.included} incluída(s)` : ''}
                  </option>
                ))}
              </select>
            </label>
            {isAdmin && (
              <Button onClick={handleGenerate} disabled={generating || !selectedJourney}>
                {generating ? 'Gerando…' : 'Gerar/atualizar perguntas'}
              </Button>
            )}
          </div>
        )}
      </div>

      {error && (
        <p className="academy-state academy-state-error">
          Não foi possível concluir a operação. Tente novamente.
        </p>
      )}

      {items === null ? (
        <p className="academy-state">Carregando perguntas…</p>
      ) : items.length === 0 ? (
        <p className="academy-state">
          Nenhuma pergunta disponível para esta jornada
          {isAdmin ? '. Use "Gerar/atualizar perguntas" para criar a partir das fontes governadas.' : ' ainda.'}
        </p>
      ) : (
        <div className="academy-manuals-list">
          {items.map((item) => (
            <FaqItem
              key={item.id}
              item={item}
              isAdmin={isAdmin}
              onSetStatus={handleSetStatus}
              updating={updating}
            />
          ))}
        </div>
      )}
    </section>
  );
}
