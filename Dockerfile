# One image: Fastify API + built React UI. Database comes from DATABASE_URL.
FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build
ENV NODE_ENV=production PORT=3001
EXPOSE 3001
CMD ["npm", "start"]
