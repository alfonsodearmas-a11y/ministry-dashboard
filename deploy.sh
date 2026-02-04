#!/bin/bash
set -e

echo "Installing dependencies..."
apt-get update
apt-get install -y curl git nginx postgresql postgresql-contrib

# Install Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs
npm install -g pm2

echo "Setting up database..."
DB_PASSWORD=$(openssl rand -base64 24)
JWT_SECRET=$(openssl rand -base64 48)

systemctl start postgresql
systemctl enable postgresql

sudo -u postgres psql -c "DROP DATABASE IF EXISTS ministry_dashboard;"
sudo -u postgres psql -c "DROP USER IF EXISTS ministry_app;"
sudo -u postgres psql -c "CREATE USER ministry_app WITH ENCRYPTED PASSWORD '$DB_PASSWORD';"
sudo -u postgres psql -c "CREATE DATABASE ministry_dashboard OWNER ministry_app;"

echo "Applying schema..."
cd /opt/ministry-dashboard
PGPASSWORD=$DB_PASSWORD psql -U ministry_app -h localhost -d ministry_dashboard -f database/schema.sql

echo "Configuring backend..."
cd /opt/ministry-dashboard/backend
cat > .env << EOF
NODE_ENV=production
PORT=3001
DB_HOST=localhost
DB_PORT=5432
DB_NAME=ministry_dashboard
DB_USER=ministry_app
DB_PASSWORD=$DB_PASSWORD
JWT_SECRET=$JWT_SECRET
JWT_EXPIRES_IN=8h
CORS_ORIGIN=*
BCRYPT_ROUNDS=12
LOG_LEVEL=info
EOF

mkdir -p logs
npm ci --only=production

echo "Configuring Nginx..."
cat > /etc/nginx/sites-available/ministry-dashboard << 'NGINX'
server {
    listen 80;
    server_name _;
    location /api { proxy_pass http://127.0.0.1:3001; proxy_set_header Host $host; proxy_set_header X-Real-IP $remote_addr; }
    location /health { proxy_pass http://127.0.0.1:3001/health; }
    location / { root /var/www/ministry-dashboard; index index.html; try_files $uri $uri/ /index.html; }
}
NGINX

ln -sf /etc/nginx/sites-available/ministry-dashboard /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default

mkdir -p /var/www/ministry-dashboard
echo "<!DOCTYPE html><html><head><title>Ministry Dashboard</title></head><body style=\"font-family:system-ui;background:#0f172a;color:white;display:flex;justify-content:center;align-items:center;height:100vh\"><div style=\"text-align:center\"><h1 style=\"color:#2dd4bf\">Ministry Dashboard</h1><p>API running at <a href=\"/health\" style=\"color:#2dd4bf\">/health</a></p></div></body></html>" > /var/www/ministry-dashboard/index.html

nginx -t && systemctl restart nginx && systemctl enable nginx

echo "Starting API..."
cd /opt/ministry-dashboard/backend
pm2 delete ministry-api 2>/dev/null || true
pm2 start src/server.js --name ministry-api
pm2 save
pm2 startup systemd -u root --hp /root

echo ""
echo "===== DEPLOYMENT COMPLETE ====="
echo "DB Password: $DB_PASSWORD"
echo "JWT Secret: $JWT_SECRET"
echo "Login: admin / Admin@2024"
echo "==============================="
