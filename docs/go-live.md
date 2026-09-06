# Bharatiya Bazaar (भारतीय बाज़ार) — Production Go-Live Runbook

## 1. Prerequisites & Server Environment
- Node.js >= 20.x LTS
- PostgreSQL 15+ running and accessible
- PM2 installed globally: `npm install -g pm2`

## 2. Environment Configuration
Create `/var/www/bb-backend/.env` based on `.env.example`:
```env
NODE_ENV=production
PORT=4000
DATABASE_URL="postgresql://<USER>:<PASSWORD>@<HOST>:5432/<DB>?schema=public"
JWT_SECRET="<64_CHAR_STRONG_RANDOM_SECRET>"
SUPERADMIN_EMAIL="admin@bharatiyabazaar.com"
SUPERADMIN_PASSWORD="<STRONG_ADMIN_PASSWORD>"
CORS_ORIGINS="https://bharatiyabazaar.com,https://www.bharatiyabazaar.com"
```

## 3. Production Deployment & Database Migration Sequence

Execute the deployment commands in strict order:

```bash
# 1. Install production dependencies
npm ci --only=production

# 2. Deploy Prisma migrations
npx prisma migrate deploy

# 3. Apply PostgreSQL ledger integrity and immutability triggers
node scripts/apply-ledger-triggers.js

# 4. Verify financial ledger reconciliation parity (must output Delta = 0)
node scripts/reconcile.js
```

## 4. PM2 Process Launch

```bash
# Start backend in single-instance mode (enforcing single-cron execution)
pm2 start ecosystem.config.js --env production

# Save process list and register OS startup daemon
pm2 save
pm2 startup
```

## 5. Post-Launch Health Verification

```bash
# 1. Basic Health Check
curl -s http://localhost:4000/api/health

# 2. Database Connection Check
curl -s http://localhost:4000/api/health/db

# 3. Verify PM2 status and logs
pm2 status
pm2 logs bb-backend --lines 50
```

## 6. Security Note on Reset Scripts
All `scratch/` reset scripts are protected with production whitelist guards (`NODE_ENV !== "development"`). Never bypass these guards on live environments.
