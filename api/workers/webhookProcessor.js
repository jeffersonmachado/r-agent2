#!/usr/bin/env node
'use strict';

/**
 * Webhook Queue Processor
 * Background job to process pending webhook deliveries
 * Runs continuously and processes the queue every N seconds
 */

const logger = require('../utils/logger');
const { connect } = require('../db');

// Configuration
const PROCESS_INTERVAL_MS = parseInt(process.env.WEBHOOK_PROCESS_INTERVAL_MS) || 10000; // 10 seconds
const BATCH_SIZE = parseInt(process.env.WEBHOOK_BATCH_SIZE) || 50;

let isShuttingDown = false;
let intervalTimer = null;

/**
 * Main processing loop
 */
async function processWebhookQueue() {
  if (isShuttingDown) {
    logger.info('[WebhookProcessor] Shutting down, skipping processing');
    return;
  }

  try {
    const db = require('../db');
    const sequelize = db.sequelize;

    if (!sequelize) {
      logger.warn('[WebhookProcessor] Database not connected, skipping');
      return;
    }

    const webhookService = require('../services/crm/webhookService');

    logger.debug('[WebhookProcessor] Processing webhook queue...');
    const result = await webhookService.processWebhookQueue(sequelize, BATCH_SIZE);

    if (result.processed > 0) {
      logger.info('[WebhookProcessor] Processed batch', {
        processed: result.processed,
        successful: result.successful,
        failed: result.failed,
        retried: result.retried,
      });
    }
  } catch (err) {
    logger.error('[WebhookProcessor] Error processing queue:', err);
  }
}

/**
 * Start the processor
 */
async function start() {
  logger.info('[WebhookProcessor] Starting webhook queue processor', {
    interval: PROCESS_INTERVAL_MS,
    batchSize: BATCH_SIZE,
  });

  // Connect to database
  try {
    await connect();
    logger.info('[WebhookProcessor] Database connected');
  } catch (err) {
    logger.error('[WebhookProcessor] Failed to connect to database:', err);
    process.exit(1);
  }

  // Initial run
  await processWebhookQueue();

  // Schedule recurring runs
  intervalTimer = setInterval(async () => {
    await processWebhookQueue();
  }, PROCESS_INTERVAL_MS);

  logger.info('[WebhookProcessor] Processor started successfully');
}

/**
 * Graceful shutdown
 */
async function shutdown() {
  if (isShuttingDown) {
    return;
  }

  isShuttingDown = true;
  logger.info('[WebhookProcessor] Received shutdown signal, cleaning up...');

  // Stop the interval
  if (intervalTimer) {
    clearInterval(intervalTimer);
    intervalTimer = null;
  }

  // Final processing attempt
  try {
    logger.info('[WebhookProcessor] Running final queue processing...');
    await processWebhookQueue();
    logger.info('[WebhookProcessor] Final processing complete');
  } catch (err) {
    logger.error('[WebhookProcessor] Error in final processing:', err);
  }

  // Close database connection
  try {
    const db = require('../db');
    if (db.sequelize) {
      await db.sequelize.close();
      logger.info('[WebhookProcessor] Database connection closed');
    }
  } catch (err) {
    logger.error('[WebhookProcessor] Error closing database:', err);
  }

  logger.info('[WebhookProcessor] Shutdown complete');
  process.exit(0);
}

// Handle shutdown signals
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// Handle uncaught errors
process.on('uncaughtException', (err) => {
  logger.error('[WebhookProcessor] Uncaught exception:', err);
  shutdown();
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('[WebhookProcessor] Unhandled rejection:', reason);
  shutdown();
});

// Start the processor
if (require.main === module) {
  start().catch((err) => {
    logger.error('[WebhookProcessor] Failed to start:', err);
    process.exit(1);
  });
}

module.exports = {
  start,
  shutdown,
  processWebhookQueue,
};
