FROM node:22-alpine

WORKDIR /app

COPY loadtest/package.json ./
RUN npm install --omit=dev

COPY loadtest/load-test.mjs /app/load-test.mjs

ENTRYPOINT ["node", "/app/load-test.mjs"]
