/**
 * Configuração PM2 para o chatbot-engine
 * 
 * Uso:
 *   pm2 start ecosystem.config.js          # Inicia todos os processos
 *   pm2 start ecosystem.config.js --only r-agent2-api  # Apenas API
 *   pm2 start ecosystem.config.js --only r-agent2-frontend  # Apenas Frontend
 *   pm2 stop all                            # Para todos
 *   pm2 restart all                         # Reinicia todos
 *   pm2 logs                                # Ver logs
 *   pm2 monit                               # Monitoramento
 */

module.exports = {
  apps: [
    {
      name: 'r-agent2-api',
      script: './api/server.js',
      cwd: './',
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
      env_development: {
        NODE_ENV: 'development',
        PORT: 3000,
      },
      error_file: './logs/pm2-api-error.log',
      out_file: './logs/pm2-api-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',
      restart_delay: 4000,
      kill_timeout: 5000,
    },
    {
      name: 'r-agent2-frontend',
      script: 'npm',
      args: 'start',
      cwd: './frontend',
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      max_memory_restart: '300M',
      env: {
        NODE_ENV: 'production',
      },
      env_development: {
        NODE_ENV: 'development',
      },
      error_file: './logs/pm2-frontend-error.log',
      out_file: './logs/pm2-frontend-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',
      restart_delay: 4000,
      kill_timeout: 5000,
    },
  ],
};

