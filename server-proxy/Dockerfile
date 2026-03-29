FROM node:20-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY index.js ./
ENV NODE_ENV=production
# Railway 等平台常用 PORT=8080；与 Networking 里填的端口保持一致
ENV PORT=8080
EXPOSE 8080
CMD ["node", "index.js"]
