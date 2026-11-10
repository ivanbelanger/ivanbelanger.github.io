(() => {
  'use strict';

  const DATA_URL = './data/travel-advisories.json';
  const REGIONAL_URL = './data/regional-advisories.geojson';
  const BOUNDARY_URL = 'https://raw.githubusercontent.com/datasets/geo-countries/master/data/countries.geojson';
  const REFRESH_MS = 30 * 60 * 1000;

  // Regional feature service codes: 1=normal, 2=increased caution,
  // 3=reconsider travel, 4=do not travel. 10/20/30 are country context
  // polygons indicating that higher-risk areas exist; they are intentionally
  // excluded from the regional overlay so the map never paints whole countries.
  const riskColors = {1:'#347a57', 2:'#b49e22', 3:'#dd8427', 4:'#c94c43'};
  const riskLabels = {
    1:'Take normal security precautions',
    2:'Exercise a high degree of caution',
    3:'Avoid non-essential travel',
    4:'Avoid all travel'
  };

  const map = L.map('map', {
    minZoom: 2, maxZoom: 8, worldCopyJump: true,
    zoomControl: false, scrollWheelZoom: true
  }).setView([22, 8], 2);
  L.control.zoom({position:'topright'}).addTo(map);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 8,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
  }).addTo(map);

  const search = document.getElementById('country-search');
  const results = document.getElementById('search-results');
  const panel = document.getElementById('country-panel');
  const status = document.getElementById('data-status');
  const errorBanner = document.getElementById('map-error');

  const countries = [];
  let recordsByIso = new Map();
  let recordsByName = new Map();
  let countryLayer = null;
  let regionalLayer = null;
  let activeCountryLayer = null;
  let regionalFeatures = [];
  let selectedIso = null;
  let lastFetchedAt = null;

  const normalize = value => String(value || '').normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase()
    .replace(/&/g, 'and').replace(/[^a-z0-9]/g, '');
  const aliases = {
    unitedstatesofamerica:['unitedstates','unitedstatesofamerica'],
    russianfederation:['russia','russianfederation'],
    southkorea:['korea','republicofkorea','southkorea'],
    korea:['southkorea','republicofkorea'],
    northkorea:['koreademocraticpeoplesrepublic','northkorea'],
    ivorycoast:['cotedivoire','ivorycoast'],
    swaziland:['eswatini','swaziland'],
    czechrepublic:['czechia','czechrepublic'],
    capeverde:['caboverde','capeverde'],
    bolivia:['bolivia','plurinationalstateofbolivia'],
    tanzania:['tanzania','unitedrepublicoftanzania'],
    moldova:['moldova','republicofmoldova'],
    syria:['syrianarabrepublic','syria'],
    laos:['laopeoplesdemocraticrepublic','laos'],
    brunei:['brunei','bruneidarussalam'],
    vietnam:['viet nam','vietnam'],
    iran:['iran','islamicrepublicofiran'],
    venezuela:['venezuela','bolivarianrepublicofvenezuela']
  };
  const nameKeys = name => {
    const key = normalize(name);
    return [key, ...(aliases[key] || [])].map(normalize);
  };
  const escapeHtml = value => String(value).replace(/[&<>"']/g, c =>
    ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const countryName = feature => {
    const p = feature.properties || {};
    return p.ADMIN || p.name || p.NAME || 'Unknown destination';
  };
  const countryIso = feature => {
    const p = feature.properties || {};
    return String(p.ISO_A2 || p.ISO_A2_EH || p.ISO2 || p.iso_a2 ||
      p['ISO3166-1-Alpha-2'] || '').trim().toUpperCase();
  };
  const recordForCountry = feature => {
    const iso = countryIso(feature);
    if (iso && iso !== '-99' && recordsByIso.has(iso)) return recordsByIso.get(iso);
    for (const key of nameKeys(countryName(feature))) {
      if (recordsByName.has(key)) return recordsByName.get(key);
    }
    return null;
  };
  const regionalIso = feature => String(feature.properties?.ISO_2 || '').trim().toUpperCase();
  const regionalLevel = feature => {
    const value = Number(feature.properties?.LEVEL_);
    return Number.isInteger(value) && Object.prototype.hasOwnProperty.call(riskColors, value) ? value : null;
  };
  const regionalName = feature => {
    const p = feature.properties || {};
    return p.Map_Label || p.State_name || p.WP_Name || p.NAME || 'Regional advisory area';
  };
  const countryNameFromRegion = feature => {
    const p = feature.properties || {};
    return p.WP_Name || p.NAME || 'Destination';
  };
  const safeOfficialUrl = (candidate, fallback) =>
    typeof candidate === 'string' && /^https:\/\/travel\.gc\.ca\/destinations\//.test(candidate)
      ? candidate : fallback;

  function countryStyle() {
    // Country outlines are geographic context only; no national advisory fill.
    return {color:'#87958f', weight:.65, fillColor:'#edf1ee', fillOpacity:.12};
  }
  function regionalStyle(feature) {
    const level = regionalLevel(feature);
    return {
      color:'#263b38', weight:.8,
      fillColor:level === null ? '#c8d1cd' : riskColors[level],
      fillOpacity:level === null ? 0 : .84
    };
  }
  function formatDate(value) {
    if (!value) return 'date unavailable';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? String(value) :
      date.toLocaleString('en-CA', {dateStyle:'medium',timeStyle:'short',timeZone:'America/Toronto'}) + ' ET';
  }
  function destinationUrl(record) {
    if (record && record.destinationUrl &&
        /^https:\/\/travel\.gc\.ca\/destinations\//.test(record.destinationUrl)) return record.destinationUrl;
    if (record && record.urlSlug) return `https://travel.gc.ca/destinations/${encodeURIComponent(record.urlSlug)}`;
    return 'https://travel.gc.ca/travelling/advisories';
  }

  function regionListForIso(iso) {
    return regionalFeatures.filter(feature => regionalIso(feature) === iso);
  }

  function renderCountryPanel(feature) {
    const name = countryName(feature);
    const iso = countryIso(feature);
    const record = recordForCountry(feature);
    const regions = iso ? regionListForIso(iso) : [];
    const url = destinationUrl(record);
    const updated = record && (record.dateModified || record.datePublished);
    const regionMarkup = regions.length
      ? `<div class="region-list"><h4>Mapped regional advisory areas (${regions.length})</h4>
          ${regions.map(region => {
            const level = regionalLevel(region);
            const label = regionalName(region);
            return `<button class="region-row" type="button" data-region-id="${escapeHtml(region.properties.OBJECTID ?? '')}">
              <span class="region-swatch" style="background:${level === null ? '#c8d1cd' : riskColors[level]}"></span>
              <span class="region-copy"><strong>${escapeHtml(label)}</strong><small>${escapeHtml(level === null ? 'Risk level unavailable' : riskLabels[level])}</small></span>
              <span class="region-arrow" aria-hidden="true">›</span>
            </button>`;
          }).join('')}</div>`
      : `<div class="regional"><strong>No regional polygons are currently available in the map dataset for this destination.</strong>
          <p>This does not mean there are no regional warnings. Open the official destination page and read its Risk levels section.</p></div>`;
    panel.innerHTML = `<div class="country-detail">
      <div class="detail-kicker">Official Canadian travel advice</div>
      <h3>${escapeHtml(name)}</h3>
      <p class="summary">The map shows mapped regional advisory areas only. Country-wide advisory shading is intentionally not displayed.</p>
      ${updated ? `<p class="date-line">Country data date: ${escapeHtml(updated)}</p>` : ''}
      ${regionMarkup}
      <a class="official-link" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">Read full official travel advice <span aria-hidden="true">↗</span></a>
      <div class="notice">The Government of Canada says its maps illustrate risk levels and are not authoritative geographic boundaries. The written Risk levels advice takes precedence. Always check the complete official page before travel.</div>
    </div>`;
    panel.querySelectorAll('.region-row').forEach(button => {
      button.addEventListener('click', () => {
        const target = regionalFeatures.find(item =>
          String(item.properties?.OBJECTID ?? '') === button.dataset.regionId);
        if (target) showRegion(target);
      });
    });
  }

  function showRegion(feature) {
    const p = feature.properties || {};
    const level = regionalLevel(feature);
    const region = regionalName(feature);
    const country = countryNameFromRegion(feature);
    const iso = regionalIso(feature);
    const matchingCountry = countries.find(item => countryIso(item) === iso);
    const record = matchingCountry ? recordForCountry(matchingCountry) : null;
    const officialUrl = safeOfficialUrl(p.URL, destinationUrl(record));
    panel.innerHTML = `<div class="country-detail">
      <div class="detail-kicker">Regional advisory area</div>
      <h3>${escapeHtml(region)}</h3>
      <div class="status" ${level === null ? '' : `data-level="${level - 1}"`}>
        <span class="status-dot"></span>${escapeHtml(level === null ? 'Risk level unavailable' : riskLabels[level])}
      </div>
      <p class="summary">Destination: <strong>${escapeHtml(country)}</strong></p>
      <a class="official-link" href="${escapeHtml(officialUrl)}" target="_blank" rel="noopener noreferrer">Read official destination advice <span aria-hidden="true">↗</span></a>
      <button class="back-link" id="back-to-country" type="button">← Back to ${escapeHtml(country)}</button>
      <div class="notice">This polygon reproduces the regional layer published for Global Affairs Canada's advisory map. It is an illustrative aid, not a legal boundary. The official written advice takes precedence.</div>
    </div>`;
    const back = document.getElementById('back-to-country');
    if (back && matchingCountry) back.addEventListener('click', () => renderCountryPanel(matchingCountry));
  }

  function selectCountry(feature, layer) {
    if (activeCountryLayer && countryLayer) countryLayer.resetStyle(activeCountryLayer);
    activeCountryLayer = layer || null;
    if (activeCountryLayer) activeCountryLayer.setStyle({color:'#173e36',weight:2,fillColor:'#edf1ee',fillOpacity:.18});
    selectedIso = countryIso(feature);
    renderCountryPanel(feature);
    search.value = countryName(feature);
    results.hidden = true;
    if (layer && layer.getBounds().isValid()) map.fitBounds(layer.getBounds(), {padding:[35,35],maxZoom:5});
  }

  function updateResults() {
    const query = normalize(search.value.trim());
    results.replaceChildren();
    if (!query) { results.hidden = true; return; }
    const matches = countries.filter(feature => normalize(countryName(feature)).includes(query)).slice(0,8);
    if (!matches.length) {
      const empty = document.createElement('div');
      empty.className = 'result'; empty.textContent = 'No matching country found'; results.append(empty);
    } else {
      matches.forEach(feature => {
        const button = document.createElement('button');
        button.type = 'button'; button.className = 'result';
        const count = regionListForIso(countryIso(feature)).length;
        button.textContent = `${countryName(feature)}${count ? ` — ${count} mapped regional areas` : ''}`;
        button.addEventListener('click', () => {
          const layer = countryLayer && countryLayer.getLayers().find(item => item.feature === feature);
          selectCountry(feature, layer);
        });
        results.append(button);
      });
    }
    results.hidden = false;
  }

  function installCountryData(payload) {
    if (!payload || !Array.isArray(payload.countries) || !payload.countries.length) {
      throw new Error('The cached country-advisory file is missing or malformed.');
    }
    const byIso = new Map(), byName = new Map();
    payload.countries.forEach(record => {
      if (!record || typeof record !== 'object') return;
      if (record.iso2) byIso.set(String(record.iso2).toUpperCase(), record);
      if (record.name) nameKeys(record.name).forEach(key => byName.set(key, record));
    });
    recordsByIso = byIso;
    recordsByName = byName;
    lastFetchedAt = payload.fetchedAt || null;
  }

  function installRegionalData(payload) {
    if (!payload || !Array.isArray(payload.features) || !payload.features.length) {
      throw new Error('The regional advisory layer is missing or empty.');
    }
    const filtered = payload.features.filter(feature => {
      const p = feature.properties || {};
      const level = regionalLevel(feature);
      // Only named sub-country polygons are drawn. Codes 10/20/30 are
      // national context/hatching records, not regional risk polygons.
      return Boolean(p.State_name || p.Map_Label) && level !== null;
    });
    if (!filtered.length) throw new Error('No regional polygons with recognized advisory levels were found.');
    const peruCount = filtered.filter(feature => regionalIso(feature) === 'PE').length;
    if (peruCount < 1) throw new Error('The regional layer contains no mapped Peru regions; refusing to show a misleading empty map.');
    regionalFeatures = filtered;
    if (regionalLayer) map.removeLayer(regionalLayer);
    regionalLayer = L.geoJSON({type:'FeatureCollection',features:regionalFeatures}, {
      style:regionalStyle,
      onEachFeature:(feature, layer) => {
        const level = regionalLevel(feature);
        layer.bindTooltip(
          `${regionalName(feature)} — ${level === null ? 'Risk level unavailable' : riskLabels[level]}`,
          {sticky:true}
        );
        layer.on('click', () => showRegion(feature));
      }
    }).addTo(map);
    if (countryLayer) countryLayer.bringToBack();
    const fetched = payload.fetchedAt || lastFetchedAt;
    status.textContent = `${regionalFeatures.length} regional polygons · retrieved ${formatDate(fetched)}`;
    status.title = `Regional polygons: ${payload.source || 'Global Affairs Canada map feature service'}`;
    errorBanner.hidden = true;
  }

  async function refreshData() {
    try {
      const [countryResponse, regionalResponse] = await Promise.all([
        fetch(`${DATA_URL}?v=${Date.now()}`, {cache:'no-store'}),
        fetch(`${REGIONAL_URL}?v=${Date.now()}`, {cache:'no-store'})
      ]);
      if (!regionalResponse.ok) throw new Error(`Regional advisory snapshot returned HTTP ${regionalResponse.status}`);
      const regionalPayload = await regionalResponse.json();
      installRegionalData(regionalPayload);
      if (countryResponse.ok) {
        const countryPayload = await countryResponse.json();
        installCountryData(countryPayload);
      }
      if (selectedIso) {
        const selected = countries.find(feature => countryIso(feature) === selectedIso);
        if (selected) renderCountryPanel(selected);
      }
    } catch (error) {
      status.textContent = 'Regional data unavailable';
      errorBanner.textContent = `${error.message} Regional risk shading is unavailable; no national-level fill will be substituted.`;
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
    .then(response => { if (!response.ok) throw new Error(`Country boundary request returned HTTP ${response.status}`); return response.json(); })
    .then(data => {
      if (!Array.isArray(data.features)) throw new Error('Country boundary GeoJSON has no feature list.');
      countries.push(...data.features);
      countryLayer = L.geoJSON(data, {
        style:countryStyle,
        onEachFeature:(feature, layer) => {
          layer.bindTooltip(countryName(feature), {sticky:true});
          layer.on({
            click:() => selectCountry(feature, layer),
            mouseover:event => event.target.setStyle({color:'#50665f',weight:1.2,fillColor:'#edf1ee',fillOpacity:.22}),
            mouseout:event => {
              if (event.target !== activeCountryLayer) countryLayer.resetStyle(event.target);
            }
          });
        }
      }).addTo(map);
      refreshData();
    })
    .catch(error => {
      errorBanner.textContent = `The country outlines could not be loaded: ${error.message}`;
      errorBanner.hidden = false;
      refreshData();
    });

  window.setInterval(refreshData, REFRESH_MS);
})();
