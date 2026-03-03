FROM node:20-alpine

WORKDIR /app

# Simple static hosting for Railway with dynamic PORT support
RUN npm install -g serve

COPY . .

CMD ["sh", "-c", "serve -s . -l ${PORT:-3000}"]
