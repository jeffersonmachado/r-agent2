'use strict';

function registerMiddlewares({ requestHandler }) {
  if (typeof requestHandler !== 'function') {
    throw new Error('requestHandler is required');
  }

  return {
    apply(req, res) {
      return requestHandler(req, res);
    },
  };
}

module.exports = {
  registerMiddlewares,
};
