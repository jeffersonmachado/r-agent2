'use strict';

function pickRouteDeps(source, keys) {
  return keys.reduce((acc, key) => {
    acc[key] = source[key];
    return acc;
  }, {});
}

module.exports = {
  pickRouteDeps,
};
