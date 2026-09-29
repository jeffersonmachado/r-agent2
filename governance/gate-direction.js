'use strict';

/**
 * governance/gate-direction.js — INVARIANTE DE DIREÇÃO ENTRE GATES (núcleo PURO).
 *
 * Missão 2026-09-28: o repositório tinha `governance/final-governance-report.json` declarando
 * `AUTONOMOUS_READY_GO` enquanto os próprios gates filhos declaravam `NO_GO` — por exemplo
 * `ENGINEERING_ROUTER_V2_SEAL = NO_GO` e `TIMEOUT_ARCHITECTURE = NO_GO`. Isso é o estado proibido:
 *
 *     child NO_GO → parent GO
 *
 * A direção obrigatória é: runtime → gate → selo → readiness → governança final. Um gate PAI só
 * pode ser GO quando TODOS os seus filhos obrigatórios forem GO e estiverem presentes.
 *
 * Regras que este núcleo aplica e que não podem ser afrouxadas:
 *   1. Ausência de evidência NUNCA é aprovação: pai GO com filho sem relatório é violação.
 *   2. Estado declaradamente bloqueado (BLOCKED_EXTERNAL / INCONCLUSIVO / PENDENTE) no filho
 *      impede o pai de ser GO — "bloqueado" não é "aprovado".
 *   3. Divergência não é degradada para aviso e o valor mais favorável nunca é escolhido.
 *
 * Este módulo é PURO: não lê arquivos, não conhece caminhos, não usa relógio. A borda (CLI
 * `scripts/governance/validate-gate-direction.js`) monta o estado a partir dos relatórios reais.
 */

/** Valores que significam "aprovado" quando normalizados (comparação por igualdade exata). */
const GO_TOKENS = Object.freeze(['GO', 'GREEN', 'PASS', 'APROVADO', 'AUTONOMOUS_READY_GO', 'VERIFIED', 'COMPLETE']);

/** Valores que significam "explicitamente bloqueado" — nunca podem virar aprovação. */
const BLOCKED_TOKENS = Object.freeze([
  'BLOCKED',
  'BLOCKED_EXTERNAL',
  'INCONCLUSIVO',
  'PENDENTE',
  'PENDENTE_APROVACAO_NEGOCIO',
  'PENDING',
  'NOT_EXECUTED',
  'NOT_EXECUTED_NO_CREDENTIAL',
  'REQUIRES_DOCKER_RUNTIME',
]);

function normalize(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim().toUpperCase();
  return text.length === 0 ? null : text;
}

/**
 * Classifica um estado já normalizado.
 * @returns {'GO'|'BLOCKED'|'NOT_GO'|'ABSENT'}
 */
function classify(decision) {
  const value = normalize(decision);
  if (value === null) return 'ABSENT';
  if (GO_TOKENS.includes(value)) return 'GO';
  if (BLOCKED_TOKENS.includes(value)) return 'BLOCKED';
  return 'NOT_GO';
}

/**
 * Aplica o invariante a uma cadeia de gates.
 *
 * @param {{ gates: Array<{id: string, report?: string, decision: *, label?: string,
 *          children: Array<{id: string, report?: string, decision: *, label?: string}>}> }} input
 * @returns {{status: 'PASS'|'FAIL', violations: Array<object>, evaluated: Array<object>}}
 */
function evaluateGateDirection({ gates }) {
  const list = Array.isArray(gates) ? gates : [];
  const violations = [];
  const evaluated = [];

  for (const gate of list) {
    const parentClass = classify(gate.decision);
    const children = Array.isArray(gate.children) ? gate.children : [];
    const childStates = children.map((child) => ({
      id: child.id,
      report: child.report || null,
      decision: child.decision === undefined ? null : child.decision,
      class: classify(child.decision),
    }));

    evaluated.push({
      id: gate.id,
      report: gate.report || null,
      decision: gate.decision === undefined ? null : gate.decision,
      class: parentClass,
      children: childStates,
    });

    // A invariante só tem o que dizer quando o PAI afirma aprovação: é esse o estado que mente.
    if (parentClass !== 'GO') continue;

    for (const child of childStates) {
      if (child.class === 'GO') continue;
      if (child.class === 'ABSENT') {
        violations.push({
          code: 'PARENT_GO_WITH_CHILD_EVIDENCE_ABSENT',
          parent: gate.id,
          child: child.id,
          detail: `${gate.id} declara GO, mas o filho obrigatório ${child.id} não tem evidência (${child.report || 'relatório não declarado'})`,
        });
        continue;
      }
      violations.push({
        code: child.class === 'BLOCKED' ? 'PARENT_GO_WITH_CHILD_BLOCKED' : 'PARENT_GO_WITH_CHILD_NO_GO',
        parent: gate.id,
        child: child.id,
        childDecision: child.decision,
        detail: `${gate.id} declara GO, mas o filho obrigatório ${child.id} está ${child.class} (${child.decision})`,
      });
    }
  }

  return {
    status: violations.length === 0 ? 'PASS' : 'FAIL',
    violations,
    evaluated,
  };
}

module.exports = { evaluateGateDirection, classify, normalize, GO_TOKENS, BLOCKED_TOKENS };
