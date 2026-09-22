import json
import os
import time
from collections import defaultdict
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from urllib.error import HTTPError

ROOT = Path(__file__).resolve().parents[1]
CATALOG_PATH = ROOT / "catalog" / "discover.json"
CONFIG_PATH = ROOT / "catalog" / "config.json"
USAGE_PATH = ROOT / "catalog" / ".api-usage.json"

REQUIRED_ITEM_FIELDS = ("id", "title", "type", "source", "description")


class DailyLimitReached(RuntimeError):
    pass


class RateLimiter:
    def __init__(self, per_run, max_per_day, min_interval_ms, backoff_seconds):
        self.per_run = max(0, int(per_run))
        self.max_per_day = max(0, int(max_per_day))
        self.min_interval_ms = max(0, int(min_interval_ms))
        self.backoff_seconds = max(0, int(backoff_seconds))
        self.requests = 0
        self.last_request = 0.0
        self.usage = self._load_usage()

    def _today(self):
        return time.strftime("%Y-%m-%d", time.gmtime())

    def _load_usage(self):
        today = self._today()
        if not USAGE_PATH.exists():
            return {"date_utc": today, "requests": 0}

        try:
            data = json.loads(USAGE_PATH.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            print("[RATE] Estado diário inválido; iniciando contador em zero.")
            return {"date_utc": today, "requests": 0}

        if data.get("date_utc") != today:
            return {"date_utc": today, "requests": 0}

        return {
            "date_utc": today,
            "requests": max(0, int(data.get("requests", 0))),
        }

    def _save_usage(self):
        USAGE_PATH.write_text(
            json.dumps(self.usage, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )

    def _reserve_request(self):
        if self.requests >= self.per_run:
            raise RuntimeError("limite de requisições por execução atingido")
        if self.usage["requests"] >= self.max_per_day:
            raise DailyLimitReached("limite diário de requisições atingido")

        self.requests += 1
        self.usage["requests"] += 1
        self._save_usage()

    def get_json(self, url):
        self._reserve_request()

        elapsed_ms = (time.monotonic() - self.last_request) * 1000
        if self.last_request and elapsed_ms < self.min_interval_ms:
            time.sleep((self.min_interval_ms - elapsed_ms) / 1000)

        request = Request(
            url,
            headers={"User-Agent": "DISCOVER-Catalog-Pipeline/1.0"},
        )

        try:
            with urlopen(request, timeout=20) as response:
                return json.load(response)
        except HTTPError as exc:
            if exc.code == 429:
                retry_after = exc.headers.get("Retry-After")
                wait_seconds = self.backoff_seconds
                if retry_after:
                    try:
                        wait_seconds = max(wait_seconds, int(retry_after))
                    except ValueError:
                        pass

                print(f"[RATE] HTTP 429 recebido. Backoff: {wait_seconds}s.")
                if wait_seconds:
                    time.sleep(wait_seconds)
                raise RuntimeError("API respondeu HTTP 429 (rate limit)") from exc
            raise
        finally:
            self.last_request = time.monotonic()


def fail(message):
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


def fetch_nasa_items(limiter):
    api_key = os.getenv("NASA_API_KEY")
    if not api_key:
        print("[NASA] NASA_API_KEY não configurada; fonte ignorada.")
        return []

    params = urlencode({
        "api_key": api_key,
        "sol": 1000,
        "camera": "fhaz",
        "page": 1,
    })
    url = (
        "https://api.nasa.gov/mars-photos/api/v1/rovers/"
        f"curiosity/photos?{params}"
    )

    try:
        data = limiter.get_json(url)
    except DailyLimitReached as exc:
        print(f"[NASA] {exc}; fonte interrompida com segurança.")
        return []
    except Exception as exc:
        print(f"[NASA] Consulta não incorporada: {exc}")
        return []

    items = []
    for photo in data.get("photos", [])[:5]:
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
                "na missão de exploração de Marte."
            ),
            "author": "NASA/JPL-Caltech/MSSS",
            "tags": [
                "Marte",
                "NASA",
                "Curiosity",
                camera.get("full_name") or camera.get("name") or "rover",
            ],
            "metadata": {
                "source_key": "nasa",
                "rover": rover.get("name"),
                "camera": camera.get("full_name") or camera.get("name"),
                "earth_date": photo.get("earth_date"),
                "sol": photo.get("sol"),
            },
        })

    return items


def merge_items(catalog, new_items):
    existing = {str(item.get("id")): item for item in catalog["items"]}

    for item in new_items:
        existing[str(item["id"])] = item

    catalog["items"] = list(existing.values())


def rotate_catalog(catalog, config):
    cinema = config.get("cinema", {})
    if not cinema.get("deduplicate", True):
        return

    max_items = max(1, int(cinema.get("max_catalog_items", 80)))
    max_per_source = max(1, int(cinema.get("max_items_per_source", 20)))
    keep_local = bool(cinema.get("keep_local_items", True))

    unique = {}
    for item in catalog["items"]:
        unique[str(item.get("id"))] = item

    items = list(unique.values())
    local_items = []
    managed = defaultdict(list)

    for item in items:
        source_key = (item.get("metadata") or {}).get("source_key")
        if source_key:
            managed[source_key].append(item)
        else:
            local_items.append(item)

    if keep_local:
        retained = list(local_items)
    else:
        retained = []

    for source_key, source_items in managed.items():
        source_items.sort(
            key=lambda item: (
                (item.get("metadata") or {}).get("earth_date") or "",
                str(item.get("id")),
            ),
            reverse=True,
        )
        retained.extend(source_items[:max_per_source])

    if len(retained) > max_items:
        retained = retained[:max_items]

    catalog["items"] = retained


def run_cinema(config, catalog, limiter):
    if not config.get("cinema", {}).get("enabled", True):
        print("[CINEMA] Modo Cinema desativado.")
        return

    sources = config.get("sources", {})
    fetched = []

    if sources.get("nasa") is True:
        fetched.extend(fetch_nasa_items(limiter))
    else:
        print("[CINEMA] NASA desativada.")

    # DPLA, Europeana e NARA permanecem desligadas até seus
    # adaptadores oficiais serem implementados no Commit 8.
    for source_key in ("dpla", "europeana", "nara", "wikimedia"):
        if sources.get(source_key) is True:
            print(
                f"[CINEMA] {source_key.upper()} está habilitada no config, "
                "mas ainda não possui adaptador neste pipeline."
            )

    if fetched:
        merge_items(catalog, fetched)

    rotate_catalog(catalog, config)
    catalog["version"] = int(catalog.get("version", 1)) + 1
    catalog["generated_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    catalog["pipeline"] = {
        "mode": "cinema",
        "sources_enabled": [
            key for key, enabled in sources.items() if enabled is True
        ],
        "requests_this_run": limiter.requests,
        "daily_requests": limiter.usage["requests"],
    }


def main():
    config, catalog = load_files()

    per_run = int(config.get("api_rate_limit_per_run", 20))
    max_per_day = int(config.get("api_max_requests_per_day", 100))
    min_interval_ms = int(config.get("api_min_interval_ms", 1000))
    backoff_seconds = int(config.get("api_backoff_seconds", 5))

    if per_run <= 0 or max_per_day <= 0:
        fail("os limites de API precisam ser maiores que zero.")

    limiter = RateLimiter(
        per_run,
        max_per_day,
        min_interval_ms,
        backoff_seconds,
    )

    print(
        f"[RATE] Uso diário UTC: "
        f"{limiter.usage['requests']}/{max_per_day}"
    )

    run_cinema(config, catalog, limiter)

    validate_catalog(catalog)

    CATALOG_PATH.write_text(
        json.dumps(catalog, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    print("[DISCOVER] 🎬 Modo Cinema concluído.")
    print(f"[DISCOVER] Itens no catálogo: {len(catalog['items'])}")
    print(f"[DISCOVER] Requisições nesta execução: {limiter.requests}")
    print(
        f"[DISCOVER] Uso diário UTC: "
        f"{limiter.usage['requests']}/{max_per_day}"
    )
    print(
        f"[DISCOVER] Limite do catálogo: "
        f"{config.get('cinema', {}).get('max_catalog_items', 80)}"
    )


if __name__ == "__main__":
    main()
