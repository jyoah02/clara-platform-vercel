function rankArray(arr) {
  const sorted = [...arr].map((v,i)=>({v,i})).sort((a,b)=>a.v-b.v);
  const ranks = new Array(arr.length);
  let i = 0;
  while(i < sorted.length) {
    let j = i;
    while(j < sorted.length - 1 && sorted[j+1].v === sorted[j].v) j++;
    const avgRank = (i + j) / 2 + 1;
    for(let k = i; k <= j; k++) ranks[sorted[k].i] = avgRank;
    i = j + 1;
  }
  return ranks;
}

function pearson(x, y) {
  const n = x.length;
  const mx = x.reduce((a,b)=>a+b,0)/n;
  const my = y.reduce((a,b)=>a+b,0)/n;
  let num=0, dx=0, dy=0;
  for(let i=0;i<n;i++){
    const xi=x[i]-mx, yi=y[i]-my;
    num+=xi*yi; dx+=xi*xi; dy+=yi*yi;
  }
  return dx&&dy ? num/Math.sqrt(dx*dy) : 0;
}

function spearman(x, y) {
  return pearson(rankArray(x), rankArray(y));
}

// Two-tailed p-value from t-distribution (approximation)
function pValue(r, n) {
  if(n <= 2) return 1;
  const t = r * Math.sqrt((n-2)/(1-r*r+1e-10));
  const absT = Math.abs(t);
  const df = n - 2;
  // Approximation using regularized incomplete beta function
  const x = df / (df + absT*absT);
  // Simple approximation for p-value
  let p;
  if(absT > 10) { p = 0.0001; }
  else {
    // Use normal approximation for large df, t-approx for small
    if(df >= 30) {
      p = 2 * (1 - normalCDF(absT));
    } else {
      p = 2 * tCDF(absT, df);
    }
  }
  return Math.min(1, Math.max(0, p));
}

function normalCDF(z) {
  const a1=0.254829592,a2=-0.284496736,a3=1.421413741,a4=-1.453152027,a5=1.061405429,p=0.3275911;
  const sign = z<0?-1:1;
  z = Math.abs(z)/Math.sqrt(2);
  const t = 1/(1+p*z);
  const y = 1-(((((a5*t+a4)*t)+a3)*t+a2)*t+a1)*t*Math.exp(-z*z);
  return 0.5*(1+sign*y);
}

function tCDF(t, df) {
  // Returns upper tail probability P(T > t)
  const x = df/(df+t*t);
  return 0.5*incompleteBeta(x, df/2, 0.5);
}

function incompleteBeta(x, a, b) {
  // Simple continued fraction approximation
  if(x <= 0) return 0; if(x >= 1) return 1;
  const lbeta = lgamma(a)+lgamma(b)-lgamma(a+b);
  const front = Math.exp(Math.log(x)*a + Math.log(1-x)*b - lbeta) / a;
  // Lentz's algorithm
  let f=1, c=1, d=1-((a+b)*x/(a+1));
  d = d===0?1e-30:d; d=1/d; f=d;
  for(let i=1;i<=100;i++){
    const m=i;
    let num = m*(b-m)*x/((a+2*m-1)*(a+2*m));
    d=1+num*d; c=1+num/c;
    d=d===0?1e-30:d; c=c===0?1e-30:c;
    d=1/d; f*=d*c;
    num=-(a+m)*(a+b+m)*x/((a+2*m)*(a+2*m+1));
    d=1+num*d; c=1+num/c;
    d=d===0?1e-30:d; c=c===0?1e-30:c;
    d=1/d; const delta=d*c; f*=delta;
    if(Math.abs(delta-1)<1e-8) break;
  }
  return front*f;
}

function lgamma(x) {
  const c=[76.18009172947146,-86.50532032941677,24.01409824083091,-1.231739572450155,0.1208650973866179e-2,-0.5395239384953e-5];
  let y=x, tmp=x+5.5; tmp-=(x+0.5)*Math.log(tmp);
  let s=1.000000000190015;
  for(let j=0;j<6;j++) s+=c[j]/++y;
  return -tmp+Math.log(2.5066282746310005*s/x);
}

function sigLabel(p) {
  if(p < 0.01) return {label:'p < 0.01', color:'#3fb950', stars:'***', level:'Highly significant'};
  if(p < 0.05) return {label:'p < 0.05', color:'#58a6ff', stars:'**',  level:'Significant'};
  if(p < 0.10) return {label:'p < 0.10', color:'#f0883e', stars:'*',   level:'Marginal'};
  return           {label:'p ≥ 0.10', color:'#8b949e', stars:'ns',  level:'Not significant'};
}
