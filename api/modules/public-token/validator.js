'use strict';

const ALLOWED_KINDS = ['storefront', 'kiosk', 'panel', 'station', 'access_control'];

function parseBooleanParam(rawValue) {
  if (rawValue === null || rawValue === undefined) {
    return null;
  }

  if (rawValue === 'true') {
    return true;
  }

  if (rawValue === 'false') {
    return false;
  }

  return null;
}

function validateKind(kind) {
  return ALLOWED_KINDS.includes(kind);
}

module.exports = {
  ALLOWED_KINDS,
  parseBooleanParam,
  validateKind,
};
