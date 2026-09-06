module.exports = {
  apps: [{
    name: "bb-backend",
    script: "src/server.js",
    instances: 1, // CRITICAL: single instance required to prevent duplicate cron sweeps
    exec_mode: "fork",
    autorestart: true,
    max_memory_restart: "1G",
    env: {
      NODE_ENV: "production",
      PORT: 4000
    }
  }]
};
