export function shouldLockCanvas(aiGeneration) {
  if (!aiGeneration || typeof aiGeneration !== 'object') return false;
  // Lock deve acontecer apenas quando há alta chance do fluxo precisar de revisão manual.
  // Retentativas (attempts > 1) são comuns durante auto-correção e NÃO devem bloquear edição
  // quando o fluxo final é válido.
  if (aiGeneration.usedFallback === true) return true;
  // Compatível com versões futuras do backend (flag explícita).
  if (aiGeneration.reviewRequired === true) return true;
  return false;
}

