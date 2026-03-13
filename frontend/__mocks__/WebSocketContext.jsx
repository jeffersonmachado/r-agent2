// Mock para context/WebSocketContext.jsx que usa import.meta.env
const useWebSocketContext = jest.fn(() => ({
  connected: true,
  authenticated: true,
  onEvent: () => {},
  subscribeEvents: [],
}));
module.exports = { useWebSocketContext };
