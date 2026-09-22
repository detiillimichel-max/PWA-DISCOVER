const CONFIG = Object.freeze({
  CATALOG_URL: "./catalog/discover.json",
  CATALOG_CACHE_NAME: "discover-catalog-v1",
  CATALOG_CACHE_TTL_HOURS: 24,
  SEARCH_CACHE_TTL_HOURS: 6,
  SEARCH_CACHE_PREFIX: "discover-search-v2:",
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
    .map(item => ({
      item,
      score: searchScore(item, query, tokens)
    }))
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
      JSON.stringify({
        timestamp: Date.now(),
        items
      })
    );
  } catch {
    // O cache é opcional: a busca continua funcionando sem localStorage.
  }
}

async function loadCatalog() {
  const response = await fetch(CONFIG.CATALOG_URL, { cache: "no-cache" });

  if (!response.ok) {
    throw new Error(`Catálogo HTTP ${response.status}`);
  }

  const data = await response.json();
  catalog = Array.isArray(data.items) ? data.items : [];
  render(catalog);
}

$("#search").addEventListener("input", event => {
  const term = event.target.value;
  const cached = readSearchCache(term);
  const results = cached || searchCatalog(term);

  if (!cached) {
    writeSearchCache(term, results);
  }

  render(results);
});

loadCatalog().catch(error => {
  console.error(error);
  $("#catalog-status").textContent =
    "Não foi possível carregar o catálogo local.";
  $("#discover-grid").innerHTML =
    '<div class="empty">Catálogo indisponível no momento.</div>';
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("./service-worker.js")
      .catch(console.error);
  });
}
