import json
import os
import time
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
CATALOG_PATH = ROOT / "catalog" / "discover.json"
CONFIG_PATH = ROOT / "catalog" / "config.json"

REQUIRED_ITEM_FIELDS = ("id", "title", "type", "source", "description")


class RateLimiter:
    def __init__(self, per_run: int, min_interval_ms: int):
        self.per_run = max(0, int(per_run))
        self.min_interval_ms = max(0, int(min_interval_ms))
        self.requests = 0
        self.last_request = 0.0

    def get_json(self, url: str):
        if self.requests >= self.per_run:
            raise RuntimeError("limite de requisições por execução atingido")

        elapsed_ms = (time.monotonic() - self.last_request) * 1000
        if self.last_request and elapsed_ms < self.min_interval_ms:
            time.sleep((self.min_interval_ms - elapsed_ms) / 1000)

        request = Request(
            url,
            headers={"User-Agent": "DISCOVER-Catalog-Pipeline/1.0"}
        )

        try:
            with urlopen(request, timeout=20) as response:
                if response.status == 429:
                    raise RuntimeError("NASA respondeu HTTP 429 (rate limit)")
                self.requests += 1
                self.last_request = time.monotonic()
                return json.load(response)
        except Exception:
            self.requests += 1
            self.last_request = time.monotonic()
            raise


def fail(message: str) -> None:
    raise SystemExit(f"[DISCOVER] ERRO: {message}")


def load_files():
    if not CONFIG_PATH.exists():
        fail("catalog/config.json não encontrado.")
    if not CATALOG_PATH.exists():
        fail("catalog/discover.json não encontrado.")

    config = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    catalog = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))

    if not isinstance(config, dict):
        fail("config.json precisa ser um objeto JSON.")
    if not isinstance(catalog, dict) or not isinstance(catalog.get("items"), list):
        fail("discover.json precisa conter items como lista.")

    return config, catalog


def validate_catalog(catalog):
    seen = set()

    for index, item in enumerate(catalog["items"], start=1):
        if not isinstance(item, dict):
            fail(f"item #{index} não é um objeto JSON.")

        missing = [field for field in REQUIRED_ITEM_FIELDS if not item.get(field)]
        if missing:
            fail(f"item #{index} sem campos obrigatórios: {', '.join(missing)}")

        item_id = str(item["id"])
        if item_id in seen:
            fail(f"id duplicado no catálogo: {item_id}")
        seen.add(item_id)

        if item.get("type") == "panorama360" and not item.get("panorama"):
            fail(f"panorama360 sem URL panorama: {item_id}")


def fetch_nasa_items(limiter: RateLimiter):
    api_key = os.getenv("NASA_API_KEY")
    if not api_key:
        print("[NASA] NASA_API_KEY não configurada; mantendo catálogo sem consulta NASA.")
        return []

    params = urlencode({
        "api_key": api_key,
        "sol": 1000,
        "camera": "fhaz",
        "page": 1,
    })
    url = f"https://api.nasa.gov/mars-photos/api/v1/rovers/curiosity/photos?{params}"

    try:
        data = limiter.get_json(url)
    except Exception as exc:
        print(f"[NASA] Consulta não incorporada: {exc}")
        return []

    photos = data.get("photos", [])
    items = []

    for photo in photos[:5]:
        photo_id = photo.get("id")
        image_url = photo.get("img_src")
        if not photo_id or not image_url:
            continue

        camera = photo.get("camera") or {}
        rover = photo.get("rover") or {}

        items.append({
            "id": f"nasa-mars-{photo_id}",
            "title": f"Marte — Curiosity #{photo_id}",
            "type": "space",
            "source": "NASA Mars Rover Photos",
            "image": image_url,
            "original": image_url,
            "description": (
                f"Imagem registrada pelo rover {rover.get('name', 'Curiosity')} "
                f"na missão de exploração de Marte."
            ),
            "author": "NASA/JPL-Caltech/MSSS",
            "tags": [
                "Marte",
                "NASA",
                "Curiosity",
                camera.get("full_name") or camera.get("name") or "rover"
            ],
            "metadata": {
                "rover": rover.get("name"),
                "camera": camera.get("full_name") or camera.get("name"),
                "earth_date": photo.get("earth_date"),
                "sol": photo.get("sol")
            }
        })

    return items


def merge_nasa_items(catalog, nasa_items):
    existing = {str(item.get("id")): item for item in catalog["items"]}

    for item in nasa_items:
        existing[item["id"]] = item

    catalog["items"] = list(existing.values())
    catalog["version"] = int(catalog.get("version", 1)) + 1
    catalog["generated_at"] = "github-actions"


def main():
    config, catalog = load_files()

    per_run = int(config.get("api_rate_limit_per_run", 20))
    min_interval_ms = int(config.get("api_min_interval_ms", 1000))
    limiter = RateLimiter(per_run, min_interval_ms)

    if config.get("sources", {}).get("nasa") is True:
        nasa_items = fetch_nasa_items(limiter)
        if nasa_items:
            merge_nasa_items(catalog, nasa_items)
            CATALOG_PATH.write_text(
                json.dumps(catalog, ensure_ascii=False, indent=2) + "\n",
                encoding="utf-8"
            )
            print(f"[NASA] {len(nasa_items)} imagens adicionadas/atualizadas.")
        else:
            print("[NASA] Nenhuma imagem nova incorporada.")
    else:
        print("[NASA] Fonte desativada no config.json.")

    validate_catalog(catalog)

    print("[DISCOVER] Catálogo válido.")
    print(f"[DISCOVER] Itens: {len(catalog['items'])}")
    print(f"[DISCOVER] Requisições nesta execução: {limiter.requests}")
    print(f"[DISCOVER] Limite por execução: {per_run}")
    print(f"[DISCOVER] Intervalo mínimo: {min_interval_ms} ms")


if __name__ == "__main__":
    main()
