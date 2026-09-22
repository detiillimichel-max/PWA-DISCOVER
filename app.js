const CONFIG = Object.freeze({
  CATALOG_URL: "./catalog/discover.json",
  CATALOG_CACHE_NAME: "discover-catalog-v4",
  CATALOG_CACHE_TTL_HOURS: 24,
  CATALOG_CACHE_META_KEY: "discover-catalog-cache-meta-v3",
  SEARCH_CACHE_TTL_HOURS: 6,
  SEARCH_CACHE_PREFIX: "discover-search-v3:",
  SEARCH_FIELDS: ["title", "description", "type", "source", "tags"]
});

let catalog = [];

const $ = (selector) => document.querySelector(selector);

function normalize(text) {
  return String(text || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function tokenize(text) {
  return normalize(text)
    .split(/\s+/)
    .map(token => token.replace(/[^a-z0-9À-ÿ-]/gi, ""))
    .filter(Boolean);
}

function searchableText(item) {
  return normalize(
    CONFIG.SEARCH_FIELDS.map(field => {
      const value = item?.[field];
      return Array.isArray(value) ? value.join(" ") : value || "";
    }).join(" ")
  );
}

function searchScore(item, query, tokens) {
  const title = normalize(item?.title);
  const tags = normalize(Array.isArray(item?.tags) ? item.tags.join(" ") : item?.tags);
  const type = normalize(item?.type);
  const source = normalize(item?.source);
  const description = normalize(item?.description);
  let score = 0;

  if (title === query) score += 100;
  if (tags === query) score += 90;
  if (title.includes(query)) score += 50;
  if (tags.includes(query)) score += 35;
  if (type.includes(query)) score += 25;
  if (source.includes(query)) score += 20;
  if (description.includes(query)) score += 10;

  for (const token of tokens) {
    if (title.includes(token)) score += 12;
    else if (tags.includes(token)) score += 9;
    else if (type.includes(token)) score += 6;
    else if (source.includes(token)) score += 5;
    else if (description.includes(token)) score += 2;
  }

  return score;
}

function searchCatalog(term) {
  const query = normalize(term);
  if (!query) return catalog;

  const tokens = tokenize(query);
  if (!tokens.length) return catalog;

  return catalog
    .filter(item => {
      const text = searchableText(item);
      return tokens.every(token => text.includes(token));
    })
    .map(item => ({ item, score: searchScore(item, query, tokens) }))
    .sort((a, b) => b.score - a.score)
    .map(result => result.item);
}

function render(items) {
  const grid = $("#discover-grid");
  const term = $("#search").value.trim();

  $("#result-count").textContent =
    `${items.length} ${items.length === 1 ? "item" : "itens"}`;

  if (term) {
    $("#catalog-status").textContent =
      `Busca local • ${items.length} ${items.length === 1 ? "resultado" : "resultados"}`;
  } else {
    $("#catalog-status").textContent =
      `${catalog.length} itens no catálogo local • sem consulta externa`;
  }

  if (!items.length) {
    grid.innerHTML = `
      <div class="empty">
        Nenhum resultado para “${escapeHtml(term)}”.<br>
        <small>A busca consulta somente o catálogo local.</small>
      </div>
    `;
    return;
  }

  grid.innerHTML = items.map(item => `
    <article class="card">
      <div class="card-media">
        <img
          src="${escapeHtml(item.image || "")}"
          alt=""
          loading="lazy"
          referrerpolicy="no-referrer"
        >
      </div>
      <div class="card-body">
        <h3>${escapeHtml(item.title)}</h3>
        <p>${escapeHtml(item.description || "")}</p>
        <span class="tag">${escapeHtml(item.type || "discover")}</span>
        <span class="tag">${escapeHtml(item.source || "catálogo local")}</span>
        ${item.type === "panorama360" && item.panorama ? `
          <button
            class="panorama-button"
            type="button"
            data-panorama-id="${escapeHtml(item.id)}"
          >🌀 Abrir experiência 360°</button>
        ` : ""}
      </div>
    </article>
  `).join("");
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[char]));
}

function cacheKey(term) {
  return CONFIG.SEARCH_CACHE_PREFIX + normalize(term);
}

function readSearchCache(term) {
  try {
    const raw = localStorage.getItem(cacheKey(term));
    if (!raw) return null;

    const cached = JSON.parse(raw);

    if (
      !cached ||
      !Array.isArray(cached.items) ||
      Date.now() - cached.timestamp > CONFIG.SEARCH_CACHE_TTL_HOURS * 3600000
    ) {
      localStorage.removeItem(cacheKey(term));
      return null;
    }

    return cached.items;
  } catch {
    return null;
  }
}

function writeSearchCache(term, items) {
  try {
    localStorage.setItem(
      cacheKey(term),
      JSON.stringify({ timestamp: Date.now(), items })
    );
  } catch {}
}

function readCatalogMeta() {
  try {
    const meta = JSON.parse(
      localStorage.getItem(CONFIG.CATALOG_CACHE_META_KEY) || "null"
    );
    return meta && Number.isFinite(meta.timestamp) ? meta : null;
  } catch {
    return null;
  }
}

function writeCatalogMeta(extra = {}) {
  try {
    localStorage.setItem(
      CONFIG.CATALOG_CACHE_META_KEY,
      JSON.stringify({ timestamp: Date.now(), ...extra })
    );
  } catch {}
}

async function readCatalogCache() {
  if (!("caches" in window)) return null;

  try {
    const cache = await caches.open(CONFIG.CATALOG_CACHE_NAME);
    const response = await cache.match(CONFIG.CATALOG_URL);
    if (!response) return null;

    const data = await response.clone().json();
    if (!Array.isArray(data.items)) return null;

    return data;
  } catch {
    return null;
  }
}

async function writeCatalogCache(data) {
  if (!("caches" in window)) return;

  try {
    const cache = await caches.open(CONFIG.CATALOG_CACHE_NAME);
    const response = new Response(JSON.stringify(data), {
      headers: { "Content-Type": "application/json; charset=utf-8" }
    });
    await cache.put(CONFIG.CATALOG_URL, response);
    writeCatalogMeta({
      version: data.version ?? null,
      itemCount: Array.isArray(data.items) ? data.items.length : 0
    });
  } catch {}
}

function isCatalogCacheFresh() {
  const meta = readCatalogMeta();
  if (!meta) return false;
  return Date.now() - meta.timestamp <= CONFIG.CATALOG_CACHE_TTL_HOURS * 3600000;
}

function setCatalogStatus(text) {
  $("#catalog-status").textContent = text;
}

async function loadCatalog() {
  const cachedCatalog = await readCatalogCache();

  if (cachedCatalog && isCatalogCacheFresh()) {
    catalog = cachedCatalog.items;
    setCatalogStatus(`${catalog.length} itens no catálogo local • cache ativo`);
    render(catalog);
    return;
  }

  if (cachedCatalog) {
    catalog = cachedCatalog.items;
    setCatalogStatus(`${catalog.length} itens no catálogo local • cache expirado • atualizando…`);
    render(catalog);
  }

  try {
    const response = await fetch(CONFIG.CATALOG_URL, { cache: "no-cache" });
    if (!response.ok) throw new Error(`Catálogo HTTP ${response.status}`);

    const data = await response.json();
    if (!Array.isArray(data.items)) throw new Error("Formato de catálogo inválido");

    catalog = data.items;
    await writeCatalogCache(data);
    setCatalogStatus(`${catalog.length} itens no catálogo local • catálogo atualizado`);
    render(catalog);
  } catch (error) {
    console.error(error);

    if (cachedCatalog) {
      setCatalogStatus(`${catalog.length} itens no catálogo local • usando cache`);
      render(catalog);
      return;
    }

    setCatalogStatus("Catálogo indisponível no momento.");
    $("#discover-grid").innerHTML =
      '<div class="empty">Não foi possível carregar o catálogo local.</div>';
  }
}

$("#search").addEventListener("input", event => {
  const term = event.target.value;
  const cached = readSearchCache(term);
  const results = cached || searchCatalog(term);

  if (!cached) writeSearchCache(term, results);
  render(results);
});

$("#discover-grid").addEventListener("click", event => {
  const button = event.target.closest(".panorama-button");
  if (!button) return;

  const item = catalog.find(entry => entry.id === button.dataset.panoramaId);
  if (item && window.DISCOVER360?.open) {
    window.DISCOVER360.open(item);
  }
});

loadCatalog();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("./service-worker.js")
      .catch(console.error);
  });
}
