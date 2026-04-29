/**
 * Mock API Enabler
 * Add this to window to enable/disable mock API at runtime
 * Usage: window.useMockAPI() or window.disableMockAPI()
 */

window.useMockAPI = function() {
  console.log('[Mock API] Ativando dados mock...');
  localStorage.setItem('USE_MOCK_API', 'true');
  localStorage.setItem('MOCK_API_ENABLED_AT', new Date().toISOString());
  window.location.reload();
};

window.disableMockAPI = function() {
  console.log('[Mock API] Desativando dados mock...');
  localStorage.removeItem('USE_MOCK_API');
  window.location.reload();
};

window.isMockAPIEnabled = function() {
  const enabled = localStorage.getItem('USE_MOCK_API') === 'true';
  return enabled;
};

window.toggleMockAPI = function() {
  if (window.isMockAPIEnabled()) {
    window.disableMockAPI();
  } else {
    window.useMockAPI();
  }
};

// Show status in console
const status = window.isMockAPIEnabled() ? '✅ ATIVADO' : '❌ DESATIVADO';
console.log(`%c[Mock API] Status: ${status}`, 'color: #2563eb; font-weight: bold; font-size: 12px;');
console.log('%cUse window.useMockAPI() para ativar ou window.disableMockAPI() para desativar', 'color: #666; font-size: 11px;');
