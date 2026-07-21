import express from 'express';
import cors from 'cors';
import wavesRoutes from './routes/wavesRoutes.js';
import executionRoutes from './routes/executionRoutes.js';
import replayRoutes from './routes/replayRoutes.js';
import businessRulesRoutes from './routes/business-rules.routes.js';

const app = express();
const port = process.env.QA_WAVES_UI_PORT || 4176;

app.use(cors());
app.use(express.json({ limit: '2mb' }));

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', service: 'qa-waves-ui-backend' });
});

app.use('/api/waves', wavesRoutes);
app.use('/api/executions', executionRoutes);
app.use('/api/replays', replayRoutes);
app.use('/api/business', businessRulesRoutes);

app.listen(port, () => {
  console.log(`qa-waves-ui backend listening on ${port}`);
});
