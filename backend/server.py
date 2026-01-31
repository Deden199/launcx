"""
Proxy server to bridge uvicorn to Node.js backend.
This runs a simple proxy that forwards all requests to the Node.js app running on port 8002.
"""
import os
import sys
import subprocess
import threading
import time
from typing import Optional
import asyncio
import signal

# Try to import uvicorn/starlette for proxy
try:
    from starlette.applications import Starlette
    from starlette.responses import Response, StreamingResponse
    from starlette.routing import Route
    import httpx
except ImportError:
    # If not installed, we'll run node directly
    pass

NODE_PORT = 8002  # Node runs here
PROXY_PORT = 8001  # Uvicorn listens here

node_process: Optional[subprocess.Popen] = None

def start_node_backend():
    """Start the Node.js backend on port 8002"""
    global node_process
    
    os.chdir('/app')
    
    # Build if needed
    if not os.path.exists('/app/dist/app.js'):
        print("[Backend] Building TypeScript...")
        subprocess.run(['yarn', 'build'], cwd='/app', check=True)
    
    env = os.environ.copy()
    env['PORT'] = str(NODE_PORT)
    
    print(f"[Backend] Starting Node.js backend on port {NODE_PORT}...")
    node_process = subprocess.Popen(
        ['node', 'dist/app.js'],
        cwd='/app',
        env=env,
        stdout=sys.stdout,
        stderr=sys.stderr
    )
    return node_process

def stop_node_backend():
    """Stop the Node.js backend"""
    global node_process
    if node_process:
        node_process.terminate()
        try:
            node_process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            node_process.kill()

# If starlette is available, create a proxy app
try:
    from starlette.applications import Starlette
    from starlette.responses import Response, StreamingResponse
    from starlette.routing import Route
    from starlette.requests import Request
    import httpx
    
    # Start node in background thread on startup
    node_thread = None
    
    async def proxy_request(request: Request):
        """Proxy all requests to Node.js backend"""
        url = f"http://127.0.0.1:{NODE_PORT}{request.url.path}"
        if request.url.query:
            url += f"?{request.url.query}"
        
        async with httpx.AsyncClient(timeout=60.0) as client:
            try:
                # Forward the request
                body = await request.body()
                response = await client.request(
                    method=request.method,
                    url=url,
                    headers=dict(request.headers),
                    content=body if body else None,
                )
                
                # Return the response
                return Response(
                    content=response.content,
                    status_code=response.status_code,
                    headers=dict(response.headers),
                )
            except httpx.ConnectError:
                return Response(
                    content=b'{"error": "Backend not ready"}',
                    status_code=503,
                    media_type='application/json'
                )
            except Exception as e:
                return Response(
                    content=f'{{"error": "{str(e)}"}}'.encode(),
                    status_code=500,
                    media_type='application/json'
                )
    
    async def startup():
        """Start Node.js backend on startup"""
        global node_thread
        node_thread = threading.Thread(target=start_node_backend, daemon=True)
        node_thread.start()
        # Wait for Node to be ready
        time.sleep(3)
        print(f"[Proxy] Ready to forward requests to port {NODE_PORT}")
    
    async def shutdown():
        """Stop Node.js backend on shutdown"""
        stop_node_backend()
    
    # Create Starlette app with catch-all route
    app = Starlette(
        debug=True,
        routes=[
            Route("/{path:path}", proxy_request, methods=["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS", "HEAD"]),
            Route("/", proxy_request, methods=["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS", "HEAD"]),
        ],
        on_startup=[startup],
        on_shutdown=[shutdown],
    )

except ImportError:
    # No starlette, just run node directly
    print("[Backend] No starlette available, running Node.js directly")
    
    def run_node():
        os.chdir('/app')
        env = os.environ.copy()
        env['PORT'] = '8001'
        subprocess.run(['node', 'dist/app.js'], cwd='/app', env=env)
    
    if __name__ == '__main__':
        run_node()
