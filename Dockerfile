# Dockerfile

########################
# 1) Build stage
########################
FROM node:20-alpine AS build

# Set working directory inside the container
WORKDIR /app

# Install build dependencies
# Copy only package files first for better caching
COPY package.json package-lock.json* pnpm-lock.yaml* yarn.lock* ./

# You can switch to pnpm/yarn if your project uses them.
# By default, we use npm.
RUN npm install

# Now copy the rest of the project
COPY . .

# Build the production bundle (Vite)
RUN npm run build

########################
# 2) Nginx serve stage
########################
FROM nginx:stable-alpine

# Remove default Nginx config
RUN rm /etc/nginx/conf.d/default.conf

# Copy our custom nginx config
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy built frontend files from build stage
COPY --from=build /app/dist /usr/share/nginx/html

# Expose port 80 inside the container
EXPOSE 80

# Default Nginx start command
CMD ["nginx", "-g", "daemon off;"]
