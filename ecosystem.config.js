module.exports = {
  apps: [
    {
      name: 'launcx-backend',
      cwd: __dirname,
      script: 'dist/app.js',
      instances: 1,
      autorestart: true,
      watch: false,
      env_file: '.env',
      env: {
        NODE_ENV: 'env',
        PORT: 5000
      },
      error_file: './logs/backend-error.log',
      out_file: './logs/backend-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z'
    },
    {
      name: 'launcx-callback-worker',
      cwd: __dirname,
      script: 'dist/worker/callbackQueue.js',
      instances: 10,
      exec_mode: 'cluster',
      max_memory_restart: '512M',
      instance_var: 'INSTANCE_ID',
      autorestart: true,
      watch: false,
      env_file: '.env',
      env: { NODE_ENV: 'production' },
      error_file: './logs/callback-worker-error.log',
      out_file: './logs/callback-worker-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z'
    },
    {
      name: 'launcx-frontend',
      cwd: __dirname + '/frontend',
      script: 'npm',
      args: 'run start',
      instances: 1,
      autorestart: true,
      watch: false,
      env_file: '.env',
      env: {
        NODE_ENV: 'production',
        PORT: 5001,
        NEXT_PUBLIC_API_URL: '/api/v1'
      },
      error_file: '../logs/frontend-error.log',
      out_file: '../logs/frontend-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z'
    }
  ]
}