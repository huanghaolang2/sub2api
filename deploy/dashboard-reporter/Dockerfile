FROM node:24-bookworm-slim

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev \
  && npx playwright install --with-deps chromium \
  && npm cache clean --force

COPY reporter.mjs ./

CMD ["node", "reporter.mjs"]
