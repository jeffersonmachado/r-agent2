import { Router } from 'express';
import {
  getStateController,
  runPipelineController,
  getJourneysController,
  getJourneyController,
  getGapsController,
  updateGapController
} from '../controllers/business-rules.controller.js';

const router = Router();

router.get('/rules', getStateController);
router.post('/rules/pipeline', runPipelineController);
router.get('/journeys', getJourneysController);
router.get('/journeys/:verticalId', getJourneyController);
router.get('/gaps', getGapsController);
router.patch('/gaps/:gapId', updateGapController);

export default router;
