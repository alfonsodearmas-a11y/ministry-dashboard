# Ministry of Public Utilities and Aviation
## Operations Dashboard System

A production-ready dashboard system for monitoring KPIs across four government agencies.

## Quick Start

```bash
# 1. Configure environment
cp backend/.env.example backend/.env
# Edit backend/.env with secure passwords

# 2. Start with Docker
docker-compose up -d

# 3. Access
# Dashboard: http://localhost
# API Health: http://localhost/health
```

## Default Credentials
- **Username:** admin
- **Password:** Admin@2024
- ⚠️ Change immediately after first login!

## Project Structure
```
ministry-dashboard/
├── backend/           # Node.js/Express API
├── frontend/          # React Admin Portal
├── database/          # PostgreSQL schema
├── nginx/             # Reverse proxy config
├── docs/              # Deployment guide
└── docker-compose.yml
```

## Agencies Covered
- **CJIA** - Cheddi Jagan International Airport
- **GWI** - Guyana Water Inc.
- **GPL** - Guyana Power & Light
- **GCAA** - Guyana Civil Aviation Authority

## Features
- ✅ JWT Authentication with role-based access
- ✅ Full audit trail logging
- ✅ Account lockout protection
- ✅ Rate limiting
- ✅ Approval workflow for submissions
- ✅ Alert thresholds for critical metrics
- ✅ Docker deployment ready

## Documentation
See `docs/DEPLOYMENT.md` for complete setup instructions.

---
*Ministry of Public Utilities and Aviation - Government of Guyana*
