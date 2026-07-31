import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  timeout: 180000,
  retries: process.env.CI ? 2 : 0,
  // Serial: a fila de execuções QA Waves é global no processo da API
  // (EXECUTION_ALREADY_RUNNING). Specs que disparam waves reais não podem
  // correr em paralelo — paralelismo entre arquivos causa 409 e contenção
  // de browser RPA na API.
  workers: 1,
  expect: {
    timeout: 30000,
  },
  use: {
    headless: true,
    baseURL: process.env.FRONTEND_URL || 'http://localhost:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  reporter: [['list'], ['html', { open: 'never' }]],
});
