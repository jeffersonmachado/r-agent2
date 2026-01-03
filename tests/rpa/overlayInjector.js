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
  
  // Ajusta posição vertical para garantir que não saia da tela
  let newTop = rect.top;
  const maxTop = viewportHeight - boxHeight - MARGEM_MINIMA;
  newTop = Math.max(MARGEM_MINIMA, Math.min(newTop, maxTop));
  
  // Aplica posição final com transição suave
  boxElement.style.transition = 'left 0.3s cubic-bezier(0.4, 0, 0.2, 1), top 0.3s cubic-bezier(0.4, 0, 0.2, 1)';
  boxElement.style.left = `${newLeft}px`;
  boxElement.style.top = `${newTop}px`;
  boxElement.style.transform = 'none';
  
  // Remove transição após animação para permitir drag fluido
  setTimeout(() => {
    boxElement.style.transition = '';
  }, 300);
  
  return { top: newTop, left: newLeft };
}

/**
 * Habilita drag na caixa flutuante
 */
function enableOverlayDrag(boxElement) {
  let isDragging = false;
  let startX = 0;
  let startY = 0;
  let initialTop = 0;
  let initialLeft = 0;
  let hasMoved = false;

  // Header como área de drag
  const header = boxElement.querySelector('.rpa-overlay-header');
  if (!header) return;

  // Previne seleção de texto durante drag
  header.style.userSelect = 'none';
  header.style.webkitUserSelect = 'none';
  header.style.cursor = 'grab';

  const startDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    
    isDragging = true;
    hasMoved = false;
    
    // Obtém posição atual
    const rect = boxElement.getBoundingClientRect();
    initialTop = rect.top + window.scrollY;
    initialLeft = rect.left + window.scrollX;
    
    // Calcula offset do clique
    const clientX = e.clientX || (e.touches && e.touches[0]?.clientX) || 0;
    const clientY = e.clientY || (e.touches && e.touches[0]?.clientY) || 0;
    
    startX = clientX - rect.left;
    startY = clientY - rect.top;
    
    // Remove transform de centralização se existir
    boxElement.style.transform = 'none';
    
    // Atualiza cursor
    header.style.cursor = 'grabbing';
    document.body.style.cursor = 'grabbing';
    
    // Adiciona listeners
    document.addEventListener('mousemove', onDrag);
    document.addEventListener('mouseup', stopDrag);
    document.addEventListener('touchmove', onDrag, { passive: false });
    document.addEventListener('touchend', stopDrag);
  };

  const onDrag = (e) => {
    if (!isDragging) return;
    
    e.preventDefault();
    hasMoved = true;
    
    const clientX = e.clientX || (e.touches && e.touches[0]?.clientX) || 0;
    const clientY = e.clientY || (e.touches && e.touches[0]?.clientY) || 0;
    
    // Calcula nova posição
    let newLeft = clientX - startX;
    let newTop = clientY - startY;
    
    // Restringe aos limites da viewport
    const boxRect = boxElement.getBoundingClientRect();
    const maxLeft = window.innerWidth - boxRect.width;
    const maxTop = window.innerHeight - boxRect.height;
    
    newLeft = Math.max(0, Math.min(newLeft, maxLeft));
    newTop = Math.max(0, Math.min(newTop, maxTop));
    
    // Aplica posição
    boxElement.style.left = `${newLeft}px`;
    boxElement.style.top = `${newTop}px`;
  };

  const stopDrag = (e) => {
    if (!isDragging) return;
    
    isDragging = false;
    header.style.cursor = 'grab';
    document.body.style.cursor = '';
    
    // Aplica snap lateral estilo AssistiveTouch se moveu
    if (hasMoved) {
      const snappedPos = applyAssistiveTouchSnap(boxElement);
      // Salva posição após snap
      saveOverlayPosition(snappedPos.top, snappedPos.left);
    }
    
    // Remove listeners
    document.removeEventListener('mousemove', onDrag);
    document.removeEventListener('mouseup', stopDrag);
    document.removeEventListener('touchmove', onDrag);
    document.removeEventListener('touchend', stopDrag);
  };

  // Adiciona listeners no header
  header.addEventListener('mousedown', startDrag);
  header.addEventListener('touchstart', startDrag, { passive: false });
  
  // Previne drag ao clicar nos botões
  const buttons = boxElement.querySelectorAll('button');
  buttons.forEach(btn => {
    btn.addEventListener('mousedown', (e) => e.stopPropagation());
    btn.addEventListener('touchstart', (e) => e.stopPropagation());
  });
}

/**
 * Cria o overlay e a caixa flutuante
 */
function createOverlay(apiBaseUrl, executionId, authToken = null) {
  // Remove overlay existente se houver
  const existing = document.getElementById(OVERLAY_ID);
  if (existing) {
    existing.remove();
  }

  // Cria overlay fullscreen (apenas bloqueio visual, não centraliza)
  const overlay = document.createElement('div');
  overlay.id = OVERLAY_ID;
  overlay.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0, 0, 0, 0.5);
    z-index: 999999;
    pointer-events: auto;
  `;

    // Adiciona estilos e animações ao documento se ainda não existir
    if (!document.getElementById('rpa-overlay-styles')) {
      const style = document.createElement('style');
      style.id = 'rpa-overlay-styles';
      // Usa concatenação de strings para evitar problemas com template strings aninhados
      style.textContent = '@keyframes rpa-pulse-paused {' +
        '0%, 100% {' +
        '  transform: scale(1);' +
        '  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.15), 0 0 0 0 rgba(245, 158, 11, 0.4);' +
        '}' +
        '50% {' +
        '  transform: scale(1.02);' +
        '  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.15), 0 0 0 8px rgba(245, 158, 11, 0);' +
        '}' +
        '}' +
        '#rpa-replay-control-box {' +
        '  transition: left 0.3s cubic-bezier(0.4, 0, 0.2, 1), top 0.3s cubic-bezier(0.4, 0, 0.2, 1);' +
        '}' +
        '#rpa-replay-control-box.rpa-paused-awaiting-confirmation {' +
        '  animation: rpa-pulse-paused 2s ease-in-out infinite;' +
        '}';
      document.head.appendChild(style);
    }

  // Cria caixa flutuante (tamanho natural, estilo AssistiveTouch)
  const box = document.createElement('div');
  box.id = BOX_ID;
  box.className = 'rpa-paused-awaiting-confirmation'; // Classe para estado pausado
  box.style.cssText = `
    position: fixed;
    background: rgba(255, 255, 255, 0.85);
    backdrop-filter: blur(6px);
    -webkit-backdrop-filter: blur(6px);
    border: 2px solid rgba(0, 0, 0, 0.6);
    border-radius: 8px;
    box-shadow: 0 2px 12px rgba(0, 0, 0, 0.15);
    background-clip: padding-box;
    min-width: 140px;
    width: auto;
    pointer-events: auto;
    user-select: none;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
    z-index: 2147483647;
  `;

  // Restaura posição ou centraliza (sem transform)
  const savedPos = restoreOverlayPosition();
  if (savedPos) {
    // Valida e ajusta posição se necessário (viewport pode ter mudado)
    requestAnimationFrame(() => {
      const rect = box.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      let newTop = savedPos.top;
      let newLeft = savedPos.left;
      
      // Garante que não saia da tela
      const maxLeft = viewportWidth - rect.width - MARGEM_MINIMA;
      const maxTop = viewportHeight - rect.height - MARGEM_MINIMA;
      newLeft = Math.max(MARGEM_MINIMA, Math.min(newLeft, maxLeft));
      newTop = Math.max(MARGEM_MINIMA, Math.min(newTop, maxTop));
      
      box.style.top = `${newTop}px`;
      box.style.left = `${newLeft}px`;
      box.style.transform = 'none';
    });
    // Posição inicial temporária
    box.style.top = `${savedPos.top}px`;
    box.style.left = `${savedPos.left}px`;
    box.style.transform = 'none';
  } else {
    // Posiciona no canto superior esquerdo na primeira execução
    box.style.top = `${MARGEM_MINIMA}px`;
    box.style.left = `${MARGEM_MINIMA}px`;
    box.style.transform = 'none';
  }

  // Header (área de drag)
  const header = document.createElement('div');
  header.className = 'rpa-overlay-header';
  header.style.cssText = `
    padding: 4px 6px;
    border-bottom: 1px solid rgba(0, 0, 0, 0.1);
    background: rgba(0, 0, 0, 0.03);
    border-radius: 6px 6px 0 0;
    cursor: grab;
    display: flex;
    align-items: center;
    justify-content: space-between;
  `;
  
  const headerTitle = document.createElement('div');
  headerTitle.style.cssText = `
    font-weight: 600;
    font-size: 10px;
    color: #333;
    display: flex;
    align-items: center;
    gap: 2px;
  `;
  headerTitle.innerHTML = '⏸️ <span>Replay Pausado</span>';
  header.appendChild(headerTitle);

  // Corpo com botões
  const body = document.createElement('div');
  body.style.cssText = `
    padding: 4px;
    display: flex;
    flex-direction: column;
    gap: 2px;
  `;

  // Função auxiliar para obter headers de autenticação
  // Usa o token passado como parâmetro ou tenta ler do localStorage
  function getAuthHeaders() {
    // Prioriza o token passado como parâmetro
    if (authToken) {
      return { 'Authorization': `Bearer ${authToken}` };
    }
    
    // Fallback para localStorage
    try {
      const token = localStorage.getItem('auth_token');
      if (token) {
        return { 'Authorization': `Bearer ${token}` };
      }
    } catch (e) {
      // Ignora erros de localStorage
    }
    return {};
  }

  // Botão Continuar
  const btnContinue = document.createElement('button');
  btnContinue.textContent = '▶️ Continuar';
  btnContinue.style.cssText = `
    padding: 4px 8px;
    background: #4CAF50;
    color: white;
    border: none;
    border-radius: 3px;
    font-size: 10px;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.2s;
    margin: 0;
  `;
  btnContinue.onmouseover = () => btnContinue.style.background = '#45a049';
  btnContinue.onmouseout = () => btnContinue.style.background = '#4CAF50';
    btnContinue.onclick = async () => {
      try {
        const authHeaders = getAuthHeaders();
        const headers = Object.assign({ 'Content-Type': 'application/json' }, authHeaders);
        const response = await fetch(`${apiBaseUrl}/rpa/execution/${executionId}/continue`, {
          method: 'POST',
          headers: headers,
        });
        if (!response.ok) {
          let errorMessage = 'Erro ao continuar';
          try {
            const errorData = await response.json();
            errorMessage = errorData.message || errorData.error || errorMessage;
          } catch (e) {
            // Ignora erro ao parsear JSON
          }
          throw new Error(errorMessage);
        }
      } catch (error) {
        console.error('Erro ao continuar execução:', error);
        alert('Erro ao continuar execução: ' + (error.message || 'Erro desconhecido'));
      }
    };

  // Botão Próximo
  const btnNext = document.createElement('button');
  btnNext.textContent = '⏭️ Próximo';
  btnNext.style.cssText = `
    padding: 4px 8px;
    background: #2196F3;
    color: white;
    border: none;
    border-radius: 3px;
    font-size: 10px;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.2s;
    margin: 0;
  `;
  btnNext.onmouseover = () => btnNext.style.background = '#0b7dda';
  btnNext.onmouseout = () => btnNext.style.background = '#2196F3';
    btnNext.onclick = async () => {
      try {
        const authHeaders = getAuthHeaders();
        const headers = Object.assign({ 'Content-Type': 'application/json' }, authHeaders);
        const response = await fetch(`${apiBaseUrl}/rpa/execution/${executionId}/next`, {
          method: 'POST',
          headers: headers,
        });
        if (!response.ok) {
          let errorMessage = 'Erro ao executar próximo step';
          try {
            const errorData = await response.json();
            errorMessage = errorData.message || errorData.error || errorMessage;
          } catch (e) {
            // Ignora erro ao parsear JSON
          }
          throw new Error(errorMessage);
        }
      } catch (error) {
        console.error('Erro ao executar próximo step:', error);
        alert('Erro ao executar próximo step: ' + (error.message || 'Erro desconhecido'));
      }
    };

  // Botão Parar
  const btnStop = document.createElement('button');
  btnStop.textContent = '⏹️ Parar';
  btnStop.style.cssText = `
    padding: 4px 8px;
    background: #f44336;
    color: white;
    border: none;
    border-radius: 3px;
    font-size: 10px;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.2s;
    margin: 0;
  `;
  btnStop.onmouseover = () => btnStop.style.background = '#da190b';
  btnStop.onmouseout = () => btnStop.style.background = '#f44336';
    btnStop.onclick = async () => {
      try {
        const authHeaders = getAuthHeaders();
        const headers = Object.assign({ 'Content-Type': 'application/json' }, authHeaders);
        const response = await fetch(`${apiBaseUrl}/rpa/execution/${executionId}/cancel`, {
          method: 'POST',
          headers: headers,
        });
        if (!response.ok) {
          let errorMessage = 'Erro ao cancelar';
          try {
            const errorData = await response.json();
            errorMessage = errorData.message || errorData.error || errorMessage;
          } catch (e) {
            // Ignora erro ao parsear JSON
          }
          throw new Error(errorMessage);
        }
      } catch (error) {
        console.error('Erro ao cancelar execução:', error);
        alert('Erro ao cancelar execução: ' + (error.message || 'Erro desconhecido'));
      }
    };

  body.appendChild(btnNext);
  body.appendChild(btnContinue);
  body.appendChild(btnStop);

  box.appendChild(header);
  box.appendChild(body);
  overlay.appendChild(box);
  document.body.appendChild(overlay);

  // Habilita drag
  enableOverlayDrag(box);

  return overlay;
}

/**
 * Remove o overlay
 */
function removeOverlay() {
  const overlay = document.getElementById(OVERLAY_ID);
  if (overlay) {
    overlay.remove();
  }
}

/**
 * Controla o estado de pausado da caixa flutuante
 * Adiciona ou remove a classe que ativa a animação de pulso
 */
function setPausedState(isPaused) {
  const box = document.getElementById(BOX_ID);
  if (box) {
    if (isPaused) {
      box.classList.add('rpa-paused-awaiting-confirmation');
    } else {
      box.classList.remove('rpa-paused-awaiting-confirmation');
    }
  }
}

/**
 * Script injetável (string para page.evaluate)
 * Inclui todas as funções e constantes necessárias inline
 */
const INJECTABLE_SCRIPT = `
(function() {
  try {
    // Versão do script para debug
    const SCRIPT_VERSION = '2.0.1';
    // Mensagem inicial simplificada
    console.log('[RPA Overlay] Iniciado');
  
  const OVERLAY_ID = 'rpa-replay-overlay';
  const BOX_ID = 'rpa-replay-control-box';
  const STORAGE_KEY = 'rpa-overlay-position';
  const MARGEM_MINIMA = 12;
  
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
    return {
      top: viewportHeight / 2,
      left: viewportWidth / 2,
    };
  }

  function applyAssistiveTouchSnap(boxElement) {
    const rect = boxElement.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const boxWidth = rect.width;
    const boxHeight = rect.height;
    
    const centerX = rect.left + (boxWidth / 2);
    const distanciaEsquerda = centerX;
    const distanciaDireita = viewportWidth - centerX;
    
    let newLeft;
    if (distanciaEsquerda <= distanciaDireita) {
      newLeft = MARGEM_MINIMA;
    } else {
      newLeft = viewportWidth - boxWidth - MARGEM_MINIMA;
    }
    
    let newTop = rect.top;
    const maxTop = viewportHeight - boxHeight - MARGEM_MINIMA;
    newTop = Math.max(MARGEM_MINIMA, Math.min(newTop, maxTop));
    
    // Aplica posição final com transição suave
    boxElement.style.transition = 'left 0.3s cubic-bezier(0.4, 0, 0.2, 1), top 0.3s cubic-bezier(0.4, 0, 0.2, 1)';
    boxElement.style.left = newLeft + 'px';
    boxElement.style.top = newTop + 'px';
    boxElement.style.transform = 'none';
    
    // Remove transição após animação para permitir drag fluido
    setTimeout(function() {
      boxElement.style.transition = '';
    }, 300);
    
    return { top: newTop, left: newLeft };
  }
  
  function setPausedState(isPaused) {
    const box = document.getElementById(BOX_ID);
    if (box) {
      if (isPaused) {
        box.classList.add('rpa-paused-awaiting-confirmation');
      } else {
        box.classList.remove('rpa-paused-awaiting-confirmation');
      }
    }
  }

  function enableOverlayDrag(boxElement) {
    let isDragging = false;
    let startX = 0;
    let startY = 0;
    let hasMoved = false;

    const header = boxElement.querySelector('.rpa-overlay-header');
    if (!header) return;

    header.style.userSelect = 'none';
    header.style.webkitUserSelect = 'none';
    header.style.cursor = 'grab';

    const startDrag = (e) => {
      e.preventDefault();
      e.stopPropagation();
      
      isDragging = true;
      hasMoved = false;
      
      const rect = boxElement.getBoundingClientRect();
      const clientX = e.clientX || (e.touches && e.touches[0]?.clientX) || 0;
      const clientY = e.clientY || (e.touches && e.touches[0]?.clientY) || 0;
      
      startX = clientX - rect.left;
      startY = clientY - rect.top;
      
      boxElement.style.transform = 'none';
      header.style.cursor = 'grabbing';
      document.body.style.cursor = 'grabbing';
      
      document.addEventListener('mousemove', onDrag);
      document.addEventListener('mouseup', stopDrag);
      document.addEventListener('touchmove', onDrag, { passive: false });
      document.addEventListener('touchend', stopDrag);
    };

    const onDrag = (e) => {
      if (!isDragging) return;
      
      e.preventDefault();
      hasMoved = true;
      
      const clientX = e.clientX || (e.touches && e.touches[0]?.clientX) || 0;
      const clientY = e.clientY || (e.touches && e.touches[0]?.clientY) || 0;
      
      let newLeft = clientX - startX;
      let newTop = clientY - startY;
      
      const boxRect = boxElement.getBoundingClientRect();
      const maxLeft = window.innerWidth - boxRect.width;
      const maxTop = window.innerHeight - boxRect.height;
      
      newLeft = Math.max(0, Math.min(newLeft, maxLeft));
      newTop = Math.max(0, Math.min(newTop, maxTop));
      
      boxElement.style.left = newLeft + 'px';
      boxElement.style.top = newTop + 'px';
    };

    const stopDrag = (e) => {
      if (!isDragging) return;
      
      isDragging = false;
      header.style.cursor = 'grab';
      document.body.style.cursor = '';
      
      if (hasMoved) {
        const snappedPos = applyAssistiveTouchSnap(boxElement);
        saveOverlayPosition(snappedPos.top, snappedPos.left);
      }
      
      document.removeEventListener('mousemove', onDrag);
      document.removeEventListener('mouseup', stopDrag);
      document.removeEventListener('touchmove', onDrag);
      document.removeEventListener('touchend', stopDrag);
    };

    header.addEventListener('mousedown', startDrag);
    header.addEventListener('touchstart', startDrag, { passive: false });
    
    const buttons = boxElement.querySelectorAll('button');
    buttons.forEach(btn => {
      btn.addEventListener('mousedown', (e) => e.stopPropagation());
      btn.addEventListener('touchstart', (e) => e.stopPropagation());
    });
  }

  function createOverlay(apiBaseUrl, executionId, authToken) {
    try {
      // Garante que o body esteja disponível
      if (!document.body) {
        setTimeout(function() {
          createOverlay(apiBaseUrl, executionId, authToken);
        }, 100);
        return null;
      }
      
      const existing = document.getElementById(OVERLAY_ID);
      if (existing) {
        existing.remove();
      }

      const overlay = document.createElement('div');
      overlay.id = OVERLAY_ID;
      overlay.style.cssText = 'position: fixed !important; top: 0 !important; left: 0 !important; width: 100% !important; height: 100% !important; background: rgba(0, 0, 0, 0.5) !important; z-index: 2147483647 !important; pointer-events: auto !important; display: block !important; visibility: visible !important; opacity: 1 !important;';

    // Adiciona estilos e animações ao documento se ainda não existir
    if (!document.getElementById('rpa-overlay-styles')) {
      const style = document.createElement('style');
      style.id = 'rpa-overlay-styles';
      // Usa concatenação de strings para evitar problemas com template strings aninhados
      style.textContent = '@keyframes rpa-pulse-paused {' +
        '0%, 100% {' +
        '  transform: scale(1);' +
        '  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.15), 0 0 0 0 rgba(245, 158, 11, 0.4);' +
        '}' +
        '50% {' +
        '  transform: scale(1.02);' +
        '  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.15), 0 0 0 8px rgba(245, 158, 11, 0);' +
        '}' +
        '}' +
        '#rpa-replay-control-box {' +
        '  transition: left 0.3s cubic-bezier(0.4, 0, 0.2, 1), top 0.3s cubic-bezier(0.4, 0, 0.2, 1);' +
        '}' +
        '#rpa-replay-control-box.rpa-paused-awaiting-confirmation {' +
        '  animation: rpa-pulse-paused 2s ease-in-out infinite;' +
        '}';
      document.head.appendChild(style);
    }

    const box = document.createElement('div');
    box.id = BOX_ID;
    box.className = 'rpa-paused-awaiting-confirmation';
    box.style.cssText = 'position: fixed !important; background: rgba(255, 255, 255, 0.85) !important; backdrop-filter: blur(6px) !important; -webkit-backdrop-filter: blur(6px) !important; border: 2px solid rgba(0, 0, 0, 0.6) !important; border-radius: 8px !important; box-shadow: 0 2px 12px rgba(0, 0, 0, 0.15) !important; background-clip: padding-box !important; min-width: 140px !important; width: auto !important; pointer-events: auto !important; user-select: none !important; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen, Ubuntu, Cantarell, sans-serif !important; display: block !important; visibility: visible !important; opacity: 1 !important; z-index: 2147483647 !important;';

    // Tenta restaurar posição salva, mas ignora erro de localStorage
    let savedPos = null;
    try {
      savedPos = restoreOverlayPosition();
    } catch (e) {
      // Ignora silenciosamente - localStorage pode não estar disponível em contextos restritos
      savedPos = null;
    }
    
    if (savedPos && savedPos.top && savedPos.left) {
      box.style.top = savedPos.top + 'px';
      box.style.left = savedPos.left + 'px';
      box.style.transform = 'none';
      
      requestAnimationFrame(function() {
        const rect = box.getBoundingClientRect();
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;
        let newTop = savedPos.top;
        let newLeft = savedPos.left;
        
        const maxLeft = viewportWidth - rect.width - MARGEM_MINIMA;
        const maxTop = viewportHeight - rect.height - MARGEM_MINIMA;
        newLeft = Math.max(MARGEM_MINIMA, Math.min(newLeft, maxLeft));
        newTop = Math.max(MARGEM_MINIMA, Math.min(newTop, maxTop));
        
        box.style.top = newTop + 'px';
        box.style.left = newLeft + 'px';
        box.style.transform = 'none';
      });
    } else {
      box.style.top = MARGEM_MINIMA + 'px';
      box.style.left = MARGEM_MINIMA + 'px';
      box.style.transform = 'none';
    }

    const header = document.createElement('div');
    header.className = 'rpa-overlay-header';
    header.style.cssText = 'padding: 4px 6px; border-bottom: 1px solid rgba(0, 0, 0, 0.1); background: rgba(0, 0, 0, 0.03); border-radius: 6px 6px 0 0; cursor: grab; display: flex; align-items: center; justify-content: space-between;';
    
    const headerTitle = document.createElement('div');
    headerTitle.style.cssText = 'font-weight: 600; font-size: 10px; color: #333; display: flex; align-items: center; gap: 2px;';
    headerTitle.innerHTML = '⏸️ <span>Replay Pausado</span>';
    header.appendChild(headerTitle);

    const body = document.createElement('div');
    body.style.cssText = 'padding: 4px; display: flex; flex-direction: column; gap: 2px;';

    // Função auxiliar para obter headers de autenticação
    // Usa o token passado como parâmetro ou tenta ler do localStorage
    function getAuthHeaders() {
      // Prioriza o token passado como parâmetro
      if (authToken) {
        return { 'Authorization': 'Bearer ' + authToken };
      }
      
      // Fallback para localStorage
      try {
        const token = localStorage.getItem('auth_token');
        if (token) {
          return { 'Authorization': 'Bearer ' + token };
        }
      } catch (e) {
        // Ignora erros de localStorage
      }
      return {};
    }

    const btnContinue = document.createElement('button');
    btnContinue.textContent = '▶️ Continuar';
    btnContinue.style.cssText = 'padding: 4px 8px; background: #4CAF50; color: white; border: none; border-radius: 3px; font-size: 10px; font-weight: 500; cursor: pointer; transition: background 0.2s; margin: 0;';
    btnContinue.onmouseover = () => btnContinue.style.background = '#45a049';
    btnContinue.onmouseout = () => btnContinue.style.background = '#4CAF50';
    btnContinue.onclick = async () => {
      try {
        const authHeaders = getAuthHeaders();
        const headers = Object.assign({ 'Content-Type': 'application/json' }, authHeaders);
        const response = await fetch(apiBaseUrl + '/rpa/execution/' + executionId + '/continue', {
          method: 'POST',
          headers: headers,
        });
        if (!response.ok) {
          let errorMessage = 'Erro ao continuar';
          try {
            const errorData = await response.json();
            errorMessage = errorData.message || errorData.error || errorMessage;
          } catch (e) {
            // Ignora erro ao parsear JSON
          }
          throw new Error(errorMessage);
        }
      } catch (error) {
        console.error('Erro ao continuar execução:', error);
        alert('Erro ao continuar execução: ' + (error.message || 'Erro desconhecido'));
      }
    };

    const btnNext = document.createElement('button');
    btnNext.textContent = '⏭️ Próximo';
    btnNext.style.cssText = 'padding: 4px 8px; background: #2196F3; color: white; border: none; border-radius: 3px; font-size: 10px; font-weight: 500; cursor: pointer; transition: background 0.2s; margin: 0;';
    btnNext.onmouseover = () => btnNext.style.background = '#0b7dda';
    btnNext.onmouseout = () => btnNext.style.background = '#2196F3';
    btnNext.onclick = async () => {
      try {
        const authHeaders = getAuthHeaders();
        const headers = Object.assign({ 'Content-Type': 'application/json' }, authHeaders);
        const response = await fetch(apiBaseUrl + '/rpa/execution/' + executionId + '/next', {
          method: 'POST',
          headers: headers,
        });
        if (!response.ok) {
          let errorMessage = 'Erro ao executar próximo step';
          try {
            const errorData = await response.json();
            errorMessage = errorData.message || errorData.error || errorMessage;
          } catch (e) {
            // Ignora erro ao parsear JSON
          }
          throw new Error(errorMessage);
        }
      } catch (error) {
        console.error('Erro ao executar próximo step:', error);
        alert('Erro ao executar próximo step: ' + (error.message || 'Erro desconhecido'));
      }
    };

    const btnStop = document.createElement('button');
    btnStop.textContent = '⏹️ Parar';
    btnStop.style.cssText = 'padding: 4px 8px; background: #f44336; color: white; border: none; border-radius: 3px; font-size: 10px; font-weight: 500; cursor: pointer; transition: background 0.2s; margin: 0;';
    btnStop.onmouseover = () => btnStop.style.background = '#da190b';
    btnStop.onmouseout = () => btnStop.style.background = '#f44336';
    btnStop.onclick = async () => {
      try {
        const authHeaders = getAuthHeaders();
        const headers = Object.assign({ 'Content-Type': 'application/json' }, authHeaders);
        const response = await fetch(apiBaseUrl + '/rpa/execution/' + executionId + '/cancel', {
          method: 'POST',
          headers: headers,
        });
        if (!response.ok) {
          let errorMessage = 'Erro ao cancelar';
          try {
            const errorData = await response.json();
            errorMessage = errorData.message || errorData.error || errorMessage;
          } catch (e) {
            // Ignora erro ao parsear JSON
          }
          throw new Error(errorMessage);
        }
      } catch (error) {
        console.error('Erro ao cancelar execução:', error);
        alert('Erro ao cancelar execução: ' + (error.message || 'Erro desconhecido'));
      }
    };

      body.appendChild(btnNext);
      body.appendChild(btnContinue);
      body.appendChild(btnStop);

      box.appendChild(header);
      box.appendChild(body);
      overlay.appendChild(box);
      
      if (document.body) {
        document.body.appendChild(overlay);
      } else {
        document.documentElement.appendChild(overlay);
      }

      // Força visibilidade novamente após adicionar ao DOM
      requestAnimationFrame(function() {
        overlay.style.display = 'block';
        overlay.style.visibility = 'visible';
        overlay.style.opacity = '1';
        box.style.display = 'block';
        box.style.visibility = 'visible';
        box.style.opacity = '1';
      });

      // Habilita drag
      enableOverlayDrag(box);

      // Verificação final após um pequeno delay
      setTimeout(function() {
        const finalOverlay = document.getElementById(OVERLAY_ID);
        const finalBox = document.getElementById(BOX_ID);
        
        if (finalOverlay && finalBox) {
          const boxRect = finalBox.getBoundingClientRect();
          const boxComputed = window.getComputedStyle(finalBox);
          
          const isVisible = 
            boxRect.width > 0 && 
            boxRect.height > 0 && 
            boxComputed.display !== 'none' && 
            boxComputed.visibility !== 'hidden' && 
            parseFloat(boxComputed.opacity) > 0;
          
          if (!isVisible) {
            console.warn('[RPA Overlay] Overlay não está visível, forçando visibilidade...');
            finalBox.style.cssText += ' display: block !important; visibility: visible !important; opacity: 1 !important;';
            finalOverlay.style.cssText += ' display: block !important; visibility: visible !important; opacity: 1 !important;';
          } else {
            console.log('[RPA Overlay] Overlay criado e visível');
          }
        } else {
          console.error('[RPA Overlay] ERRO: Overlay ou box não encontrados após criação!');
        }
      }, 100);

      return overlay;
    } catch (error) {
      console.error('[RPA Overlay] ERRO ao criar overlay:', error);
      return null;
    }
  }

  function removeOverlay() {
    const overlay = document.getElementById(OVERLAY_ID);
    if (overlay) {
      overlay.remove();
    }
  }
  
  // Armazena parâmetros para criação automática
  let pendingConfig = null;
  
  // Função para tentar criar overlay automaticamente quando DOM estiver pronto
  function tryAutoCreate() {
    if (!pendingConfig) {
      return;
    }
    
    if (pendingConfig && document.body) {
      const config = pendingConfig;
      pendingConfig = null;
      if (window.rpaOverlay && window.rpaOverlay.create) {
        window.rpaOverlay.create(config.apiBaseUrl, config.executionId, config.authToken);
      }
    }
  }
  
  console.log('[RPA Overlay] Preparando para criar window.rpaOverlay...');
  console.log('[RPA Overlay] Funções disponíveis:', {
    hasCreateOverlay: typeof createOverlay === 'function',
    hasRemoveOverlay: typeof removeOverlay === 'function',
    hasSetPausedState: typeof setPausedState === 'function',
    hasTryAutoCreate: typeof tryAutoCreate === 'function'
  });
  
  try {
    console.log('[RPA Overlay] Criando objeto window.rpaOverlay...');
    window.rpaOverlay = {
    create: function(apiBaseUrl, executionId, authToken) {
      console.log('[RPA Overlay] Criando overlay...');
      
      if (!apiBaseUrl || !executionId) {
        console.error('[RPA Overlay] ❌ ERRO: Parâmetros inválidos!', {
          apiBaseUrl: apiBaseUrl,
          executionId: executionId
        });
        return null;
      }
      
      try {
        const result = createOverlay(apiBaseUrl, executionId, authToken);
        if (result) {
          console.log('[RPA Overlay] Overlay criado com sucesso');
        } else {
          console.warn('[RPA Overlay] createOverlay retornou null');
        }
        return result;
      } catch (error) {
        console.error('[RPA Overlay] ERRO ao chamar createOverlay:', error);
        return null;
      }
    },
    remove: function() {
      console.log('[RPA Overlay] 🗑️ window.rpaOverlay.remove chamado');
      return removeOverlay();
    },
    setPausedState: function(isPaused) {
      console.log('[RPA Overlay] 🎛️ window.rpaOverlay.setPausedState chamado:', isPaused);
      return setPausedState(isPaused);
    },
    // Método para inicializar e criar overlay automaticamente
    init: function(apiBaseUrl, executionId, authToken) {
      console.log('[RPA Overlay] Inicializando...');
      
      if (!apiBaseUrl || !executionId) {
        console.error('[RPA Overlay] ❌ ERRO: Parâmetros inválidos no init!', {
          apiBaseUrl: apiBaseUrl,
          executionId: executionId
        });
        return false;
      }
      
      // Se o DOM estiver pronto (body disponível e estado interactive ou complete), cria imediatamente
      if (document.body && (document.readyState === 'interactive' || document.readyState === 'complete')) {
        const result = window.rpaOverlay.create(apiBaseUrl, executionId, authToken);
        return result !== null;
      } else {
        // Armazena para criar quando DOM estiver pronto
        pendingConfig = { apiBaseUrl, executionId, authToken };
        
        // Tenta criar quando DOM estiver pronto
        if (document.readyState === 'loading') {
          const autoCreateWrapper = function() {
            tryAutoCreate();
          };
          document.addEventListener('DOMContentLoaded', autoCreateWrapper, { once: true });
        } else if (document.readyState === 'interactive' || document.readyState === 'complete') {
          setTimeout(function() {
            tryAutoCreate();
          }, 50);
        } else {
          setTimeout(function() {
            tryAutoCreate();
          }, 100);
        }
        
        return true;
      }
    }
  };
  
    console.log('[RPA Overlay] ✅ window.rpaOverlay criado e pronto para uso');
  } catch (error) {
    console.error('[RPA Overlay] ❌ ERRO ao criar window.rpaOverlay:', error);
    console.error('[RPA Overlay] Stack:', error.stack);
    // Cria um objeto mínimo mesmo em caso de erro
    window.rpaOverlay = {
      error: error.message,
      debug: function() {
        console.error('[RPA Overlay] Script não foi inicializado corretamente:', error.message);
        return { error: error.message };
      }
    };
  }
  
  // Nota: tryAutoCreate() só será chamado quando init() for executado e definir pendingConfig
  // Não chamamos automaticamente aqui para evitar tentativas desnecessárias sem parâmetros
  
  // Adiciona um método de teste manual
  window.rpaOverlay.test = function() {
    console.log('[RPA Overlay] 🧪 TESTE MANUAL: Chamando create com valores de teste...');
    return window.rpaOverlay.create('http://localhost:3000', 'test-execution-id');
  };
  
  // Adiciona método para forçar visibilidade
  window.rpaOverlay.forceVisible = function() {
    const overlay = document.getElementById(OVERLAY_ID);
    const box = document.getElementById(BOX_ID);
    
    if (!overlay || !box) {
      console.error('[RPA Overlay] ❌ Elementos não encontrados!');
      return false;
    }
    
    console.log('[RPA Overlay] 🔧 Forçando visibilidade...');
    
    // Força todos os estilos de visibilidade
    overlay.style.cssText = 'position: fixed !important; top: 0 !important; left: 0 !important; width: 100% !important; height: 100% !important; background: rgba(0, 0, 0, 0.5) !important; z-index: 2147483647 !important; pointer-events: auto !important; display: block !important; visibility: visible !important; opacity: 1 !important;';
    
    // Garante que a box esteja visível no canto superior esquerdo
    box.className = 'rpa-paused-awaiting-confirmation';
    box.style.cssText = 'position: fixed !important; background: rgba(255, 255, 255, 0.85) !important; backdrop-filter: blur(6px) !important; -webkit-backdrop-filter: blur(6px) !important; border: 2px solid rgba(0, 0, 0, 0.6) !important; border-radius: 8px !important; box-shadow: 0 2px 12px rgba(0, 0, 0, 0.15) !important; background-clip: padding-box !important; min-width: 140px !important; width: auto !important; pointer-events: auto !important; user-select: none !important; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen, Ubuntu, Cantarell, sans-serif !important; display: block !important; visibility: visible !important; opacity: 1 !important; z-index: 2147483647 !important; top: ' + MARGEM_MINIMA + 'px !important; left: ' + MARGEM_MINIMA + 'px !important; transform: none !important;';
    
    console.log('[RPA Overlay] ✅ Visibilidade forçada!');
    console.log('[RPA Overlay] Box posicionada em:', { top: MARGEM_MINIMA, left: MARGEM_MINIMA });
    
    // Verifica novamente
    setTimeout(function() {
      const rect = box.getBoundingClientRect();
      console.log('[RPA Overlay] 📊 Após forçar visibilidade:', {
        width: rect.width,
        height: rect.height,
        top: rect.top,
        left: rect.left,
        visible: rect.width > 0 && rect.height > 0
      });
    }, 50);
    
    return true;
  };
  
  // Adiciona método de debug
  window.rpaOverlay.debug = function() {
    const overlay = document.getElementById(OVERLAY_ID);
    const box = document.getElementById(BOX_ID);
    
    if (!overlay || !box) {
      console.error('[RPA Overlay] ❌ Elementos não encontrados!');
      return { overlay: null, box: null };
    }
    
    const overlayRect = overlay.getBoundingClientRect();
    const boxRect = box.getBoundingClientRect();
    const overlayComputed = window.getComputedStyle(overlay);
    const boxComputed = window.getComputedStyle(box);
    
    const debugInfo = {
      overlay: {
        element: overlay,
        rect: {
          top: overlayRect.top,
          left: overlayRect.left,
          width: overlayRect.width,
          height: overlayRect.height,
          bottom: overlayRect.bottom,
          right: overlayRect.right
        },
        styles: {
          display: overlayComputed.display,
          visibility: overlayComputed.visibility,
          opacity: overlayComputed.opacity,
          zIndex: overlayComputed.zIndex,
          position: overlayComputed.position
        },
        inlineStyle: overlay.style.cssText
      },
      box: {
        element: box,
        rect: {
          top: boxRect.top,
          left: boxRect.left,
          width: boxRect.width,
          height: boxRect.height,
          bottom: boxRect.bottom,
          right: boxRect.right
        },
        styles: {
          display: boxComputed.display,
          visibility: boxComputed.visibility,
          opacity: boxComputed.opacity,
          zIndex: boxComputed.zIndex,
          position: boxComputed.position,
          backgroundColor: boxComputed.backgroundColor,
          top: boxComputed.top,
          left: boxComputed.left,
          transform: boxComputed.transform
        },
        inlineStyle: box.style.cssText
      },
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight
      },
      isVisible: boxRect.width > 0 && boxRect.height > 0,
      isInViewport: boxRect.top >= 0 && boxRect.left >= 0 && 
                   boxRect.bottom <= window.innerHeight && 
                   boxRect.right <= window.innerWidth
    };
    
    console.log('[RPA Overlay] 🔍 DEBUG INFO:', debugInfo);
    console.log('[RPA Overlay] 💡 Elementos disponíveis para inspeção:', {
      overlay: overlay,
      box: box
    });
    
    return debugInfo;
  };
  
    console.log('[RPA Overlay] 💡 Dicas:');
    console.log('  - window.rpaOverlay.test() // para testar criação');
    console.log('  - window.rpaOverlay.debug() // para ver estado atual');
    console.log('  - window.rpaOverlay.forceVisible() // para forçar visibilidade');
    console.log('  - document.getElementById("rpa-replay-overlay") // para inspecionar overlay');
    console.log('  - document.getElementById("rpa-replay-control-box") // para inspecionar box');
    
    // Verifica se window.rpaOverlay foi criado
    if (typeof window.rpaOverlay === 'undefined') {
      console.error('[RPA Overlay] ❌ ERRO CRÍTICO: window.rpaOverlay não foi criado!');
      throw new Error('window.rpaOverlay não foi criado');
    }
    
    console.log('[RPA Overlay] ✅ window.rpaOverlay criado com sucesso');
  } catch (error) {
    console.error('[RPA Overlay] ❌ ERRO FATAL ao inicializar script:', error);
    console.error('[RPA Overlay] Stack:', error.stack);
    // Tenta criar um objeto mínimo mesmo em caso de erro
    if (typeof window.rpaOverlay === 'undefined') {
      window.rpaOverlay = {
        error: error.message,
        debug: function() {
          console.error('[RPA Overlay] Script não foi inicializado corretamente:', error.message);
          return { error: error.message };
        }
      };
    }
  }
})();
`;

module.exports = {
  createOverlay,
  removeOverlay,
  setPausedState,
  INJECTABLE_SCRIPT,
  OVERLAY_ID,
  BOX_ID,
};

