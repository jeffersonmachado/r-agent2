import { useEffect, useMemo, useState } from 'react';

export default function ReplayPlayer({ playback, autoPlay = false, emptyMessage = 'Este replay nao possui steps reproduziveis.' }) {
  const playbackSteps = useMemo(() => {
    const steps = Array.isArray(playback?.steps) ? playback.steps : [];
    return steps;
  }, [playback]);

  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(Boolean(autoPlay));
  const [speedMs, setSpeedMs] = useState(1200);

  useEffect(() => {
    setCurrentStepIndex(0);
    setIsPlaying(Boolean(autoPlay));
  }, [playback, autoPlay]);

  useEffect(() => {
    if (!isPlaying || playbackSteps.length === 0) return undefined;

    const timer = setInterval(() => {
      setCurrentStepIndex((index) => {
        if (index >= playbackSteps.length - 1) {
          setIsPlaying(false);
          return index;
        }
        return index + 1;
      });
    }, speedMs);

    return () => clearInterval(timer);
  }, [isPlaying, speedMs, playbackSteps.length]);

  const currentStep = playbackSteps[currentStepIndex] || null;

  if (playbackSteps.length === 0) {
    return <p>{emptyMessage}</p>;
  }

  return (
    <>
      <div className="player-toolbar">
        <button className="primary" onClick={() => setIsPlaying((value) => !value)}>
          {isPlaying ? 'Pausar' : 'Play'}
        </button>
        <button
          className="secondary"
          onClick={() => setCurrentStepIndex((index) => Math.max(0, index - 1))}
          disabled={currentStepIndex <= 0}
        >
          Anterior
        </button>
        <button
          className="secondary"
          onClick={() => setCurrentStepIndex((index) => Math.min(playbackSteps.length - 1, index + 1))}
          disabled={currentStepIndex >= playbackSteps.length - 1}
        >
          Proximo
        </button>
        <button
          className="secondary"
          onClick={() => {
            setCurrentStepIndex(0);
            setIsPlaying(false);
          }}
        >
          Reiniciar
        </button>
        <label className="player-speed">
          Velocidade
          <select value={speedMs} onChange={(event) => setSpeedMs(Number(event.target.value))}>
            <option value={1800}>Lenta</option>
            <option value={1200}>Normal</option>
            <option value={700}>Rapida</option>
          </select>
        </label>
      </div>

      <p className="info-text">
        Etapa {currentStepIndex + 1} de {playbackSteps.length}
      </p>

      {currentStep ? (
        <div className="player-step-card">
          <strong>{currentStep.label}</strong>
          <span>Tipo: {currentStep.type}</span>
          {currentStep.at ? <span>Horario: {new Date(currentStep.at).toLocaleString('pt-BR')}</span> : null}
          {currentStep.selector ? <span>Seletor: {currentStep.selector}</span> : null}
          {currentStep.value !== null && currentStep.value !== undefined && currentStep.value !== '' ? (
            <span>Valor: {String(currentStep.value)}</span>
          ) : null}
        </div>
      ) : null}

      {currentStep?.screenshot ? (
        <div className="player-screenshot-wrap">
          <img className="player-screenshot" src={currentStep.screenshot} alt="Frame do replay" />
        </div>
      ) : null}
    </>
  );
}