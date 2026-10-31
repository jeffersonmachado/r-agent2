'use strict';

/**
 * `lro_outbox.claimed_at` — rastreio do claim de publicação (P1-D).
 *
 * Por que existe: o dispatcher marca a linha como `PUBLISHING` antes de publicar. Se o processo
 * morrer entre o claim e a publicação (SIGKILL, restart, crash), a linha ficava `PUBLISHING` para
 * SEMPRE — evento permanentemente preso, nunca entregue e nunca considerado morto. Sem um carimbo do
 * claim não há como distinguir "está publicando agora" de "morreu publicando".
 *
 * `claimed_at` é NULL para linhas fora de voo; recebe o instante do claim e é limpo quando a linha
 * volta a `PENDING` (reagendamento, DLQ ou recuperação de claim expirado).
 *
 * Reversível: `down` remove a coluna (aditiva, sem FK, sem mudança de contrato para consumidores que
 * não a conheçam).
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const { DataTypes } = Sequelize;
    await queryInterface.addColumn('lro_outbox', 'claimed_at', {
      type: DataTypes.DATE,
      allowNull: true,
    });
    await queryInterface.addIndex('lro_outbox', ['status', 'claimed_at'], {
      name: 'lro_outbox_status_claimed_at_idx',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('lro_outbox', 'lro_outbox_status_claimed_at_idx');
    await queryInterface.removeColumn('lro_outbox', 'claimed_at');
  },
};
