# Before You Go — Canadian regional travel advisory map

A static GitHub Pages site that displays **regional risk polygons** from the map layer used for Global Affairs Canada's Travel Advice and Advisories. National country-level fill is intentionally not displayed. Neutral country outlines provide geographic context; coloured polygons represent named regional advisory areas only.

GitHub Actions refreshes both the country-advisory reference data and the regional map polygons every six hours. The browser checks for new snapshots every 30 minutes while open.

## Important scope and safety notes

- The interactive map colours named sub-country regional polygons only. It does not colour whole countries by their national advisory level.
- ArcGIS layer values 1–4 are the four regional advisory levels. Values 10, 20 and 30 represent national/context polygons indicating a country contains higher-risk areas; these are excluded from the regional overlay.
- The map is an illustrative aid, not authoritative geographic boundary data. Global Affairs Canada states that the written Risk levels text takes precedence over the map.
- If a destination has no regional polygon in the downloaded map layer, the site says so and directs users to the official destination page. It does not imply that the destination is safe or has no regional warnings.
- Always read the complete official advice before travel. This is an independent project, not a Government of Canada service.

## Official sources

1. Global Affairs Canada, [Travel Advice and Advisories](https://travel.gc.ca/travelling/advisories).
2. [Peru travel advice](https://travel.gc.ca/destinations/peru), used as the regional-layer validation destination.
3. [Global Affairs Canada explanation of its colour-coded maps](https://www.international.gc.ca/world-monde/stories-histoires/2026/2026-03-26-maps-cartes.aspx?lang=eng).
4. [Regional advisory polygon feature layer](https://services6.arcgis.com/R6wlO6UHmSzqm9Vs/ArcGIS/rest/services/Travel_Advisory_Levels_%282024%29_View_Layer_for_Inset_Maps/FeatureServer/54).

The regional layer exposes polygon geometry and attributes including `NAME`, `State_name`, `Map_Label`, `LEVEL_`, `URL`, `ADVDATE`, and `ISO_2`. The scheduled workflow requests GeoJSON in WGS84 coordinates and stores a static snapshot in the repository.

## First-time setup

1. Upload the contents of this folder to your GitHub repository.
2. In **Settings → Actions → General**, ensure workflow permissions allow read and write access to repository contents.
3. Open **Actions** and run **Refresh Government of Canada travel advisories** using **Run workflow**.
4. Confirm the workflow succeeds and commits both:
   - `data/travel-advisories.json`
   - `data/regional-advisories.geojson`
5. In **Settings → Pages**, choose **Deploy from a branch**, select your default branch and `/ (root)`, then save.

The first workflow run is required. The repository does not ship fabricated regional geometries or advisory values.

## Automatic updates

The workflow runs at minute 17 every six hours (UTC), and can be started manually. It downloads the GAC country JSON, checks Peru's national level against the official Peru destination page, downloads the ArcGIS regional polygon layer, checks that named polygons and Peru regional polygons exist, and commits changed snapshots.

The front end refreshes both snapshots every 30 minutes while a visitor leaves the page open. GitHub Pages remains static; GitHub Actions is the scheduled data pipeline.

## Local preview

Run the data scripts first (requires Python and internet access), then serve the directory over HTTP:

```bash
python scripts/fetch_advisories.py
python scripts/fetch_regional_advisories.py
python -m http.server 8000
```

Open <http://localhost:8000>.

## Validation and limitations

- Regional polygon filter: `State_name` must be populated and `LEVEL_` must be one of 1, 2, 3 or 4. This excludes the 10/20/30 country-context polygons.
- The regional workflow fails closed if the service returns too few features, any feature lacks geometry or an ISO-2 country code, or Peru has no regional polygons.
- The service schema can change. A future schema change should fail the workflow rather than silently painting national risk as regional risk.
- The updater does not independently compare every polygon boundary with every sentence in the destination page. The official text remains authoritative.
- Leaflet, OpenStreetMap tiles, country boundary GeoJSON and the ArcGIS feature service are external dependencies. Their availability and terms apply.

## Repository layout

```text
.
├── .github/workflows/update-advisories.yml
├── data/
│   └── .gitkeep
├── scripts/
│   ├── fetch_advisories.py
│   └── fetch_regional_advisories.py
├── app.js
├── index.html
└── README.md
```
