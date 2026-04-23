import { Router } from 'express';
import {
  getReplayController,
  listReplaysController,
  reexecuteReplayController
} from '../controllers/replayController.js';

const router = Router();

router.get('/', listReplaysController);
router.get('/:replayId', getReplayController);
router.post('/:replayId/reexecute', reexecuteReplayController);

export default router;
