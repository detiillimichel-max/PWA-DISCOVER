import { Viewer } from "@photo-sphere-viewer/core";
import { GyroscopePlugin } from "@photo-sphere-viewer/gyroscope-plugin";

let viewer = null;
let feedViewer = null;
let feedItem = null;
let feedLiked = false;

const modal = document.querySelector("#viewer-modal");
const container = document.querySelector("#viewer");
const title = document.querySelector("#viewer-title");
const info = document.querySelector("#viewer-info");
const closeButton = document.querySelector("#viewer-close");
const gyroButton = document.querySelector("#viewer-gyro");

const feedModal = document.querySelector("#feed-viewer-modal");
const feedImage = document.querySelector("#feed-viewer-image");
const feedPanorama = document.querySelector("#feed-viewer-panorama");
const feedTitle = document.querySelector("#feed-viewer-title");
const feedCaption = document.querySelector("#feed-viewer-caption");
const feedSource = document.querySelector("#feed-viewer-source");
const feedPosition = document.querySelector("#feed-viewer-position");
const feedClose = document.querySelector("#feed-viewer-close");
const feedGyroButton = document.querySelector("[data-feed-action='gyro']");
const feedTouchButton = document.querySelector("[data-feed-action='touch360']");
const feedShareButton = document.querySelector("[data-feed-action='share']");
const feedLikeButton = document.querySelector("[data-feed-action='like']");

function renderIcons() {
  if (window.lucide?.createIcons) window.lucide.createIcons();
}

async function openViewer(item) {
  if (!item?.panorama) return;

  closeFeedViewer();
  modal.classList.add("is-open");
  modal.setAttribute("aria-hidden", "false");
  document.body.classList.add("viewer-open");

  title.textContent = item.title || "Panorama 360°";
  info.innerHTML = item.original
    ? `Fonte: ${escapeHtml(item.source || "origem externa")} • <a href="${escapeAttribute(item.original)}" target="_blank" rel="noopener noreferrer">Ver original ↗</a>`
    : `Fonte: ${escapeHtml(item.source || "origem externa")}`;

  container.innerHTML = `
    <div class="viewer-loading">Carregando experiência 360°…</div>
  `;
  gyroButton.hidden = false;
  gyroButton.disabled = false;
  gyroButton.classList.remove("is-active");
  gyroButton.querySelector("span").textContent = "Giro";

  // O modal acabou de ficar visível. Esperamos um frame para o navegador
  // calcular a área real do container antes de criar o WebGL.
  await new Promise(requestAnimationFrame);
  await new Promise(requestAnimationFrame);

  if (!modal.classList.contains("is-open")) return;

  container.innerHTML = "";

  try {
    viewer = new Viewer({
      container,
      panorama: item.panorama,
      caption: item.title || "Panorama 360°",
      loadingTxt: "Carregando panorama…",
      canvasBackground: "#000",
      size: {
        width: Math.max(1, container.clientWidth),
        height: Math.max(1, container.clientHeight)
      },
      mousemove: true,
      mousewheel: true,
      touchmoveTwoFingers: false,
      keyboard: "fullscreen",
      navbar: ["zoom", "move", "fullscreen"],
      plugins: [
        [GyroscopePlugin, {
          moveMode: "smooth",
          touchmove: true,
          roll: true,
          absolutePosition: false
        }]
      ],
      lang: {
        gyroscope: "Giroscópio"
      }
    });

    viewer.addEventListener("ready", () => {
      // Garante que o renderer use o tamanho final do modal.
      viewer.resize({
        width: container.clientWidth,
        height: container.clientHeight
      });
      gyroButton.title = "Ativar giroscópio";
      renderIcons();
    }, { once: true });

    viewer.addEventListener("panorama-error", () => {
      info.textContent = "Não foi possível carregar este panorama.";
    }, { once: true });
  } catch (error) {
    console.error(error);
    info.textContent = "O visualizador 360° não pôde ser iniciado.";
  }

  renderIcons();
}

function closeViewer() {
  modal.classList.remove("is-open");
  modal.setAttribute("aria-hidden", "true");
  document.body.classList.remove("viewer-open");

  if (viewer) {
    viewer.destroy();
    viewer = null;
  }

  container.innerHTML = "";
}

function closeFeedViewer() {
  feedModal.classList.remove("is-open");
  feedModal.setAttribute("aria-hidden", "true");
  document.body.classList.remove("viewer-open");

  if (feedViewer) {
    feedViewer.destroy();
    feedViewer = null;
  }

  feedPanorama.innerHTML = "";
  feedImage.removeAttribute("src");
  feedItem = null;
}

function setFeedLikeState() {
  if (!feedItem || !feedLikeButton) return;

  feedLikeButton.classList.toggle("is-liked", feedLiked);
  feedLikeButton.setAttribute("aria-pressed", String(feedLiked));
  feedLikeButton.querySelector("span").textContent = feedLiked ? "Curtido" : "Curtir";
  renderIcons();
}

function readLike(id) {
  try {
    return localStorage.getItem("discover-like:" + id) === "1";
  } catch {
    return false;
  }
}

function writeLike(id, value) {
  try {
    localStorage.setItem("discover-like:" + id, value ? "1" : "0");
  } catch {}
}

async function setFeedMode(mode) {
  if (!feedViewer) return;

  const gyro = feedViewer.getPlugin(GyroscopePlugin);
  if (!gyro) return;

  if (mode === "gyro") {
    try {
      if (typeof DeviceOrientationEvent !== "undefined" &&
          typeof DeviceOrientationEvent.requestPermission === "function") {
        const permission = await DeviceOrientationEvent.requestPermission();
        if (permission !== "granted") throw new Error("permission-denied");
      }
      await gyro.start("smooth");
      feedSource.textContent = feedItem?.source ? "Fonte: " + feedItem.source : "Giroscópio ativo";
      feedGyroButton.classList.add("is-active");
      feedTouchButton.classList.remove("is-active");
    } catch (error) {
      console.warn("DISCOVER gyro:", error);
      feedSource.textContent = "Giroscópio não autorizado ou indisponível. Tente tocar em Giro novamente.";
      feedGyroButton.classList.remove("is-active");
      feedTouchButton.classList.add("is-active");
    }
  } else {
    gyro.stop();
    feedGyroButton.classList.remove("is-active");
    feedTouchButton.classList.add("is-active");
  }
  renderIcons();
}

async function openFeedViewer(item, meta = {}) {
  if (!item?.image && !item?.panorama) return;

  closeViewer();

  feedItem = item;
  feedLiked = readLike(item.id);

  feedModal.classList.add("is-open");
  feedModal.setAttribute("aria-hidden", "false");
  document.body.classList.add("viewer-open");

  feedTitle.textContent = item.title || "DISCOVER";
  feedCaption.textContent = item.title || "Descoberta";
  feedSource.textContent = item.source ? "Fonte: " + item.source : "";
  const index = Number.isFinite(meta.index) ? meta.index + 1 : 1;
  const total = Number.isFinite(meta.total) ? meta.total : 1;
  feedPosition.textContent = index + " / " + total;

  const is360 = item.type === "panorama360" && item.panorama;
  const metaStartMode = meta.startMode || (is360 ? "touch" : "image");
  feedImage.hidden = is360;
  feedPanorama.hidden = !is360;
  feedGyroButton.hidden = !is360;
  feedTouchButton.hidden = !is360;
  feedGyroButton.disabled = !is360;
  feedTouchButton.disabled = !is360;

  setFeedLikeState();

  if (!is360) {
    feedImage.src = item.image || "";
    feedImage.alt = item.title || "Imagem DISCOVER";
    renderIcons();
    return;
  }

  feedPanorama.innerHTML = "";
  feedImage.removeAttribute("src");
  feedSource.textContent = "Carregando experiência 360°…";

  try {
    feedViewer = new Viewer({
      container: feedPanorama,
      panorama: item.panorama,
      caption: item.title || "Panorama 360°",
      loadingTxt: "Carregando panorama…",
      mousemove: true,
      mousewheel: true,
      touchmoveTwoFingers: false,
      keyboard: "fullscreen",
      navbar: ["zoom", "move", "fullscreen"],
      plugins: [
        [GyroscopePlugin, {
          moveMode: "smooth",
          touchmove: true,
          roll: true,
          absolutePosition: false
        }]
      ],
      lang: {
        gyroscope: "Giroscópio"
      }
    });

    feedViewer.addEventListener("ready", () => {
      feedGyroButton.disabled = false;
      feedGyroButton.title = "Modo giroscópio";
      setFeedMode(metaStartMode === "gyro" ? "gyro" : "touch");
    }, { once: true });

    feedViewer.addEventListener("panorama-error", () => {
      feedSource.textContent = "Não foi possível carregar este panorama.";
      feedImage.hidden = false;
      feedImage.src = item.image || item.panorama || "";
    }, { once: true });
  } catch (error) {
    console.error(error);
    feedSource.textContent = "Visualizador 360 indisponível — mostrando a imagem original.";
    feedPanorama.hidden = true;
    feedImage.hidden = false;
    feedImage.src = item.image || item.panorama || "";
  }

  renderIcons();
}

async function shareFeedItem() {
  if (!feedItem) return;

  const shareData = {
    title: feedItem.title || "DISCOVER",
    text: (feedItem.description || "Descoberta no DISCOVER") + "\n\nDISCOVER",
    url: new URL("./?discover=" + encodeURIComponent(feedItem.id), window.location.href).href
  };

  try {
    if (navigator.share) {
      await navigator.share(shareData);
    } else if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(shareData.url);
      feedShareButton.querySelector("span").textContent = "Copiado";
      renderIcons();
      window.setTimeout(() => {
        if (feedShareButton) {
          feedShareButton.querySelector("span").textContent = "Compartilhar";
          renderIcons();
        }
      }, 1800);
    }
  } catch (error) {
    if (error?.name !== "AbortError") console.error(error);
  }
}

function toggleFeedLike() {
  if (!feedItem) return;
  feedLiked = !feedLiked;
  writeLike(feedItem.id, feedLiked);
  setFeedLikeState();
}

closeButton.addEventListener("click", closeViewer);

gyroButton.addEventListener("click", async () => {
  if (!viewer) return;
  const gyro = viewer.getPlugin(GyroscopePlugin);
  if (!gyro) return;

  try {
    if (typeof DeviceOrientationEvent !== "undefined" &&
        typeof DeviceOrientationEvent.requestPermission === "function") {
      const permission = await DeviceOrientationEvent.requestPermission();
      if (permission !== "granted") throw new Error("permission-denied");
    }
    await gyro.start("smooth");
    gyroButton.classList.add("is-active");
    gyroButton.querySelector("span").textContent = "Giro ativo";
  } catch (error) {
    console.warn("DISCOVER gyro:", error);
    gyroButton.classList.remove("is-active");
    gyroButton.querySelector("span").textContent = "Giro indisponível";
  }
  renderIcons();
});

modal.addEventListener("click", event => {
  if (event.target === modal) closeViewer();
});

feedClose.addEventListener("click", closeFeedViewer);

feedModal.addEventListener("click", event => {
  if (event.target === feedModal) closeFeedViewer();
});

feedGyroButton.addEventListener("click", () => setFeedMode("gyro"));
feedTouchButton.addEventListener("click", () => setFeedMode("touch"));
feedShareButton.addEventListener("click", shareFeedItem);
feedLikeButton.addEventListener("click", toggleFeedLike);

document.addEventListener("keydown", event => {
  if (event.key === "Escape") {
    if (modal.classList.contains("is-open")) closeViewer();
    if (feedModal.classList.contains("is-open")) closeFeedViewer();
  }
});

window.DISCOVER360 = Object.freeze({
  open: openViewer,
  close: closeViewer,
  openFeed: openFeedViewer,
  closeFeed: closeFeedViewer
});
