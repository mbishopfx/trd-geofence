FROM node:20-alpine

WORKDIR /app

COPY backend/package*.json ./
RUN npm ci --omit=dev

COPY backend/. ./

ENV NODE_ENV=production

CMD ["npm", "start"]
