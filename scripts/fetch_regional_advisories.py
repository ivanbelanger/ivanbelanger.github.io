#!/usr/bin/env python3
"""Download Global Affairs Canada's regional advisory polygons from its ArcGIS feature layer."""
from __future__ import annotations

import json
import os
import sys
import tempfile
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

LAYER_URL = (
    "https://services6.arcgis.com/R6wlO6UHmSzqm9Vs/ArcGIS/rest/services/"
    "Travel_Advisory_Levels_%282024%29_View_Layer_for_Inset_Maps/FeatureServer/54/query"
)
OUTPUT = Path("data/regional-advisories.geojson")
USER_AGENT = "BeforeYouGo-RegionalAdvisoryMap/1.0 (GitHub Actions; public map-data consumer)"
PAGE_SIZE = 1000
FIELDS = "OBJECTID,NAME,LEVEL_,URL,ADVDATE,ISO_3"


def request_json(params: dict) -> dict:
    url = LAYER_URL + "?" + urllib.parse.urlencode(params)
    request = urllib.request.Request(url, headers={
        "User-Agent": USER_AGENT,
        "Accept": "application/geo+json,application/json",
    })
    with urllib.request.urlopen(request, timeout=60) as response:
        if response.status != 200:
            raise RuntimeError(f"ArcGIS regional feature service returned HTTP {response.status}")
        payload = json.loads(response.read().decode("utf-8-sig"))
    if "error" in payload:
        raise RuntimeError(f"ArcGIS query error: {payload['error']}")
    return payload


def main():
    # State_name / Map_Label identify named sub-country map areas. Codes 10/20/30
    # are country-context polygons ("contains areas with higher security risk"),
    # not regional risk polygons; omit them from the published overlay.
    where = "NAME IS NOT NULL AND NAME <> '' AND LEVEL_ IN (1,2,3,4)"
    features = []
    offset = 0
    while True:
        page = request_json({
            "where": where,
            "outFields": FIELDS,
            "returnGeometry": "true",
            "outSR": "4326",
            "f": "geojson",
            "resultOffset": offset,
            "resultRecordCount": PAGE_SIZE,
        })
        if page.get("type") != "FeatureCollection" or not isinstance(page.get("features"), list):
            raise ValueError("ArcGIS returned an unexpected GeoJSON response.")
        batch = page["features"]
        features.extend(batch)
        if len(batch) < PAGE_SIZE:
            break
        offset += len(batch)

    if len(features) < 10:
        raise ValueError(f"Refusing to publish suspiciously small regional layer ({len(features)} features).")
        print("DIAGNOSTIC: Total regional features:", len(features))

    for feature in features[:15]:
        properties = feature.get("properties") or {}
        print(
            "DIAGNOSTIC:",
            "NAME =", properties.get("NAME"),
            "| ISO_3 =", properties.get("ISO_3"),
            "| LEVEL_ =", properties.get("LEVEL_"),
            "| URL =", properties.get("URL")
        )

    print(
        "DIAGNOSTIC: ISO_3 values:",
        sorted({
            str((feature.get("properties") or {}).get("ISO_3"))
            for feature in features
        })
    )
    peru = [
        feature for feature in features
        if str((feature.get("properties") or {}).get("ISO_3", "")).upper() == "PER"
        and str((feature.get("properties") or {}).get("NAME", "")).strip().lower() != "peru"
    ]

    if not peru:
        raise ValueError(
            "No named sub-country polygons found for Peru (ISO_3=PER). "
            "Check the official ArcGIS layer records before publishing."
        )
    if invalid:
        raise ValueError(f"{len(invalid)} regional features have missing geometry or ISO_2.")

    payload = {
        "type": "FeatureCollection",
        "source": LAYER_URL,
        "fetchedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "recordCount": len(features),
        "peruRegionalFeatureCount": len(peru),
        "features": features,
    }
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    fd, temp_name = tempfile.mkstemp(prefix="regional-advisories-", suffix=".geojson", dir=OUTPUT.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(payload, handle, ensure_ascii=False, separators=(",", ":"))
            handle.write("\n")
        os.replace(temp_name, OUTPUT)
    finally:
        if os.path.exists(temp_name):
            os.unlink(temp_name)
    print(f"Published {len(features)} named regional polygons; Peru has {len(peru)}.")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        raise
