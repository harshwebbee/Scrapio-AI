FROM mcr.microsoft.com/playwright:v1.45.3-jammy

WORKDIR /app
ENV NODE_ENV=development

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/scraper/package.json packages/scraper/package.json

RUN npm ci

COPY . .

RUN npm run build -w packages/scraper

EXPOSE 3000 4000
