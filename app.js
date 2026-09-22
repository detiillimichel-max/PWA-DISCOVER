const CONFIG = Object.freeze({
  CATALOG_URL: "./catalog/discover.json",
  CATALOG_CACHE_NAME: "discover-catalog-v5",
  CATALOG_CACHE_TTL_HOURS: 24,
  CATALOG_CACHE_META_KEY: "discover-catalog-cache-meta-v4",
  SEARCH_CACHE_TTL_HOURS: 6,
  SEARCH_CACHE_PREFIX: "discover-search-v3:",
  SEARCH_FIELDS: ["title", "description", "type", "source", "tags"]
});

let catalog = [];
let activeView = "discover";
let carouselIndex = 0;
let feedIndex = 0;

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

function renderIcons() {
  if (window.lucide?.createIcons) window.lucide.createIcons();
}

function filteredCatalog(term = $("#search").value) {
  const base = term.trim() ? searchCatalog(term) : catalog;
  if (activeView === "360") return base.filter(item => item.type === "panorama360");
  if (activeView === "normal") return base.filter(item => item.type !== "panorama360");
  return base;
}

function renderCard(item, options = {}) {
  const feed = options.feed ? " feed-card" : "";
  return `
    <article class="card${feed}">
      <div class="card-media">
        <img
          src="${escapeHtml(item.image || "")}"
          alt=""
          loading="lazy"
          referrerpolicy="no-referrer"
          onerror="this.style.display='none';this.parentElement.classList.add('media-fallback')"
        >
        <div class="media-fallback-icon" aria-hidden="true"><i data-lucide="image-off"></i></div>
      </div>
      <div class="card-body">
        <h3>${escapeHtml(item.title)}</h3>
        <p>${escapeHtml(item.description || "")}</p>
        <span class="tag">${escapeHtml(item.type || "discover")}</span>
        <span class="tag">${escapeHtml(item.source || "catálogo local")}</span>
        ${item.type === "panorama360" && item.panorama ? `
          <button class="panorama-button" type="button" data-panorama-id="${escapeHtml(item.id)}"><i data-lucide="rotate-3d" aria-hidden="true"></i> Abrir experiência 360°</button>
        ` : ""}
        ${options.feed ? `
          <button class="share-button" type="button" data-share-id="${escapeHtml(item.id)}"><i data-lucide="share-2" aria-hidden="true"></i> Compartilhar</button>
        ` : ""}
      </div>
    </article>
  `;
}

function renderDiscoverCarousel(items) {
  const grid = $("#discover-grid");
  if (!items.length) {
    grid.innerHTML = `<div class="empty">Nenhuma descoberta disponível no momento.</div>`;
    renderIcons();
    return;
  }

  carouselIndex = Math.max(0, Math.min(carouselIndex, items.length - 1));
  grid.innerHTML = renderCard(items[carouselIndex]);
  $("#discover-prev").disabled = carouselIndex === 0;
  $("#discover-next").disabled = carouselIndex === items.length - 1;
  renderIcons();
}

function renderGrid(items) {
  const grid = $("#discover-grid");
  if (!items.length) {
    grid.innerHTML = `
      <div class="empty">
        Nenhum resultado para “${escapeHtml($("#search").value.trim())}”.<br>
        <small>A busca consulta somente o catálogo local.</small>
      </div>
    `;
    renderIcons();
    return;
  }
  grid.innerHTML = items.map(item => renderCard(item)).join("");
  renderIcons();
}

function renderFeed(items) {
  const grid = $("#discover-grid");
  if (!items.length) {
    grid.innerHTML = `<div class="empty">O feed não encontrou cards.</div>`;
    renderIcons();
    return;
  }

  grid.innerHTML = `
    <div class="feed-intro">
      <i data-lucide="rss" aria-hidden="true"></i>
      <div><strong>Feed DISCOVER</strong><span>${items.length} cards disponíveis</span></div>
    </div>
    <div class="feed-list">
      ${items.map(item => renderCard(item, { feed: true })).join("")}
    </div>
  `;
  renderIcons();
}

function updateDiscoverView(items) {
  if (activeView === "discover") renderDiscoverCarousel(items);
  else if (activeView === "feed") renderFeed(items);
  else renderGrid(items);
}

function renderPanoramaShowcase() {
  const section = $("#panorama-section");
  const grid = $("#panorama-grid");
  if (!section || !grid) return;

  const panoramas = catalog.filter(item => item.type === "panorama360" && item.panorama);
  section.hidden = !panoramas.length;
  grid.innerHTML = panoramas.slice(0, 5).map(item => `
    <article class="panorama-card">
      <div class="panorama-card-media">
        <img src="${escapeHtml(item.image || item.panorama || "")}" alt="" loading="lazy" referrerpolicy="no-referrer">
        <span class="panorama-badge"><i data-lucide="orbit" aria-hidden="true"></i> 360°</span>
      </div>
      <div class="panorama-card-body">
        <h3>${escapeHtml(item.title)}</h3>
        <p>${escapeHtml(item.source || "Fonte original")}</p>
        <button class="panorama-button" type="button" data-panorama-id="${escapeHtml(item.id)}"><i data-lucide="rotate-3d" aria-hidden="true"></i> Explorar 360°</button>
      </div>
    </article>
  `).join("");
  renderIcons();
}

function render(items) {
  const term = $("#search").value.trim();
  $("#result-count").textContent = `${items.length} ${items.length === 1 ? "item" : "itens"}`;

  if (term) {
    $("#catalog-status").textContent = `Busca local • ${items.length} ${items.length === 1 ? "resultado" : "resultados"}`;
  } else {
    $("#catalog-status").textContent = `${catalog.length} itens no catálogo local • sem consulta externa`;
  }

  updateDiscoverView(items);
  $("#panorama-section").hidden = activeView !== "discover" || !catalog.some(item => item.type === "panorama360" && item.panorama);
  if (activeView === "discover") renderPanoramaShowcase();
  renderIcons();
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

$("#discover-grid").addEventListener("click", async event => {
  const panoramaButton = event.target.closest(".panorama-button");
  if (panoramaButton) {
    const item = catalog.find(entry => entry.id === panoramaButton.dataset.panoramaId);
    if (item && window.DISCOVER360?.open) window.DISCOVER360.open(item);
    return;
  }

  const shareButton = event.target.closest(".share-button");
  if (shareButton) {
    const item = catalog.find(entry => entry.id === shareButton.dataset.shareId);
    if (!item) return;

    const shareData = {
      title: item.title || "DISCOVER",
      text: item.description || "Descoberta no DISCOVER",
      url: item.original || window.location.href
    };

    try {
      if (navigator.share) {
        await navigator.share(shareData);
      } else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(shareData.url);
        shareButton.innerHTML = '<i data-lucide="check" aria-hidden="true"></i> Link copiado';
        renderIcons();
      }
    } catch (error) {
      if (error?.name !== "AbortError") console.error(error);
    }
    return;
  }

});

document.querySelectorAll(".library-action").forEach(button => {
  button.addEventListener("click", () => {
    activeView = button.dataset.view || "discover";
    carouselIndex = 0;
    feedIndex = 0;

    document.querySelectorAll(".library-action").forEach(item => {
      item.classList.toggle("is-active", item === button);
    });

    $("#search").value = "";
    render(filteredCatalog(""));
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
});

$("#discover-prev")?.addEventListener("click", () => {
  const items = filteredCatalog($("#search").value);
  carouselIndex = Math.max(0, carouselIndex - 1);
  render(items);
});

$("#discover-next")?.addEventListener("click", () => {
  const items = filteredCatalog($("#search").value);
  carouselIndex = Math.min(items.length - 1, carouselIndex + 1);
  render(items);
});

$("#search").addEventListener("input", event => {
  const term = event.target.value;
  const cached = readSearchCache(term);
  const results = cached || searchCatalog(term);

  if (!cached) writeSearchCache(term, results);
  carouselIndex = 0;
  render(results.filter(item => {
    if (activeView === "360") return item.type === "panorama360";
    if (activeView === "normal") return item.type !== "panorama360";
    return true;
  }));
});

$("#show-all-360")?.addEventListener("click", () => {
  activeView = "360";
  document.querySelectorAll(".library-action").forEach(button => {
    button.classList.toggle("is-active", button.dataset.view === "360");
  });
  $("#search").value = "";
  render(filteredCatalog(""));
  window.scrollTo({ top: 0, behavior: "smooth" });
});
loadCatalog();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("./service-worker.js")
      .catch(console.error);
  });
}
