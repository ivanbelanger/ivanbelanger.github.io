#!/usr/bin/env python3
"""Fetch and normalize Global Affairs Canada's public travel advisory JSON."""
from __future__ import annotations

import json
import os
import re
import sys
import tempfile
import urllib.request
from html.parser import HTMLParser
from datetime import datetime, timezone
from pathlib import Path

SOURCE_URL = "https://data.international.gc.ca/travel-voyage/index-alpha-eng.json"
OUTPUT = Path("data/travel-advisories.json")
USER_AGENT = "BeforeYouGo-AdvisoryMap/1.0 (GitHub Actions; public open-data consumer)"
PERU_PAGE_URL = "https://travel.gc.ca/destinations/peru"
RISK_TEXT = (
    (0, re.compile(r"take normal security precautions|exercise normal security precautions", re.I)),
    (1, re.compile(r"exercise a high degree of caution", re.I)),
    (2, re.compile(r"avoid non-essential travel", re.I)),
    (3, re.compile(r"avoid all travel", re.I)),
)


def first_value(*values):
    for value in values:
        if value is not None and value != "":
            return value
    return None


def get_state(record):
    value = first_value(
        record.get("advisory-state"),
        record.get("advisoryState"),
        (record.get("eng") or {}).get("advisory-state"),
        (record.get("eng") or {}).get("advisoryState"),
    )
    if isinstance(value, str) and value.strip().isdigit():
        value = int(value.strip())
    if isinstance(value, int) and value in range(4):
        return value
    text = " ".join(str(x) for x in (
        record.get("advisory-text"),
        (record.get("eng") or {}).get("advisory-text"),
        record.get("risk-level"),
        (record.get("eng") or {}).get("risk-level"),
    ) if isinstance(x, str))
    for state, pattern in RISK_TEXT:
        if pattern.search(text):
            return state
    return None


def fetch_peru_page_level():
    """Read Peru's national level from the official destination page for a live cross-check."""
    class TextExtractor(HTMLParser):
        def __init__(self):
            super().__init__()
            self.parts = []
        def handle_data(self, data):
            self.parts.append(data)

    request = urllib.request.Request(PERU_PAGE_URL, headers={"User-Agent": USER_AGENT, "Accept": "text/html"})
    with urllib.request.urlopen(request, timeout=45) as response:
        if response.status != 200:
            raise RuntimeError(f"Official Peru page returned HTTP {response.status}")
        html = response.read().decode("utf-8", errors="replace")
    parser = TextExtractor()
    parser.feed(html)
    visible_text = " ".join(" ".join(parser.parts).split())
    match = re.search(
        r"\bPeru\s*[–—-]\s*(Take normal security precautions|Exercise a high degree of caution|Avoid non-essential travel|Avoid all travel)\b",
        visible_text,
        re.I,
    )
    if not match:
        raise ValueError("Could not identify Peru's national risk level on the official destination page.")
    label = match.group(1).casefold()
    for state, pattern in RISK_TEXT:
        if pattern.search(label):
            return state, match.group(1)
    raise ValueError("Peru page contained an unrecognized national risk label.")


def iter_records(document):
    records = first_value(document.get("data"), document.get("countries"), document)
    if isinstance(records, list):
        for index, item in enumerate(records):
            if isinstance(item, dict):
                yield str(index), item
    elif isinstance(records, dict):
        for key, item in records.items():
            if isinstance(item, dict):
                yield str(key), item
    else:
        raise ValueError("Unrecognized GAC JSON layout: expected data/countries object or list.")


def normalize_record(key, record):
    english = record.get("eng") if isinstance(record.get("eng"), dict) else {}
    iso = first_value(record.get("country-iso"), record.get("countryIso"), record.get("iso2"), key)
    iso = str(iso).strip().upper() if iso is not None else ""
    name = first_value(record.get("country-eng"), english.get("name"), record.get("name"))
    if not name:
        return None
    slug = first_value(english.get("url-slug"), record.get("url-slug"))
    direct_url = first_value(record.get("url-eng"), english.get("url"), english.get("url-eng"))
    if not (isinstance(direct_url, str) and direct_url.startswith("https://travel.gc.ca/destinations/")):
        direct_url = f"https://travel.gc.ca/destinations/{slug}" if isinstance(slug, str) and slug else None
    regional = first_value(record.get("has-regional-advisory"), record.get("hasRegionalAdvisory"))
    regional = str(regional).strip().lower() in ("1", "true", "yes") or regional is True
    return {
        "iso2": iso if re.fullmatch(r"[A-Z]{2}", iso) else None,
        "name": str(name),
        "advisoryState": get_state(record),
        "advisoryText": first_value(english.get("advisory-text"), record.get("advisory-text")),
        "dateModified": first_value(record.get("date-modified"), record.get("dateModified")),
        "datePublished": first_value(record.get("date-published"), record.get("datePublished")),
        "hasRegionalAdvisory": regional,
        "urlSlug": slug,
        "destinationUrl": direct_url,
    }


def main():
    request = urllib.request.Request(SOURCE_URL, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
    with urllib.request.urlopen(request, timeout=45) as response:
        if response.status != 200:
            raise RuntimeError(f"GAC endpoint returned HTTP {response.status}")
        raw = response.read()
    document = json.loads(raw.decode("utf-8-sig"))
    if not isinstance(document, dict):
        raise ValueError("GAC response root must be a JSON object.")

    countries = [item for key, record in iter_records(document)
                 if (item := normalize_record(key, record)) is not None]
    if len(countries) < 100:
        raise ValueError(f"Refusing to publish suspiciously small dataset ({len(countries)} records).")

    # Fail closed if Peru disappears or its current advisory cannot be interpreted.
    peru = next((item for item in countries if item["iso2"] == "PE" or item["name"].casefold() == "peru"), None)
    if peru is None:
        raise ValueError("Peru record missing; refusing to publish.")
    if peru["advisoryState"] is None:
        raise ValueError("Peru advisory level could not be interpreted; refusing to publish.")
    page_state, page_label = fetch_peru_page_level()
    if peru["advisoryState"] != page_state:
        raise ValueError(
            f"Peru mismatch: JSON says state {peru['advisoryState']}, "
            f"but the official destination page says '{page_label}' (state {page_state})."
        )

    generated = None
    metadata = document.get("metadata") if isinstance(document.get("metadata"), dict) else {}
    generated_obj = metadata.get("generated")
    if isinstance(generated_obj, dict):
        generated = first_value(generated_obj.get("date"), generated_obj.get("datetime"))
    elif isinstance(generated_obj, str):
        generated = generated_obj

    payload = {
        "schemaVersion": 1,
        "source": SOURCE_URL,
        "fetchedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "generatedAt": generated,
        "recordCount": len(countries),
        "countries": countries,
    }
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    fd, temp_name = tempfile.mkstemp(prefix="advisories-", suffix=".json", dir=OUTPUT.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(payload, handle, ensure_ascii=False, indent=2)
            handle.write("\n")
        os.replace(temp_name, OUTPUT)
    finally:
        if os.path.exists(temp_name):
            os.unlink(temp_name)
    print(f"Published {len(countries)} records. Peru national level {peru['advisoryState']} matches official page ({page_label}); regional advisory flag: {peru['hasRegionalAdvisory']}.")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        raise
