import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CATALOG_PATH = ROOT / "catalog" / "discover.json"
CONFIG_PATH = ROOT / "catalog" / "config.json"

REQUIRED_ITEM_FIELDS = ("id", "title", "type", "source", "description")


def fail(message: str) -> None:
    raise SystemExit(f"[DISCOVER] ERRO: {message}")


def main() -> None:
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

    print("[DISCOVER] Catálogo válido.")
    print(f"[DISCOVER] Itens: {len(catalog['items'])}")
    print(f"[DISCOVER] Atualização prevista: {config.get('catalog_refresh_hours')}h")
    print(f"[DISCOVER] Limite por execução: {config.get('api_rate_limit_per_run')}")
    print(f"[DISCOVER] Limite diário: {config.get('api_max_requests_per_day')}")
    print(f"[DISCOVER] Intervalo mínimo: {config.get('api_min_interval_ms')} ms")
    print("[DISCOVER] Nenhuma API externa é consultada nesta etapa.")


if __name__ == "__main__":
    main()
