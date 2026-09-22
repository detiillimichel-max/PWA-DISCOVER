import html
import json
import os
import re
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
            headers={
                "User-Agent": (
                    "DISCOVER-Catalog-Pipeline/1.0 "
                    "(https://github.com/detiillimichel-max/PWA-DISCOVER)"
                )
            },
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
    # A NASA Image and Video Library API atual não exige API key
    # para a busca pública. Mantemos a NASA_API_KEY no GitHub Secrets
    # para futuras APIs da NASA que possam exigir autenticação.
    params = urlencode({
        "q": "Mars",
        "media_type": "image",
        "page": 1,
        "page_size": 30,
    })
    url = f"https://images-api.nasa.gov/search?{params}"

    try:
        data = limiter.get_json(url)
    except DailyLimitReached as exc:
        print(f"[NASA] {exc}; fonte interrompida com segurança.")
        return []
    except Exception as exc:
        print(f"[NASA] Consulta não incorporada: {exc}")
        return []

    collection = data.get("collection") or {}
    results = collection.get("items") or []
    items = []

    for result in results[:30]:
        data_items = result.get("data") or []
        metadata = data_items[0] if data_items else {}
        nasa_id = metadata.get("nasa_id")
        if not nasa_id:
            continue

        preview = ""
        for link in result.get("links") or []:
            if link.get("rel") == "preview" and link.get("href"):
                preview = link["href"]
                break

        if not preview:
            continue

        title = metadata.get("title") or f"NASA — {nasa_id}"
        description = metadata.get("description") or (
            "Imagem da NASA encontrada na NASA Image and Video Library."
        )
        keywords = metadata.get("keywords") or []
        if not isinstance(keywords, list):
            keywords = [str(keywords)]

        items.append({
            "id": f"nasa-library-{nasa_id}",
            "title": title,
            "type": "space",
            "source": "NASA Image and Video Library",
            "image": preview,
            "original": f"https://images.nasa.gov/details/{nasa_id}",
            "description": description,
            "author": metadata.get("photographer") or metadata.get("center") or "NASA",
            "tags": [
                "NASA",
                "espaço",
                "Marte",
                *[str(keyword) for keyword in keywords[:6]],
            ],
            "metadata": {
                "source_key": "nasa",
                "nasa_id": nasa_id,
                "center": metadata.get("center"),
                "date_created": metadata.get("date_created"),
                "media_type": metadata.get("media_type"),
            },
        })

    print(f"[NASA] Image Library: {len(items)} imagens selecionadas.")
    return items

def fetch_dpla_items(limiter):
    api_key = os.getenv("DPLA_API_KEY")
    if not api_key:
        print("[DPLA] DPLA_API_KEY não configurada; fonte ignorada.")
        return []

    params = urlencode({
        "q": "photograph",
        "sourceResource.type": "image",
        "page": 1,
        "page_size": 20,
        "api_key": api_key,
    })
    url = f"https://api.dp.la/v2/items?{params}"

    try:
        data = limiter.get_json(url)
    except DailyLimitReached as exc:
        print(f"[DPLA] {exc}; fonte interrompida com segurança.")
        return []
    except Exception as exc:
        print(f"[DPLA] Consulta não incorporada: {exc}")
        return []

    items = []
    for record in (data.get("docs") or [])[:20]:
        dpla_id = record.get("id")
        source = record.get("sourceResource") or {}
        if not dpla_id:
            continue

        preview = record.get("object")
        if isinstance(preview, dict):
            preview = preview.get("@id") or preview.get("id")
        if not preview:
            has_view = record.get("hasView")
            if isinstance(has_view, dict):
                preview = has_view.get("@id")
            elif isinstance(has_view, list) and has_view:
                first_view = has_view[0]
                if isinstance(first_view, dict):
                    preview = first_view.get("@id")

        original = record.get("isShownAt") or record.get("@id") or preview
        if not preview:
            continue

        title = source.get("title") or f"DPLA — {dpla_id}"
        description = source.get("description") or (
            "Imagem de patrimônio cultural digitalizada e indexada pela DPLA."
        )
        creator = source.get("creator")
        if isinstance(creator, list):
            creator = ", ".join(
                str(value.get("name") if isinstance(value, dict) else value)
                for value in creator
            )

        subjects = source.get("subject") or []
        tags = []
        for subject in subjects if isinstance(subjects, list) else [subjects]:
            if isinstance(subject, dict):
                value = subject.get("name")
            else:
                value = subject
            if value:
                tags.append(str(value))

        items.append({
            "id": f"dpla-{dpla_id}",
            "title": title,
            "type": "image",
            "source": "Digital Public Library of America",
            "image": preview,
            "original": original,
            "description": description,
            "author": creator or record.get("dataProvider") or "DPLA",
            "tags": ["DPLA", "patrimônio", "fotografia", *tags[:6]],
            "metadata": {
                "source_key": "dpla",
                "dpla_id": dpla_id,
                "data_provider": record.get("dataProvider"),
                "provider": (
                    (record.get("provider") or {}).get("name")
                    if isinstance(record.get("provider"), dict)
                    else record.get("provider")
                ),
                "rights": source.get("rights") or record.get("rights"),
            },
        })

    print(f"[DPLA] Imagens selecionadas: {len(items)}.")
    return items



def _commons_metadata_value(metadata, key):
    value = metadata.get(key) or {}
    if isinstance(value, dict):
        return value.get("value") or value.get("rawvalue") or ""
    return str(value)


def _strip_html(value):
    text = html.unescape(str(value or ""))
    return re.sub(r"<[^>]+>", " ", text).strip()


def _clean_commons_text(value, fallback):
    text = _strip_html(value)
    text = re.sub(r"\\[\\[([^\\]|]+)(?:\\|([^\\]]+))?\\]\\]", r"\\2", text)
    text = re.sub(r"\\[\\[([^\\]]+)\\]\\]", r"\\1", text)
    return " ".join(text.split()) or fallback


def _is_equirectangular(width, height, metadata):
    if not width or not height:
        return False

    projection = _clean_commons_text(
        _commons_metadata_value(metadata, "Projection"),
        "",
    ).lower()

    if "equirectangular" in projection:
        return True

    # The source category is explicitly curated as:
    # "360° panoramas with equirectangular projection".
    # Keep a conservative 2:1 aspect-ratio check as a second validation.
    ratio = width / height
    return 1.85 <= ratio <= 2.15


def fetch_wikimedia_360_items(limiter, config):
    cinema = config.get("cinema", {})
    max_items = max(
        1,
        int((cinema.get("source_item_limits") or {}).get("wikimedia", 5)),
    )
    category_limit = max(5, min(10, max_items * 2))
    categories = cinema.get("wikimedia_360_categories") or [
        "Category:360° panoramas with equirectangular projection",
        "Category:360° panoramas of Mars",
    ]

    candidates = []

    for category in categories:
        if len(candidates) >= max_items * 2:
            break

        params = urlencode({
            "action": "query",
            "generator": "categorymembers",
            "gcmtitle": category,
            "gcmtype": "file",
            "gcmlimit": category_limit,
            "prop": "imageinfo",
            "iiprop": "url|size|mime|extmetadata",
            "iiurlwidth": 4096,
            "format": "json",
            "formatversion": 2,
        })
        url = f"https://commons.wikimedia.org/w/api.php?{params}"

        try:
            data = limiter.get_json(url)
        except DailyLimitReached as exc:
            print(f"[WIKIMEDIA] {exc}; fonte interrompida com segurança.")
            break
        except Exception as exc:
            print(f"[WIKIMEDIA] Categoria não incorporada: {category} • {exc}")
            continue

        for page in data.get("query", {}).get("pages", []):
            info_list = page.get("imageinfo") or []
            info = info_list[0] if info_list else {}
            width = int(info.get("width") or 0)
            height = int(info.get("height") or 0)
            mime = str(info.get("mime") or "").lower()

            # Photo Sphere Viewer works best here with JPEG equirectangular
            # panoramas. We deliberately skip TIFF/WEBP/other large formats
            # in this first protected test.
            if mime != "image/jpeg":
                continue

            if not _is_equirectangular(width, height, info.get("extmetadata") or {}):
                continue

            scaled = info.get("thumburl") or info.get("url")
            original_url = info.get("url")
            description_url = info.get("descriptionurl")
            if not scaled or not original_url or not description_url:
                continue

            metadata = info.get("extmetadata") or {}
            title = page.get("title") or "Wikimedia Commons — panorama 360°"
            title = title.removeprefix("File:").strip()

            description = _clean_commons_text(
                _commons_metadata_value(metadata, "ImageDescription"),
                "Panorama 360° equiretangular encontrado na Wikimedia Commons.",
            )
            author = _clean_commons_text(
                _commons_metadata_value(metadata, "Artist"),
                "Wikimedia Commons",
            )
            license_name = _clean_commons_text(
                _commons_metadata_value(metadata, "LicenseShortName"),
                "Licença indicada na página original",
            )
            license_url = _commons_metadata_value(metadata, "LicenseUrl")

            lower_title = title.lower()
            lower_category = category.lower()
            tags = ["Wikimedia Commons", "360", "panorama", "equiretangular"]

            if "mars" in lower_title or "mars" in lower_category:
                tags.extend(["Marte", "espaço"])
            if any(word in lower_title for word in ("museum", "museu", "gallery", "biblioteca", "cathedral", "church", "castle")):
                tags.extend(["museu", "patrimônio histórico"])
            if any(word in lower_title for word in ("park", "forest", "lake", "mountain", "nature")):
                tags.append("natureza")

            item_id = f"wikimedia-360-{page.get('pageid')}"
            candidates.append({
                "id": item_id,
                "title": title,
                "type": "panorama360",
                "source": "Wikimedia Commons",
                "image": scaled,
                "panorama": scaled,
                "original": description_url,
                "description": description,
                "author": author,
                "license": license_name,
                "license_url": license_url,
                "tags": list(dict.fromkeys(tags)),
                "metadata": {
                    "source_key": "wikimedia",
                    "commons_title": page.get("title"),
                    "commons_page_id": page.get("pageid"),
                    "original_file_url": original_url,
                    "thumbnail_url": scaled,
                    "width": width,
                    "height": height,
                    "mime": mime,
                    "projection": "equirectangular",
                    "projection_validation": "category + aspect-ratio",
                    "delivery_width": 4096,
                    "category": category,
                },
            })

    # Mix the configured categories so the first test is not dominated by one
    # subject. Keep the total deliberately small (3–5 items).
    selected = []
    positions = [0] * len(categories)
    while len(selected) < max_items:
        added = False
        for index, category in enumerate(categories):
            while positions[index] < len(candidates):
                candidate = candidates[positions[index]]
                positions[index] += 1
                if candidate["metadata"]["category"] == category:
                    if candidate["id"] not in {item["id"] for item in selected}:
                        selected.append(candidate)
                    added = True
                    break
            if len(selected) >= max_items:
                break
        if not added:
            break

    print(f"[WIKIMEDIA] 360° equiretangulares selecionados: {len(selected)}.")
    return selected



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
    source_limits = {
        str(key): max(1, int(value))
        for key, value in (cinema.get("source_item_limits") or {}).items()
    }
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
        source_limit = source_limits.get(source_key, max_per_source)
        retained.extend(source_items[:source_limit])

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

    if sources.get("dpla") is True:
        fetched.extend(fetch_dpla_items(limiter))
    else:
        print("[CINEMA] DPLA desativada.")

    if sources.get("wikimedia") is True:
        fetched.extend(fetch_wikimedia_360_items(limiter, config))
    else:
        print("[CINEMA] WIKIMEDIA 360° desativada.")

    # Fontes ainda sem adaptador: permanecem explicitamente desligadas.
    for source_key in ("europeana", "nara"):
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
