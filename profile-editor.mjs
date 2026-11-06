// Editing stays on the profile already opened by the authenticated browser.
export function profileBaseUrl(raw) {
  const url = new URL(raw);
  const match = url.pathname.match(/^\/in\/([^/]+)\/?$/);
  if (url.protocol !== "https:" || url.hostname !== "www.linkedin.com" || !match || match[1] === "me") {
    throw new Error("Abra o endereço real do seu perfil. Configure LINKEDIN_PROFILE_URL no Railway; o atalho /in/me/ não pode ser usado para editar.");
  }
  return `${url.origin}/in/${match[1]}/`;
}

export async function openProfileEditor(page, section, ctx = {}) {
  if (ctx.onFeed) {
    throw new Error("O LinkedIn não permitiu abrir seu perfil para edição. A leitura alternativa não permite alterações; use Copiar para aplicar manualmente.");
  }
  const base = profileBaseUrl(page.url());
  const selectors = {
    intro: "main h1",
    about: "#about",
    experience: "#experience",
  };
  const field = {
    intro: "textarea[id*='headline'], input[id*='headline']",
    about: "textarea",
    experience: "input[id*='title']",
  }[section];
  if (!field || !selectors[section]) throw new Error("Seção de edição desconhecida.");
  // Restrict to the section and to a same-profile edit link; never click another person's profile.
  const editPath = { intro: "edit/intro", about: "edit/forms/summary", experience: "add-edit/POSITION" }[section];
  const handle = await page.evaluateHandle((anchor, prefix) => {
    const sectionEl = document.querySelector(anchor)?.closest("section");
    return Array.from(sectionEl?.querySelectorAll("a[href]") || []).find((link) => link.href.startsWith(prefix)) || null;
  }, selectors[section], `${base}${editPath}`);
  const link = handle.asElement();
  try {
    if (link) {
      await link.click();
    } else {
      const suffix = { intro: "edit/intro/", about: "edit/forms/summary/new/", experience: "add-edit/POSITION/" }[section];
      await page.goto(`${base}${suffix}`, { waitUntil: "domcontentloaded", timeout: 30_000 });
    }
    await page.waitForSelector(`[role='dialog'] ${field.split(", ").join(", [role='dialog'] ")}`, { visible: true, timeout: 15_000 });
  } catch {
    throw new Error("O LinkedIn não abriu o formulário de edição do seu perfil. Nenhuma alteração foi salva; use Copiar para aplicar manualmente.");
  } finally {
    await handle.dispose();
  }
  return `[role='dialog'] ${field.split(", ").join(", [role='dialog'] ")}`;
}