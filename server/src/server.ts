import './config/env.js';
import { createApp } from './app.js';
import { logger } from './utils/logger.js';

const PORT = parseInt(process.env.PORT || '5000', 10);
const { app } = createApp();

const server = app.listen(PORT, () => {
  logger.info(`Referral Engine API server running on port ${PORT}`);
  logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
  logger.info(`SQLite Database connected at ${process.env.DATABASE_URL || 'file:./dev.db'}`);
});

process.on('SIGTERM', () => {
  logger.info('SIGTERM signal received. Gracefully shutting down.');
  server.close(() => {
    logger.info('HTTP server closed.');
    process.exit(0);
  });
});
