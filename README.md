# Worker AtualizaAI

Robô que aplica título, sobre e experiência no seu LinkedIn.

## Variáveis
- `WORKER_TOKEN` (obrigatório, 24+ caracteres) — o mesmo do campo "Token" no painel Admin.
- `LINKEDIN_LI_AT` — cookie `li_at` da sua conta (navegador → F12 → Application → Cookies → linkedin.com).
- `LINKEDIN_COOKIES` (opcional, recomendado) — todos os cookies do LinkedIn exportados do navegador
  (extensão Cookie-Editor → abrir em linkedin.com → Export → JSON). Tem prioridade sobre `LINKEDIN_LI_AT`
  e evita o erro "o LinkedIn ficou redirecionando".
- `LINKEDIN_PROFILE_URL` (opcional, recomendado) — endereço do seu perfil, ex.: https://www.linkedin.com/in/seu-nome/. Evita o erro "redirecionando no perfil".
- `LINKEDIN_JSESSIONID` (opcional) — cookie `JSESSIONID` da mesma tela; ajuda o LinkedIn a aceitar a sessão.
- `LINKEDIN_USER_AGENT` (opcional) — identificação do seu navegador (abra https://www.whatismybrowser.com/detect/what-is-my-user-agent e copie). Use o mesmo navegador de onde copiou o li_at.
- `HEADLESS` — `false` para ver o navegador (só em máquina com tela).

## Subir (Railway, Fly.io, Render ou VPS com Docker)
```
docker build -t atualizai-worker .
docker run -d -p 8080:8080 -e WORKER_TOKEN=... -e LINKEDIN_LI_AT=... -v $(pwd)/session:/home/pptruser/app/session atualizai-worker
```
Precisa de HTTPS público (Railway/Fly/Render dão automático; em VPS use Caddy/Nginx).

## Payloads
- `POST /read_profile` — lê o perfil atual (somente leitura) e devolve textos + capturas
- `POST /apply_headline` `{ "text": "..." }`
- `POST /apply_about` `{ "text": "..." }`
- `POST /apply_experience` `{ "title": "...", "company": "...", "description": "..." }`

Também são aceitos: `headline`/`about`/`value` no lugar de `text`, e `role`/`organization`
ou um array `experience` (usa o primeiro bloco) no lugar de `title`/`company`.

Automação de navegador viola os termos do LinkedIn e pode restringir a conta. Use com moderação.
