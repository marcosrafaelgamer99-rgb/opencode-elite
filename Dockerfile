# Use Node.js optimized for production
FROM node:20-alpine

# Set the working directory
WORKDIR /app

# Copy package files
COPY package.json package-lock.json ./

# Install dependencies statically
RUN npm ci

# Copy the rest of the application
COPY . .

# Build the TypeScript code (if you have a build step, otherwise we can run it closely with tsx)
# In our case we use tsx so we don't strictly need tsc, but HF Spaces gives us 16GB free RAM.
# We'll just run it directly.

# Set Hugging Face environment variable requirements
ENV HOST=0.0.0.0
# Hugging Face default port is 7860
ENV PORT=7860

# Expose the default HF port
EXPOSE 7860

# Start the Node.js API server
CMD ["npm", "run", "dev"]
