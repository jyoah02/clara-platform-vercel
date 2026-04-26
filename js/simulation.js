function selectPhase(phase) {
  selectedPhase = phase;
  selectedIntensity = 'All';
  document.getElementById('btn-nino').className = 'enso-phase-btn' + (phase==='El Niño'?' active-nino':'');
  document.getElementById('btn-neutral').className = 'enso-phase-btn' + (phase==='Neutral'?' active-neutral':'');
  document.getElementById('btn-nina').className = 'enso-phase-btn' + (phase==='La Niña'?' active-nina':'');
  const intRow = document.getElementById('intensity-row');
  intRow.style.display = phase === 'Neutral' ? 'none' : 'flex';
  document.querySelectorAll('.enso-int-btn').forEach(b=>b.classList.remove('active'));
  document.getElementById('int-all').classList.add('active');
  updateAnalogueInfo();
  updateSimBtn();
}

function selectIntensity(intensity) {
  selectedIntensity = intensity;
  document.querySelectorAll('.enso-int-btn').forEach(b=>b.classList.remove('active'));
  const idMap = {all:'all',weak:'weak',moderate:'mod',strong:'str'};
  document.getElementById('int-'+(idMap[intensity.toLowerCase()]||intensity.toLowerCase())).classList.add('active');
  updateAnalogueInfo();
  updateSimBtn();
}

function selectSeasonMode(mode) {
  selectedSeasonMode = mode;
  document.querySelectorAll('#season-mode-row .season-mode-btn').forEach(b => b.classList.remove('active'));
  const idMap = {'Dry':'smode-dry','Both':'smode-both','Wet':'smode-wet'};
  document.getElementById(idMap[mode]).classList.add('active');
  updateAnalogueInfo();
  updateSimBtn();
}

function getAnalogueSemesters() {
  if(!selectedPhase) return [];
  let sems;
  if(selectedPhase === 'Neutral') sems = ENSO_SEASONS['Neutral'];
  else if(selectedIntensity === 'All') sems = ENSO_SEASONS[selectedPhase];
  else sems = ENSO_INTENSITY[selectedPhase]?.[selectedIntensity] || [];
  if(selectedSeasonMode === 'Dry') return sems.filter(s => s.s === 1);
  if(selectedSeasonMode === 'Wet') return sems.filter(s => s.s === 2);
  return sems;
}

function updateAnalogueInfo() {
  const box = document.getElementById('analogue-info');
  if(!selectedPhase){ box.style.display='none'; return; }
  const sems = getAnalogueSemesters();
  box.style.display = 'block';
  if(!sems.length){
    // Show which intensities ARE available for this phase
    const available = [];
    if(selectedPhase !== 'Neutral') {
      const intensityMap = ENSO_INTENSITY[selectedPhase] || {};
      Object.entries(intensityMap).forEach(([int, seasons]) => {
        if(seasons.length) available.push(`${int} (${seasons.length} season${seasons.length>1?'s':''})`);
      });
    }
    const suggestion = available.length ? `Available: ${available.join(', ')}` : 'No seasons available for this condition in the 2018–2025 dataset.';
    box.innerHTML = `<span style="color:var(--warn)">No <strong>${selectedIntensity} ${selectedPhase}</strong> seasons in dataset. ${suggestion}</span>`;
    return;
  }
  const labels = sems.map(s=>`${s.y} ${s.s===1?'Dry':'Wet'}`).join(', ');
  box.innerHTML = `<strong>${sems.length} analogue season${sems.length>1?'s':''}:</strong> ${labels}`;
}

function updateSimBtn() {
  const can = modelPlanting !== null && csvData !== null && selectedPhase !== null && getAnalogueSemesters().length > 0;
  document.getElementById('simulate-btn').disabled = !can;
}

// ══════════════════════════════════════════════════════════════
// SIMULATION
// ══════════════════════════════════════════════════════════════
async function runSimulation() {
  const runStart = Date.now();
  const MIN_DURATION = 5000;
  const sems = getAnalogueSemesters();
  window._lastSimSems = sems.slice()
  if(!sems.length || !modelPlanting || !csvData) return;

  const btn = document.getElementById('simulate-btn');
  btn.disabled = true;
  btn.textContent = 'Simulating…';
  
  // Show full-screen overlay
  const overlay = document.getElementById('loading-overlay');
  overlay.classList.add('active');
  console.log('Loading overlay activated');
  const fillEl = document.getElementById('overlay-progress-fill');
  fillEl.style.width = '0%'; // Reset to 0
  document.getElementById('overlay-progress-label').textContent = 'Running inference...';
  
  // Start progress animation
  setTimeout(() => {
    fillEl.style.width = '5%';
    console.log('Progress set to 5%');
  }, 50);

  // Filter CSV to matching seasons
  const semSet = new Set(sems.map(s=>`${s.y}_${s.s}`));
  const filtered = csvData.filter(r => {
    if(!r.yield_mt_ha || r.yield_mt_ha <= 0) return false;
    return semSet.has(`${r.harvest_year}_${r.semester}`);
  });

  // Group by municipality + harvest_year + semester
  const groups = {};
  filtered.forEach(r => {
    const key = `${r.province}||${r.municipality}||${r.harvest_year}||${r.semester}`;
    if(!groups[key]) groups[key] = [];
    groups[key].push(r);
  });

  // Sort each group by week_start and build scaled sequences
  const sequences = [];
  const meta = [];
  const ensoEnc = ENSO_ENC[selectedPhase] || 0;

  Object.entries(groups).forEach(([key, rows]) => {
    rows.sort((a,b) => new Date(a.week_start) - new Date(b.week_start));
    const raw = rows.map(r => [
      +r.Wind_Speed_10m_Mean_24h, +r.Temperature_Air_2m_Mean_24h,
      +r.Solar_Radiation_Flux,    +r.Vapour_Pressure_Mean_24h,
      +r.Precipitation_CHIRPS,   +r.semester, ensoEnc
    ]);
    // Pad or trim
    let seq = raw;
    if(seq.length < SEQ_LEN) {
      const pad = Array(SEQ_LEN - seq.length).fill(Array(7).fill(0));
      seq = [...pad, ...seq];
    } else if(seq.length > SEQ_LEN) {
      seq = seq.slice(seq.length - SEQ_LEN);
    }
    // Scale
    const scaled = seq.map(r => scaleRow(r, SCALER_AY));
    sequences.push(scaled);
    const [prov, muni, hy, sem] = key.split('||');
    meta.push({province:prov, municipality:muni, harvest_year:+hy, semester:+sem});
  });

  document.getElementById('overlay-progress-label').textContent = `Running inference on ${sequences.length} sequences…`;
  setTimeout(() => {
    document.getElementById('overlay-progress-fill').style.width = '30%';
    console.log('Progress set to 30%');
  }, 100);

  // Batch inference
  let preds;
  try {
    preds = await runBatchInference(modelPlanting, sequences);
  } catch(e) {
    btn.disabled=false; btn.textContent='Run Simulation';
    overlay.classList.remove('active');
    document.getElementById('sim-result').innerHTML = `<div style="color:var(--error);font-size:11px;padding:8px;">Inference error: ${e.message}</div>`;
    return;
  }

  setTimeout(() => {
    document.getElementById('overlay-progress-fill').style.width = '70%';
    console.log('Progress set to 70%');
  }, 100);

  // Accumulate climate data by municipality key from filtered rows
  const muniClimateSums = {};
  filtered.forEach(row => {
    const k = `${row.province.trim().toLowerCase()}||${row.municipality.trim().toLowerCase()}`;
    if(!muniClimateSums[k]) muniClimateSums[k] = {wind:0,temp:0,solar:0,vp:0,precip:0,n:0};
    muniClimateSums[k].wind   += +row.Wind_Speed_10m_Mean_24h || 0;
    muniClimateSums[k].temp   += +row.Temperature_Air_2m_Mean_24h || 0;
    muniClimateSums[k].solar  += +row.Solar_Radiation_Flux || 0;
    muniClimateSums[k].vp     += +row.Vapour_Pressure_Mean_24h || 0;
    muniClimateSums[k].precip += +row.Precipitation_CHIRPS || 0;
    muniClimateSums[k].n++;
  });

  // Aggregate by municipality — normalize keys to avoid name mismatch
  const muniResults = {};
  meta.forEach(({province, municipality, semester, harvest_year}, i) => {
    const k = `${province.trim().toLowerCase()}||${municipality.trim().toLowerCase()}`;
    if(!muniResults[k]) muniResults[k] = {province, municipality, dry:[], wet:[], drySems:[], wetSems:[], climSum:{wind:0,temp:0,solar:0,vp:0,precip:0}, climN:0};
    if(semester===1) { muniResults[k].dry.push(preds[i]); muniResults[k].drySems.push({year:harvest_year, sem:1}); }
    else             { muniResults[k].wet.push(preds[i]); muniResults[k].wetSems.push({year:harvest_year, sem:2}); }
  });

  // Determine recommendation per municipality
  simResults = {};
  Object.entries(muniResults).forEach(([k, r]) => {
    const dryMean = r.dry.length ? r.dry.reduce((a,b)=>a+b,0)/r.dry.length : null;
    const wetMean = r.wet.length ? r.wet.reduce((a,b)=>a+b,0)/r.wet.length : null;
    let recommended = null;
    if(dryMean !== null && wetMean !== null) recommended = dryMean >= wetMean ? 1 : 2;
    else if(dryMean !== null) recommended = 1;
    else if(wetMean !== null) recommended = 2;
    const cs = muniClimateSums[k] || {wind:0,temp:0,solar:0,vp:0,precip:0,n:0};
    const cn = cs.n || 1;
    simResults[k] = {province:r.province, municipality:r.municipality, dry:r.dry, wet:r.wet, drySems:r.drySems, wetSems:r.wetSems, dryMean, wetMean, recommended, climMeans:{wind:(cs.wind/cn).toFixed(2),temp:(cs.temp/cn).toFixed(2),solar:(cs.solar/cn).toFixed(1),vp:(cs.vp/cn).toFixed(2),precip:(cs.precip/cn).toFixed(2)}};
  });

  // Animate progress bar to 100% over minimum duration
  const elapsed = Date.now() - runStart;
  const remaining = Math.max(1000, MIN_DURATION - elapsed);
  
  setTimeout(() => {
    const fillEl2 = document.getElementById('overlay-progress-fill');
    fillEl2.style.transition = `width ${remaining / 1000}s linear`;
    fillEl2.style.width = '100%';
    document.getElementById('overlay-progress-label').textContent = 'Coloring map…';
    console.log('Progress animating to 100% over', remaining / 1000, 'seconds');
  }, 100);

  // Color the map
  colorPlantingMap();

  // Hide progress bar after minimum duration
  setTimeout(() => {
    overlay.classList.remove('active');
    console.log('Loading overlay hidden');
    btn.disabled=false; btn.textContent='Run Simulation';
    const muniCount = Object.keys(simResults).length;
    document.getElementById('sim-result').innerHTML = `
      <div class="result-panel">
        <div class="result-header">Simulation Complete</div>
        <div class="result-row"><span class="result-key">Municipalities</span><span class="result-val">${muniCount}</span></div>
        <div class="result-row"><span class="result-key">Sequences run</span><span class="result-val">${sequences.length}</span></div>
        <div class="result-row"><span class="result-key">Analogue seasons</span><span class="result-val">${sems.length}</span></div>
        <div class="result-rec">Click any CHIRPS cell to see the yield distribution for that municipality.</div>
      </div>`;
    if(selectedSeasonMode === 'Both') {
      const toggleDiv = document.createElement('div');
      toggleDiv.style.cssText = 'display:flex;gap:5px;margin-top:8px;';
      toggleDiv.innerHTML = `
        <button class="season-mode-btn" onclick="colorPlantingMap(1)">View Dry</button>
        <button class="season-mode-btn" style="flex:1.3" onclick="colorPlantingMap(null)">Recommended</button>
        <button class="season-mode-btn" onclick="colorPlantingMap(2)">View Wet</button>
      `;
      document.getElementById('sim-result').appendChild(toggleDiv);
    }
  }, remaining);
}

function colorPlantingMap(displaySeason) {
  CHIRPS_POINTS.forEach(pt => {
    const key = `${pt.province.trim().toLowerCase()}||${pt.municipality.trim().toLowerCase()}`;
    const r   = simResults[key];
    const layer = pCellLayers[`${pt.lat}_${pt.lon}`];
    if(!layer) return;
    if(!r || r.recommended === null) {
      layer.setStyle({color:'rgba(255,255,255,0.3)',weight:0.8,fillColor:'rgba(255,255,255,0.07)',fillOpacity:1});
      return;
    }
    const sem = displaySeason !== undefined && displaySeason !== null ? displaySeason : r.recommended;
    if(sem === 1) {
      layer.setStyle({color:'rgba(88,166,255,0.8)',weight:1,fillColor:'rgba(88,166,255,0.3)',fillOpacity:1});
    } else {
      layer.setStyle({color:'rgba(63,185,80,0.8)',weight:1,fillColor:'rgba(63,185,80,0.3)',fillOpacity:1});
    }
  });
}

function closeCellPopup() {
  const popup = document.getElementById('cell-popup');
  if(popup) popup.classList.remove('visible');
  if(window._pwChart)   { window._pwChart.destroy();   window._pwChart   = null; }
  if(window._obsChart)  { window._obsChart.destroy();  window._obsChart  = null; }
  if(window._climChart) { window._climChart.destroy(); window._climChart = null; }
}

function togglePopupSection(section) {
  const content = document.getElementById(`popup-${section}`);
  const btn     = document.getElementById(`popup-${section}-btn`);
  if(!content || !btn) return;
  const isOpen = content.classList.toggle('open');
  btn.classList.toggle('open', isOpen);
  if(isOpen && section === 'obs') buildObsCharts(window._lastPopupData);
}

function positionPopup(popup, mapEl, latLng) {
  const mapRect  = mapEl.getBoundingClientRect();
  const pt       = pMap.latLngToContainerPoint(latLng);
  const popW     = 340, popH = 420;
  const margin   = 12;
  let left = pt.x + margin;
  let top  = pt.y - popH / 2;
  if(left + popW > mapRect.width  - margin) left = pt.x - popW - margin;
  if(left < margin) left = margin;
  if(top < margin) top = margin;
  if(top + popH > mapRect.height - margin) top = mapRect.height - popH - margin;
  popup.style.left = left + 'px';
  popup.style.top  = top  + 'px';
}

function showCellSimResult(pt) {
  const key = `${pt.province.trim().toLowerCase()}||${pt.municipality.trim().toLowerCase()}`;
  const r   = simResults[key];
  if(!r) return;

  // ── Climatology baseline ──────────────────────────────────
  let climoDryMean = null, climoWetMean = null;
  if(csvData) {
    const provKey = key.split('||')[0], muniKey = key.split('||')[1];
    const seen = new Set();
    const uniqueRows = csvData.filter(row => {
      if(!row.province || row.province.trim().toLowerCase() !== provKey) return false;
      if(!row.municipality || row.municipality.trim().toLowerCase() !== muniKey) return false;
      if(!(+row.yield_mt_ha > 0)) return false;
      const sk = `${row.harvest_year}_${row.semester}`;
      if(seen.has(sk)) return false; seen.add(sk); return true;
    });
    const dryU = uniqueRows.filter(row => +row.semester === 1);
    const wetU = uniqueRows.filter(row => +row.semester === 2);
    if(dryU.length) climoDryMean = dryU.reduce((s,row)=>s+(+row.yield_mt_ha),0)/dryU.length;
    if(wetU.length) climoWetMean = wetU.reduce((s,row)=>s+(+row.yield_mt_ha),0)/wetU.length;
  }

  // ── Core metrics ──────────────────────────────────────────
  const pw         = PLANTING_WINDOWS[r.recommended] || {};
  const recLabel   = pw.label || '—';
  const dryMeanStr = r.dryMean !== null ? r.dryMean.toFixed(2) : '—';
  const wetMeanStr = r.wetMean !== null ? r.wetMean.toFixed(2) : '—';
  const totalSems  = r.dry.length + r.wet.length;
  const agreedSems = r.recommended===1 ? r.dry.length : r.wet.length;
  const consensusPct = totalSems > 0 ? Math.round((agreedSems/totalSems)*100) : 0;
  let confColor, confLabel;
  if(consensusPct >= 80)      { confColor='var(--accent2)'; confLabel='High'; }
  else if(consensusPct >= 60) { confColor='var(--accent)';  confLabel='Moderate'; }
  else                        { confColor='var(--warn)';    confLabel='Low'; }

  const maxMean = Math.max(r.dryMean||0, r.wetMean||0) || 1;
  const dryBarW = r.dryMean !== null ? Math.round((r.dryMean/maxMean)*100) : 0;
  const wetBarW = r.wetMean !== null ? Math.round((r.wetMean/maxMean)*100) : 0;

  const margin    = r.dryMean !== null && r.wetMean !== null ? Math.abs(r.dryMean - r.wetMean) : null;
  const minMean   = r.dryMean !== null && r.wetMean !== null ? Math.min(r.dryMean, r.wetMean) : null;
  const marginPct = margin !== null && minMean > 0 ? Math.round((margin/minMean)*100) : null;
  const phaseLabel = selectedPhase || 'selected ENSO';
  const narrative = margin !== null
    ? `${agreedSems} of ${totalSems} analogue ${phaseLabel} seasons favour <strong>${recLabel}</strong> by ${margin.toFixed(2)} mt/ha (${marginPct}%). Confidence: <span style="color:${confColor}">${confLabel} (${consensusPct}%)</span>.`
    : `Only ${recLabel} season data available for this municipality.`;

  // ── Calendar strip ────────────────────────────────────────
  const MONTH_ABBR = ['J','F','M','A','M','J','J','A','S','O','N','D'];
  const pwm = PW_MONTHS[r.recommended] || {plant:[],harvest:[]};
  const calCells = MONTH_ABBR.map((m,i) => {
    const mo = i+1;
    const isPlant = pwm.plant.includes(mo), isHarv = pwm.harvest.includes(mo);
    const bg  = isPlant ? 'rgba(88,166,255,0.5)' : isHarv ? 'rgba(240,136,62,0.5)' : 'rgba(255,255,255,0.05)';
    const bdr = isPlant ? 'rgba(88,166,255,0.8)' : isHarv ? 'rgba(240,136,62,0.8)' : 'var(--border)';
    const clr = (isPlant||isHarv) ? 'var(--text)' : 'var(--muted)';
    return `<div style="background:${bg};border:1px solid ${bdr};border-radius:2px;height:18px;display:flex;align-items:center;justify-content:center;font-family:var(--font-mono);font-size:8px;color:${clr};">${m}</div>`;
  }).join('');

  // ── vs. climatology tags ──────────────────────────────────
  const dryVsTag = climoDryMean !== null && r.dryMean !== null
    ? `<span style="font-size:9px;font-family:var(--font-mono);color:${r.dryMean>=climoDryMean?'var(--accent2)':'var(--error)'};">${r.dryMean>=climoDryMean?'▲':'▼'} ${Math.abs(r.dryMean-climoDryMean).toFixed(2)} vs avg</span>` : '';
  const wetVsTag = climoWetMean !== null && r.wetMean !== null
    ? `<span style="font-size:9px;font-family:var(--font-mono);color:${r.wetMean>=climoWetMean?'var(--accent2)':'var(--error)'};">${r.wetMean>=climoWetMean?'▲':'▼'} ${Math.abs(r.wetMean-climoWetMean).toFixed(2)} vs avg</span>` : '';

  // ── Analogue labels for detail chart ─────────────────────
  const dryLabels = (r.drySems||[]).map(s=>`${s.year} Dry`);
  const wetLabels = (r.wetSems||[]).map(s=>`${s.year} Wet`);
  const analogueList = [...dryLabels, ...wetLabels].join(', ') || '—';
  const bkTotal  = r.dry.length + r.wet.length;
  const bkHeight = Math.max(80, bkTotal * 26 + 32);

  // ── Planting-window climate ───────────────────────────────
  const _pwPlantMonths = pwm.plant;
  const _analogueSems  = window._lastSimSems || [];
  const _pwRows = (csvData || []).filter(row => {
    const mo = new Date(row.week_start).getMonth() + 1;
    if(!_pwPlantMonths.includes(mo)) return false;
    return _analogueSems.some(s => String(s.y)===String(row.harvest_year) && String(s.s)===String(row.semester))
      && row.municipality === pt.municipality && row.province === pt.province;
  });
  let _pwClim = null;
  if(_pwRows.length > 0) {
    const _avg = k => { const vals=_pwRows.map(row=>parseFloat(row[k])).filter(v=>!isNaN(v)); return vals.length?(vals.reduce((a,b)=>a+b,0)/vals.length):null; };
    _pwClim = { temp:_avg('Temperature_Air_2m_Mean_24h'), precip:_avg('Precipitation_CHIRPS'), solar:_avg('Solar_Radiation_Flux') };
  }
  const _pwMonthNames = _pwPlantMonths.map(m=>MONTH_SHORT[m]).join('–');

  // ── Stash for deferred obs charts ────────────────────────
  window._lastPopupData = { r, pt, dryLabels, wetLabels, bkHeight };

  // ── Populate popup ────────────────────────────────────────
  document.getElementById('popup-muni').textContent = pt.municipality;
  document.getElementById('popup-prov').textContent = `${pt.province} · (${pt.lat}, ${pt.lon})`;

  document.getElementById('popup-primary').innerHTML = `
    <div class="cell-popup-rec">
      <span class="cell-popup-rec-label">Recommended Season</span>
      <span class="cell-popup-rec-badge ${r.recommended===1?'dry':'wet'}">${recLabel}</span>
    </div>
    <div class="cell-popup-conf">
      <span class="cell-popup-conf-pill" style="background:${confColor}22;color:${confColor};border:1px solid ${confColor}55;">${confLabel} confidence · ${consensusPct}%</span>
      <span style="font-size:10px;color:var(--muted);font-family:var(--font-mono);">${agreedSems}/${totalSems} seasons</span>
    </div>
    <div class="cell-popup-bars">
      ${r.dryMean !== null ? `<div class="cell-popup-bar-row">
        <span class="cell-popup-bar-label" style="color:var(--accent);">DRY</span>
        <div class="cell-popup-bar-track"><div class="cell-popup-bar-fill" style="width:${dryBarW}%;background:rgba(88,166,255,0.6);"></div></div>
        <span class="cell-popup-bar-val" style="color:var(--accent);">${dryMeanStr} mt/ha</span>
        ${dryVsTag}
      </div>` : ''}
      ${r.wetMean !== null ? `<div class="cell-popup-bar-row">
        <span class="cell-popup-bar-label" style="color:var(--accent2);">WET</span>
        <div class="cell-popup-bar-track"><div class="cell-popup-bar-fill" style="width:${wetBarW}%;background:rgba(63,185,80,0.6);"></div></div>
        <span class="cell-popup-bar-val" style="color:var(--accent2);">${wetMeanStr} mt/ha</span>
        ${wetVsTag}
      </div>` : ''}
    </div>
    <div class="cell-popup-narrative">${narrative}</div>
    ${pw.window ? `<div class="cell-popup-pw">
      <span><strong>Plant:</strong> ${pw.window}</span>
      <span><strong>Harvest:</strong> ${pw.harvest}</span>
    </div>` : ''}`;

  // ── Details section ───────────────────────────────────────
  document.getElementById('popup-details').innerHTML = `
    <div class="cell-popup-section-label">Per-analogue predictions</div>
    <div style="position:relative;height:${bkHeight}px;"><canvas id="pw-breakdown-chart"></canvas></div>
    <div class="cell-popup-section-label" style="margin-top:10px;">Analogue seasons used</div>
    <div style="font-size:10px;color:var(--muted);line-height:1.7;">${analogueList}</div>
    <div class="cell-popup-section-label" style="margin-top:10px;">Mean climate inputs (analogue weeks)</div>
    <div class="cell-popup-clim-grid">
      <div class="result-row" style="padding:3px 0;"><span class="result-key">Temperature</span><span class="result-val">${r.climMeans?.temp ?? '—'} °C</span></div>
      <div class="result-row" style="padding:3px 0;"><span class="result-key">Precip</span><span class="result-val">${r.climMeans?.precip ?? '—'} mm/wk</span></div>
      <div class="result-row" style="padding:3px 0;"><span class="result-key">Solar</span><span class="result-val">${r.climMeans?.solar ?? '—'} MJ/m²</span></div>
      <div class="result-row" style="padding:3px 0;"><span class="result-key">Vapour Pres.</span><span class="result-val">${r.climMeans?.vp ?? '—'} kPa</span></div>
      <div class="result-row" style="padding:3px 0;"><span class="result-key">Wind Speed</span><span class="result-val">${r.climMeans?.wind ?? '—'} m/s</span></div>
    </div>
    ${pw.window ? `
    <div class="cell-popup-section-label" style="margin-top:10px;">Recommended calendar</div>
    <div class="cell-popup-cal">${calCells}</div>
    <div class="cell-popup-cal-legend">
      <span><span style="display:inline-block;width:9px;height:9px;border-radius:2px;background:rgba(88,166,255,0.5);margin-right:3px;vertical-align:middle;"></span>Plant</span>
      <span><span style="display:inline-block;width:9px;height:9px;border-radius:2px;background:rgba(240,136,62,0.5);margin-right:3px;vertical-align:middle;"></span>Harvest</span>
    </div>
    ${_pwClim ? `<div style="font-size:10px;color:var(--muted);line-height:1.6;">During ${_pwMonthNames} in analogue years: <span style="color:var(--text);">${_pwClim.temp.toFixed(1)}°C · ${_pwClim.precip.toFixed(0)} mm/wk · ${_pwClim.solar.toFixed(1)} MJ/m²</span></div>` : ''}
    ` : ''}`;

  // ── Observed section placeholder (built on expand) ────────
  document.getElementById('popup-obs').innerHTML =
    '<div style="font-size:11px;color:var(--muted);">Loading…</div>';

  // ── Reset expand states ───────────────────────────────────
  ['details','obs'].forEach(s => {
    document.getElementById(`popup-${s}`).classList.remove('open');
    const btn = document.getElementById(`popup-${s}-btn`);
    if(btn) btn.classList.remove('open');
  });

  // ── Show & position popup ─────────────────────────────────
  const popup = document.getElementById('cell-popup');
  const mapEl = document.getElementById('map-planting');
  popup.classList.add('visible');
  positionPopup(popup, mapEl, [pt.lat, pt.lon]);

  requestAnimationFrame(() => buildBreakdownChart(r, dryLabels, wetLabels, bkHeight));
}

function buildBreakdownChart(r, dryLabels, wetLabels, bkHeight) {
  if(window._pwChart) { window._pwChart.destroy(); window._pwChart = null; }
  const pwCanvas = document.getElementById('pw-breakdown-chart');
  if(!pwCanvas || (r.dry.length + r.wet.length) === 0) return;
  const labels    = [...dryLabels, ...wetLabels];
  const data      = [...r.dry, ...r.wet];
  const bgColors  = [...r.dry.map(()=>'rgba(88,166,255,0.55)'), ...r.wet.map(()=>'rgba(63,185,80,0.55)')];
  const bdrColors = [...r.dry.map(()=>'rgba(88,166,255,0.9)'),  ...r.wet.map(()=>'rgba(63,185,80,0.9)')];
  window._pwChart = new Chart(pwCanvas, {
    type:'bar',
    data:{labels, datasets:[{data, backgroundColor:bgColors, borderColor:bdrColors, borderWidth:1, borderRadius:2}]},
    options:{
      indexAxis:'y', responsive:true, maintainAspectRatio:false,
      plugins:{legend:{display:false}, tooltip:{callbacks:{label:i=>`${i.parsed.x.toFixed(2)} mt/ha`}}},
      layout:{padding:{left:4,right:4,top:0,bottom:0}},
      scales:{
        x:{min:0, title:{display:true,text:'Predicted Yield (mt/ha)',color:'#8b949e',font:{size:9,family:'Space Mono'}},
           grid:{color:'rgba(255,255,255,0.05)'}, ticks:{color:'#8b949e',font:{size:9,family:'Space Mono'}}},
        y:{grid:{display:false}, ticks:{color:'#8b949e',font:{size:9,family:'Space Mono'},padding:4},
           afterFit(axis){axis.width=Math.max(axis.width,72);}}
      }
    }
  });
}

function buildObsCharts(d) {
  if(!d) return;
  const { r, pt } = d;
  if(window._obsChart)  { window._obsChart.destroy();  window._obsChart  = null; }
  if(window._climChart) { window._climChart.destroy(); window._climChart = null; }

  const obsSection = document.getElementById('popup-obs');
  if(!obsSection || !csvData) return;

  const sems   = (window._lastSimSems || getAnalogueSemesters());
  const semSet = new Set(sems.map(s=>`${s.y}_${s.s}`));
  const prov   = r.province.trim().toLowerCase();
  const muni   = r.municipality.trim().toLowerCase();

  const obsRows = csvData.filter(row =>
    row.province && row.province.trim().toLowerCase() === prov &&
    row.municipality && row.municipality.trim().toLowerCase() === muni &&
    semSet.has(`${row.harvest_year}_${row.semester}`) &&
    +row.yield_mt_ha > 0
  );

  if(!obsRows.length) {
    obsSection.innerHTML = '<div style="font-size:11px;color:var(--muted);">No observed data for this municipality in the selected analogue seasons.</div>';
    return;
  }

  const obsGroups = {};
  obsRows.forEach(row => {
    const gk = `${row.harvest_year}_${row.semester}`;
    if(!obsGroups[gk]) obsGroups[gk] = {year:+row.harvest_year, sem:+row.semester, vals:[]};
    obsGroups[gk].vals.push(+row.yield_mt_ha);
  });
  const obsSeasons = Object.values(obsGroups)
    .sort((a,b) => a.year-b.year || a.sem-b.sem)
    .map(g => ({...g, mean: g.vals.reduce((s,v)=>s+v,0)/g.vals.length}));

  const obsDrySeas = obsSeasons.filter(g=>g.sem===1);
  const obsWetSeas = obsSeasons.filter(g=>g.sem===2);
  const obsDryMean = obsDrySeas.length ? (obsDrySeas.reduce((s,g)=>s+g.mean,0)/obsDrySeas.length).toFixed(2) : null;
  const obsWetMean = obsWetSeas.length ? (obsWetSeas.reduce((s,g)=>s+g.mean,0)/obsWetSeas.length).toFixed(2) : null;
  const years   = [...new Set(obsSeasons.map(g=>String(g.year)))].sort();
  const dryData = years.map(yr => { const g=obsDrySeas.find(g=>String(g.year)===yr); return g?+g.mean.toFixed(3):null; });
  const wetData = years.map(yr => { const g=obsWetSeas.find(g=>String(g.year)===yr); return g?+g.mean.toFixed(3):null; });

  obsSection.innerHTML = `
    <div style="display:flex;gap:14px;margin-bottom:8px;flex-wrap:wrap;">
      ${obsDryMean!==null?`<div class="result-row" style="flex:1;border:none;padding:2px 0;"><span class="result-key">Obs. dry mean</span><span class="result-val" style="color:var(--accent)">${obsDryMean} mt/ha</span></div>`:''}
      ${obsWetMean!==null?`<div class="result-row" style="flex:1;border:none;padding:2px 0;"><span class="result-key">Obs. wet mean</span><span class="result-val" style="color:var(--accent2)">${obsWetMean} mt/ha</span></div>`:''}
    </div>
    <div style="position:relative;height:130px;"><canvas id="obs-yield-chart"></canvas></div>
    <div style="font-size:9px;color:var(--muted);margin-top:5px;">Observed yield per analogue season. Dashed lines = model mean prediction.</div>
    <div style="margin-top:12px;">
      <div style="font-size:9px;color:var(--muted);font-family:var(--font-mono);text-transform:uppercase;letter-spacing:0.08em;margin-bottom:5px;">Monthly climate profile</div>
      <div style="position:relative;height:150px;"><canvas id="clim-driver-chart"></canvas></div>
      <div style="font-size:9px;color:var(--muted);margin-top:4px;">Mean across analogue seasons. Left: Temp &amp; Solar. Right: Precip &amp; Vapour Pressure.</div>
    </div>`;

  const obsCanvas = document.getElementById('obs-yield-chart');
  if(!obsCanvas) return;
  const dryPred = r.dryMean, wetPred = r.wetMean;
  const refLinePlugin = {
    id:'claraRefLines',
    afterDraw(chart){
      const ctx=chart.ctx, yA=chart.scales.y, xA=chart.scales.x;
      if(!yA||!xA) return;
      const drawH=(val,color,label)=>{
        if(val===null||val===undefined) return;
        const y=yA.getPixelForValue(+val);
        ctx.save(); ctx.strokeStyle=color; ctx.lineWidth=1; ctx.setLineDash([3,3]);
        ctx.beginPath(); ctx.moveTo(xA.left,y); ctx.lineTo(xA.right,y); ctx.stroke();
        ctx.fillStyle=color; ctx.font='8px Space Mono'; ctx.textAlign='right';
        ctx.fillText(label, xA.right-4, y-3); ctx.restore();
      };
      drawH(dryPred,'rgba(88,166,255,0.8)',`Pred ${dryPred?dryPred.toFixed(2):'—'}`);
      drawH(wetPred,'rgba(63,185,80,0.8)', `Pred ${wetPred?wetPred.toFixed(2):'—'}`);
    }
  };
  window._obsChart = new Chart(obsCanvas, {
    type:'bar',
    data:{labels:years, datasets:[
      {label:'Dry Season', data:dryData, backgroundColor:'rgba(88,166,255,0.5)', borderColor:'rgba(88,166,255,0.9)', borderWidth:1, borderRadius:2},
      {label:'Wet Season', data:wetData, backgroundColor:'rgba(63,185,80,0.5)',  borderColor:'rgba(63,185,80,0.9)',  borderWidth:1, borderRadius:2}
    ]},
    options:{
      responsive:true, maintainAspectRatio:false,
      plugins:{
        legend:{labels:{color:'#8b949e',font:{size:9,family:'Space Mono'},boxWidth:10,padding:8}},
        tooltip:{callbacks:{label:i=>i.raw!==null?`${i.dataset.label}: ${(+i.raw).toFixed(2)} mt/ha`:'No data'}}
      },
      scales:{
        y:{min:0, title:{display:true,text:'Yield (mt/ha)',color:'#8b949e',font:{size:9,family:'Space Mono'}},
           grid:{color:'rgba(255,255,255,0.05)'}, ticks:{color:'#8b949e',font:{size:9,family:'Space Mono'}}},
        x:{grid:{display:false}, ticks:{color:'#8b949e',font:{size:9,family:'Space Mono'}}}
      }
    },
    plugins:[refLinePlugin]
  });

  const climCanvas = document.getElementById('clim-driver-chart');
  if(climCanvas && csvData) {
    const climRows = csvData.filter(row =>
      row.province && row.province.trim().toLowerCase() === prov &&
      row.municipality && row.municipality.trim().toLowerCase() === muni &&
      semSet.has(`${row.harvest_year}_${row.semester}`)
    );
    const byMonth = {};
    climRows.forEach(row => {
      const mo = new Date(row.week_start).getMonth() + 1;
      if(!byMonth[mo]) byMonth[mo] = {temp:[],precip:[],solar:[],vp:[]};
      const t=+row.Temperature_Air_2m_Mean_24h, p=+row.Precipitation_CHIRPS, s=+row.Solar_Radiation_Flux, v=+row.Vapour_Pressure_Mean_24h;
      if(!isNaN(t)&&t) byMonth[mo].temp.push(t);
      if(!isNaN(p)&&String(p)!=='') byMonth[mo].precip.push(+p);
      if(!isNaN(s)&&s) byMonth[mo].solar.push(s);
      if(!isNaN(v)&&v) byMonth[mo].vp.push(v);
    });
    const climMonths = Object.keys(byMonth).map(Number).sort((a,b)=>a-b);
    const avg = arr => arr.length ? arr.reduce((s,v)=>s+v,0)/arr.length : null;
    window._climChart = new Chart(climCanvas, {
      type:'line',
      data:{
        labels:climMonths.map(m=>MONTH_SHORT[m]),
        datasets:[
          {label:'Temp (°C)',    data:climMonths.map(m=>{const v=avg(byMonth[m].temp);  return v?+v.toFixed(2):null;}), borderColor:'rgba(240,136,62,0.85)',backgroundColor:'transparent',tension:0.3,yAxisID:'yT',pointRadius:3},
          {label:'Solar MJ/m²', data:climMonths.map(m=>{const v=avg(byMonth[m].solar); return v?+v.toFixed(1):null;}), borderColor:'rgba(247,201,72,0.85)',backgroundColor:'transparent',tension:0.3,yAxisID:'yT',pointRadius:3},
          {label:'Precip mm',   data:climMonths.map(m=>{const v=avg(byMonth[m].precip);return v?+v.toFixed(2):null;}), borderColor:'rgba(88,166,255,0.85)', backgroundColor:'transparent',tension:0.3,yAxisID:'yP',pointRadius:3},
          {label:'VP kPa',      data:climMonths.map(m=>{const v=avg(byMonth[m].vp);    return v?+v.toFixed(2):null;}), borderColor:'rgba(63,185,80,0.75)',  backgroundColor:'transparent',tension:0.3,yAxisID:'yP',pointRadius:3}
        ]
      },
      options:{
        responsive:true, maintainAspectRatio:false,
        plugins:{
          legend:{labels:{color:'#8b949e',font:{size:9,family:'Space Mono'},boxWidth:10,padding:8}},
          tooltip:{callbacks:{label:i=>`${i.dataset.label}: ${i.raw}`}}
        },
        scales:{
          yT:{type:'linear',position:'left', grid:{color:'rgba(255,255,255,0.05)'},ticks:{color:'#8b949e',font:{size:9,family:'Space Mono'}}},
          yP:{type:'linear',position:'right',grid:{display:false},               ticks:{color:'#8b949e',font:{size:9,family:'Space Mono'}}},
          x: {grid:{display:false},                                               ticks:{color:'#8b949e',font:{size:9,family:'Space Mono'}}}
        }
      }
    });
  }
}

// ══════════════════════════════════════════════════════════════
// VALIDATION MAP
// ══════════════════════════════════════════════════════════════