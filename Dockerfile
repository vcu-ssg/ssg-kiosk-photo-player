# Use lightweight Node image
FROM node:22-slim

WORKDIR /app

# Copy package files and install
COPY package*.json ./
RUN npm ci --only=production

# Copy the rest of the app
COPY . .

# Expose port
EXPOSE 3000

# Start server
CMD ["npm", "start"]
