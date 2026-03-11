'use strict';

function detectProcessManager() {
  if (process.env.PM2_HOME || process.env.PM2_INSTANCE_ID !== undefined) {
    return {
      name: 'PM2',
      hasProcessManager: true,
      details: {
        pm2Home: process.env.PM2_HOME,
        instanceId: process.env.PM2_INSTANCE_ID,
        method: 'environment_variables',
      },
    };
  }

  const parentProcess = process.env.nodemon || '';
  if (parentProcess || process.argv.some((arg) => arg.includes('nodemon'))) {
    return {
      name: 'nodemon',
      hasProcessManager: true,
      details: {
        method: 'process_detection',
      },
    };
  }

  try {
    const ppid = process.ppid;
    if (ppid && process.platform !== 'win32') {
      try {
        const { execSync } = require('child_process');
        const parentCmd = execSync(`ps -p ${ppid} -o comm=`, { encoding: 'utf8', timeout: 1000 }).trim();
        if (parentCmd.includes('pm2') || parentCmd.includes('PM2')) {
          return {
            name: 'PM2',
            hasProcessManager: true,
            details: {
              parentProcess: parentCmd,
              method: 'parent_process_detection',
            },
          };
        }
        if (parentCmd.includes('nodemon')) {
          return {
            name: 'nodemon',
            hasProcessManager: true,
            details: {
              parentProcess: parentCmd,
              method: 'parent_process_detection',
            },
          };
        }
      } catch (_) {}
    }
  } catch (_) {}

  return {
    name: 'none',
    hasProcessManager: false,
    details: {
      method: 'none_detected',
      note: 'Servidor rodando diretamente com node',
    },
  };
}

module.exports = {
  detectProcessManager,
};
