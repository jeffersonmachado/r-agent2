'use strict';

/**
 * pbx-cdr-id-default — permite que o Asterisk grave CDR em pbx_cdr.
 *
 * DEFEITO (2026-09-12): o backend `cdr_adaptive_odbc` do Asterisk insere APENAS as
 * colunas que correspondem a variáveis de CDR (uniqueid, src, dst, disposition,
 * duration, billsec, accountcode, userfield, clid, dcontext, channel, dstchannel,
 * amaflags, peeraccount, linkedid, sequence, calldate). Ele NÃO fornece `id`.
 *
 * `pbx_cdr.id` era `character varying NOT NULL` SEM default. Consequência: o INSERT
 * do backend falhava em `id` e o Asterisk DESCARTAVA a linha em silêncio — sem erro
 * visível na aplicação. Efeito observável: `pbx_cdr` só tinha linhas inseridas pela
 * aplicação/smokes; nenhum CDR real de chamada.
 *
 * Isso quebrava, em cascata:
 *   - `pbxProdLike.signals.cdr` e `.hangupCauses` = false na evidência enterprise;
 *   - `qa/enterprise/pbx-voice-flow-prod-like.json` saía `ok=false`;
 *   - `RAP-068` (PBX / Voice Runtime Reliability) reprovava;
 *   - o `zip:release` bloqueava em `platform-readiness` (SEAL_NO_GO) — sem selo.
 *
 * A migration anterior (`20260512101000-pbx-cdr-adaptive-runtime-fix.js`) já havia
 * corrigido `calldate` e removido `lastapp`/`lastdata` (payloads não-UTF8 em canais
 * Local) com a MESMA intenção, mas não tratou o `id`.
 *
 * `gen_random_uuid()` é nativo do PostgreSQL desde a versão 13 (verificado no
 * ambiente: PG 16). As demais colunas NOT NULL já têm default (`tenant_key` =>
 * 'unknown', `extra` => '{}', `created_at`/`updated_at` => CURRENT_TIMESTAMP) e
 * `uniqueid` é fornecido pelo Asterisk.
 */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(
      `ALTER TABLE pbx_cdr ALTER COLUMN id SET DEFAULT gen_random_uuid()::text`,
    );
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(
      `ALTER TABLE pbx_cdr ALTER COLUMN id DROP DEFAULT`,
    ).catch(() => {});
  },
};
