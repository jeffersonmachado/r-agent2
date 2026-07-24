/**
 * ManualsTab — manuais operacionais ilustrados gerados de replays reais.
 *
 * Usuários veem e baixam os manuais do tenant; admins (owner/admin/super_admin)
 * também podem gerar um novo manual a partir de um replay (QA Waves/RPA).
 * Imagens e o .md são servidos pela API com auth — por isso blob + objectURL.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import * as academyApi from '../../api/academy';
import { Button } from '../../styles/Button';
import logger from '../../utils/logger';

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('pt-BR');
}

function ManualStepImage({ manualId, imagePath, alt }) {
  const [url, setUrl] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let objectUrl = null;
    let cancelled = false;
    academyApi.fetchManualImageBlob(manualId, imagePath)
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch((imageError) => {
        logger.warn('[ManualsTab] falha ao carregar imagem do manual', imageError);
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [manualId, imagePath]);

  if (failed) return <p className="academy-muted">Imagem indisponível.</p>;
  if (!url) return <p className="academy-muted">Carregando imagem…</p>;
  return <img className="academy-manual-step-image" src={url} alt={alt} loading="lazy" />;
}

function ManualCard({ manual }) {
  const [expanded, setExpanded] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const handleDownload = useCallback(async () => {
    setDownloading(true);
    try {
      const blob = await academyApi.fetchManualMarkdownBlob(manual.id);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${manual.title.replace(/[^\w.-]+/g, '-').slice(0, 80) || manual.id}.md`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (downloadError) {
      logger.error('[ManualsTab] falha ao baixar manual', downloadError);
    } finally {
      setDownloading(false);
    }
  }, [manual]);

  return (
    <article className="academy-manual-card" data-testid={`manual-${manual.id}`}>
      <div className="academy-manual-body">
        <h3>{manual.title}</h3>
        <p className="academy-muted">
          {manual.stepCount} passo(s) · {manual.imageCount} tela(s)
          {manual.journeyKey ? ` · jornada ${manual.journeyKey}` : ''}
          {' · '}gerado em {formatDate(manual.createdAt)}
        </p>
      </div>
      <div className="academy-manual-actions">
        <Button onClick={() => setExpanded((value) => !value)}>
          {expanded ? 'Ocultar' : 'Visualizar'}
        </Button>
        <Button onClick={handleDownload} disabled={downloading}>
          {downloading ? 'Baixando…' : 'Baixar .md'}
        </Button>
      </div>
      {expanded && (
        <ol className="academy-manual-steps">
          {(manual.steps || []).map((step) => (
            <li key={step.order} className="academy-manual-step">
              <strong>Passo {step.order} — {step.name}</strong>
              <span className="academy-muted">
                {' '}{step.label}
                {step.success === false ? ' (falhou no replay)' : ''}
              </span>
              {step.image && (
                <ManualStepImage
                  manualId={manual.id}
                  imagePath={step.image}
                  alt={`Passo ${step.order} — ${step.name}`}
                />
              )}
            </li>
          ))}
        </ol>
      )}
    </article>
  );
}

export function ManualsTab({ isAdmin }) {
  const [manuals, setManuals] = useState(null);
  const [replays, setReplays] = useState(null);
  const [selectedReplayId, setSelectedReplayId] = useState('');
  const [title, setTitle] = useState('');
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const loadManuals = useCallback(async () => {
    try {
      const data = await academyApi.getManuals();
      if (mountedRef.current) setManuals(data.manuals || []);
    } catch (loadError) {
      logger.error('[ManualsTab] falha ao carregar manuais', loadError);
      if (mountedRef.current) setError(loadError);
    }
  }, []);

  useEffect(() => {
    loadManuals();
  }, [loadManuals]);

  useEffect(() => {
    if (!isAdmin) return;
    academyApi.getReplays()
      .then((data) => {
        if (!mountedRef.current) return;
        const list = (data.replays || []).filter((replay) => replay.actions > 0);
        setReplays(list);
        if (list.length > 0) setSelectedReplayId((current) => current || list[0].id);
      })
      .catch((replayError) => {
        logger.warn('[ManualsTab] replays indisponíveis', replayError);
        if (mountedRef.current) setReplays([]);
      });
  }, [isAdmin]);

  const handleGenerate = useCallback(async () => {
    if (!selectedReplayId) return;
    setGenerating(true);
    setError(null);
    try {
      const created = await academyApi.generateManualFromReplay(selectedReplayId, title.trim() || undefined);
      if (mountedRef.current) {
        setManuals((current) => [created, ...(current || [])]);
        setTitle('');
      }
    } catch (generateError) {
      logger.error('[ManualsTab] falha ao gerar manual', generateError);
      if (mountedRef.current) setError(generateError);
    } finally {
      if (mountedRef.current) setGenerating(false);
    }
  }, [selectedReplayId, title]);

  return (
    <section aria-label="Manuais operacionais">
      <h2 className="academy-section-title">Manuais operacionais</h2>
      <p className="academy-muted">
        Manuais ilustrados gerados automaticamente a partir de replays reais das jornadas
        (telas capturadas em execução, dados anonimizados).
      </p>

      {isAdmin && (
        <div className="academy-manual-generator" data-testid="manual-generator">
          <h3>Gerar novo manual</h3>
          {replays === null ? (
            <p className="academy-muted">Carregando replays…</p>
          ) : replays.length === 0 ? (
            <p className="academy-muted">Nenhum replay com passos de UI disponível.</p>
          ) : (
            <div className="academy-manual-generator-form">
              <label>
                Replay de origem
                <select
                  value={selectedReplayId}
                  onChange={(event) => setSelectedReplayId(event.target.value)}
                >
                  {replays.map((replay) => (
                    <option key={replay.id} value={replay.id}>
                      {replay.id} — {replay.actions} passo(s), {replay.screens} tela(s)
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Título (opcional)
                <input
                  type="text"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder="Manual — jornada ..."
                  maxLength={120}
                />
              </label>
              <Button onClick={handleGenerate} disabled={generating || !selectedReplayId}>
                {generating ? 'Gerando…' : 'Gerar manual'}
              </Button>
            </div>
          )}
        </div>
      )}

      {error && (
        <p className="academy-state academy-state-error">
          Não foi possível concluir a operação. Tente novamente.
        </p>
      )}

      {manuals === null ? (
        <p className="academy-state">Carregando manuais…</p>
      ) : manuals.length === 0 ? (
        <p className="academy-state">
          Nenhum manual gerado ainda. Manuais são criados a partir de replays
          operacionais reais pela administração da plataforma.
        </p>
      ) : (
        <div className="academy-manuals-list">
          {manuals.map((manual) => (
            <ManualCard key={manual.id} manual={manual} />
          ))}
        </div>
      )}
    </section>
  );
}
