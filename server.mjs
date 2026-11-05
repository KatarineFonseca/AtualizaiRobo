// AtualizaAI — worker externo de automação do LinkedIn (Node + Puppeteer Stealth).
// Endpoints: GET /health, POST /read_profile, POST /apply_headline, POST /apply_about, POST /apply_experience
// Todos exigem: Authorization: Bearer <WORKER_TOKEN>
import http from "node:http";
import fs from "node:fs";
import crypto from "node:crypto";
import puppeteer from "puppeteer-extra";
import Stealth from "puppeteer-extra-plugin-stealth";

puppeteer.use(Stealth());

const PORT = Number(process.env.PORT || 8080);
const TOKEN = process.env.WORKER_TOKEN || "";
// Aceita o valor colado com aspas, espaços ou com o prefixo "li_at=".
const cleanCookie = (v) => (v || "").trim().replace(/^(li_at|JSESSIONID)=/i, "").replace(/^"+|"+$/g, "").replace(/;.*$/, "").trim();
const LI_AT = cleanCookie(process.env.LINKEDIN_LI_AT); // cookie de sessão "li_at" da sua conta
const JSESSIONID = cleanCookie(process.env.LINKEDIN_JSESSIONID); // opcional
const USER_AGENT = (process.env.LINKEDIN_USER_AGENT || "").trim(); // opcional: o mesmo do seu navegador
const SESSION_DIR = process.env.SESSION_DIR || "./session";
const HEADLESS = process.env.HEADLESS !== "false";

if (TOKEN.length < 24) {
  console.error("WORKER_TOKEN ausente ou fraco (mínimo 24 caracteres).");
  process.exit(1);
}
fs.mkdirSync(SESSION_DIR, { recursive: true });

let busy = false; // uma automação por vez, para parecer uso humano
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const human = () => sleep(800 + Math.random() * 1700);

function authorized(req) {
  const got = Buffer.from(req.headers.authorization || "");
  const want = Buffer.from(`Bearer ${TOKEN}`);
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

function send(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function pickText(source, keys) {
  for (const key of keys) {
    const value = source?.[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

async function readJson(req) {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 100_000) throw new Error("payload muito grande");
  }
  return raw ? JSON.parse(raw) : {};
}

async function withBrowser(fn) {
  const browser = await puppeteer.launch({
    headless: HEADLESS,
    userDataDir: SESSION_DIR,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1366, height: 900 });
    // Mesmo navegador do usuário (opcional): o LinkedIn desconfia quando a sessão muda de navegador.
    if (USER_AGENT) await page.setUserAgent(USER_AGENT);
    await page.setExtraHTTPHeaders({ "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8" });
    if (LI_AT) {
      // Cookies antigos guardados na pasta de sessão brigam com o li_at novo e causam
      // ERR_TOO_MANY_REDIRECTS. Limpa tudo e usa só o li_at informado.
      const cdp = await page.target().createCDPSession();
      await cdp.send("Network.clearBrowserCookies");
      const cookies = [{ name: "li_at", value: LI_AT, domain: ".linkedin.com", path: "/", secure: true, httpOnly: true }];
      if (JSESSIONID) cookies.push({ name: "JSESSIONID", value: `"${JSESSIONID}"`, domain: ".www.linkedin.com", path: "/", secure: true });
      await page.setCookie(...cookies);
    }
    const expired = (why) =>
      `Sessão do LinkedIn expirada ou recusada (${why}). Pegue um novo cookie li_at (F12 → Application → Cookies → linkedin.com), atualize LINKEDIN_LI_AT no Railway e tente de novo.`;
    try {
      await page.goto("https://www.linkedin.com/feed/", { waitUntil: "domcontentloaded", timeout: 45_000 });
    } catch (err) {
      if (/TOO_MANY_REDIRECTS|ERR_ABORTED/.test(err.message)) throw new Error(expired("o LinkedIn ficou redirecionando"));
      throw err;
    }
    await human();
    const url1 = page.url();
    if (/checkpoint|challenge/.test(url1)) {
      throw new Error("O LinkedIn pediu verificação de segurança para o robô. Entre no LinkedIn pelo seu navegador, confirme o acesso se aparecer aviso, copie um li_at novo e atualize LINKEDIN_LI_AT no Railway.");
    }
    if (/login|authwall|uas\//.test(url1)) throw new Error(expired("o LinkedIn mandou para a tela de login"));
    // descobre o endereço do próprio perfil pelo menu (evita o redirecionamento de /in/me/)
    const profileUrl = await page.evaluate(() => {
      const a = Array.from(document.querySelectorAll("a[href*='/in/']"))
        .map((el) => el.href.split("?")[0])
        .find((href) => /linkedin\.com\/in\/[^/]+\/?$/.test(href));
      return a || null;
    });
    try {
      await page.goto(profileUrl || "https://www.linkedin.com/in/me/", { waitUntil: "domcontentloaded", timeout: 45_000 });
    } catch (err) {
      if (/TOO_MANY_REDIRECTS/.test(err.message)) throw new Error(expired("o LinkedIn ficou redirecionando no perfil"));
      throw err;
    }
    await human();
    if (/login|checkpoint|authwall/.test(page.url())) throw new Error(expired("o perfil pediu login"));
    return await fn(page);
  } finally {
    await browser.close();
  }
}

async function clickByText(page, selector, regex) {
  const handles = await page.$$(selector);
  for (const h of handles) {
    const text = await h.evaluate((el) => (el.innerText || el.getAttribute("aria-label") || "").trim());
    if (regex.test(text)) { await h.click(); return true; }
  }
  return false;
}

async function typeInto(page, selector, text) {
  await page.waitForSelector(selector, { timeout: 15_000 });
  await page.click(selector, { clickCount: 3 });
  await page.keyboard.press("Backspace");
  await page.type(selector, text, { delay: 25 + Math.random() * 40 });
}

async function save(page) {
  await human();
  const ok = await clickByText(page, "button", /^(Salvar|Save)$/i);
  if (!ok) throw new Error("Botão Salvar não encontrado.");
  await sleep(3000);
}

const actions = {
  // Lê o perfil atual (somente leitura): textos das seções + até 3 capturas.
  async read_profile(page) {
    await page.waitForSelector("main h1", { timeout: 20_000 }).catch(() => {});
    const shots = [];
    const shot = async () => {
      shots.push(await page.screenshot({ type: "jpeg", quality: 55, encoding: "base64" }));
    };
    await shot();
    // rola devagar para o LinkedIn carregar Sobre/Experiência/Competências
    for (let i = 0; i < 8; i++) {
      await page.evaluate(() => window.scrollBy(0, 700));
      await sleep(700 + Math.random() * 500);
    }
    const data = await page.evaluate(() => {
      const t = (el) => (el?.innerText || "").trim();
      const h1 = document.querySelector("main h1");
      const intro = h1?.closest("section");
      const section = (id) => t(document.getElementById(id)?.closest("section"));
      return {
        name: t(h1),
        headline: t(intro?.querySelector(".text-body-medium")),
        location: t(intro?.querySelector(".text-body-small.inline")),
        url: location.href.split("?")[0],
        aboutRaw: section("about"),
        experienceRaw: section("experience"),
        educationRaw: section("education"),
        skillsRaw: section("skills"),
      };
    });
    for (const id of ["about", "experience"]) {
      const found = await page.evaluate((anchorId) => {
        const el = document.getElementById(anchorId)?.closest("section");
        if (!el) return false;
        el.scrollIntoView({ block: "start" });
        return true;
      }, id);
      if (found) { await sleep(800); await shot(); }
    }
    const cut = (s, n) => (s || "").slice(0, n);
    return {
      name: cut(data.name, 200),
      headline: cut(data.headline, 600),
      location: cut(data.location, 200),
      url: cut(data.url, 400),
      aboutRaw: cut(data.aboutRaw, 12000),
      experienceRaw: cut(data.experienceRaw, 20000),
      educationRaw: cut(data.educationRaw, 12000),
      skillsRaw: cut(data.skillsRaw, 12000),
      screenshots: shots.slice(0, 3),
    };
  },
  async apply_headline(page, body) {
    const text = pickText(body, ["text", "headline", "value"]);
    if (!text) throw new Error("Informe 'text' (ou 'headline').");
    await page.goto("https://www.linkedin.com/in/me/edit/intro/", { waitUntil: "domcontentloaded" });
    await typeInto(page, "textarea[id*='headline'], input[id*='headline']", text.slice(0, 220));
    await save(page);
    return { applied: "headline" };
  },
  async apply_about(page, body) {
    const text = pickText(body, ["text", "about", "value"]);
    if (!text) throw new Error("Informe 'text' (ou 'about').");
    await page.goto("https://www.linkedin.com/in/me/edit/forms/summary/new/", { waitUntil: "domcontentloaded" });
    await typeInto(page, "textarea", text.slice(0, 2600));
    await save(page);
    return { applied: "about" };
  },
  async apply_experience(page, body) {
    const item = Array.isArray(body?.experience)
      ? body.experience.find((entry) => entry && typeof entry === "object")
      : null;
    const merged = { ...(item ?? {}), ...(body ?? {}) };
    const title = pickText(merged, ["title", "role"]);
    const company = pickText(merged, ["company", "organization"]);
    let description = pickText(merged, ["description"]);
    if (!description && Array.isArray(item?.bullets)) {
      description = item.bullets.filter((b) => typeof b === "string").map((b) => `• ${b}`).join("\n");
    }
    if (!title || !company) throw new Error("Informe 'title' e 'company'.");
    await page.goto("https://www.linkedin.com/in/me/add-edit/POSITION/", { waitUntil: "domcontentloaded" });
    await typeInto(page, "input[id*='title']", title.slice(0, 100));
    await human();
    await typeInto(page, "input[id*='requiredCompany'], input[id*='company']", company.slice(0, 100));
    await sleep(1500);
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    if (description) await typeInto(page, "textarea[id*='description']", description.slice(0, 2000));
    await save(page);
    return { applied: "experience" };
  },
};

http.createServer(async (req, res) => {
  const requestId = req.headers["x-request-id"] || crypto.randomUUID();
  const path = new URL(req.url, "http://x").pathname.replace(/^\/+/, "");
  if (!authorized(req)) return send(res, 401, { ok: false, error: "unauthorized" });

  if (req.method === "GET" && path === "health") {
    return send(res, 200, { ok: true, busy, session: Boolean(LI_AT) || fs.readdirSync(SESSION_DIR).length > 0 });
  }
  const action = actions[path];
  if (req.method !== "POST" || !action) return send(res, 404, { ok: false, error: "not_found" });
  if (busy) return send(res, 429, { ok: false, error: "busy" });

  busy = true;
  try {
    const body = await readJson(req);
    const result = await withBrowser((page) => action(page, body));
    console.log(`[${requestId}] ${path} ok`);
    send(res, 200, { ok: true, requestId, ...result });
  } catch (err) {
    console.error(`[${requestId}] ${path} falhou:`, err.message);
    send(res, 500, { ok: false, requestId, error: err.message });
  } finally {
    busy = false;
  }
}).listen(PORT, () => console.log(`Worker AtualizaAI na porta ${PORT}`));
