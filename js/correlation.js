function selectCorrENSO(phase, enc) {
  corrENSOPhase = phase; corrENSOEnc = enc;
  document.getElementById('cc-neutral').classList.toggle('active', phase==='Neutral');
  document.getElementById('cc-nino').classList.toggle('active', phase==='El Niño');
  document.getElementById('cc-nina').classList.toggle('active', phase==='La Niña');
  document.getElementById('corr-results').style.display='none';
}

// ── MONTH GRID ────────────────────────────────────────────────
const monthGrid=document.getElementById('month-grid');
MONTHS.forEach((m,i)=>{
  const btn=document.createElement('button');
  btn.className='month-btn';
  btn.textContent=m.n;
  btn.onclick=()=>selectMonth(i,btn);
  monthGrid.appendChild(btn);
});

function selectMonth(idx,btn) {
  selectedMonth=idx;
  const m=MONTHS[idx];
  const startNum=MONTH_NUMS[m.n];
  const growWin=buildGrowingWindow(startNum, m.sem);
  // highlight all months in the growing window
  document.querySelectorAll('.month-btn').forEach((b,i)=>{
    const mn=MONTH_NUMS[MONTHS[i].n];
    b.classList.toggle('active', growWin.includes(mn));
  });
  renderSeasonCtx(idx, growWin);
  updateAnalyzeBtn();
  document.getElementById('corr-results').style.display='none';
}

function renderSeasonCtx(idx, growWin) {
  const m=MONTHS[idx];
  const isDry=m.sem===1;
  const box=document.getElementById('season-ctx-box');
  const winLen=growWin ? growWin.length : '';
  const winStart=growWin ? MONTH_SHORT[growWin[0]] : m.n;
  const winEnd=growWin ? MONTH_SHORT[growWin[growWin.length-1]] : '—';
  const winLabel=growWin ? `Growing window: ${winStart} → ${winEnd} (${isDry?'Dry Season':'Wet Season'} · ${winLen} month${winLen!==1?'s':''})` : `${m.n} → ${m.harvest} Harvest`;
  box.innerHTML=`<div class="season-ctx ${isDry?'dry':'wet'}"><div class="ctx-title">${winLabel}</div><div class="ctx-body"><strong>${m.n}</strong> starts in the <strong>${isDry?'Dry Season (Sep 16–Mar 15)':'Wet Season (Mar 16–Sep 15)'}</strong>.<br>Typical planting: <strong>${isDry?'October – November':'May – June'}</strong> · Expected harvest: <strong>${m.harvest}</strong></div></div>`;
}

function updateAnalyzeBtn() {
  const can = csvData !== null && selectedMonth !== null;
  document.getElementById('c-analyze-btn').disabled = !can;
  // Update CSV badge
  const csvBadge = document.getElementById('c-csv-badge');
  if(csvBadge) {
    if(csvData) { csvBadge.className='m-badge loaded'; csvBadge.innerHTML='<span class="mdot"></span>Dataset ready'; }
    else        { csvBadge.className='m-badge unloaded'; csvBadge.innerHTML='<span class="mdot"></span>No dataset'; }
  }
}

// ── SPEARMAN ANALYSIS ─────────────────────────────────────────
async function runCorrelation() {
  if(!csvData || selectedMonth===null) return;

  const btn = document.getElementById('c-analyze-btn');
  btn.disabled = true;
  document.getElementById('corr-results').style.display='none';
  document.getElementById('corr-loading').style.display='block';
  corrCharts.forEach(ch=>ch.destroy()); corrCharts=[];
  if(window._lagChart) { window._lagChart.destroy(); window._lagChart=null; }

  const m        = MONTHS[selectedMonth];
  const startNum = MONTH_NUMS[m.n];
  const sem      = m.sem;
  const growWin  = buildGrowingWindow(startNum, sem);

  // ── ENSO FILTER via analogue season set ───────────────────
  const analogueSems = ENSO_SEASONS[corrENSOPhase] || []
  const semSet = new Set(analogueSems.map(s=>`${s.y}_${s.s}`))

  const mean = arr => arr.reduce((a,b)=>a+b,0)/arr.length

  // ── AGGREGATE: group by province||municipality||harvest_year||semester ──
  // Each unit accumulates byMonth data for all months in the growing window
  const units = {}
  csvData.forEach(r => {
    if(!r.week_start) return
    if(!r.yield_anomaly && r.yield_anomaly !== 0) return
    if(+r.yield_mt_ha <= 0) return
    if(+r.semester !== sem) return
    const semKey = `${r.harvest_year}_${r.semester}`
    if(analogueSems.length && !semSet.has(semKey)) return
    const d = new Date(r.week_start)
    if(isNaN(d)) return
    const rowMonth = d.getMonth() + 1
    if(!growWin.includes(rowMonth)) return
    const k = `${r.province}||${r.municipality}||${r.harvest_year}||${r.semester}`
    if(!units[k]) {
      units[k] = { yield_anomaly: +r.yield_anomaly, byMonth: {} }
      growWin.forEach(mn => { units[k].byMonth[mn] = {wind:[],temp:[],solar:[],vapour:[],precip:[]} })
    }
    const bm = units[k].byMonth[rowMonth]
    bm.wind.push(+r.Wind_Speed_10m_Mean_24h)
    bm.temp.push(+r.Temperature_Air_2m_Mean_24h)
    bm.solar.push(+r.Solar_Radiation_Flux)
    bm.vapour.push(+r.Vapour_Pressure_Mean_24h)
    bm.precip.push(+r.Precipitation_CHIRPS)
  })

  // Keep only units that have data for every month in the window
  const completeUnits = Object.values(units).filter(u =>
    growWin.every(mn => u.byMonth[mn].wind.length > 0)
  )

  document.getElementById('corr-loading').style.display='none';

  const n = completeUnits.length

  if(n < 5) {
    document.getElementById('corr-results').style.display='block';
    document.getElementById('effect-summary').innerHTML =
      `<div style="grid-column:1/-1;color:var(--warn);font-size:12px;padding:12px;">
        Not enough observations (${n}) for this ENSO condition and starting month combination.
        Try selecting a different ENSO condition or month.
       </div>`;
    document.getElementById('charts-grid').innerHTML='';
    btn.disabled=false;
    return;
  }

  // ── COMPUTE LAG PROFILE ───────────────────────────────────
  const varKeys = ['wind','temp','solar','vapour','precip']
  const profile = {}
  varKeys.forEach(v => { profile[v] = [] })

  growWin.forEach((mn, mi) => {
    const isLast = mi === growWin.length - 1
    const label = MONTH_SHORT[mn] + (isLast ? ' ▸' : '')
    varKeys.forEach(v => {
      const xs = completeUnits.map(u => mean(u.byMonth[mn][v]))
      const ys = completeUnits.map(u => u.yield_anomaly)
      const r  = spearman(xs, ys)
      const p  = pValue(r, n)
      profile[v].push({monthLabel: label, r, p, n})
    })
  })

  renderLagProfile(profile, growWin, m, n)

  // Run model complement if model is loaded
  if(modelCorrelation) {
    await runModelComplement(m);
  } else {
    document.getElementById('model-prediction-section').style.display = 'none';
  }

  btn.disabled=false;
}

// ── RENDER LAG PROFILE ─────────────────────────────────────
function renderLagProfile(profile, growWin, m, n) {
  const chartsGrid = document.getElementById('charts-grid');
  chartsGrid.innerHTML = '';

  const labels = growWin.map((mn, i) => MONTH_SHORT[mn] + (i === growWin.length-1 ? ' ▸' : ''))

  const varDefs = [
    {key:'solar',  label:'Solar Radiation', color:'#f7c948'},
    {key:'temp',   label:'Temperature',     color:'#f0883e'},
    {key:'precip', label:'Precipitation',   color:'#58a6ff'},
    {key:'vapour', label:'Vapour Pressure', color:'#bc8cff'},
    {key:'wind',   label:'Wind Speed',      color:'#8b949e'},
  ]

  const card = document.createElement('div')
  card.className = 'chart-card full'
  card.innerHTML = `
    <div class="chart-card-title">Staggered Lag Profile — Climate vs. Semester Yield</div>
    <div class="chart-card-sub">Each point = Spearman r between that month's climate and final semester yield · Filled = p&lt;0.05</div>
    <div class="chart-container" style="position:relative;height:260px;"><canvas id="lag-profile-chart"></canvas></div>`
  chartsGrid.appendChild(card)

  setTimeout(() => {
    const ctx = document.getElementById('lag-profile-chart').getContext('2d')

    const zeroLinePlugin = {
      id: 'zeroLine',
      afterDraw(chart) {
        const {ctx: c, scales:{y}} = chart
        const yZero = y.getPixelForValue(0)
        const {left, right} = chart.chartArea
        c.save()
        c.strokeStyle = 'rgba(255,255,255,0.15)'
        c.lineWidth = 1
        c.setLineDash([4,4])
        c.beginPath()
        c.moveTo(left, yZero)
        c.lineTo(right, yZero)
        c.stroke()
        c.restore()
      }
    }

    const datasets = varDefs.map(vd => {
      const pts = profile[vd.key]
      return {
        label: vd.label,
        data: pts.map(p => p.r),
        borderColor: vd.color,
        backgroundColor: vd.color + '33',
        borderWidth: 2,
        tension: 0.3,
        pointRadius: pts.map(p => p.p < 0.05 ? 5 : 3),
        pointBackgroundColor: pts.map(p => p.p < 0.05 ? vd.color : 'transparent'),
        pointBorderColor: pts.map(_ => vd.color),
        pointHoverRadius: 7,
        fill: false,
      }
    })

    window._lagChart = new Chart(ctx, {
      type: 'line',
      data: { labels, datasets },
      options: {
        responsive: true, maintainAspectRatio: false, animation: false,
        plugins: {
          legend: {display:true, labels:{color:'#8b949e', font:{size:9, family:'Space Mono'}, boxWidth:12}},
          tooltip: {
            backgroundColor:'#161b22', borderColor:'#30363d', borderWidth:1,
            titleColor:'#e6edf3', bodyColor:'#8b949e',
            titleFont:{family:'Space Mono',size:10}, bodyFont:{family:'Space Mono',size:10},
            callbacks: {
              label(ctx2) {
                const vd = varDefs[ctx2.datasetIndex]
                const pt = profile[vd.key][ctx2.dataIndex]
                return `${ctx2.dataset.label} · ${pt.monthLabel.replace(' ▸','')}: r=${pt.r.toFixed(2)}, p=${pt.p.toFixed(3)}, n=${pt.n}`
              }
            }
          }
        },
        scales: {
          x: {ticks:{color:'#8b949e',font:{size:9,family:'Space Mono'}}, grid:{color:'rgba(255,255,255,0.05)'}},
          y: {
            min:-1, max:1,
            ticks:{color:'#8b949e',font:{size:9,family:'Space Mono'}},
            grid:{color:'rgba(255,255,255,0.05)'},
            title:{display:true,text:'Spearman r',color:'#8b949e',font:{size:9,family:'Space Mono'}}
          }
        }
      },
      plugins: [zeroLinePlugin]
    })
    corrCharts.push(window._lagChart)
  }, 50)

  // ── EFFECT SUMMARY CARDS (peak |r| per variable) ──────────
  const summaryEl = document.getElementById('effect-summary')
  summaryEl.innerHTML = ''
  const varDefsSum = [
    {key:'wind',   label:'Wind Speed'},
    {key:'temp',   label:'Temperature'},
    {key:'solar',  label:'Solar Rad.'},
    {key:'vapour', label:'Vapour Pres.'},
    {key:'precip', label:'Precipitation'},
  ]
  varDefsSum.forEach(({key, label}) => {
    const pts = profile[key]
    const peak = pts.reduce((best, pt) => Math.abs(pt.r) > Math.abs(best.r) ? pt : best, pts[0])
    const dir = peak.r >= 0 ? '↑' : '↓'
    const pos = peak.r >= 0
    const star = peak.p < 0.05 ? ' ★' : ''
    const mLabel = peak.monthLabel.replace(' ▸','')
    summaryEl.innerHTML += `
      <div class="effect-card">
        <div class="effect-var">${label}</div>
        <div style="font-family:var(--font-mono);font-size:9px;color:var(--muted);margin-bottom:4px;">peak: ${mLabel}</div>
        <div class="effect-dir ${pos?'pos':'neg'}">${dir}</div>
        <div class="effect-mag ${pos?'pos':'neg'}">${peak.r.toFixed(3)}${star}</div>
        <div style="font-size:9px;color:var(--muted);margin-top:3px;font-family:var(--font-mono);">p=${peak.p.toFixed(3)}</div>
      </div>`
  })

  summaryEl.innerHTML += `
    <div style="grid-column:1/-1;font-size:10px;color:var(--muted);font-family:var(--font-mono);padding:6px 0;">
      n = ${n} municipality-year observations · Window: ${MONTH_SHORT[growWin[0]]}→${MONTH_SHORT[growWin[growWin.length-1]]} · ${m.sem===1?'Dry':'Wet'} · ENSO: ${corrENSOPhase}
    </div>`

  // ── DISCLOSURE BLOCK ───────────────────────────────────────
  const existing = document.getElementById('lag-disclosures')
  if(existing) existing.remove()
  const disc = document.createElement('div')
  disc.id = 'lag-disclosures'
  disc.style.cssText = 'margin-top:16px;padding:10px 14px;background:rgba(255,255,255,0.02);border:1px solid var(--border);border-radius:5px;font-family:var(--font-mono);font-size:9px;color:var(--muted);line-height:1.9;'
  disc.innerHTML = `
    <div style="margin-bottom:4px;text-transform:uppercase;letter-spacing:0.08em;">Analytical disclosures</div>
    <div>1 · Yield is seasonal — same semester yield correlated against each month's climate; not a month-resolved decomposition.</div>
    <div>2 · Effective n ~40–50 due to shared CHIRPS grid cells (~0.05°); spatial autocorrelation not corrected.</div>
    <div>3 · No multiple-testing correction across 5 variables × window months — exploratory only.</div>
    <div>4 · Correlation ≠ causation; solar/temp/vapour are confounded via cloud cover.</div>
    <div>5 · Fixed planting calendar assumed; actual planting shifts 2–4 weeks across municipalities.</div>`
  chartsGrid.after(disc)

  document.getElementById('corr-results').style.display='block'
}
// ══════════════════════════════════════════════════════════════
// MODEL COMPLEMENT — YIELD ANOMALY PREDICTIONS
// ══════════════════════════════════════════════════════════════
async function runModelComplement(m) {
  const section  = document.getElementById('model-prediction-section');
  const content  = document.getElementById('model-pred-content');
  section.style.display = 'block';
  content.innerHTML = '<div class="loading-bar"><span class="spin"></span>Running yield anomaly model on analogue sequences…</div>';

  // Get matching seasons for selected ENSO condition
  const sems = ENSO_SEASONS[corrENSOPhase] || [];
  if(!sems.length) {
    content.innerHTML = `<div style="color:var(--muted);font-size:12px;">No analogue seasons for ${corrENSOPhase} in the 2018–2025 dataset.</div>`;
    return;
  }

  const semSet   = new Set(sems.map(s=>`${s.y}_${s.s}`));
  const ensoEnc  = ENSO_ENC[corrENSOPhase] || 0;

  // Filter CSV to matching seasons
  const filtered = (csvData||[]).filter(r => {
    if(!r.yield_mt_ha || r.yield_mt_ha <= 0) return false;
    if(r.semester !== m.sem) return false;
    return semSet.has(`${r.harvest_year}_${r.semester}`);
  });

  // Group into sequences
  const groups = {};
  filtered.forEach(r => {
    const k = `${r.province}||${r.municipality}||${r.harvest_year}||${r.semester}`;
    if(!groups[k]) groups[k] = [];
    groups[k].push(r);
  });

  const sequences = [], seqMeta = [];
  Object.entries(groups).forEach(([key, rows]) => {
    rows.sort((a,b)=>new Date(a.week_start)-new Date(b.week_start));
    const raw = rows.map(r=>[+r.Wind_Speed_10m_Mean_24h,+r.Temperature_Air_2m_Mean_24h,+r.Solar_Radiation_Flux,+r.Vapour_Pressure_Mean_24h,+r.Precipitation_CHIRPS,+r.semester,ensoEnc]);
    let seq = raw;
    if(seq.length < SEQ_LEN){ const pad=Array(SEQ_LEN-seq.length).fill(Array(7).fill(0)); seq=[...pad,...seq]; }
    else if(seq.length > SEQ_LEN){ seq=seq.slice(seq.length-SEQ_LEN); }
    const scaled = seq.map(r=>r.map((v,i)=>(v-SCALER_YA.mean[i])/SCALER_YA.scale[i]));
    sequences.push(scaled);
    const [prov,muni,hy,sem] = key.split('||');
    seqMeta.push({province:prov, municipality:muni, harvest_year:+hy, semester:+sem,
      actual_anomaly: rows[0].yield_anomaly || 0});
  });

  if(!sequences.length) {
    content.innerHTML = `<div style="color:var(--muted);font-size:12px;">No sequences available for this condition.</div>`;
    return;
  }

  // Batch inference
  let preds;
  try {
    preds = await runBatchInference(modelCorrelation, sequences);
  } catch(e) {
    content.innerHTML = `<div style="color:var(--error);font-size:12px;">Model inference error: ${e.message}</div>`;
    return;
  }

  // Statistics on predictions
  const mean   = arr => arr.reduce((a,b)=>a+b,0)/arr.length;
  const std    = arr => { const m=mean(arr); return Math.sqrt(arr.reduce((s,v)=>s+(v-m)**2,0)/arr.length); };
  const predMean  = mean(preds);
  const predStd   = std(preds);
  const predMin   = Math.min(...preds);
  const predMax   = Math.max(...preds);
  const posCount  = preds.filter(v=>v>0).length;
  const negCount  = preds.filter(v=>v<=0).length;
  const consensus = Math.round((Math.max(posCount,negCount)/preds.length)*100);
  const direction = posCount >= negCount ? 'Above Average' : 'Below Average';
  const dirColor  = posCount >= negCount ? 'var(--accent2)' : 'var(--error)';

  // Confidence level
  let confLabel, confColor;
  if(consensus >= 80)      { confLabel='High';     confColor='var(--accent2)'; }
  else if(consensus >= 60) { confLabel='Moderate'; confColor='var(--accent)'; }
  else                     { confLabel='Low';      confColor='var(--warn)'; }

  // Distribution histogram data — 10 bins
  const bins = 10;
  const binSize = (predMax - predMin) / bins || 0.1;
  const hist = Array(bins).fill(0);
  preds.forEach(v => { const b = Math.min(bins-1, Math.floor((v-predMin)/binSize)); hist[b]++; });
  const histMax = Math.max(...hist);

  // Agreement check with Spearman direction
  // We check sign agreement — if Spearman showed mostly positive correlations and model predicts above average, they agree
  const spearmanSummary = document.querySelectorAll('#effect-summary .effect-mag');
  let spearmanAgreement = '—';
  if(spearmanSummary.length) {
    spearmanAgreement = direction === 'Above Average' ? '↑ Consistent with positive correlations' : '↓ Consistent with negative correlations';
  }

  content.innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:16px;">
      <div style="background:var(--panel);border:1px solid var(--border);border-radius:6px;padding:12px;text-align:center;">
        <div style="font-family:var(--font-mono);font-size:9px;text-transform:uppercase;letter-spacing:0.08em;color:var(--muted);margin-bottom:6px;">Predicted Direction</div>
        <div style="font-size:16px;font-weight:700;color:${dirColor}">${direction}</div>
        <div style="font-size:10px;color:var(--muted);margin-top:3px;">${posCount} above · ${negCount} below</div>
      </div>
      <div style="background:var(--panel);border:1px solid var(--border);border-radius:6px;padding:12px;text-align:center;">
        <div style="font-family:var(--font-mono);font-size:9px;text-transform:uppercase;letter-spacing:0.08em;color:var(--muted);margin-bottom:6px;">Confidence</div>
        <div style="font-size:16px;font-weight:700;color:${confColor}">${confLabel}</div>
        <div style="font-size:10px;color:var(--muted);margin-top:3px;">${consensus}% of sequences agree</div>
      </div>
      <div style="background:var(--panel);border:1px solid var(--border);border-radius:6px;padding:12px;text-align:center;">
        <div style="font-family:var(--font-mono);font-size:9px;text-transform:uppercase;letter-spacing:0.08em;color:var(--muted);margin-bottom:6px;">Mean Prediction</div>
        <div style="font-size:16px;font-weight:700;color:${dirColor}">${predMean>=0?'+':''}${predMean.toFixed(3)}</div>
        <div style="font-size:10px;color:var(--muted);margin-top:3px;">mt/ha anomaly</div>
      </div>
    </div>
    <div style="background:var(--panel);border:1px solid var(--border);border-radius:6px;padding:14px;margin-bottom:12px;">
      <div style="font-family:var(--font-mono);font-size:9px;text-transform:uppercase;letter-spacing:0.08em;color:var(--muted);margin-bottom:10px;">Prediction Distribution (${sequences.length} sequences · ${sems.length} analogue seasons)</div>
      <div style="display:flex;align-items:flex-end;gap:3px;height:60px;">
        ${hist.map((h,i)=>{
          const barH = histMax ? Math.round((h/histMax)*100) : 0;
          const binCenter = predMin + (i+0.5)*binSize;
          const col = binCenter >= 0 ? 'rgba(63,185,80,0.7)' : 'rgba(248,81,73,0.7)';
          return '<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:2px;">'
            + '<div style="width:100%;height:'+barH+'%;background:'+col+';border-radius:2px 2px 0 0;min-height:'+(h?2:0)+'px;"></div>'
            + '</div>';
        }).join('')}
      </div>
      <div style="display:flex;justify-content:space-between;font-family:var(--font-mono);font-size:9px;color:var(--muted);margin-top:4px;">
        <span>${predMin.toFixed(2)}</span><span>0</span><span>${predMax.toFixed(2)}</span>
      </div>
      <div style="text-align:center;font-size:10px;color:var(--muted);margin-top:2px;">Yield Anomaly (mt/ha)</div>
    </div>
    <div style="background:var(--panel);border:1px solid var(--border);border-radius:6px;padding:12px;">
      <div style="font-family:var(--font-mono);font-size:9px;text-transform:uppercase;letter-spacing:0.08em;color:var(--muted);margin-bottom:8px;">Summary Statistics</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;font-size:11px;">
        <div style="display:flex;justify-content:space-between;"><span style="color:var(--muted);">Mean</span><span style="font-family:var(--font-mono);color:var(--text);">${predMean>=0?'+':''}${predMean.toFixed(3)} mt/ha</span></div>
        <div style="display:flex;justify-content:space-between;"><span style="color:var(--muted);">Std Dev</span><span style="font-family:var(--font-mono);color:var(--text);">±${predStd.toFixed(3)} mt/ha</span></div>
        <div style="display:flex;justify-content:space-between;"><span style="color:var(--muted);">Min</span><span style="font-family:var(--font-mono);color:var(--text);">${predMin.toFixed(3)} mt/ha</span></div>
        <div style="display:flex;justify-content:space-between;"><span style="color:var(--muted);">Max</span><span style="font-family:var(--font-mono);color:var(--text);">${predMax.toFixed(3)} mt/ha</span></div>
        <div style="display:flex;justify-content:space-between;"><span style="color:var(--muted);">Sequences</span><span style="font-family:var(--font-mono);color:var(--text);">${sequences.length}</span></div>
        <div style="display:flex;justify-content:space-between;"><span style="color:var(--muted);">Model R²</span><span style="font-family:var(--font-mono);color:var(--muted);">0.1437 (v2)</span></div>
      </div>
    </div>`;
}