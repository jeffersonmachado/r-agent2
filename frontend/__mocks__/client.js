// Mock para import.meta.env em ambiente de teste (CommonJS)
const fetchJson = jest.fn();
const VITE_API_BASE_URL = 'http://localhost:3000';
const base = VITE_API_BASE_URL;
module.exports = { fetchJson, base };
