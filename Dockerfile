FROM node:22-slim

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

ENV PORT=3000
ENV DB_PATH=/app/data/smolov.db

EXPOSE 3000
VOLUME ["/app/data"]

CMD ["node", "server/index.js"]
