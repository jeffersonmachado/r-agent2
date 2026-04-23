import { Router } from 'express';
import {
  createExecutionController,
  getExecutionController,
  listExecutionsController
} from '../controllers/executionController.js';

const router = Router();

router.get('/', listExecutionsController);
router.post('/', createExecutionController);
router.get('/:executionId', getExecutionController);

export default router;
