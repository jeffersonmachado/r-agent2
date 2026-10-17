'use strict';
/**
 * Probe de ELEGIBILIDADE por operação (missão V3 §9/§11).
 *
 * Lê o inventário real da fila oficial e o SHA real do repositório e pergunta
 * ao mecanismo, operação por operação, se a execução está autorizada. Não
 * executa nada: apenas torna medível que a plataforma NÃO pode avançar para
 * fases certificantes enquanto houver P0/P1 aberto.
 */
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const { evaluateExecutionEligibility } = require('../../governance/bug-closure/eligibility');

const ROOT = path.resolve(__dirname, '..', '..');
const fila = JSON.parse(fs.readFileSync(path.join(ROOT, 'AI_MEMORY', 'hardening-queue.json'), 'utf8'));
const itens = Array.isArray(fila) ? fila : fila.items;

const FECHADOS = new Set(['VERIFIED', 'RESOLVED', 'RISK_ACCEPTED']);
const abertos = itens.filter((i) => !FECHADOS.has(String(i.state || '')));

const ctx = {
  commit: execSync('git rev-parse HEAD', { cwd: ROOT }).toString().trim(),
  actor: { id: 'AUDITOR:V3', kind: 'AUDIT' },
  defects: abertos.map((i) => ({
    id: i.id,
    severity: i.severity,
    state: i.state,
    title: i.title,
  })),
};

const contagem = abertos.reduce((acc, i) => {
  const s = String(i.severity || 'SEM_SEVERIDADE').toUpperCase();
  acc[s] = (acc[s] || 0) + 1;
  return acc;
}, {});

console.log(`HEAD=${ctx.commit.slice(0, 12)} abertos=${abertos.length} ${JSON.stringify(contagem)}`);

const ops = [
  'DIAGNOSTICO', 'REPRODUCAO', 'CORRECAO_CODIGO', 'TESTES_DIRECIONADOS', 'TESTES_NEGATIVOS_REGRESSAO',
  'L0_COMPLETO', 'L1_AMPLO', 'L2_L3_EXTENSIVO', 'QA_WAVES_COMPLETA', 'REPLAY_MASSIVO',
  'CONVERGENCIA_COMPLETA', 'SELO_FINAL', 'PUBLICACAO_RELEASE',
];

for (const op of ops) {
  const r = evaluateExecutionEligibility(ctx, op);
  const motivos = (r.reasonCodes || []).join(',') || '-';
  console.log(`${op.padEnd(26)} allowed=${String(r.allowed).padEnd(5)} decision=${String(r.decision).padEnd(18)} motivos=${motivos}`);
}
