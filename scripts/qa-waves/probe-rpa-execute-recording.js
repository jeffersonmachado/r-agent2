'use strict';
/* Probe 3: executa a gravação fitness-matricula-leads pelo MESMO caminho do mesh
   (rpaService.executeRecording) e despeja resultado por step. */
process.env.RUNTIME_ROOT = process.env.RUNTIME_ROOT || '/tmp/ragent2-runtime-dev';
const { executeRecording, getExecutionStatus } = require('../../api/services/rpaService');

(async () => {
  const start = await executeRecording(
    'fitness-matricula-leads',
    { headless: true, slowMo: 0, timeout: 30000, screenshotOnFailure: true, recordVideo: false },
    {}
  );
  console.log('executionId:', start.executionId);
  const deadline = Date.now() + 8 * 60 * 1000;
  while (Date.now() < deadline) {
    const st = getExecutionStatus(start.executionId);
    if (st && ['completed', 'failed', 'cancelled'].includes(st.status)) {
      const steps = st.results?.steps || [];
      for (const s of steps) {
        console.log(
          String(s.index).padStart(2), (s.action || '').padEnd(9),
          (s.status || '').padEnd(8), `${s.durationMs}ms`.padStart(9),
          '|', (s.name || '').slice(0, 40),
          s.error ? `| ERR: ${String(s.error).slice(0, 90)}` : ''
        );
      }
      console.log('success:', st.results?.success, '| errors:', JSON.stringify(st.results?.errors || []).slice(0, 300));
      return;
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  console.log('TIMEOUT aguardando execução');
  process.exit(1);
})().catch((e) => { console.error('PROBE FAIL:', e); process.exit(1); });
