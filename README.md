# Worker AtualizaAI

Robô que aplica título, sobre e experiência no seu LinkedIn.

## Variáveis
- `WORKER_TOKEN` (obrigatório, 24+ caracteres) — o mesmo do campo "Token" no painel Admin.
- `LINKEDIN_LI_AT` — cookie `li_at` da sua conta (navegador → F12 → Application → Cookies → linkedin.com).
- `HEADLESS` — `false` para ver o navegador (só em máquina com tela).

## Subir (Railway, Fly.io, Render ou VPS com Docker)
```
docker build -t atualizai-worker .
docker run -d -p 8080:8080 -e WORKER_TOKEN=... -e LINKEDIN_LI_AT=... -v $(pwd)/session:/home/pptruser/app/session atualizai-worker
```
Precisa de HTTPS público (Railway/Fly/Render dão automático; em VPS use Caddy/Nginx).

## Payloads
- `POST /apply_headline` `{ "text": "..." }`
- `POST /apply_about` `{ "text": "..." }`
- `POST /apply_experience` `{ "title": "...", "company": "...", "description": "..." }`

Automação de navegador viola os termos do LinkedIn e pode restringir a conta. Use com moderação.
