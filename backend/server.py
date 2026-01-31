"""
Proxy server to bridge uvicorn to Node.js backend
This is a workaround because supervisor is configured to run uvicorn
but the actual backend is a Node.js application.
"""
import subprocess
import os
import sys

# Change to the app directory
os.chdir('/app')

# Start the Node.js backend directly
# Using 'yarn start' which runs 'node dist/app.js'
try:
    # First build if needed
    if not os.path.exists('/app/dist/app.js'):
        print("[Backend] Building TypeScript...")
        subprocess.run(['yarn', 'build'], cwd='/app', check=True)
    
    print("[Backend] Starting Node.js backend on port 8001...")
    # Run node directly
    subprocess.run(
        ['node', 'dist/app.js'],
        cwd='/app',
        env={**os.environ, 'PORT': '8001'}
    )
except KeyboardInterrupt:
    print("[Backend] Shutting down...")
except Exception as e:
    print(f"[Backend] Error: {e}")
    sys.exit(1)
