# Skill Tracking — Radar + détecteur profond, prêt pour Google Cloud Run (europe-west1)
FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8080 PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
COPY package.json ./
RUN npm install --omit=dev && npx playwright install --with-deps chromium && rm -rf /root/.npm
COPY . .
EXPOSE 8080
CMD ["node", "server.js"]
