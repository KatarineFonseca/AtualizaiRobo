// AtualizaAI — worker externo de automação do LinkedIn (Node + Puppeteer Stealth).
// Endpoints: GET /health, POST /apply_headline, POST /apply_about, POST /apply_experience
// Todos exigem: Authorization: Bearer <WORKER_TOKEN>
import http from "node:http";
import fs from "node:fs";
import crypto from "node:crypto";
import puppeteer from "puppeteer-extra";
import Stealth from "puppeteer-extra-plugin-stealth";

puppeteer.use(Stealth());

const PORT = Number(process.env.PORT || 8080);
const TOKEN = process.env.WORKER_TOKEN || "";
const LI_AT = process.env.LINKEDIN_LI_AT || ""; // cookie de sessão "li_at" da sua conta
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
    if (LI_AT) {
      await page.setCookie({ name: "li_at", value: LI_AT, domain: ".linkedin.com", path: "/", secure: true, httpOnly: true });
    }
    await page.goto("https://www.linkedin.com/in/me/", { waitUntil: "domcontentloaded", timeout: 45_000 });
    await human();
    if (/login|checkpoint|authwall/.test(page.url())) {
      throw new Error("Sessão do LinkedIn inválida: atualize LINKEDIN_LI_AT.");
    }
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
  async apply_headline(page, { text }) {
    if (!text) throw new Error("Informe 'text'.");
    await page.goto("https://www.linkedin.com/in/me/edit/intro/", { waitUntil: "domcontentloaded" });
    await typeInto(page, "textarea[id*='headline'], input[id*='headline']", String(text).slice(0, 220));
    await save(page);
    return { applied: "headline" };
  },
  async apply_about(page, { text }) {
    if (!text) throw new Error("Informe 'text'.");
    await page.goto("https://www.linkedin.com/in/me/edit/forms/summary/new/", { waitUntil: "domcontentloaded" });
    await typeInto(page, "textarea", String(text).slice(0, 2600));
    await save(page);
    return { applied: "about" };
  },
  async apply_experience(page, { title, company, description }) {
    if (!title || !company) throw new Error("Informe 'title' e 'company'.");
    await page.goto("https://www.linkedin.com/in/me/add-edit/POSITION/", { waitUntil: "domcontentloaded" });
    await typeInto(page, "input[id*='title']", String(title).slice(0, 100));
    await human();
    await typeInto(page, "input[id*='requiredCompany'], input[id*='company']", String(company).slice(0, 100));
    await sleep(1500);
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    if (description) await typeInto(page, "textarea[id*='description']", String(description).slice(0, 2000));
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
