function getColor(prov){ return PROV_COLORS[prov]||'#8b949e'; }

// ── Rice Area overlay (shared between both maps) ──────────────
let vRiceLayer = null;
let pRiceLayer = null;

function loadRiceAreaOverlay(targetMap, layerRef, onLoaded) {
  fetch('rice_areas.geojson')
    .then(r => { if(!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
    .then(data => {
      const layer = L.geoJSON(data, {
        style: {
          color: '#4ade80',
          weight: 0.6,
          fillColor: '#4ade80',
          fillOpacity: 0.15,
          opacity: 0.7,
          interactive: false
        },
        onEachFeature(feature, layer) {
          const raw = (feature.properties?.layer || '');
          const season = raw.includes('S1') ? 'Season 1 (Dry)' : raw.includes('S2') ? 'Season 2 (Wet)' : raw;
          layer.bindTooltip(
            `<div class="map-tooltip"><strong style="color:#4ade80">Rice Area · 2025</strong><div class="tt-row">${season}</div></div>`,
            {sticky: true, className: '', offset: [10, 0]}
          );
        }
      });
      onLoaded(layer);
      layer.addTo(targetMap);
    })
    .catch(() => {});
}

const vMap = L.map('map-validation',{center:[15.3,120.8],zoom:8,zoomControl:true,attributionControl:false});
L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',{maxZoom:19}).addTo(vMap);

const vMarkerLayer=L.layerGroup().addTo(vMap), vCellLayer=L.layerGroup();
const vChirpsPtLayer=L.layerGroup(), vChirpsCellLayer=L.layerGroup();
let vMarkerMap={}, vChirpsMarkerMap={}, selectedMarker=null;

GRID_POINTS.forEach(pt => {
  const c=getColor(pt.province);
  const m=L.circleMarker([pt.lat,pt.lon],{radius:6,fillColor:c,color:'rgba(0,0,0,0.4)',weight:1,fillOpacity:0.9});
  m.bindTooltip(`<div class="map-tooltip"><strong>${pt.municipality}</strong><div class="tt-row">${pt.province} Province</div><div class="tt-coords">(${pt.lat}, ${pt.lon})</div></div>`,{sticky:true,className:'',offset:[10,0]});
  m.on('click',()=>showValidationInfo(pt,m));
  vMarkerLayer.addLayer(m);
  vMarkerMap[`${pt.lat}_${pt.lon}`]=m;
  const half=0.05;
  const cell=L.rectangle([[pt.lat-half,pt.lon-half],[pt.lat+half,pt.lon+half]],{color:'rgba(255,255,255,0.3)',weight:1,fillColor:'rgba(255,255,255,0.04)',fillOpacity:1,interactive:false});
  vCellLayer.addLayer(cell);
});

CHIRPS_POINTS.forEach(pt => {
  const cm=L.circleMarker([pt.lat,pt.lon],{radius:4,fillColor:'#22d3ee',color:'rgba(0,0,0,0.3)',weight:0.5,fillOpacity:0.8});
  cm.bindTooltip(`<div class="map-tooltip"><strong>${pt.municipality}</strong><div class="tt-row">CHIRPS · ${pt.province}</div><div class="tt-coords">(${pt.lat}, ${pt.lon})</div></div>`,{sticky:true,className:'',offset:[10,0]});
  cm.on('click',()=>showChirpsInfo(pt,cm));
  vChirpsPtLayer.addLayer(cm);
  vChirpsMarkerMap[`${pt.lat}_${pt.lon}`]=cm;
  const half=0.025;
  const cc=L.rectangle([[pt.lat-half,pt.lon-half],[pt.lat+half,pt.lon+half]],{color:'rgba(34,211,238,0.6)',weight:0.5,fillColor:'rgba(34,211,238,0.04)',fillOpacity:1,interactive:false});
  vChirpsCellLayer.addLayer(cc);
});

document.getElementById('tog-pts').addEventListener('change',e=>e.target.checked?vMap.addLayer(vMarkerLayer):vMap.removeLayer(vMarkerLayer));
document.getElementById('tog-cells').addEventListener('change',e=>e.target.checked?vMap.addLayer(vCellLayer):vMap.removeLayer(vCellLayer));
document.getElementById('tog-chirps-pts').addEventListener('change',e=>e.target.checked?vMap.addLayer(vChirpsPtLayer):vMap.removeLayer(vChirpsPtLayer));
document.getElementById('tog-chirps-cells').addEventListener('change',e=>e.target.checked?vMap.addLayer(vChirpsCellLayer):vMap.removeLayer(vChirpsCellLayer));
document.getElementById('tog-rice').addEventListener('change', e => {
  if(e.target.checked) {
    if(vRiceLayer) { vMap.addLayer(vRiceLayer); }
    else { loadRiceAreaOverlay(vMap, null, layer => { vRiceLayer = layer; }); }
  } else {
    if(vRiceLayer) vMap.removeLayer(vRiceLayer);
  }
});

function showValidationInfo(pt, marker) {
  if(selectedMarker&&selectedMarker!==marker){ const prev=GRID_POINTS.find(p=>p.lat===selectedMarker._latlng.lat&&p.lon===selectedMarker._latlng.lng); if(prev) selectedMarker.setStyle({fillColor:getColor(prev.province),radius:6,weight:1}); }
  selectedMarker=marker; marker.setStyle({fillColor:'#fff',radius:8,weight:2});
  const poly=CHIRPS_POINTS.filter(c=>c.municipality===pt.municipality&&c.province===pt.province);
  document.getElementById('info-panel-v').innerHTML=`<div class="info-card"><div class="info-card-title" style="color:${getColor(pt.province)}">${pt.municipality}</div><div class="info-row"><span class="info-key">Province</span><span class="info-val">${pt.province}</span></div><div class="info-row"><span class="info-key">Coordinates</span><span class="info-val">(${pt.lat}, ${pt.lon})</span></div><div class="info-row"><span class="info-key">CHIRPS cells</span><span class="info-val">${poly.length}</span></div><div class="info-row"><span class="info-key">AgERA5 spacing</span><span class="info-val">0.1° (~11 km)</span></div><span class="val-badge valid">✓ Grid point validated</span></div>`;
}

function showChirpsInfo(pt, marker) {
  if(selectedMarker&&selectedMarker!==marker) selectedMarker.setStyle({radius:4,weight:0.5});
  selectedMarker=marker; marker.setStyle({fillColor:'#fff',radius:6,weight:2});
  const agCount=GRID_POINTS.filter(p=>p.municipality===pt.municipality&&p.province===pt.province).length;
  const chCount=CHIRPS_POINTS.filter(p=>p.municipality===pt.municipality&&p.province===pt.province).length;
  document.getElementById('info-panel-v').innerHTML=`<div class="info-card"><div class="info-card-title" style="color:${getColor(pt.province)}">${pt.municipality}</div><div class="info-row"><span class="info-key">Province</span><span class="info-val">${pt.province}</span></div><div class="info-row"><span class="info-key">Coordinates</span><span class="info-val">(${pt.lat}, ${pt.lon})</span></div><div class="info-row"><span class="info-key">CHIRPS spacing</span><span class="info-val">0.05° (~5.5 km)</span></div><div class="info-row"><span class="info-key">CHIRPS cells (muni)</span><span class="info-val">${chCount}</span></div><div class="info-row"><span class="info-key">AgERA5 pts (muni)</span><span class="info-val">${agCount}</span></div><span class="val-badge valid">✓ CHIRPS point</span></div>`;
}

const PROVINCES=['Aurora','Bataan','Bulacan','Nueva Ecija','Pampanga','Tarlac','Zambales'];
let activeProvV=null;
const provListV=document.getElementById('prov-list-v');
PROVINCES.forEach(prov => {
  const ptc=GRID_POINTS.filter(p=>p.province===prov).length;
  const div=document.createElement('div');
  div.className='prov-item';
  div.innerHTML=`<div class="prov-dot" style="background:${getColor(prov)}"></div><span>${prov}</span><span class="prov-count">${ptc}</span>`;
  div.addEventListener('click',()=>{
    if(activeProvV===prov){
      activeProvV=null;
      document.querySelectorAll('#prov-list-v .prov-item').forEach(el=>el.classList.remove('active'));
      GRID_POINTS.forEach(pt=>{const m=vMarkerMap[`${pt.lat}_${pt.lon}`];if(m)m.setStyle({fillColor:getColor(pt.province),fillOpacity:0.9,radius:6,weight:1});});
      CHIRPS_POINTS.forEach(pt=>{const m=vChirpsMarkerMap[`${pt.lat}_${pt.lon}`];if(m)m.setStyle({fillColor:'#22d3ee',fillOpacity:0.8,radius:4,weight:0.5});});
    } else {
      activeProvV=prov;
      document.querySelectorAll('#prov-list-v .prov-item').forEach(el=>el.classList.remove('active'));
      div.classList.add('active');
      GRID_POINTS.forEach(pt=>{const m=vMarkerMap[`${pt.lat}_${pt.lon}`];if(!m)return; m.setStyle(pt.province===prov?{fillColor:getColor(pt.province),fillOpacity:0.95,radius:7,weight:2}:{fillColor:'#333',fillOpacity:0.2,radius:4,weight:0.5});});
      CHIRPS_POINTS.forEach(pt=>{const m=vChirpsMarkerMap[`${pt.lat}_${pt.lon}`];if(!m)return; m.setStyle(pt.province===prov?{fillColor:'#22d3ee',fillOpacity:0.95,radius:5,weight:1}:{fillColor:'#333',fillOpacity:0.15,radius:3,weight:0.5});});
      const pts=GRID_POINTS.filter(p=>p.province===prov);
      if(pts.length){const lats=pts.map(p=>p.lat),lons=pts.map(p=>p.lon); vMap.flyToBounds([[Math.min(...lats)-0.1,Math.min(...lons)-0.1],[Math.max(...lats)+0.1,Math.max(...lons)+0.1]],{duration:0.8});}
    }
  });
  provListV.appendChild(div);
});

// ══════════════════════════════════════════════════════════════
// PLANTING MAP SEARCH & PROVINCE FILTER
// ══════════════════════════════════════════════════════════════
let activePlantingProv = null;

function toggleProvFilter() {
  const toggle = document.getElementById('prov-filter-toggle');
  const list = document.getElementById('prov-list-p');
  toggle.classList.toggle('collapsed');
  list.classList.toggle('collapsed');
}

function buildPlantingProvFilter() {
  const list = document.getElementById('prov-list-p');
  PROVINCES.forEach(prov => {
    const ptc = CHIRPS_POINTS.filter(p => p.province === prov).length;
    const div = document.createElement('div');
    div.className = 'prov-item';
    div.innerHTML = `<div class="prov-dot" style="background:${getColor(prov)}"></div><span>${prov}</span><span class="prov-count">${ptc}</span>`;
    div.addEventListener('click', () => {
      if(activePlantingProv === prov) {
        activePlantingProv = null;
        document.querySelectorAll('#prov-list-p .prov-item').forEach(el => el.classList.remove('active'));
        resetPlantingCellOpacity();
      } else {
        activePlantingProv = prov;
        document.querySelectorAll('#prov-list-p .prov-item').forEach(el => el.classList.remove('active'));
        div.classList.add('active');
        filterPlantingCellsByProvince(prov);
        // Fly to province bounds
        const pts = CHIRPS_POINTS.filter(p => p.province === prov);
        if(pts.length) {
          const lats = pts.map(p => p.lat), lons = pts.map(p => p.lon);
          pMap.flyToBounds([[Math.min(...lats)-0.1,Math.min(...lons)-0.1],[Math.max(...lats)+0.1,Math.max(...lons)+0.1]],{duration:0.8});
        }
      }
    });
    list.appendChild(div);
  });
}

function filterPlantingCellsByProvince(prov) {
  CHIRPS_POINTS.forEach(pt => {
    const layer = pCellLayers[`${pt.lat}_${pt.lon}`];
    if(!layer) return;
    if(pt.province === prov) {
      layer.setStyle({opacity:1, fillOpacity:1});
    } else {
      layer.setStyle({opacity:0.15, fillOpacity:0.08});
    }
  });
}

function resetPlantingCellOpacity() {
  CHIRPS_POINTS.forEach(pt => {
    const layer = pCellLayers[`${pt.lat}_${pt.lon}`];
    if(layer) layer.setStyle({opacity:1, fillOpacity:1});
  });
}

function onPlantingSearch(query) {
  const box = document.getElementById('p-search-results');
  const q = query.trim().toLowerCase();
  if(!q) { box.style.display = 'none'; box.innerHTML = ''; return; }

  // Search municipalities and provinces in CHIRPS_POINTS
  const seen = new Set();
  const results = [];

  // Province matches first
  PROVINCES.forEach(prov => {
    if(prov.toLowerCase().includes(q) && !seen.has('prov_'+prov)) {
      seen.add('prov_'+prov);
      results.push({type:'province', label:prov, sub:'Province · '+CHIRPS_POINTS.filter(p=>p.province===prov).length+' CHIRPS cells'});
    }
  });

  // Municipality matches
  CHIRPS_POINTS.forEach(pt => {
    const key = pt.municipality + '_' + pt.province;
    if(!seen.has(key) && pt.municipality.toLowerCase().includes(q)) {
      seen.add(key);
      results.push({type:'municipality', label:pt.municipality, sub:pt.province, lat:pt.lat, lon:pt.lon});
    }
  });

  if(!results.length) { box.style.display = 'none'; return; }

  box.style.display = 'flex';
  box.innerHTML = results.slice(0, 8).map((r, i) => `
    <div onclick="selectPlantingSearchResult(${i})" data-idx="${i}"
      style="padding:6px 8px;border-radius:4px;cursor:pointer;background:rgba(255,255,255,0.03);border:1px solid var(--border);"
      onmouseover="this.style.background='rgba(88,166,255,0.08)'" onmouseout="this.style.background='rgba(255,255,255,0.03)'">
      <div style="font-size:11px;color:var(--text);">${r.label}</div>
      <div style="font-size:10px;color:var(--muted);font-family:var(--font-mono);">${r.sub}</div>
    </div>`).join('');

  // Store results for click handler
  box._results = results.slice(0, 8);
}

function selectPlantingSearchResult(idx) {
  const box = document.getElementById('p-search-results');
  const r = box._results[idx];
  if(!r) return;

  document.getElementById('p-search-input').value = r.label;
  box.style.display = 'none';
  box.innerHTML = '';

  if(!plantingMapInit) initPlantingMap();

  if(r.type === 'province') {
    // Activate province filter
    activePlantingProv = r.label;
    document.querySelectorAll('#prov-list-p .prov-item').forEach((el, i) => {
      el.classList.toggle('active', PROVINCES[i] === r.label);
    });
    filterPlantingCellsByProvince(r.label);
    const pts = CHIRPS_POINTS.filter(p => p.province === r.label);
    if(pts.length) {
      const lats = pts.map(p => p.lat), lons = pts.map(p => p.lon);
      pMap.flyToBounds([[Math.min(...lats)-0.1,Math.min(...lons)-0.1],[Math.max(...lats)+0.1,Math.max(...lons)+0.1]],{duration:0.8});
    }
  } else {
    // Fly to municipality and flash its cells
    const muniPts = CHIRPS_POINTS.filter(p => p.municipality === r.label && p.province === r.sub);
    if(muniPts.length) {
      const lats = muniPts.map(p => p.lat), lons = muniPts.map(p => p.lon);
      pMap.flyToBounds([[Math.min(...lats)-0.05,Math.min(...lons)-0.05],[Math.max(...lats)+0.05,Math.max(...lons)+0.05]],{duration:0.8,maxZoom:12});
      // Brief highlight flash
      muniPts.forEach(pt => {
        const layer = pCellLayers[`${pt.lat}_${pt.lon}`];
        if(layer) { layer.setStyle({color:'#fff',weight:2}); setTimeout(()=>layer.setStyle({color:'rgba(255,255,255,0.3)',weight:0.8}),1500); }
      });
    }
  }
}

// Build province filter once planting map is ready
function initPlantingMap() {
  plantingMapInit=true;
  pMap=L.map('map-planting',{center:[15.3,120.8],zoom:8,zoomControl:true,attributionControl:false});
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',{maxZoom:19}).addTo(pMap);
  CHIRPS_POINTS.forEach(pt => {
    const key=`${pt.lat}_${pt.lon}`;
    const half=0.025;
    const rect=L.rectangle([[pt.lat-half,pt.lon-half],[pt.lat+half,pt.lon+half]],{color:'rgba(255,255,255,0.3)',weight:0.8,fillColor:'rgba(255,255,255,0.07)',fillOpacity:1});
    rect.bindTooltip(`<div class="map-tooltip"><strong>${pt.municipality}</strong><div class="tt-row">CHIRPS · ${pt.province}</div><div class="tt-coords">(${pt.lat}, ${pt.lon})</div></div>`,{sticky:true,className:'',offset:[10,0]});
    rect.on('click',()=>showCellSimResult(pt));
    rect.addTo(pMap);
    pCellLayers[key]=rect;
  });
  buildPlantingProvFilter();

  // Auto-load rice area overlay and check the toggle
  loadRiceAreaOverlay(pMap, null, layer => {
    pRiceLayer = layer;
    const tog = document.getElementById('tog-rice-p');
    if(tog) tog.checked = true;
  });

  document.getElementById('tog-rice-p').addEventListener('change', e => {
    if(e.target.checked) {
      if(pRiceLayer) { pMap.addLayer(pRiceLayer); }
      else { loadRiceAreaOverlay(pMap, null, layer => { pRiceLayer = layer; }); }
    } else {
      if(pRiceLayer) pMap.removeLayer(pRiceLayer);
    }
  });
}

// ══════════════════════════════════════════════════════════════
// CORRELATIONAL ANALYSIS — SPEARMAN RANK CORRELATION
// ══════════════════════════════════════════════════════════════