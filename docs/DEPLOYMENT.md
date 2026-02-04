# Deployment Guide

## Docker Deployment (Recommended)

### Prerequisites
- Docker 24.0+
- Docker Compose 2.0+

### Steps

1. **Configure Environment**
```bash
cp backend/.env.example backend/.env
```

2. **Set Secure Passwords**
```bash
# Generate secure values
export DB_PASSWORD=$(openssl rand -base64 32)
export JWT_SECRET=$(openssl rand -base64 64)

# Update backend/.env with these values
```

3. **Start Services**
```bash
docker-compose up -d
```

4. **Verify**
```bash
curl http://localhost/health
# Should return: {"status":"healthy",...}
```

---

## Manual Deployment

### Database Setup (PostgreSQL 15+)
```bash
psql -U postgres
CREATE DATABASE ministry_dashboard;
CREATE USER ministry_app WITH PASSWORD 'your_password';
GRANT ALL ON DATABASE ministry_dashboard TO ministry_app;
\q

psql -U ministry_app -d ministry_dashboard -f database/schema.sql
psql -U ministry_app -d ministry_dashboard -f database/seed.sql
```

### Backend Setup (Node.js 18+)
```bash
cd backend
npm ci --only=production
cp .env.example .env
# Edit .env with your database and JWT settings

# Start with PM2
npm install -g pm2
pm2 start src/server.js --name ministry-api
pm2 save
```

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| DB_PASSWORD | Yes | Database password |
| JWT_SECRET | Yes | Min 32 chars for signing tokens |
| PORT | No | API port (default: 3001) |
| CORS_ORIGIN | No | Frontend URL |

---

## Security Checklist

- [ ] Change default admin password
- [ ] Set strong DB_PASSWORD
- [ ] Set strong JWT_SECRET (32+ chars)
- [ ] Configure HTTPS/SSL
- [ ] Set up firewall rules
- [ ] Enable database backups

---

## User Accounts

| Username | Role | Access |
|----------|------|--------|
| admin | Director General | All agencies |
| cjia.admin | Agency Admin | CJIA only |
| gwi.admin | Agency Admin | GWI only |
| gpl.admin | Agency Admin | GPL only |
| gcaa.admin | Agency Admin | GCAA only |

**Default password for all:** Admin@2024

---

## API Endpoints

### Authentication
- POST `/api/v1/auth/login` - Login
- POST `/api/v1/auth/logout` - Logout
- GET `/api/v1/auth/profile` - Get profile

### Metrics
- GET `/api/v1/dashboard/metrics` - All latest metrics
- POST `/api/v1/metrics/{agency}` - Submit metrics
- GET `/api/v1/metrics/{agency}/history` - Submission history

---

## Troubleshooting

**Cannot connect to database**
```bash
docker-compose logs postgres
# Check if postgres is healthy
```

**API returns 401**
```bash
# Token expired - login again
# Or check JWT_SECRET matches
```

**Port already in use**
```bash
# Change PORT in .env or docker-compose.yml
```

---

*Ministry of Public Utilities and Aviation*
