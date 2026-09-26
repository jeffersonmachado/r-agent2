/**
 * Migration: PROGRESSO SIGNIFICATIVO em missions e tasks (2026-09-26).
 *
 * DEFEITO ARQUITETURAL (missão de hardening de timeouts): o sistema media
 * LIVENESS (lease/heartbeat), mas NÃO media AVANÇO. Sem `last_progress_at` não
 * havia como distinguir:
 *
 *   - SLOW  = worker VIVO e PROGREDINDO  → estado legítimo, não se toca;
 *   - STUCK = worker VIVO e SEM progresso → exige DIAGNÓSTICO, não kill;
 *   - DEAD  = liveness perdida (heartbeat parou → lease expira) → takeover.
 *
 * A ausência dessa terceira medida empurrava qualquer decisão para o único
 * sinal disponível: TEMPO DECORRIDO. Daí o padrão que esta missão elimina —
 * "passou X minutos ⇒ considerar morto / derrubar / takeover".
 *
 * `last_progress_signal` guarda QUAL sinal de progresso foi registrado
 * (phase_change, test_result, patch_produced, ...), permitindo auditar por que
 * uma fase é considerada produtiva. `progress_count` dá a taxa de avanço, usada
 * no orçamento de iterações/anti-runaway (nunca wall-clock).
 *
 * Heartbeat NÃO conta como progresso: renovação de lease é ignorada por
 * `recordProgress` (ver `engine/engineeringMission/progressPolicy.js`).
 */

'use strict';

const TABLES = ['engineering_missions', 'engineering_tasks'];

async function addColumnIfMissing(queryInterface, table, column, definition) {
  const description = await queryInterface.describeTable(table);
  if (description[column]) return false;
  await queryInterface.addColumn(table, column, definition);
  return true;
}

module.exports = {
  async up(queryInterface, Sequelize) {
    for (const table of TABLES) {
      await addColumnIfMissing(queryInterface, table, 'last_progress_at', {
        type: Sequelize.DATE,
        allowNull: true,
      });
      await addColumnIfMissing(queryInterface, table, 'last_progress_signal', {
        type: Sequelize.STRING(48),
        allowNull: true,
      });
      await addColumnIfMissing(queryInterface, table, 'progress_count', {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
      });
    }
  },

  async down(queryInterface) {
    for (const table of TABLES) {
      for (const column of ['progress_count', 'last_progress_signal', 'last_progress_at']) {
        try {
          await queryInterface.removeColumn(table, column);
        } catch (_) {
          /* coluna já ausente */
        }
      }
    }
  },
};
