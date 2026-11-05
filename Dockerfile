FROM ghcr.io/puppeteer/puppeteer:23.11.1
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY server.mjs ./
ENV PORT=8080 SESSION_DIR=/app/session
VOLUME ["/app/session"]
EXPOSE 8080
CMD ["node", "server.mjs"]
