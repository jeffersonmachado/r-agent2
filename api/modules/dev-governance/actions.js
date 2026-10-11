'use strict';

/**
 * Autoridade da superfície de GOVERNANÇA DE ENGENHARIA.
 *
 * A granularidade segue o que a DECISÃO exige, não o verbo HTTP: ler o estado do
 * release, VERIFICAR o entregue, SELAR (que reescreve `dist/`) e PUBLICAR a tag
 * são decisões distintas. Nenhuma delas decorre de "ter acesso à tela".
 *
 * O recurso `dev_governance` é novo de propósito: reaproveitar `engineering` ou
 * `security_intel` faria a autoridade de release herdar, em silêncio, permissões
 * concedidas para outra finalidade.
 */

const DEV_GOVERNANCE_RESOURCE = 'dev_governance';

const DEV_GOVERNANCE_ACTIONS = Object.freeze({
  READ: 'read',
  RELEASE_VERIFY: 'release_verify',
  RELEASE_SEAL: 'release_seal',
  RELEASE_PUBLISH: 'release_publish',
});

/** Ação RBAC de cada ação executável do catálogo de release. */
const RELEASE_ACTION_RBAC = Object.freeze({
  verify: DEV_GOVERNANCE_ACTIONS.RELEASE_VERIFY,
  seal: DEV_GOVERNANCE_ACTIONS.RELEASE_SEAL,
  'publish-tag': DEV_GOVERNANCE_ACTIONS.RELEASE_PUBLISH,
});

module.exports = {
  DEV_GOVERNANCE_RESOURCE,
  DEV_GOVERNANCE_ACTIONS,
  RELEASE_ACTION_RBAC,
};
