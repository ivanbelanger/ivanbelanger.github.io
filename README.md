# Before You Go — Canadian travel advisory map

A static GitHub Pages site that displays Global Affairs Canada's **national travel advisory levels** on an interactive world map. Selecting a country opens its official Government of Canada destination page inside the details panel, including the regional risk descriptions and official regional map where the Government of Canada page permits embedding. A direct link is always provided as a fallback.

GitHub Actions refreshes the official country-advisory data every six hours. The browser checks for new snapshots every 30 minutes while open.

## Important scope and safety notes

- Country colours represent the national advisory level only. Regional warnings may be more restrictive.
- The official destination page is the source for regional risk descriptions and maps. This project does not redraw, extract, or approximate regional boundaries.
- The Government of Canada states that its maps are illustrative; the written information in the Risk levels section takes precedence.
- If the official destination page cannot be displayed inside the panel, use the **Open official travel advice** link or the fallback link below the frame.
- Always read the complete official advice before travel. This is an independent project, not a Government of Canada service.

## Official sources

1. [Global Affairs Canada — Travel Advice and Advisories](https://travel.gc.ca/travelling/advisories)
2. [Global Affairs Canada — Peru travel advice](https://travel.gc.ca/destinations/peru)
3. [Global Affairs Canada — explanation of colour-coded maps](https://www.international.gc.ca/world-monde/stories-histoires/2026/2026-03-26-maps-cartes.aspx?lang=eng)
4. [Official GAC travel advisory data](https://data.international.gc.ca/travel-voyage/index-alpha-eng.json)

## First-time setup

1. Upload the contents of this folder to the root of your GitHub repository, keeping the folder structure shown below.
2. In **Settings → Actions → General**, ensure workflow permissions allow read and write access to repository contents.
3. Open **Actions** and run **Refresh Government of Canada travel advisories** using **Run workflow**.
4. Confirm the workflow succeeds and commits `data/travel-advisories.json`.
5. In **Settings → Pages**, choose **Deploy from a branch**, select your default branch and `/ (root)`, then save.

The first workflow run is required. The repository does not ship fabricated advisory values.

## Automatic updates

The workflow runs at minute 17 every six hours (UTC), and can also be started manually. It downloads the GAC country JSON, checks Peru's national level against the official Peru destination page, and commits the refreshed snapshot. The front end refreshes the snapshot every 30 minutes while a visitor leaves the page open.

## Local preview

Run the data script first (requires Python and internet access), then serve the directory over HTTP:

```bash
python scripts/fetch_advisories.py
python -m http.server 8000
```

Open <http://localhost:8000>.

## Validation and limitations

- The updater fails if the source returns too few records, Peru is missing, its national risk level cannot be interpreted, or its level disagrees with the official destination page.
- Embedded official pages may be restricted by browser or Government of Canada security settings. The direct official link remains available in that case.
- Leaflet, OpenStreetMap tiles and country boundary GeoJSON are external dependencies; their availability and terms apply.
- National country shading must not be interpreted as a substitute for regional warnings. Read the complete official destination advice before making travel decisions.

## Repository layout

```text
.
├── .github/workflows/update-advisories.yml
├── data/
│   └── .gitkeep
├── scripts/
│   └── fetch_advisories.py
├── app.js
├── index.html
└── README.md
```
