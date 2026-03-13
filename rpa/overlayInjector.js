/**
 * Sistema de Overlay para Replay RPA
 *
 * Injeta um overlay fullscreen com caixa flutuante movimentável
 * que contém botões de controle durante o replay step-by-step.
 */

const OVERLAY_ID = 'rpa-replay-overlay';
const BOX_ID = 'rpa-replay-control-box';
const STORAGE_KEY = 'rpa-overlay-position';
const MARGEM_MINIMA = 12; // Margem mínima nas bordas (estilo iOS)

/**
 * Funções utilitárias para gerenciar posição
 */
function saveOverlayPosition(top, left) {
  try {
    // Verifica se localStorage está disponível antes de tentar acessar
    if (typeof Storage !== 'undefined' && typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ top, left }));
    }
  } catch (e) {
    // Ignora silenciosamente erros de localStorage (comum em contextos restritos)
    // Não loga como erro para não poluir o console
  }
}

function restoreOverlayPosition() {
  try {
    // Verifica se localStorage está disponível antes de tentar acessar
    if (typeof Storage !== 'undefined' && typeof localStorage !== 'undefined') {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        return JSON.parse(saved);
      }
    }
  } catch (e) {
    // Ignora silenciosamente erros de localStorage (comum em contextos restritos)
    // Não loga como erro para não poluir o console
  }
  return null;
}

function centerOverlay() {
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  // Retorna posição do canto superior esquerdo para centralização
  // (será ajustado após a caixa ser renderizada com seu tamanho real)
  return {
    top: viewportHeight / 2,
    left: viewportWidth / 2,
  };
}

/**
 * Aplica snap lateral estilo AssistiveTouch do iOS
 * Calcula o centro horizontal da caixa e fixa na lateral mais próxima
 */
function applyAssistiveTouchSnap(boxElement) {
  const rect = boxElement.getBoundingClientRect();
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const boxWidth = rect.width;
  const boxHeight = rect.height;

  // Calcula o centro horizontal da caixa
  const centerX = rect.left + (boxWidth / 2);

  // Determina qual lateral está mais próxima
  const distanciaEsquerda = centerX;
  const distanciaDireita = viewportWidth - centerX;

  let newLeft;
  if (distanciaEsquerda <= distanciaDireita) {
    // Snap para a esquerda
    newLeft = MARGEM_MINIMA;
  } else {
    // Snap para a direita
    newLeft = viewportWidth - boxWidth - MARGEM_MINIMA;
  }

  // Mantém dentro dos limites verticais
  let newTop = rect.top;
  if (newTop < MARGEM_MINIMA) newTop = MARGEM_MINIMA;
  if (newTop + boxHeight > viewportHeight - MARGEM_MINIMA) {
    newTop = viewportHeight - boxHeight - MARGEM_MINIMA;
  }

  boxElement.style.left = `${newLeft}px`;
  boxElement.style.top = `${newTop}px`;

  saveOverlayPosition(newTop, newLeft);
}

/**
 * Injeta overlay no DOM
 */
function injectOverlay({ onNext, onPrev, onPlay, onPause, onStop, onSpeedChange, onResetSpeed, onClose }) {
  // Remove overlay existente
  removeOverlay();

  // Cria overlay
  const overlay = document.createElement('div');
  overlay.id = OVERLAY_ID;
  overlay.style.position = 'fixed';
  overlay.style.top = '0';
  overlay.style.left = '0';
  overlay.style.width = '100%';
  overlay.style.height = '100%';
  overlay.style.zIndex = '9999';
  overlay.style.pointerEvents = 'none';

  // Cria caixa de controle
  const box = document.createElement('div');
  box.id = BOX_ID;
  box.style.position = 'fixed';
  box.style.background = 'rgba(0, 0, 0, 0.85)';
  box.style.color = '#fff';
  box.style.padding = '12px';
  box.style.borderRadius = '10px';
  box.style.fontFamily = 'Arial, sans-serif';
  box.style.fontSize = '14px';
  box.style.display = 'flex';
  box.style.flexDirection = 'column';
  box.style.gap = '8px';
  box.style.pointerEvents = 'auto';
  box.style.boxShadow = '0 4px 12px rgba(0,0,0,0.35)';

  // Posicionamento inicial (restaura ou centraliza)
  const savedPos = restoreOverlayPosition();
  if (savedPos && typeof savedPos.top === 'number' && typeof savedPos.left === 'number') {
    box.style.top = `${savedPos.top}px`;
    box.style.left = `${savedPos.left}px`;
  } else {
    const center = centerOverlay();
    box.style.top = `${center.top}px`;
    box.style.left = `${center.left}px`;
  }

  // Drag
  let isDragging = false;
  let dragOffsetX = 0;
  let dragOffsetY = 0;

  box.addEventListener('mousedown', (e) => {
    isDragging = true;
    const rect = box.getBoundingClientRect();
    dragOffsetX = e.clientX - rect.left;
    dragOffsetY = e.clientY - rect.top;
  });

  document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    const newLeft = e.clientX - dragOffsetX;
    const newTop = e.clientY - dragOffsetY;
    box.style.left = `${newLeft}px`;
    box.style.top = `${newTop}px`;
  });

  document.addEventListener('mouseup', () => {
    if (!isDragging) return;
    isDragging = false;
    applyAssistiveTouchSnap(box);
  });

  // Botões
  const controls = document.createElement('div');
  controls.style.display = 'flex';
  controls.style.gap = '6px';

  function createButton(label, onClick) {
    const btn = document.createElement('button');
    btn.textContent = label;
    btn.style.padding = '6px 10px';
    btn.style.background = '#1f2937';
    btn.style.color = '#fff';
    btn.style.border = '1px solid #374151';
    btn.style.borderRadius = '6px';
    btn.style.cursor = 'pointer';
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (onClick) onClick();
    });
    return btn;
  }

  controls.appendChild(createButton('⏮️ Prev', onPrev));
  controls.appendChild(createButton('▶️ Play', onPlay));
  controls.appendChild(createButton('⏸️ Pause', onPause));
  controls.appendChild(createButton('⏭️ Next', onNext));
  controls.appendChild(createButton('⏹️ Stop', onStop));

  // Velocidade
  const speedContainer = document.createElement('div');
  speedContainer.style.display = 'flex';
  speedContainer.style.gap = '6px';

  speedContainer.appendChild(createButton('⏩ +', () => onSpeedChange && onSpeedChange(1.5)));
  speedContainer.appendChild(createButton('⏪ -', () => onSpeedChange && onSpeedChange(0.75)));
  speedContainer.appendChild(createButton('🔄 Reset', onResetSpeed));
  speedContainer.appendChild(createButton('❌ Fechar', onClose));

  box.appendChild(controls);
  box.appendChild(speedContainer);

  overlay.appendChild(box);
  document.body.appendChild(overlay);
}

/**
 * Remove overlay do DOM
 */
function removeOverlay() {
  const existing = document.getElementById(OVERLAY_ID);
  if (existing) {
    existing.remove();
  }
}

module.exports = {
  injectOverlay,
  removeOverlay,
};
