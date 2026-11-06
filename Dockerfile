FROM ghcr.io/puppeteer/puppeteer:23.11.1
# A imagem roda como o usuário "pptruser"; use uma pasta que ele possa gravar.
WORKDIR /home/pptruser/app
COPY --chown=pptruser:pptruser package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY --chown=pptruser:pptruser server.mjs profile-editor.mjs ./
ENV PORT=8080
ENV SESSION_DIR=/home/pptruser/app/session
EXPOSE 8080
CMD ["node", "server.mjs"]
