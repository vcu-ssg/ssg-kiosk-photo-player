# ------------------------------------------------------------
# 🟢 Base image — Node 22 LTS (Debian Slim)
# ------------------------------------------------------------
FROM node:22-slim

# Create working directory
WORKDIR /app

# ------------------------------------------------------------
# 📦 Copy package manifests first (for cached install)
# ------------------------------------------------------------
COPY package*.json ./

# ------------------------------------------------------------
# 🧠 Install runtime dependencies
# Add modules required by server.js (dotenv, js-yaml, glob)
# ------------------------------------------------------------
RUN npm ci --omit=dev && \
    npm install --no-save express morgan js-yaml glob dotenv

# ------------------------------------------------------------
# 📁 Copy remaining source
# ------------------------------------------------------------
COPY . .

# Ensure common folders exist (prevents missing-volume errors)
RUN mkdir -p /app/photos /app/public /app/pages /app/logs

# ------------------------------------------------------------
# ⚙️ Environment defaults
# ------------------------------------------------------------
ENV NODE_ENV=production \
    PORT=3000

# ------------------------------------------------------------
# 🚪 Expose port & start the kiosk
# ------------------------------------------------------------
EXPOSE 3000
CMD ["node", "server.js"]
