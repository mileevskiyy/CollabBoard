FROM node:24-bookworm-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build && mkdir -p /app/data && chown node:node /app/data
USER node
ENV HOST=0.0.0.0 PORT=3700 DATABASE_PATH=:memory:
EXPOSE 3700
CMD ["node", "--import", "tsx", "server/index.ts"]
