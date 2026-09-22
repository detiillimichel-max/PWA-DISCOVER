import { Viewer } from "@photo-sphere-viewer/core";
import { GyroscopePlugin } from "@photo-sphere-viewer/gyroscope-plugin";

let viewer = null;

const modal = document.querySelector("#viewer-modal");
const container = document.querySelector("#viewer");
const title = document.querySelector("#viewer-title");
const info = document.querySelector("#viewer-info");
const closeButton = document.querySelector("#viewer-close");

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

async function openViewer(item) {
  if (!item?.panorama) return;

  modal.classList.add("is-open");
  modal.setAttribute("aria-hidden", "false");
  document.body.classList.add("viewer-open");

  title.textContent = item.title || "Panorama 360°";
  info.innerHTML = item.original
    ? `Fonte: ${escapeHtml(item.source || "origem externa")} • <a href="${escapeAttribute(item.original)}" target="_blank" rel="noopener noreferrer">Ver original ↗</a>`
    : `Fonte: ${escapeHtml(item.source || "origem externa")}`;

  container.innerHTML = "";

  try {
    viewer = new Viewer({
      container,
      panorama: item.panorama,
      caption: item.title || "Panorama 360°",
      loadingTxt: "Carregando panorama…",
      mousemove: true,
      mousewheel: true,
      touchmoveTwoFingers: false,
      keyboard: "fullscreen",
      navbar: ["zoom", "move", "gyroscope", "fullscreen"],
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

    viewer.addEventListener("panorama-error", () => {
      info.textContent = "Não foi possível carregar este panorama.";
    }, { once: true });
  } catch (error) {
    console.error(error);
    info.textContent = "O visualizador 360° não pôde ser iniciado.";
  }
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

function escapeAttribute(value) {
  return String(value).replace(/[&<>"]/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;"
  }[char]));
}

closeButton.addEventListener("click", closeViewer);

modal.addEventListener("click", event => {
  if (event.target === modal) closeViewer();
});

document.addEventListener("keydown", event => {
  if (event.key === "Escape" && modal.classList.contains("is-open")) {
    closeViewer();
  }
});

window.DISCOVER360 = Object.freeze({
  open: openViewer,
  close: closeViewer
});
