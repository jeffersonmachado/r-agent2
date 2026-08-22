'use strict';

const indexes = [
  ['governance_gate_results', ['run_id', 'gate_key'], 'governance_gate_results_run_gate_unique_idx'],
  ['scorecard_dimension_results', ['evaluation_id', 'dimension_id'], 'scorecard_dimension_results_eval_dimension_unique_idx'],
  ['scorecard_requirement_results', ['dimension_result_id', 'requirement_id'], 'scorecard_requirement_results_dimension_requirement_unique_idx'],
];

module.exports = {
  async up(queryInterface) {
    for (const [table, fields, name] of indexes) await queryInterface.addIndex(table, fields, { name, unique: true }).catch((error) => {
      if (!/already exists|duplicate/i.test(error.message)) throw error;
    });
  },
  async down(queryInterface) {
    for (const [table, , name] of indexes) await queryInterface.removeIndex(table, name).catch(() => {});
  },
};