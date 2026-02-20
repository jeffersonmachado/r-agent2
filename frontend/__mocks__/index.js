// Mock para utils/index.js que usa import.meta.env (CommonJS)
const getBasePath = jest.fn(() => '/');
const getTestID = jest.fn((id) => id);
module.exports = { getBasePath, getTestID };
