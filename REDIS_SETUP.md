# Redis Setup Guide for Windows

## Option 1: Using Docker (Recommended)

### Install Docker Desktop for Windows
1. Download Docker Desktop from https://www.docker.com/products/docker-desktop
2. Install and start Docker Desktop

### Run Redis Container
```powershell
docker run -d --name redis-launcx -p 6379:6379 redis:alpine
```

### Verify Redis is running
```powershell
docker exec -it redis-launcx redis-cli ping
# Should return: PONG
```

### Start Redis (after restart)
```powershell
docker start redis-launcx
```

### Stop Redis
```powershell
docker stop redis-launcx
```

---

## Option 2: Using Memurai (Native Windows Redis)

### Download and Install
1. Go to https://www.memurai.com/get-memurai
2. Download Memurai (Windows-native Redis)
3. Install and run as Windows Service

### Verify Installation
```powershell
redis-cli ping
# Should return: PONG
```

---

## Option 3: Using WSL2 (Windows Subsystem for Linux)

### Enable WSL2
```powershell
wsl --install
```

### Install Redis in WSL2
```bash
sudo apt update
sudo apt install redis-server -y
```

### Start Redis
```bash
sudo service redis-server start
```

### Verify
```bash
redis-cli ping
# Should return: PONG
```

---

## Option 4: Remote Redis (Production)

### Using Redis Cloud (Free Tier)
1. Go to https://redis.com/try-free/
2. Create free account
3. Create database
4. Copy connection details

### Update .env
```env
REDIS_HOST=redis-xxxxx.c123.us-east-1-1.ec2.cloud.redislabs.com
REDIS_PORT=12345
REDIS_PASSWORD=your_password_here
REDIS_DB=0
```

---

## Testing Redis Connection

Create test file `test-redis.js`:
```javascript
const Redis = require('ioredis');

const redis = new Redis({
  host: 'localhost',
  port: 6379,
});

redis.on('connect', () => {
  console.log('✅ Connected to Redis');
});

redis.on('error', (err) => {
  console.error('❌ Redis error:', err);
});

// Test set/get
redis.set('test', 'hello', 'EX', 10);
redis.get('test').then(console.log); // Should print: hello

setTimeout(() => {
  redis.quit();
}, 2000);
```

Run: `node test-redis.js`

---

## Redis GUI Tools (Optional)

- **RedisInsight**: https://redis.com/redis-enterprise/redis-insight/
- **Another Redis Desktop Manager**: https://github.com/qishibo/AnotherRedisDesktopManager

---

## Quick Start (Recommended for Local Dev)

### Using Docker:
```powershell
# Start Redis
docker run -d --name redis-launcx -p 6379:6379 redis:alpine

# Check if running
docker ps

# View logs
docker logs redis-launcx

# Connect with CLI
docker exec -it redis-launcx redis-cli
```

That's it! Your application will connect to Redis automatically.
