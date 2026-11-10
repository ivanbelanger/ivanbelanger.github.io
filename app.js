(() => {
  'use strict';

  const DATA_URL = './data/travel-advisories.json';
  const BOUNDARY_URL = 'https://raw.githubusercontent.com/datasets/geo-countries/master/data/countries.geojson';
  const REFRESH_MS = 30 * 60 * 1000;
  const riskColors = ['#347a57', '#b49e22', '#dd8427', '#c94c43'];
  const riskLabels = [
    'Take normal security precautions',
    'Exercise a high degree of caution',
    'Avoid non-essential travel',
    'Avoid all travel'
  ];

  const map = L.map('map', {
    minZoom: 2, maxZoom: 7, worldCopyJump: true,
    zoomControl: false, scrollWheelZoom: true
  }).setView([22, 8], 2);
  L.control.zoom({position: 'topright'}).addTo(map);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 7,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
  }).addTo(map);

  const search = document.getElementById('country-search');
  const results = document.getElementById('search-results');
  const panel = document.getElementById('country-panel');
  const status = document.getElementById('data-status');
  const errorBanner = document.getElementById('map-error');
  const features = [];
  let recordsByIso = new Map();
  let recordsByName = new Map();
  let geoLayer;
  let activeLayer = null;
  let lastLoadedAt = null;

  const normalize = value => String(value || '').normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase()
    .replace(/&/g, 'and').replace(/[^a-z0-9]/g, '');
  const aliases = {
    unitedstatesofamerica: ['unitedstates', 'unitedstatesofamerica'],
    russianfederation: ['russia', 'russianfederation'],
    southkorea: ['korea', 'republicofkorea', 'southkorea'],
    korea: ['southkorea', 'republicofkorea'],
    northkorea: ['koreademocraticpeoplesrepublic', 'northkorea'],
    ivorycoast: ['cotedivoire', 'ivorycoast'],
    swaziland: ['eswatini', 'swaziland'],
    czechrepublic: ['czechia', 'czechrepublic'],
    capeverde: ['caboverde', 'capeverde'],
    bolivia: ['bolivia', 'plurinationalstateofbolivia'],
    tanzania: ['tanzania', 'unitedrepublicoftanzania'],
    moldova: ['moldova', 'republicofmoldova'],
    syria: ['syrianarabrepublic', 'syria'],
    laos: ['laopeoplesdemocraticrepublic', 'laos'],
    brunei: ['brunei', 'bruneidarussalam'],
    vietnam: ['viet nam', 'vietnam'],
    iran: ['iran', 'islamicrepublicofiran'],
    venezuela: ['venezuela', 'bolivarianrepublicofvenezuela']
  };
  const nameKeys = name => {
    const key = normalize(name);
    return [key, ...(aliases[key] || [])].map(normalize);
  };
  const escapeHtml = value => String(value).replace(/[&<>"']/g, c =>
    ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));
  const featureName = feature => {
    const p = feature.properties || {};
    return p.ADMIN || p.name || p.NAME || 'Unknown destination';
  };
  const featureIso = feature => {
    const p = feature.properties || {};
    return String(p.ISO_A2 || p.ISO_A2_EH || p.ISO2 || p.iso_a2 ||
      p['ISO3166-1-Alpha-2'] || '').trim().toUpperCase();
  };
  const recordForFeature = feature => {
    const iso = featureIso(feature);
    if (iso && iso !== '-99' && recordsByIso.has(iso)) return recordsByIso.get(iso);
    for (const key of nameKeys(featureName(feature))) {
      if (recordsByName.has(key)) return recordsByName.get(key);
    }
    return null;
  };

  // GAC advisory-state values: 0=normal, 1=high caution, 2=avoid non-essential, 3=avoid all.
  // Unknown or missing values remain uncoloured; never infer "normal" from missing data.
  function riskFromRecord(record) {
    if (!record) return null;
    let state = record.advisoryState;
    if (typeof state === 'string' && /^\d+$/.test(state.trim())) state = Number(state);
    if (Number.isInteger(state) && state >= 0 && state <= 3) return state;
    return null;
  }
  function styleFor(feature) {
    const risk = riskFromRecord(recordForFeature(feature));
    return {color:'#fff', weight:1, fillColor:risk === null ? '#c8d1cd' : riskColors[risk], fillOpacity:.9};
  }
  function destinationUrl(record) {
    const candidate = record && record.destinationUrl;
    if (candidate && /^https:\/\/travel\.gc\.ca\/destinations\//.test(candidate)) return candidate;
    const slug = record && record.urlSlug;
    if (slug) return `https://travel.gc.ca/destinations/${encodeURIComponent(slug)}`;
    return 'https://travel.gc.ca/travelling/advisories';
  }
  function showDestination(feature, layer) {
    if (activeLayer && geoLayer) geoLayer.resetStyle(activeLayer);
    activeLayer = layer || null;
    if (activeLayer) activeLayer.setStyle({...styleFor(feature), color:'#172d35', weight:2, fillOpacity:1});

    const name = featureName(feature);
    const record = recordForFeature(feature);
    const risk = riskFromRecord(record);
    const hasRegional = Boolean(record && record.hasRegionalAdvisory);
    const url = destinationUrl(record);
    const date = record && (record.dateModified || record.datePublished);
    const summary = record && record.advisoryText
      ? record.advisoryText
      : 'The national advisory could not be summarized from the available dataset. Open the official destination page for the current advice.';
    panel.innerHTML = `<div class="country-detail">
      <div class="detail-kicker">Canadian travel advice · national level</div>
      <h3>${escapeHtml(name)}</h3>
      <div class="status" ${risk === null ? '' : `data-level="${risk}"`}>
        <span class="status-dot"></span>${escapeHtml(risk === null ? 'Risk level unavailable' : riskLabels[risk])}
      </div>
      <p class="summary">${escapeHtml(summary.length > 440 ? `${summary.slice(0,437).trimEnd()}…` : summary)}</p>
      ${date ? `<p style="margin-top:6px;font-size:10px">Government data date: ${escapeHtml(date)}</p>` : ''}
      <a class="official-link" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">Open official travel advice <span aria-hidden="true">↗</span></a>
      <div class="regional-embed-heading"><strong>Official regional advice and map</strong><p>The Government of Canada's destination page is shown below when embedding is permitted by that site.</p></div>
      <iframe class="official-frame" title="Official Government of Canada travel advice for ${escapeHtml(name)}" src="${escapeHtml(url + (url.includes('?') ? '&' : '?') + 'embed=true')}" loading="lazy" referrerpolicy="strict-origin-when-cross-origin"></iframe>
      <p class="frame-fallback">If the official page does not appear here, <a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">open it directly in a new tab</a>.</p>
      <div class="regional">
        <strong>${hasRegional ? 'Regional advisories are published for this destination' : 'Check the official page for regional information'}</strong>
        <p>The map colour represents the national advisory only. Regional areas may carry a more restrictive warning. The Government of Canada's written risk-level advice takes precedence over its illustrative map.</p>
      </div>
      <div class="notice">This independent map is a navigation aid, not an official Government of Canada product. Always read the complete official advice before making travel decisions.</div>
    </div>`;
    search.value = name;
    results.hidden = true;
  }
  function selectFeature(feature) {
    if (!feature) return;
    const layer = geoLayer && geoLayer.getLayers().find(item => item.feature === feature);
    showDestination(feature, layer);
    if (layer && layer.getBounds().isValid()) map.fitBounds(layer.getBounds(), {padding:[35,35], maxZoom:5});
  }
  function updateResults() {
    const query = normalize(search.value.trim());
    results.replaceChildren();
    if (!query) { results.hidden = true; return; }
    const matches = features.filter(feature => normalize(featureName(feature)).includes(query)).slice(0,8);
    if (!matches.length) {
      const empty = document.createElement('div');
      empty.className = 'result'; empty.textContent = 'No matching country found'; results.append(empty);
    } else {
      matches.forEach(feature => {
        const button = document.createElement('button');
        button.type = 'button'; button.className = 'result';
        const level = riskFromRecord(recordForFeature(feature));
        button.textContent = `${featureName(feature)}${level === null ? '' : ` — ${riskLabels[level]}`}`;
        button.addEventListener('click', () => selectFeature(feature));
        results.append(button);
      });
    }
    results.hidden = false;
  }

  function installData(payload) {
    if (!payload || !Array.isArray(payload.countries)) throw new Error('The cached advisory file has an unexpected structure.');
    if (!payload.countries.length) throw new Error('No country advisory records are available yet. Run the GitHub Actions update workflow.');
    const byIso = new Map(), byName = new Map();
    payload.countries.forEach(record => {
      if (!record || typeof record !== 'object') return;
      if (record.iso2) byIso.set(String(record.iso2).toUpperCase(), record);
      if (record.name) nameKeys(record.name).forEach(key => byName.set(key, record));
    });
    if (!byIso.size && !byName.size) throw new Error('The advisory file contains no usable country identifiers.');
    recordsByIso = byIso;
    recordsByName = byName;
    lastLoadedAt = payload.fetchedAt || null;
    if (geoLayer) geoLayer.setStyle(styleFor);
    const generated = payload.generatedAt ? ` · source generated ${payload.generatedAt}` : '';
    status.textContent = `${payload.recordCount || payload.countries.length} destinations · retrieved ${formatDate(lastLoadedAt)}${generated}`;
    status.title = `Source: ${payload.source || 'Global Affairs Canada'}; retrieved: ${lastLoadedAt || 'unknown'}`;
    errorBanner.hidden = true;
  }
  function formatDate(value) {
    if (!value) return 'date unavailable';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString('en-CA', {dateStyle:'medium', timeStyle:'short', timeZone:'America/Toronto'}) + ' ET';
  }
  async function refreshData() {
    try {
      const response = await fetch(`${DATA_URL}?v=${Date.now()}`, {cache:'no-store'});
      if (!response.ok) throw new Error(`Cached data request returned HTTP ${response.status}`);
      const payload = await response.json();
      installData(payload);
    } catch (error) {
      status.textContent = 'Data unavailable';
      errorBanner.textContent = `${error.message} Country colours will remain unavailable rather than implying a safe advisory.`;
      errorBanner.hidden = false;
    }
  }

  search.addEventListener('input', updateResults);
  search.addEventListener('keydown', event => {
    if (event.key === 'Escape') results.hidden = true;
    if (event.key === 'Enter' && !results.hidden) {
      const first = results.querySelector('button');
      if (first) first.click();
    }
  });
  document.addEventListener('click', event => {
    if (!event.target.closest('.searchbox')) results.hidden = true;
  });

  fetch(BOUNDARY_URL, {cache:'force-cache'})
    .then(response => { if (!response.ok) throw new Error(`Map boundary request returned HTTP ${response.status}`); return response.json(); })
    .then(data => {
      if (!Array.isArray(data.features)) throw new Error('Boundary GeoJSON has no feature list.');
      features.push(...data.features);
      geoLayer = L.geoJSON(data, {
        style: styleFor,
        onEachFeature: (feature, layer) => {
          layer.bindTooltip(featureName(feature), {sticky:true});
          layer.on({
            click: () => showDestination(feature, layer),
            mouseover: event => { if (event.target !== activeLayer) event.target.setStyle({...styleFor(feature), fillOpacity:1, weight:1.6}); },
            mouseout: event => { if (event.target !== activeLayer) geoLayer.resetStyle(event.target); }
          });
        }
      }).addTo(map);
      refreshData();
    })
    .catch(error => {
      errorBanner.textContent = `The world map could not be loaded: ${error.message}`;
      errorBanner.hidden = false;
      refreshData();
    });

  // The GitHub Action is the durable updater. This lightweight browser refresh
  // picks up a newly published snapshot while a visitor leaves the page open.
  window.setInterval(refreshData, REFRESH_MS);
})();
