/**
 * Utilitários para formatação de datas e horas.
 */

/**
 * Formata uma data ISO string para o formato brasileiro com data e hora.
 * @param {string|Date} date - Data em formato ISO string ou objeto Date
 * @param {Object} options - Opções de formatação
 * @param {boolean} options.showTime - Se deve mostrar a hora (padrão: true)
 * @param {boolean} options.showSeconds - Se deve mostrar os segundos (padrão: false)
 * @returns {string} Data formatada no formato "DD/MM/YYYY HH:mm" ou "DD/MM/YYYY HH:mm:ss"
 */
export function formatDateTime(date, options = {}) {
  const { showTime = true, showSeconds = false } = options;
  
  if (!date) return '-';
  
  try {
    const dateObj = typeof date === 'string' ? new Date(date) : date;
    
    if (isNaN(dateObj.getTime())) {
      return '-';
    }
    
    const day = String(dateObj.getDate()).padStart(2, '0');
    const month = String(dateObj.getMonth() + 1).padStart(2, '0');
    const year = dateObj.getFullYear();
    
    if (!showTime) {
      return `${day}/${month}/${year}`;
    }
    
    const hours = String(dateObj.getHours()).padStart(2, '0');
    const minutes = String(dateObj.getMinutes()).padStart(2, '0');
    
    if (showSeconds) {
      const seconds = String(dateObj.getSeconds()).padStart(2, '0');
      return `${day}/${month}/${year} ${hours}:${minutes}:${seconds}`;
    }
    
    return `${day}/${month}/${year} ${hours}:${minutes}`;
  } catch (error) {
    console.error('Erro ao formatar data:', error);
    return '-';
  }
}

/**
 * Formata uma data ISO string para o formato brasileiro apenas com data.
 * @param {string|Date} date - Data em formato ISO string ou objeto Date
 * @returns {string} Data formatada no formato "DD/MM/YYYY"
 */
export function formatDate(date) {
  return formatDateTime(date, { showTime: false });
}

/**
 * Formata uma data ISO string para o formato brasileiro apenas com hora.
 * @param {string|Date} date - Data em formato ISO string ou objeto Date
 * @param {boolean} showSeconds - Se deve mostrar os segundos (padrão: false)
 * @returns {string} Hora formatada no formato "HH:mm" ou "HH:mm:ss"
 */
export function formatTime(date, showSeconds = false) {
  if (!date) return '-';
  
  try {
    const dateObj = typeof date === 'string' ? new Date(date) : date;
    
    if (isNaN(dateObj.getTime())) {
      return '-';
    }
    
    const hours = String(dateObj.getHours()).padStart(2, '0');
    const minutes = String(dateObj.getMinutes()).padStart(2, '0');
    
    if (showSeconds) {
      const seconds = String(dateObj.getSeconds()).padStart(2, '0');
      return `${hours}:${minutes}:${seconds}`;
    }
    
    return `${hours}:${minutes}`;
  } catch (error) {
    console.error('Erro ao formatar hora:', error);
    return '-';
  }
}

/**
 * Retorna uma descrição relativa do tempo (ex: "há 2 horas", "há 3 dias").
 * @param {string|Date} date - Data em formato ISO string ou objeto Date
 * @returns {string} Descrição relativa do tempo
 */
export function formatRelativeTime(date) {
  if (!date) return '-';
  
  try {
    const dateObj = typeof date === 'string' ? new Date(date) : date;
    
    if (isNaN(dateObj.getTime())) {
      return '-';
    }
    
    const now = new Date();
    const diffMs = now.getTime() - dateObj.getTime();
    const diffSeconds = Math.floor(diffMs / 1000);
    const diffMinutes = Math.floor(diffSeconds / 60);
    const diffHours = Math.floor(diffMinutes / 60);
    const diffDays = Math.floor(diffHours / 24);
    const diffMonths = Math.floor(diffDays / 30);
    const diffYears = Math.floor(diffDays / 365);
    
    if (diffSeconds < 60) {
      return 'agora';
    } else if (diffMinutes < 60) {
      return `há ${diffMinutes} ${diffMinutes === 1 ? 'minuto' : 'minutos'}`;
    } else if (diffHours < 24) {
      return `há ${diffHours} ${diffHours === 1 ? 'hora' : 'horas'}`;
    } else if (diffDays < 30) {
      return `há ${diffDays} ${diffDays === 1 ? 'dia' : 'dias'}`;
    } else if (diffMonths < 12) {
      return `há ${diffMonths} ${diffMonths === 1 ? 'mês' : 'meses'}`;
    } else {
      return `há ${diffYears} ${diffYears === 1 ? 'ano' : 'anos'}`;
    }
  } catch (error) {
    console.error('Erro ao formatar tempo relativo:', error);
    return '-';
  }
}
