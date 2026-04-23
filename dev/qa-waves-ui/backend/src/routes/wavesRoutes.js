import { Router } from 'express';
import { listWavesController } from '../controllers/wavesController.js';

const router = Router();

router.get('/', listWavesController);

export default router;
