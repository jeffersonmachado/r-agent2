# Replay Engine

Replay engine responsibilities:

- record deterministic browser/RPA flows
- execute replay steps
- generate evidence and diffs
- link QA journeys to replay artifacts
- validate provenance/integrity
- support visual replay inspection

## Canonical sources

- `core/rpa/replaySystem.js`
- `core/rpa/player/rpaPlayer.js`
- `core/rpa/recorder/rpaRecorder.js`
- `core/rpa/deterministic/index.js`
- `lib/replaySystem.js`
- `tests/rpa/COMO_USAR_REPLAY.md`
- `tests/rpa/SISTEMA_REPLAY.md`
- `docs/COMO_VER_REPLAY_VISUAL.md`
- `docs/rpa-reliability-handbook/01-architecture.md`
- `docs/rpa-reliability-handbook/12-api-and-replay-contract.md`

## Player reutilizável de replay (frontend, 2026-08-25)

- Componente único e consistente: `frontend/src/components/replay/`:
  - `ReplayPlayer.jsx` — player passo a passo (navegação, autoplay + velocidade, "Somente falhas", "Ir para erro", material de treinamento, seções de evidência: timeline/mutation diff/side effects/snapshots). Props: `steps`, `typedEntries`, `assertions`, `evidence`, `onStepChange`, `focusStepAt`.
  - `replayNormalizer.js` — normaliza os 3 formatos (QA Mesh, RPA browser, QA Waves) para o esquema comum de passos; também `normalizeReplayEvidence` e `normalizeTypedEntries`/`normalizeAssertions`.
  - `index.js` — barrel export.
- Consumidores: `QaMeshPage.jsx` (botão Replay → modal) e `RpaReplaysPage.jsx` (modo ▶️ Play, com sync bidirecional via `onStepChange`/`focusStepAt` por timestamp).
- O `ReplaySystem` (`lib/replaySystem.js`) tem opção `enabled` (default `true`); serviços backend usam `enabled: false` por padrão (ver `AI_MEMORY/replay-governance.md`).

