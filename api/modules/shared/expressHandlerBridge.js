'use strict';

function createExpressHandlerMiddleware({ handler, buildDeps }) {
  return async function expressHandlerMiddleware(req, res, next) {
    try {
      const pathname = new URL(req.originalUrl || req.url || '/', 'http://localhost').pathname;
      const handled = await handler({
        req,
        res,
        method: (req.method || 'GET').toUpperCase(),
        pathname,
        deps: buildDeps(req, res),
      });

      if (!handled && !res.writableEnded) {
        next();
      }
    } catch (err) {
      next(err);
    }
  };
}

function mountExpressHandler(router, options) {
  router.use(createExpressHandlerMiddleware(options));
}

module.exports = {
  createExpressHandlerMiddleware,
  mountExpressHandler,
};
