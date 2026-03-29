# 使用 Debian slim：firebase-admin / gRPC 在 Alpine(musl) 上常崩溃或无法启动，导致 Railway 报 Application failed to respond
FROM node:20-bookworm-slim
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY index.js ./
ENV NODE_ENV=production
EXPOSE 8080
CMD ["node", "index.js"]
