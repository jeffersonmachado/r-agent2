'use strict';

function createRealtimeRegistrar({
  http,
  logger,
  initializeWebSocket,
  disableWebSocket = false,
}) {
  if (!http?.createServer) {
    throw new Error('http.createServer is required');
  }

  return {
    createHttpServer(handler) {
      if (typeof handler !== 'function') {
        throw new Error('HTTP handler is required');
      }

      const server = http.createServer(handler);
      if (!disableWebSocket && typeof initializeWebSocket === 'function') {
        initializeWebSocket(server);
        logger.info('[Bootstrap] Realtime/WebSocket registrado');
      }
      return server;
    },
  };
}

module.exports = {
  createRealtimeRegistrar,
};
