# Deployment: Production Hardening

Guia de configuração de segurança, performance e observabilidade para r-agent2 em produção.

---

## 1. Security Hardening

### 1.1. Access Control

#### SSH Access
```bash
# Generate SSH keys for deployment
ssh-keygen -t ed25519 -f deploy_key -N ""

# Restrict permissions
chmod 600 deploy_key
chmod 644 deploy_key.pub

# Add to authorized_keys
cat deploy_key.pub >> ~/.ssh/authorized_keys

# Restrict to specific IP
echo "from=\"10.0.0.0/8\" $(cat deploy_key.pub)" >> ~/.ssh/authorized_keys

# Disable password login
sudo nano /etc/ssh/sshd_config
  PermitRootLogin no
  PasswordAuthentication no
  PubkeyAuthentication yes
  AllowUsers deploy
sudo systemctl restart sshd
```

#### Database Access
```bash
# Strong password (32-char random)
DB_PASSWORD=$(openssl rand -base64 32)

# Restrict to API container only
# Already enforced in docker-compose via network isolation

# Enable connection logging
sudo nano /etc/postgresql/14/main/postgresql.conf
  log_connections = on
  log_disconnections = on
  log_statement = 'all'

# Restart
sudo systemctl restart postgresql
```

#### Redis Authentication
```bash
# Generate password
REDIS_PASSWORD=$(openssl rand -base64 32)

# Update .env.docker
REDIS_PASSWORD=your_password_here

# Update docker-compose.prod.yml command
command: redis-server --requirepass ${REDIS_PASSWORD}

# Update API env vars
REDIS_PASSWORD=${REDIS_PASSWORD}

# Verify
docker-compose exec ragent2-redis \
  redis-cli -a ${REDIS_PASSWORD} PING
```

### 1.2. Network Security

#### Firewall Rules

```bash
# Enable UFW
sudo ufw enable

# Allow SSH
sudo ufw allow 22/tcp

# Allow HTTP/HTTPS only
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp

# Deny everything else
sudo ufw default deny incoming
sudo ufw default allow outgoing

# Check rules
sudo ufw status verbose

# Block specific countries (optional, if DDoS)
sudo apt-get install geoip-database
# Use fail2ban to block by geolocation
```

#### Docker Network Isolation

```yaml
# docker-compose.prod.yml already uses custom network
networks:
  ragent2-network:
    driver: bridge
    ipam:
      config:
        - subnet: 172.20.0.0/16

# Internal services only accessible within network
# DB and Redis: NO external ports
# API: Only 3000 exposed (behind nginx reverse proxy)
# Nginx: 80/443 public facing
```

#### Rate Limiting (Nginx)

```nginx
# /etc/nginx/nginx.conf
limit_req_zone $binary_remote_addr zone=api_limit:10m rate=10r/s;
limit_req_zone $binary_remote_addr zone=auth_limit:10m rate=5r/s;

server {
  location /api/ {
    limit_req zone=api_limit burst=20 nodelay;
    proxy_pass http://ragent2_api;
  }

  location /api/auth {
    limit_req zone=auth_limit burst=5 nodelay;
    proxy_pass http://ragent2_api;
  }
}
```

#### DDoS Protection

```bash
# Install fail2ban
sudo apt-get install fail2ban

# Create jail for API
sudo nano /etc/fail2ban/jail.d/ragent2.conf

[ragent2-api]
enabled = true
port = http,https
filter = ragent2-api
logpath = /var/log/ragent2/api.log
maxretry = 10
findtime = 600
bantime = 3600

# Create filter
sudo nano /etc/fail2ban/filter.d/ragent2-api.conf

[Definition]
failregex = ^<HOST> .* "POST /api/auth" 401
ignoreregex =

# Restart
sudo systemctl restart fail2ban
```

### 1.3. Application Security

#### Secrets Management

```bash
# Use docker secrets for sensitive data (Swarm mode)
# Or use environment variables from orchestrator

# ❌ Never commit secrets
echo "*.key" >> .gitignore
echo ".env.prod" >> .gitignore

# ✅ Use secrets file (not in git)
DATABASE_PASSWORD=$(cat /run/secrets/db_password)

# Or use HashiCorp Vault
curl -H "X-Vault-Token: $VAULT_TOKEN" \
  https://vault.seu-dominio.com/v1/secret/ragent2 | jq '.data.data'
```

#### API Key Rotation

```bash
# Store API keys in database (encrypted)
-- users table
ALTER TABLE users ADD COLUMN api_key_hash VARCHAR(255);
ALTER TABLE users ADD COLUMN api_key_rotation_at TIMESTAMP;

-- API endpoint to rotate
POST /api/admin/users/:id/rotate-api-key
  Response: { apiKey: "new_key_here" }

-- Enforce rotation every 90 days
Agende um job externo chamando o endpoint de rotacao ou um script operacional interno do ambiente.
```

#### CORS & CSRF

```javascript
// api/express/middleware/cors.js
app.use(cors({
  origin: process.env.CORS_ORIGIN.split(','),
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE']
}));

// CSRF Token protection
app.use(csrf({ cookie: false, sessionKey: 'session' }));

// Example in .env.prod
CORS_ORIGIN=https://seu-dominio.com,https://www.seu-dominio.com
```

#### SQL Injection Prevention

```javascript
// ✅ Use parameterized queries
const user = await db.query(
  'SELECT * FROM users WHERE id = $1',
  [userId]
);

// ❌ Never use string interpolation
const user = await db.query(
  `SELECT * FROM users WHERE id = ${userId}`  // VULNERABILITY!
);
```

### 1.4. SSL/TLS Hardening

```nginx
# /etc/nginx/nginx.conf - Strong SSL config

ssl_protocols TLSv1.2 TLSv1.3;
ssl_ciphers ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES128-GCM-SHA256;
ssl_prefer_server_ciphers off;
ssl_session_cache shared:SSL:10m;
ssl_session_timeout 10m;

# HSTS (Strict Transport Security)
add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;

# CSP (Content Security Policy)
add_header Content-Security-Policy "default-src 'self'" always;

# X-Frame-Options (Clickjacking)
add_header X-Frame-Options "SAMEORIGIN" always;

# X-Content-Type-Options (MIME sniffing)
add_header X-Content-Type-Options "nosniff" always;

# X-XSS-Protection
add_header X-XSS-Protection "1; mode=block" always;
```

---

## 2. Performance Optimization

### 2.1. Database Tuning

```sql
-- Connection pooling
-- In api/db/pool.js
const pool = new pg.Pool({
  max: 20,                    -- Max connections
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

-- Add indexes
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_conversations_tenant_id ON conversations(tenant_id);
CREATE INDEX idx_audit_logs_created_at ON audit_logs(created_at);

-- Vacuum & analyze
VACUUM ANALYZE;
```

### 2.2. Caching Strategy

```javascript
// api/middleware/cache.js
const redisCache = async (key, fn, ttl = 3600) => {
  // Try cache first
  const cached = await redis.get(key);
  if (cached) return JSON.parse(cached);

  // Not cached, execute
  const result = await fn();

  // Cache result
  await redis.setex(key, ttl, JSON.stringify(result));
  return result;
};

// Usage
const user = await redisCache(
  `user:${userId}`,
  () => db.query('SELECT * FROM users WHERE id = $1', [userId]),
  3600  // 1 hour TTL
);
```

#### Cache Invalidation
```javascript
// When user data changes
await redis.del(`user:${userId}`);
await redis.del(`user:${userId}:settings`);
await redis.del(`user:${userId}:devices`);
```

### 2.3. Frontend Optimization

```javascript
// frontend/vite.config.js
export default {
  build: {
    minify: 'terser',
    target: 'es2020',
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom'],
          utils: ['lodash', 'axios']
        }
      }
    }
  }
};

// nginx - compression
gzip on;
gzip_types text/plain text/css application/json application/javascript;
gzip_min_length 1000;
gzip_vary on;

# Cache static assets
location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2)$ {
  expires 1y;
  add_header Cache-Control "public, immutable";
}

# Don't cache HTML
location / {
  add_header Cache-Control "no-cache, no-store, must-revalidate";
  proxy_pass http://ragent2_api;
}
```

### 2.4. Load Balancing (If Multi-API)

```nginx
# nginx.conf - Round-robin load balancing
upstream ragent2_api_pool {
  server api-1:3000 weight=1;
  server api-2:3000 weight=1;
  server api-3:3000 weight=1;
  
  keepalive 32;
}

server {
  location / {
    proxy_pass http://ragent2_api_pool;
    proxy_http_version 1.1;
    proxy_set_header Connection "";
  }
}
```

---

## 3. Monitoring & Observability

### 3.1. Logging

```javascript
// api/middleware/logger.js
const winston = require('winston');

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.json(),
  defaultMeta: { service: 'ragent2-api' },
  transports: [
    new winston.transports.File({ filename: '/var/log/ragent2/error.log', level: 'error' }),
    new winston.transports.File({ filename: '/var/log/ragent2/combined.log' })
  ]
});

// Log requests
app.use((req, res, next) => {
  logger.info({
    method: req.method,
    path: req.path,
    ip: req.ip,
    userId: req.user?.id
  });
  next();
});

// Log errors
app.use((err, req, res, next) => {
  logger.error({
    message: err.message,
    stack: err.stack,
    path: req.path,
    userId: req.user?.id
  });
  res.status(500).json({ error: 'Internal Server Error' });
});
```

#### Log Rotation
```bash
# /etc/logrotate.d/ragent2
/var/log/ragent2/*.log {
  daily
  rotate 30
  compress
  delaycompress
  notifempty
  create 0640 ragent2 ragent2
  sharedscripts
  postrotate
    docker-compose -f /opt/ragent2/docker-compose.prod.yml \
      exec ragent2-api kill -SIGUSR1 \$(pidof node)
  endscript
}

# Test rotation
sudo logrotate -f /etc/logrotate.d/ragent2
```

### 3.2. Metrics & Monitoring (Prometheus + Grafana)

```javascript
// api/middleware/metrics.js
const prometheus = require('prom-client');

// Default metrics
prometheus.collectDefaultMetrics();

// Custom metrics
const httpRequestDuration = new prometheus.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status_code']
});

// Middleware
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = (Date.now() - start) / 1000;
    httpRequestDuration
      .labels(req.method, req.route?.path || req.path, res.statusCode)
      .observe(duration);
  });
  next();
});

// Expose metrics
app.get('/metrics', async (req, res) => {
  res.set('Content-Type', prometheus.register.contentType);
  res.end(await prometheus.register.metrics());
});
```

### 3.3. Health Checks & Alerts

```javascript
// api/routes/health.js
router.get('/health', async (req, res) => {
  const health = {
    status: 'ok',
    timestamp: new Date(),
    uptime: process.uptime(),
    checks: {
      database: await checkDatabase(),
      redis: await checkRedis(),
      rag: await checkRAG()
    }
  };

  const allHealthy = Object.values(health.checks).every(c => c.status === 'ok');
  res.status(allHealthy ? 200 : 503).json(health);
});
```

---

## 4. Disaster Recovery

### 4.1. Backup Strategy

```bash
# Daily database backup
0 2 * * * /opt/ragent2/scripts/backup-db.sh >> /var/log/ragent2/backup.log 2>&1

# /opt/ragent2/scripts/backup-db.sh
#!/bin/bash
BACKUP_DIR="/var/backups/ragent2"
DATE=$(date +%Y%m%d_%H%M%S)

docker-compose -f /opt/ragent2/docker-compose.prod.yml exec -T ragent2-db \
  pg_dump -U ragent2 ragent2_prod > ${BACKUP_DIR}/db_${DATE}.sql

# Compress
gzip ${BACKUP_DIR}/db_${DATE}.sql

# Upload to S3
aws s3 cp ${BACKUP_DIR}/db_${DATE}.sql.gz \
  s3://ragent2-backups/prod/

# Keep only last 30 days locally
find ${BACKUP_DIR} -name "db_*.sql.gz" -mtime +30 -delete
```

### 4.2. Database Restore

```bash
# From backup file
BACKUP_FILE="db_20260420_020000.sql"

# Stop API to prevent writes
docker-compose -f docker-compose.prod.yml stop ragent2-api

# Restore
docker-compose -f docker-compose.prod.yml exec ragent2-db \
  psql -U ragent2 ragent2_prod < ${BACKUP_FILE}

# Restart API
docker-compose -f docker-compose.prod.yml start ragent2-api
```

---

## 5. Checklist Pré-Production

```bash
[ ] SSL/TLS certificates installed & auto-renewal configured
[ ] Database passwords changed from defaults
[ ] Database backups tested & automated
[ ] Firewall configured (UFW rules)
[ ] SSH hardened (key-based auth only)
[ ] API rate limiting enabled
[ ] Logging configured & log rotation enabled
[ ] Health checks passing
[ ] Database connection pooling optimized
[ ] Redis authentication enabled
[ ] Backup/Restore procedures tested
[ ] Audit logging enabled
```

---

## 6. Related Documentation

- [DOUTRINA_OPERACIONAL.md](./DOUTRINA_OPERACIONAL.md)
- [DEPLOY_DOCKER_COMPOSE.md](./DEPLOY_DOCKER_COMPOSE.md)
- [release-checklist.md](./release-checklist.md)

