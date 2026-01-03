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
    style.textContent = `
      @keyframes rpa-pulse-paused {
        0%, 100% {
          transform: scale(1);
          box-shadow: 0 2px 12px rgba(0, 0, 0, 0.15), 0 0 0 0 rgba(245, 158, 11, 0.4);
        }
        50% {
          transform: scale(1.02);
          box-shadow: 0 2px 12px rgba(0, 0, 0, 0.15), 0 0 0 8px rgba(245, 158, 11, 0);
        }
      }
      #rpa-replay-control-box {
        transition: left 0.3s cubic-bezier(0.4, 0, 0.2, 1), top 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      }
      #rpa-replay-control-box.rpa-paused-awaiting-confirmation {
        animation: rpa-pulse-paused 2s ease-in-out infinite;
      }
    `;
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
  // Versão do script para debug
  const SCRIPT_VERSION = '2.0.1';
  console.log('[RPA Overlay] Script injetável iniciado (v' + SCRIPT_VERSION + ')');
  
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
    console.log('[RPA Overlay] ========== INÍCIO createOverlay ==========');
    console.log('[RPA Overlay] Parâmetros:', { apiBaseUrl, executionId });
    console.log('[RPA Overlay] Estado do documento:', {
      readyState: document.readyState,
      hasBody: !!document.body,
      bodyChildren: document.body ? document.body.children.length : 0,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight
    });
    
    // Garante que o body esteja disponível
    if (!document.body) {
      console.warn('[RPA Overlay] ⚠️ document.body não está disponível, aguardando 100ms...');
      // Tenta aguardar o body estar pronto
      setTimeout(function() {
        console.log('[RPA Overlay] Tentando novamente após delay...');
        createOverlay(apiBaseUrl, executionId);
      }, 100);
      return null; // Retorna null temporariamente, será criado após delay
    }
    
    console.log('[RPA Overlay] ✅ document.body disponível');
    
    const existing = document.getElementById(OVERLAY_ID);
    if (existing) {
      console.log('[RPA Overlay] 🗑️ Removendo overlay existente');
      existing.remove();
    }

    console.log('[RPA Overlay] 📦 Criando elemento overlay...');
    const overlay = document.createElement('div');
    overlay.id = OVERLAY_ID;
    // Aumenta z-index e garante visibilidade
    overlay.style.cssText = 'position: fixed !important; top: 0 !important; left: 0 !important; width: 100% !important; height: 100% !important; background: rgba(0, 0, 0, 0.5) !important; z-index: 2147483647 !important; pointer-events: auto !important; display: block !important; visibility: visible !important; opacity: 1 !important;';
    
    console.log('[RPA Overlay] ✅ Overlay criado:', {
      id: overlay.id,
      tagName: overlay.tagName,
      hasStyle: !!overlay.style,
      styleLength: overlay.style.cssText.length
    });

    // Adiciona estilos e animações ao documento se ainda não existir
    if (!document.getElementById('rpa-overlay-styles')) {
      const style = document.createElement('style');
      style.id = 'rpa-overlay-styles';
      style.textContent = `
        @keyframes rpa-pulse-paused {
          0%, 100% {
            transform: scale(1);
            box-shadow: 0 2px 12px rgba(0, 0, 0, 0.15), 0 0 0 0 rgba(245, 158, 11, 0.4);
          }
          50% {
            transform: scale(1.02);
            box-shadow: 0 2px 12px rgba(0, 0, 0, 0.15), 0 0 0 8px rgba(245, 158, 11, 0);
          }
        }
        #rpa-replay-control-box {
          transition: left 0.3s cubic-bezier(0.4, 0, 0.2, 1), top 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        }
        #rpa-replay-control-box.rpa-paused-awaiting-confirmation {
          animation: rpa-pulse-paused 2s ease-in-out infinite;
        }
      `;
      document.head.appendChild(style);
    }

    console.log('[RPA Overlay] 📦 Criando elemento box...');
    const box = document.createElement('div');
    box.id = BOX_ID;
    box.className = 'rpa-paused-awaiting-confirmation'; // Classe para estado pausado
    // Garante que a caixa seja visível com z-index alto, borda visível e fundo semi-transparente
    box.style.cssText = 'position: fixed !important; background: rgba(255, 255, 255, 0.85) !important; backdrop-filter: blur(6px) !important; -webkit-backdrop-filter: blur(6px) !important; border: 2px solid rgba(0, 0, 0, 0.6) !important; border-radius: 8px !important; box-shadow: 0 2px 12px rgba(0, 0, 0, 0.15) !important; background-clip: padding-box !important; min-width: 140px !important; width: auto !important; pointer-events: auto !important; user-select: none !important; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen, Ubuntu, Cantarell, sans-serif !important; display: block !important; visibility: visible !important; opacity: 1 !important; z-index: 2147483647 !important;';
    
    console.log('[RPA Overlay] ✅ Box criado:', {
      id: box.id,
      tagName: box.tagName
    });

    // Tenta restaurar posição salva, mas ignora erro de localStorage
    let savedPos = null;
    try {
      savedPos = restoreOverlayPosition();
    } catch (e) {
      // Ignora silenciosamente - localStorage pode não estar disponível em contextos restritos
      savedPos = null;
    }
    
    if (savedPos && savedPos.top && savedPos.left) {
      console.log('[RPA Overlay] 📍 Usando posição salva:', savedPos);
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
        console.log('[RPA Overlay] 📍 Posição ajustada:', { top: newTop, left: newLeft });
      });
    } else {
      console.log('[RPA Overlay] 📍 Posicionando caixa no canto superior esquerdo...');
      // Posiciona no canto superior esquerdo na primeira execução
      box.style.top = MARGEM_MINIMA + 'px';
      box.style.left = MARGEM_MINIMA + 'px';
      box.style.transform = 'none';
      
      console.log('[RPA Overlay] 📍 Posição inicial definida:', {
        top: box.style.top,
        left: box.style.left,
        transform: box.style.transform
      });
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

    console.log('[RPA Overlay] 🔗 Montando estrutura DOM...');
    body.appendChild(btnNext);
    body.appendChild(btnContinue);
    body.appendChild(btnStop);
    console.log('[RPA Overlay] ✅ Botões adicionados ao body da caixa');

    box.appendChild(header);
    box.appendChild(body);
    console.log('[RPA Overlay] ✅ Header e body adicionados à box');
    
    overlay.appendChild(box);
    console.log('[RPA Overlay] ✅ Box adicionado ao overlay');
    console.log('[RPA Overlay] Estrutura DOM montada:', {
      overlayChildren: overlay.children.length,
      boxChildren: box.children.length,
      headerExists: !!box.querySelector('.rpa-overlay-header'),
      buttonsCount: box.querySelectorAll('button').length
    });
    
    // Garante que o body esteja pronto antes de adicionar
    console.log('[RPA Overlay] 📍 Adicionando overlay ao DOM...');
    if (document.body) {
      const beforeAppend = document.body.children.length;
      document.body.appendChild(overlay);
      const afterAppend = document.body.children.length;
      console.log('[RPA Overlay] ✅ Overlay adicionado ao body:', {
        beforeAppend,
        afterAppend,
        overlayInBody: document.body.contains(overlay),
        overlayIsLastChild: document.body.lastChild === overlay
      });
    } else {
      console.error('[RPA Overlay] ❌ ERRO: document.body não está disponível para adicionar overlay');
      // Tenta adicionar ao documentElement como fallback
      document.documentElement.appendChild(overlay);
      console.log('[RPA Overlay] ⚠️ Overlay adicionado ao documentElement como fallback');
    }

    // Força visibilidade novamente após adicionar ao DOM
    requestAnimationFrame(function() {
      console.log('[RPA Overlay] 🎨 Aplicando estilos de visibilidade (requestAnimationFrame)...');
      
      overlay.style.display = 'block';
      overlay.style.visibility = 'visible';
      overlay.style.opacity = '1';
      box.style.display = 'block';
      box.style.visibility = 'visible';
      box.style.opacity = '1';
      
      const overlayComputed = window.getComputedStyle(overlay);
      const boxComputed = window.getComputedStyle(box);
      const overlayRect = overlay.getBoundingClientRect();
      const boxRect = box.getBoundingClientRect();
      
      console.log('[RPA Overlay] ✅ Estilos aplicados');
      
      // Logs individuais para facilitar leitura
      console.log('[RPA Overlay] 📊 VERIFICAÇÃO DETALHADA:');
      console.log('  Overlay no DOM:', document.body.contains(overlay) || document.documentElement.contains(overlay));
      console.log('  Box no DOM:', overlay.contains(box));
      console.log('  Overlay Rect:', 'top=' + overlayRect.top, 'left=' + overlayRect.left, 'width=' + overlayRect.width, 'height=' + overlayRect.height);
      console.log('  Box Rect:', 'top=' + boxRect.top, 'left=' + boxRect.left, 'width=' + boxRect.width, 'height=' + boxRect.height);
      console.log('  Overlay Styles:', 'display=' + overlayComputed.display, 'visibility=' + overlayComputed.visibility, 'opacity=' + overlayComputed.opacity, 'zIndex=' + overlayComputed.zIndex);
      console.log('  Box Styles:', 'display=' + boxComputed.display, 'visibility=' + boxComputed.visibility, 'opacity=' + boxComputed.opacity, 'zIndex=' + boxComputed.zIndex, 'position=' + boxComputed.position);
      console.log('  Box Background:', boxComputed.backgroundColor);
      console.log('  Viewport:', 'width=' + window.innerWidth, 'height=' + window.innerHeight);
      
      // Verifica se está dentro da viewport
      const boxInViewport = boxRect.top >= 0 && boxRect.left >= 0 && 
                           boxRect.bottom <= window.innerHeight && 
                           boxRect.right <= window.innerWidth;
      console.log('  Box dentro da viewport?', boxInViewport);
      
      if (boxRect.width === 0 || boxRect.height === 0) {
        console.error('[RPA Overlay] ❌ PROBLEMA: Box tem dimensões ZERO!', {
          width: boxRect.width,
          height: boxRect.height
        });
      }
      
      if (!boxInViewport) {
        console.warn('[RPA Overlay] ⚠️ Box está FORA da viewport!', {
          boxTop: boxRect.top,
          boxLeft: boxRect.left,
          boxBottom: boxRect.bottom,
          boxRight: boxRect.right,
          viewportHeight: window.innerHeight,
          viewportWidth: window.innerWidth
        });
      }
      
      // Log completo como objeto também
      console.log('[RPA Overlay] 📊 Objeto completo:', {
        overlayInDOM: document.body.contains(overlay) || document.documentElement.contains(overlay),
        boxInDOM: overlay.contains(box),
        overlayRect: {
          top: overlayRect.top,
          left: overlayRect.left,
          width: overlayRect.width,
          height: overlayRect.height
        },
        boxRect: {
          top: boxRect.top,
          left: boxRect.left,
          width: boxRect.width,
          height: boxRect.height,
          bottom: boxRect.bottom,
          right: boxRect.right
        },
        overlayStyles: {
          display: overlayComputed.display,
          visibility: overlayComputed.visibility,
          opacity: overlayComputed.opacity,
          zIndex: overlayComputed.zIndex,
          position: overlayComputed.position
        },
        boxStyles: {
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
        viewport: {
          width: window.innerWidth,
          height: window.innerHeight
        },
        boxInViewport: boxInViewport
      });
      
      // Verifica se há elementos bloqueando
      const allElements = document.querySelectorAll('*');
      let blockingElements = [];
      allElements.forEach(function(el) {
        if (el === overlay || el === box || overlay.contains(el)) return;
        const style = window.getComputedStyle(el);
        const zIndex = parseInt(style.zIndex) || 0;
        if (zIndex > 1000000 && style.position !== 'static') {
          blockingElements.push({
            tag: el.tagName,
            id: el.id,
            className: el.className,
            zIndex: zIndex
          });
        }
      });
      
      if (blockingElements.length > 0) {
        console.warn('[RPA Overlay] ⚠️ Elementos com z-index alto encontrados (podem estar bloqueando):', blockingElements.slice(0, 5));
      }
    });

    // Habilita drag
    enableOverlayDrag(box);

    // Verificação final após um pequeno delay
    setTimeout(function() {
      console.log('[RPA Overlay] 🔍 Verificação final após 100ms...');
      const finalOverlay = document.getElementById(OVERLAY_ID);
      const finalBox = document.getElementById(BOX_ID);
      
      if (finalOverlay && finalBox) {
        const boxRect = finalBox.getBoundingClientRect();
        const overlayRect = finalOverlay.getBoundingClientRect();
        const boxComputed = window.getComputedStyle(finalBox);
        const overlayComputed = window.getComputedStyle(finalOverlay);
        
        const isVisible = 
          boxRect.width > 0 && 
          boxRect.height > 0 && 
          boxComputed.display !== 'none' && 
          boxComputed.visibility !== 'hidden' && 
          parseFloat(boxComputed.opacity) > 0;
        
        // Log detalhado expandido com valores individuais
      console.log('[RPA Overlay] ✅ VERIFICAÇÃO FINAL:');
      console.log('  Overlay existe:', !!finalOverlay);
      console.log('  Box existe:', !!finalBox);
      console.log('  Overlay Rect:', 'top=' + overlayRect.top, 'left=' + overlayRect.left, 'width=' + overlayRect.width, 'height=' + overlayRect.height);
      console.log('  Box Rect:', 'top=' + boxRect.top, 'left=' + boxRect.left, 'width=' + boxRect.width, 'height=' + boxRect.height, 'bottom=' + boxRect.bottom, 'right=' + boxRect.right);
      console.log('  Box Styles:', 'display=' + boxComputed.display, 'visibility=' + boxComputed.visibility, 'opacity=' + boxComputed.opacity, 'zIndex=' + boxComputed.zIndex);
      console.log('  Box Position:', 'top=' + boxComputed.top, 'left=' + boxComputed.left, 'transform=' + boxComputed.transform);
      console.log('  Box Background:', boxComputed.backgroundColor);
      console.log('  Viewport:', 'width=' + window.innerWidth, 'height=' + window.innerHeight);
      
      const boxInViewport = boxRect.top >= 0 && boxRect.left >= 0 && 
                           boxRect.bottom <= window.innerHeight && 
                           boxRect.right <= window.innerWidth;
      console.log('  Box dentro da viewport?', boxInViewport);
      console.log('  Box visível?', isVisible);
      
      const logData = {
        overlayExists: !!finalOverlay,
        boxExists: !!finalBox,
        overlayRect: {
          top: overlayRect.top,
          left: overlayRect.left,
          width: overlayRect.width,
          height: overlayRect.height,
          visible: overlayRect.width > 0 && overlayRect.height > 0,
          bottom: overlayRect.bottom,
          right: overlayRect.right
        },
        boxRect: {
          top: boxRect.top,
          left: boxRect.left,
          width: boxRect.width,
          height: boxRect.height,
          visible: boxRect.width > 0 && boxRect.height > 0,
          bottom: boxRect.bottom,
          right: boxRect.right
        },
        boxStyles: {
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
        overlayStyles: {
          display: overlayComputed.display,
          visibility: overlayComputed.visibility,
          opacity: overlayComputed.opacity,
          zIndex: overlayComputed.zIndex,
          position: overlayComputed.position
        },
        isVisible: isVisible,
        viewport: {
          width: window.innerWidth,
          height: window.innerHeight
        },
        boxInViewport: boxInViewport
      };
      
      console.log('[RPA Overlay] ✅ Objeto completo:', logData);
      
      // Log visual no console
      if (isVisible && logData.boxInViewport) {
        console.log('%c[RPA Overlay] ✅✅✅ OVERLAY DEVE ESTAR VISÍVEL! ✅✅✅', 
          'background: #4CAF50; color: white; font-size: 16px; font-weight: bold; padding: 10px;');
      } else {
        console.warn('%c[RPA Overlay] ⚠️⚠️⚠️ OVERLAY PODE NÃO ESTAR VISÍVEL ⚠️⚠️⚠️', 
          'background: #ff9800; color: white; font-size: 16px; font-weight: bold; padding: 10px;');
        if (!logData.boxInViewport) {
          console.warn('[RPA Overlay] ❌ Box está FORA da viewport!', {
            boxTop: boxRect.top,
            boxLeft: boxRect.left,
            viewportHeight: window.innerHeight,
            viewportWidth: window.innerWidth
          });
        }
      }
        
        if (!isVisible) {
          console.error('[RPA Overlay] ❌ PROBLEMA: Box não está visível!', {
            width: boxRect.width,
            height: boxRect.height,
            display: boxComputed.display,
            visibility: boxComputed.visibility,
            opacity: boxComputed.opacity
          });
          
          // Tenta forçar visibilidade novamente
          console.log('[RPA Overlay] 🔧 Tentando forçar visibilidade...');
          finalBox.style.cssText += ' display: block !important; visibility: visible !important; opacity: 1 !important;';
          finalOverlay.style.cssText += ' display: block !important; visibility: visible !important; opacity: 1 !important;';
        } else {
          console.log('[RPA Overlay] ✅ Box está visível!');
        }
      } else {
        console.error('[RPA Overlay] ❌ ERRO CRÍTICO: Elementos não encontrados após criação!', {
          overlayExists: !!finalOverlay,
          boxExists: !!finalBox,
          overlayById: !!document.getElementById(OVERLAY_ID),
          boxById: !!document.getElementById(BOX_ID)
        });
      }
      
      console.log('[RPA Overlay] ========== FIM createOverlay ==========');
      
      // Adiciona comando para inspecionar elementos no console
      console.log('[RPA Overlay] 💡 Para inspecionar manualmente, use:');
      console.log('  - document.getElementById("rpa-replay-overlay")');
      console.log('  - document.getElementById("rpa-replay-control-box")');
      console.log('  - window.rpaOverlay.debug() // para ver estado atual');
    }, 100);

    return overlay;
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
    // Verificação rápida: se não há pendingConfig, não faz nada (evita logs desnecessários)
    if (!pendingConfig) {
      // Silenciosamente retorna - init() ainda não foi chamado
      // Isso previne logs desnecessários quando a função é chamada antes de init()
      return;
    }
    
    const hasPendingConfig = !!pendingConfig;
    const hasBody = !!document.body;
    const readyState = document.readyState;
    
    console.log('[RPA Overlay] 🔄 tryAutoCreate() chamado');
    console.log('[RPA Overlay] 📊 Estado atual:', {
      hasPendingConfig: hasPendingConfig,
      hasBody: hasBody,
      readyState: readyState
    });
    
    if (pendingConfig && document.body) {
      console.log('[RPA Overlay] 🔄 Tentando criar overlay automaticamente...', {
        apiBaseUrl: pendingConfig.apiBaseUrl,
        executionId: pendingConfig.executionId
      });
      const config = pendingConfig;
      pendingConfig = null; // Limpa para evitar múltiplas criações
      const result = window.rpaOverlay.create(config.apiBaseUrl, config.executionId, config.authToken);
      console.log('[RPA Overlay] ✅ Overlay criado automaticamente:', result !== null);
    } else {
      if (!hasBody) {
        console.log('[RPA Overlay] ⚠️ Não foi possível criar overlay: document.body ainda não está disponível');
      } else {
        console.log('[RPA Overlay] ⚠️ Não foi possível criar overlay: condição não atendida');
      }
    }
  }
  
  window.rpaOverlay = {
    create: function(apiBaseUrl, executionId, authToken) {
      console.log('[RPA Overlay] ========================================');
      console.log('[RPA Overlay] 🚀 window.rpaOverlay.create CHAMADO!');
      console.log('[RPA Overlay] Parâmetros recebidos:', {
        apiBaseUrl: apiBaseUrl,
        executionId: executionId,
        authToken: authToken ? '***' : null,
        apiBaseUrlType: typeof apiBaseUrl,
        executionIdType: typeof executionId
      });
      
      if (!apiBaseUrl || !executionId) {
        console.error('[RPA Overlay] ❌ ERRO: Parâmetros inválidos!', {
          apiBaseUrl: apiBaseUrl,
          executionId: executionId
        });
        return null;
      }
      
      const result = createOverlay(apiBaseUrl, executionId, authToken);
      console.log('[RPA Overlay] Resultado de createOverlay:', result);
      return result;
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
      console.log('[RPA Overlay] 🔧 window.rpaOverlay.init chamado');
      console.log('[RPA Overlay] 📋 Parâmetros recebidos no init:', {
        apiBaseUrl: apiBaseUrl,
        executionId: executionId,
        apiBaseUrlType: typeof apiBaseUrl,
        executionIdType: typeof executionId,
        hasBody: !!document.body,
        readyState: document.readyState
      });
      
      if (!apiBaseUrl || !executionId) {
        console.error('[RPA Overlay] ❌ ERRO: Parâmetros inválidos no init!', {
          apiBaseUrl: apiBaseUrl,
          executionId: executionId
        });
        return false;
      }
      
      // Se o DOM estiver pronto (body disponível e estado interactive ou complete), cria imediatamente
      if (document.body && (document.readyState === 'interactive' || document.readyState === 'complete')) {
        console.log('[RPA Overlay] ✅ DOM pronto, criando overlay imediatamente...');
        const result = window.rpaOverlay.create(apiBaseUrl, executionId, authToken);
        console.log('[RPA Overlay] ✅ init() concluído, resultado:', result !== null);
        return result !== null;
      } else {
        // Armazena para criar quando DOM estiver pronto
        console.log('[RPA Overlay] ⏳ DOM não está pronto, aguardando...', {
          hasBody: !!document.body,
          readyState: document.readyState
        });
        pendingConfig = { apiBaseUrl, executionId, authToken };
        
        // Tenta criar quando DOM estiver pronto
        if (document.readyState === 'loading') {
          console.log('[RPA Overlay] 📌 Adicionando listener para DOMContentLoaded');
          // Usa uma função wrapper para poder remover o listener depois se necessário
          const autoCreateWrapper = function() {
            tryAutoCreate();
          };
          document.addEventListener('DOMContentLoaded', autoCreateWrapper, { once: true });
        } else if (document.readyState === 'interactive' || document.readyState === 'complete') {
          // DOM já está pronto, tenta criar imediatamente
          console.log('[RPA Overlay] ✅ DOM já está pronto, tentando criar imediatamente...');
          setTimeout(function() {
            tryAutoCreate();
          }, 50);
        } else {
          // Estado desconhecido, aguarda um pouco
          console.log('[RPA Overlay] ⏱️ Estado desconhecido, aguardando 100ms...');
          setTimeout(function() {
            tryAutoCreate();
          }, 100);
        }
        
        return true;
      }
    }
  };
  
  console.log('[RPA Overlay] ✅ window.rpaOverlay criado:', {
    hasCreate: typeof window.rpaOverlay.create === 'function',
    hasRemove: typeof window.rpaOverlay.remove === 'function',
    createType: typeof window.rpaOverlay.create
  });
  
  // Teste: verifica se pode criar overlay imediatamente (apenas para debug)
  console.log('[RPA Overlay] 🔍 Verificando ambiente...');
  if (document.body && typeof window.rpaOverlay.create === 'function') {
    console.log('[RPA Overlay] ✅ Ambiente OK: Função create está disponível e body está pronto');
  } else {
    console.warn('[RPA Overlay] ⚠️ Aviso: Ambiente pode não estar pronto', {
      hasCreate: typeof window.rpaOverlay.create === 'function',
      hasBody: !!document.body,
      readyState: document.readyState
    });
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

