'use strict';

const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');

const cache = new Map();

function getGovernanceModel(name, attributes, options = {}) {
  if (!cache.has(name)) {
    const sequelize = getSequelize();
    if (!sequelize) {
      return new Proxy({}, { get: () => { throw new Error('Sequelize não inicializado. Chame connect() primeiro.'); } });
    }
    cache.set(name, sequelize.define(name, attributes, {
      tableName: options.tableName || name.replace(/[A-Z]/g, (letter, index) => `${index ? '_' : ''}${letter.toLowerCase()}`) + 's',
      timestamps: true,
      underscored: true,
      ...options,
    }));
  }
  return cache.get(name);
}

const uuid = { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4, allowNull: false };
const id = { type: DataTypes.UUID, allowNull: false };
const json = { type: DataTypes.JSONB, allowNull: false, defaultValue: {} };

module.exports = { getGovernanceModel, uuid, id, json, DataTypes };