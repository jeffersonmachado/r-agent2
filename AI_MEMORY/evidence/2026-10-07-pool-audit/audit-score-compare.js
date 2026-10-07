'use strict';
/** Compara o SCORE que o Router calcula hoje (evidencia contaminada) vs evidencia limpa, usando o modulo REAL. */
const { scoreModel } = require('/opt/results/ria/r-agent2/engine/engineeringRouter/modelDecision');
const j = require('/tmp/audit-evidence.json');
const hoje = new Map(j.asIs);
const limpo = new Map(j.clean);
const keys = [...new Set([...hoje.keys(), ...limpo.keys()])].sort();
const COST = {
  'anthropic:claude-sonnet-5': 'MEDIUM', 'anthropic:claude-opus-5': 'HIGH',
  'deepseek:deepseek-flash': 'LOW', 'deepseek:deepseek-v4-pro': 'MEDIUM',
  'qwen:qwen3-coder-flash': 'LOW', 'qwen:qwen3-coder-plus': 'MEDIUM', 'qwen:qwen3-max': 'MEDIUM',
  'kimi:kimi-k2.7-code': 'MEDIUM', 'kimi:kimi-k2.7-code-highspeed': 'MEDIUM',
  'kimi:kimi-k2.6': 'MEDIUM', 'kimi:kimi-k3': 'HIGH',
  'openai:gpt-4o': 'MEDIUM', 'openai:gpt-5.4-mini': 'LOW',
};
const show = (label, map) => {
  console.log(`\n=== ${label} ===`);
  console.log('modelo | tier | P(applied) | ECG | meanLatMs | green/red');
  const rows = [];
  for (const k of keys) {
    const e = map.get(k);
    const [p, m] = k.split(':');
    const s = scoreModel({ providerId: p, modelId: m, costClass: COST[k] || 'MEDIUM' }, e || {});
    rows.push({ k, s, e });
  }
  rows.sort((a, b) => (a.s.reliabilityTier - b.s.reliabilityTier) || ((a.s.expectedCostPerGreen ?? 1e9) - (b.s.expectedCostPerGreen ?? 1e9)));
  for (const r of rows) {
    const e = r.e || {};
    console.log(`  ${r.k.padEnd(34)} tier=${String(r.s.reliabilityTier).padEnd(2)} P(appl)=${r.s.probabilityOfApplied !== null && r.s.probabilityOfApplied !== undefined ? (Math.round(r.s.probabilityOfApplied * 100) + '%').padEnd(5) : 'n/a  '} ECG=${String(r.s.expectedCostPerGreen).padEnd(8)} lat=${String(r.s.meanLatencyMs).padEnd(7)} green/red=${e.greenFinal ?? '-'}/${e.redFinal ?? '-'} (n=${e.attempts ?? 0})`);
  }
  console.log(`  ORDEM DE ESCOLHA: ${rows.slice(0, 5).map((r) => r.k).join('  >  ')}`);
};
show('COMO O ROUTER USA HOJE (200 tasks mais recentes, SEM filtro de origem)', hoje);
show('EVIDENCIA LIMPA (somente coortes de execucao real)', limpo);
