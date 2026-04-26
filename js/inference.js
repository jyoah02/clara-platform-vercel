async function tryAutoLoad(filename, onSuccess, onFail) {
  try {
    const res = await fetch(filename);
    if(!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf  = await res.arrayBuffer();
    const sess = await ort.InferenceSession.create(buf);
    onSuccess(sess);
  } catch(e) { onFail(e); }
}

async function tryAutoLoadCSV(filename, onSuccess, onFail) {
  try {
    const res = await fetch(filename);
    if(!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    const result = Papa.parse(text, {header:true, dynamicTyping:true, skipEmptyLines:true});
    onSuccess(result.data);
  } catch(e) { onFail(e); }
}

window.addEventListener('load', () => {
  // Planting model
  const pBadge = document.getElementById('p-model-badge');
  const pBtn   = document.getElementById('p-load-btn');
  pBadge.className = 'm-badge loading';
  pBadge.innerHTML = '<span class="mdot"></span>Loading…';
  tryAutoLoad('transformer_absolute_yield_v2_prod.onnx',
    sess => { modelPlanting=sess; pBadge.className='m-badge loaded'; pBadge.innerHTML='<span class="mdot"></span>Auto-loaded'; pBtn.textContent='Swap'; updateSimBtn(); },
    ()   => { pBadge.className='m-badge unloaded'; pBadge.innerHTML='<span class="mdot"></span>Not loaded'; }
  );
  // Correlation model
  const cBadge = document.getElementById('c-model-badge');
  const cBtn   = document.getElementById('c-load-btn');
  cBadge.className = 'm-badge loading';
  cBadge.innerHTML = '<span class="mdot"></span>Loading…';
  tryAutoLoad('transformer_yield_anomaly_v2_prod.onnx',
    sess => { modelCorrelation=sess; cBadge.className='m-badge loaded'; cBadge.innerHTML='<span class="mdot"></span>Model loaded'; cBtn.textContent='Swap'; updateAnalyzeBtn(); },
    ()   => { cBadge.className='m-badge unloaded'; cBadge.innerHTML='<span class="mdot"></span>Model not loaded'; }
  );
  // CSV — auto-load via fetch (works on Vercel/HTTP, not on file://)
  const csvBadge = document.getElementById('csv-badge');
  csvBadge.className = 'm-badge loading';
  csvBadge.innerHTML = '<span class="mdot"></span>Loading…';
  tryAutoLoadCSV('central_luzon_weekly_climate_yield_2018-2025_v2.csv',
    data => { csvData=data; csvBadge.className='m-badge loaded'; csvBadge.innerHTML=`<span class="mdot"></span>${data.length.toLocaleString()} rows`; updateSimBtn(); updateAnalyzeBtn(); },
    ()   => { csvBadge.className='m-badge unloaded'; csvBadge.innerHTML='<span class="mdot"></span>Not loaded'; }
  );
});

// ══════════════════════════════════════════════════════════════
// MODE SWITCHING
// ══════════════════════════════════════════════════════════════
function switchMode(mode) {
  document.querySelectorAll('.mode-tab').forEach((t,i)=>{ const m=['validation','planting','correlation']; t.classList.toggle('active',m[i]===mode); });
  document.querySelectorAll('.mode-panel').forEach(p=>p.classList.remove('active'));
  document.getElementById('panel-'+mode).classList.add('active');
  if(mode==='planting' && !plantingMapInit) initPlantingMap();
  if(mode==='planting' && plantingMapInit) setTimeout(()=>pMap.invalidateSize(),50);
}

// ══════════════════════════════════════════════════════════════
// MANUAL MODEL / CSV LOADING
// ══════════════════════════════════════════════════════════════
async function loadFromPicker(accept) {
  return new Promise((resolve,reject) => {
    const inp = document.createElement('input');
    inp.type='file'; inp.accept=accept;
    inp.onchange = async e => {
      try { const f=e.target.files[0]; if(!f) return reject(new Error('No file')); resolve(f); }
      catch(err){ reject(err); }
    };
    inp.oncancel=()=>reject(new Error('Cancelled'));
    inp.click();
  });
}

async function loadPlantingModel() {
  const badge=document.getElementById('p-model-badge'), btn=document.getElementById('p-load-btn');
  badge.className='m-badge loading'; badge.innerHTML='<span class="mdot"></span>Loading…'; btn.disabled=true;
  try {
    const f=await loadFromPicker('.onnx');
    const buf=await f.arrayBuffer();
    modelPlanting=await ort.InferenceSession.create(buf);
    badge.className='m-badge loaded'; badge.innerHTML='<span class="mdot"></span>Loaded'; btn.textContent='Swap'; updateSimBtn();
  } catch(e) { badge.className='m-badge unloaded'; badge.innerHTML='<span class="mdot"></span>Not loaded'; }
  btn.disabled=false;
}

async function loadCorrelationModel() {
  const badge=document.getElementById('c-model-badge'), btn=document.getElementById('c-load-btn');
  badge.className='m-badge loading'; badge.innerHTML='<span class="mdot"></span>Loading…'; btn.disabled=true;
  try {
    const f=await loadFromPicker('.onnx');
    const buf=await f.arrayBuffer();
    modelCorrelation=await ort.InferenceSession.create(buf);
    badge.className='m-badge loaded'; badge.innerHTML='<span class="mdot"></span>Model loaded'; btn.textContent='Swap'; updateAnalyzeBtn();
  } catch(e) { badge.className='m-badge unloaded'; badge.innerHTML='<span class="mdot"></span>Model not loaded'; }
  btn.disabled=false;
}

async function loadCSV() {
  const csvBadge = document.getElementById('csv-badge');
  const btn = document.getElementById('csv-load-btn');
  csvBadge.className = 'm-badge loading';
  csvBadge.innerHTML = '<span class="mdot"></span>Loading…';
  btn.disabled = true;
  try {
    const f = await loadFromPicker('.csv');
    const text = await f.text();
    const result = Papa.parse(text, {header:true, dynamicTyping:true, skipEmptyLines:true});
    csvData = result.data;
    csvBadge.className = 'm-badge loaded';
    csvBadge.innerHTML = `<span class="mdot"></span>${csvData.length.toLocaleString()} rows`;
    btn.textContent = 'Reload';
    updateSimBtn();
    updateAnalyzeBtn();
  } catch(e) {
    csvBadge.className = 'm-badge unloaded';
    csvBadge.innerHTML = '<span class="mdot"></span>Not loaded';
  }
  btn.disabled = false;
}

// ══════════════════════════════════════════════════════════════
// INFERENCE UTILITIES
// ══════════════════════════════════════════════════════════════
function scaleRow(raw, scaler) {
  return raw.map((v,i) => (v - scaler.mean[i]) / scaler.scale[i]);
}

async function runBatchInference(session, seqArray) {
  // seqArray: array of (SEQ_LEN × 7) float arrays
  const n = seqArray.length;
  const data = new Float32Array(n * SEQ_LEN * 7);
  for(let i=0;i<n;i++) for(let t=0;t<SEQ_LEN;t++) for(let f=0;f<7;f++) data[i*SEQ_LEN*7+t*7+f] = seqArray[i][t][f];
  const tensor = new ort.Tensor('float32', data, [n, SEQ_LEN, 7]);
  const result = await session.run({'sequence_input': tensor});
  return Array.from(result['output'].data);
}

async function runSingleInference(session, rawFeatures, scaler) {
  const scaled = scaleRow(rawFeatures, scaler);
  const data   = new Float32Array(SEQ_LEN * 7);
  for(let t=0;t<SEQ_LEN;t++) for(let f=0;f<7;f++) data[t*7+f] = scaled[f];
  const tensor = new ort.Tensor('float32', data, [1, SEQ_LEN, 7]);
  const result = await session.run({'sequence_input': tensor});
  return result['output'].data[0];
}

// ══════════════════════════════════════════════════════════════
// ENSO SELECTOR — PLANTING
// ══════════════════════════════════════════════════════════════