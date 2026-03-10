'use strict';

const {
  OperationalEvent,
  CrmEvent,
  OperationalPlaybookRun,
} = require('../../db/models');
const getCrmEvent = require('../../db/models/CrmEvent');
const getOperationalEvent = require('../../db/models/OperationalEvent');
const getOperationalPlaybookRun = require('../../db/models/OperationalPlaybookRun');

function resolveOperationalEventModel() {
  try {
    if (typeof OperationalEvent === 'function') return OperationalEvent();
    return getOperationalEvent();
  } catch (_) {
    if (typeof CrmEvent === 'function') return CrmEvent();
    return getCrmEvent();
  }
}

function resolveOperationalPlaybookRunModel() {
  if (typeof OperationalPlaybookRun === 'function') return OperationalPlaybookRun();
  return getOperationalPlaybookRun();
}

module.exports = {
  resolveOperationalEventModel,
  resolveOperationalPlaybookRunModel,
};
