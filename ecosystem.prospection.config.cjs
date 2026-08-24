/**
 * PM2 — agent de prospection (serveur léger, sans ClipForge).
 * Usage sur le VPS :
 *   pm2 start ecosystem.prospection.config.cjs
 *   pm2 save && pm2 startup
 */
module.exports = {
  apps: [
    {
      name: "prospection",
      script: "agent-prospection/server/standalone-server.js",
      cwd: __dirname,
      instances: 1,
      autorestart: true,
      max_restarts: 50,
      min_uptime: "10s",
      max_memory_restart: "300M",
      exp_backoff_restart_delay: 200,
      env: {
        NODE_ENV: "production",
        HOST: "127.0.0.1",
        PORT: "3011",
        TRUST_PROXY: "1",
      },
    },
  ],
};
