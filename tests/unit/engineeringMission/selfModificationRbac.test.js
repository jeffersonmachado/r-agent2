'use strict';

/**
 * tests/unit/engineeringMission/selfModificationRbac.test.js
 *
 * PROVA que alterar as REGRAS QUE JULGAM o sistema exige uma autoridade DIFERENTE da que aprova uma
 * missão comum.
 *
 * DEFEITO QUE ESTE TESTE TRAVA (confirmado no código em 2026-10-02): a rota
 * `POST /engineering/findings/:id/approve-self-modification` era gated por
 * `requirePermission(req, 'engineering', 'approve')` — a MESMA permissão genérica usada para aprovar
 * uma missão. Quem podia "aprovar engenharia" podia, sem nenhuma distinção, liberar a alteração do
 * critério que o reprovava. Privilégio genérico não é autoridade para reescrever a régua.
 *
 * Os três casos que a política precisa distinguir (e que aqui são exercitados explicitamente):
 *   - service account com engenharia, SEM principal humano        ⇒ DENIED
 *   - humano com permissão GENÉRICA, sem a específica             ⇒ DENIED
 *   - humano COM a permissão específica                           ⇒ ALLOWED
 */

const {
  assessGranularApprovalAuthority,
  SELF_MODIFICATION_APPROVAL_PERMISSION,
  HUMAN_ONLY_APPROVAL_POLICY,
} = require('../../../engine/engineeringMission/bugFinding/selfModification');

const PERMISSION_LABEL = SELF_MODIFICATION_APPROVAL_PERMISSION.label;

describe('RBAC granular de self-modification', () => {
  test('a permissão exigida é específica e compatível com o RBAC existente', () => {
    expect(SELF_MODIFICATION_APPROVAL_PERMISSION).toMatchObject({
      resource: 'engineering',
      action: 'approve_self_modification',
    });
    expect(PERMISSION_LABEL).toBe('engineering:self-modification');
  });

  test('HUMANO com a permissão ESPECÍFICA ⇒ ALLOWED', () => {
    const verdict = assessGranularApprovalAuthority({
      actor: 'engenheira@results.com.br', actorType: 'HUMAN', hasSpecificPermission: true,
    });
    expect(verdict.allowed).toBe(true);
    expect(verdict.code).toBeNull();
    expect(verdict.reason).toMatch(/permissão específica/);
  });

  test('HUMANO com permissão GENÉRICA de engenharia, sem a específica ⇒ DENIED', () => {
    const verdict = assessGranularApprovalAuthority({
      actor: 'engenheiro@results.com.br', actorType: 'HUMAN', hasSpecificPermission: false,
    });
    expect(verdict.allowed).toBe(false);
    expect(verdict.code).toBe('SELF_MODIFICATION_APPROVAL_PERMISSION_REQUIRED');
    expect(verdict.stage).toBe('SPECIFIC_PERMISSION');
    expect(verdict.reason).toMatch(/permissão genérica de engenharia não é autoridade/);
  });

  test('SERVICE ACCOUNT com engenharia, SEM principal humano ⇒ DENIED (mesmo COM a permissão)', () => {
    const verdict = assessGranularApprovalAuthority({
      actor: 'SERVICE:engineering-bot', actorType: 'SERVICE', hasSpecificPermission: true,
    });
    expect(verdict.allowed).toBe(false);
    expect(verdict.stage).toBe('HUMAN_PRINCIPAL');
    expect(verdict.code).toBe('SELF_MODIFICATION_APPROVAL_ACTOR_NOT_HUMAN');
  });

  test('ator AUTOMÁTICO que se declara humano continua recusado (defesa em profundidade)', () => {
    for (const actor of ['SYSTEM:ROUTER', 'AUTOMATION:daily', 'MODEL:llm', 'CRON:nightly']) {
      const verdict = assessGranularApprovalAuthority({ actor, actorType: 'HUMAN', hasSpecificPermission: true });
      expect(verdict.allowed).toBe(false);
      expect(verdict.stage).toBe('HUMAN_PRINCIPAL');
    }
  });

  test('FAIL-CLOSED: permissão ausente, null, undefined ou truthy-não-true NÃO é permissão', () => {
    for (const value of [undefined, null, 0, '', 'true', 'yes', 1, {}]) {
      const verdict = assessGranularApprovalAuthority({
        actor: 'humana@results.com.br', actorType: 'HUMAN', hasSpecificPermission: value,
      });
      expect(verdict.allowed).toBe(false);
      expect(verdict.code).toBe('SELF_MODIFICATION_APPROVAL_PERMISSION_REQUIRED');
    }
  });

  test('sem ator identificado ⇒ DENIED antes mesmo de olhar a permissão', () => {
    const verdict = assessGranularApprovalAuthority({ actor: null, actorType: 'HUMAN', hasSpecificPermission: true });
    expect(verdict.allowed).toBe(false);
    expect(verdict.code).toBe('ACTOR_REQUIRED');
    expect(verdict.stage).toBe('HUMAN_PRINCIPAL');
  });

  test('a política humana continua sendo a MESMA autoridade única (não reimplementada)', () => {
    // A recusa por tipo não-humano precisa vir da política declarada, não de uma regra paralela.
    expect(HUMAN_ONLY_APPROVAL_POLICY.allowedActorTypes).toEqual(['HUMAN']);
    const verdict = assessGranularApprovalAuthority({ actor: 'x', actorType: 'AGENT', hasSpecificPermission: true });
    expect(verdict.allowed).toBe(false);
    expect(verdict.human.policy).toBe('HUMAN_ONLY');
  });

  test('o veredito carrega QUAL condição falhou (auditável, não um booleano solto)', () => {
    const semHumano = assessGranularApprovalAuthority({ actor: 'SERVICE:x', actorType: 'SERVICE', hasSpecificPermission: true });
    const semPermissao = assessGranularApprovalAuthority({ actor: 'humana@x', actorType: 'HUMAN', hasSpecificPermission: false });
    expect(semHumano.stage).toBe('HUMAN_PRINCIPAL');
    expect(semPermissao.stage).toBe('SPECIFIC_PERMISSION');
    expect(semHumano.permission).toBe(PERMISSION_LABEL);
    expect(semPermissao.permission).toBe(PERMISSION_LABEL);
  });

  test('permissão customizada é respeitada (política injetável, não hardcoded no chamador)', () => {
    const verdict = assessGranularApprovalAuthority({
      actor: 'humana@x', actorType: 'HUMAN', hasSpecificPermission: true,
      permission: { resource: 'engineering', action: 'custom_action', label: 'engineering:custom' },
    });
    expect(verdict.allowed).toBe(true);
    expect(verdict.permission).toBe('engineering:custom');
  });
});
