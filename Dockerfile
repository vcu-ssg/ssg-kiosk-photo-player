# Use official Node 22 LTS slim image
FROM node:22-slim

# Create working directory
WORKDIR /app

# Copy package files first
COPY package*.json ./

# Install production dependencies
RUN npm ci --only=production
#RUN npm install --omit=dev

# Copy remaining app source
COPY . .

# Expose port
EXPOSE 3000

# Start server
CMD ["npm", "start"]
