/**
 * Helper para criar models Sequelize com lazy loading
 */

const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');

/**
 * Cria um model factory que inicializa o model apenas quando necessário
 * 
 * @param {string} modelName - Nome do model
 * @param {Object} attributes - Atributos do model
 * @param {Object} options - Opções do model
 * @returns {Function} Função que retorna o model
 */
function createModelFactory(modelName, attributes, options) {
  let Model = null;

  return function getModel() {
    if (!Model) {
      const sequelize = getSequelize();
      if (!sequelize) {
        // Retorna um proxy que lança erro quando usado
        return new Proxy({}, {
          get: () => {
            throw new Error(`Sequelize não inicializado. Chame connect() antes de usar o model ${modelName}.`);
          }
        });
      }
      
      Model = sequelize.define(modelName, attributes, options);
    }
    return Model;
  };
}

module.exports = {
  createModelFactory,
};
