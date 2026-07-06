// generate.js — reads 4 Google Sheets via Drive API, produces index.html
// Run: GOOGLE_TOKEN=xxx node generate.js

const https = require('https');
const fs = require('fs');

const SHEET_IDS = {
  LATAM:  '11TuH4d9soP3QZqSj7OCLUqfvB1Tj-JJSkMYCUgvS0Gg',
  AFRICA: '171vqzuZpNsFTJliBVek-OqVFPGWPomkKP-HnxZPj-S4',
  EMENA:  '1C3Wqp2YwvP7mtuS0UqAZA1y3bP08mHZLtbDyqhT_qd0',
  ASIA:   '1KO08YiD_U-mGkVVr6wYaeqJsr7U_uPa75vrSgvfSetA',
};

const monMap = {jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11};

function pd(v) {
  if (!v) return null;
  const s = String(v).trim();
  if (!s || s.startsWith('#') || /^\d+$/.test(s)) return null;
  const m = s.match(/^(\d{1,2})[-\/]([A-Za-z]{3})[-\/](\d{2,4})$/);
  if (m) {
    let yr=parseInt(m[3]); if(yr<100) yr+=yr<50?2000:1900;
    const mon=monMap[m[2].toLowerCase()];
    if(mon!==undefined) return new Date(yr,mon,parseInt(m[1]));
  }
  return null;
}

function parseCSV(csv) {
  const lines=csv.trim().split(/\r?\n/).filter(l=>l.trim());
  if(lines.length<2) return [];
  function split(line){
    const cols=[]; let cur='',inQ=false;
    for(const ch of line){ if(ch==='"')inQ=!inQ; else if(ch===','&&!inQ){cols.push(cur.trim());cur='';}else cur+=ch; }
    cols.push(cur.trim()); return cols.map(c=>c.replace(/^"|"$/g,''));
  }
  const headers=split(lines[0]);
  return lines.slice(1).map(line=>{ const c=split(line),r={}; headers.forEach((h,i)=>{r[h]=c[i]||'';}); return r; }).filter(r=>r['Project Name']?.trim());
}

function fetchSheet(fileId, token) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: 'www.googleapis.com',
      path: `/drive/v3/files/${fileId}/export?mimeType=text%2Fcsv`,
      headers: { Authorization: `Bearer ${token}` }
    };
    https.get(opts, res => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        if (res.statusCode !== 200) reject(new Error(`HTTP ${res.statusCode}: ${data}`));
        else resolve(data);
      });
    }).on('error', reject);
  });
}

function processSheet(csv, region) {
  const rows = parseCSV(csv);
  const now = new Date();
  const yearStart = new Date(now.getFullYear(), 0, 1);
  const ACTIVE = ['EN','CO','LI'];
  return rows.filter(r => {
    const st = r['Status']?.trim().toUpperCase();
    if (!ACTIVE.includes(st)) return false;
    const pl=pd(r['Planned Launch Date']),al=pd(r['Actual Launch Date']),eng=pd(r['Engaged Date']);
    const del=al||pl;
    if(del&&del.getFullYear()>=now.getFullYear()) return true;
    if(eng&&eng.getFullYear()>=now.getFullYear()) return true;
    if(eng&&eng.getFullYear()===now.getFullYear()-1&&del&&del.getFullYear()>=now.getFullYear()) return true;
    return false;
  }).map(r => {
    const st=r['Status']?.trim().toUpperCase();
    const eng=pd(r['Engaged Date']),pl=pd(r['Planned Launch Date']),al=pd(r['Actual Launch Date']);
    const isC=st==='LI', isD=!isC&&al&&pl&&al>pl;
    return {
      name: r['Project Name'].trim(),
      country: r['Country']?.trim()||'',
      region, isDelayed:!!isD, isCompleted:isC,
      status: isC?'Completed':isD?'Delayed':'On Track',
      engDate:eng, plannedLaunch:pl, actualLaunch:al,
      deliveryDate: al||pl||now
    };
  }).filter(p=>p.engDate||p.plannedLaunch);
}

async function main() {
  const token = process.env.GOOGLE_TOKEN;
  if (!token) { console.error('GOOGLE_TOKEN not set'); process.exit(1); }

  const allProjects = [];
  for (const [region, id] of Object.entries(SHEET_IDS)) {
    try {
      const csv = await fetchSheet(id, token);
      const projects = processSheet(csv, region);
      console.log(`${region}: ${projects.length} projects`);
      allProjects.push(...projects);
    } catch(e) {
      console.error(`${region} error:`, e.message);
    }
  }

  const html = generateHTML(allProjects);
  fs.writeFileSync('index.html', html);
  console.log(`Generated index.html with ${allProjects.length} projects`);
}

function generateHTML(projects) {
  const now = new Date();
  const year = now.getFullYear();
  const rangeStart = new Date(year, 0, 1);
  const rangeEnd = new Date(year, now.getMonth() + 4, 1);
  const totalMs = rangeEnd - rangeStart;

  const RC = {LATAM:'#38BDF8', AFRICA:'#22C55E', EMENA:'#A78BFA', ASIA:'#F59E0B'};
  const RL = {LATAM:'L', AFRICA:'F', EMENA:'E', ASIA:'A'};

  const sorted = [...projects].sort((a,b)=>{
    const o={Delayed:0,'On Track':1,Completed:2};
    const sd=(o[a.status]??1)-(o[b.status]??1);
    return sd!==0?sd:['LATAM','AFRICA','EMENA','ASIA'].indexOf(a.region)-['LATAM','AFRICA','EMENA','ASIA'].indexOf(b.region);
  });

  const stats = {
    total: projects.length,
    onTrack: projects.filter(p=>!p.isDelayed&&!p.isCompleted).length,
    delayed: projects.filter(p=>p.isDelayed&&!p.isCompleted).length,
    completed: projects.filter(p=>p.isCompleted).length,
  };

  const regionCounts = {};
  for (const r of ['LATAM','AFRICA','EMENA','ASIA']) regionCounts[r] = projects.filter(p=>p.region===r).length;

  // Generate month markers
  const months = [];
  const seenM = new Set();
  const wd = new Date(rangeStart);
  while (wd.getDay()!==1) wd.setDate(wd.getDate()+1);
  while (wd <= rangeEnd) {
    const k = wd.getFullYear()+'-'+wd.getMonth();
    if (!seenM.has(k)) {
      seenM.add(k);
      const pct = (wd-rangeStart)/totalMs*100;
      months.push({pct, label: wd.toLocaleString('en',{month:'short',year:'numeric'})});
    }
    wd.setDate(wd.getDate()+7);
  }

  const todayPct = (now-rangeStart)/totalMs*100;
  const updatedStr = now.toLocaleString('en-GB',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'});

  const rowsHTML = sorted.map((p, i) => {
    const eng = (p.engDate||p.plannedLaunch||now).getTime();
    const del = p.deliveryDate.getTime();
    const sp = Math.max(0,(eng-rangeStart)/totalMs*100);
    const ep = Math.min(100,(del-rangeStart)/totalMs*100);
    const barW = Math.max(0.5, ep-sp);
    const col = p.isCompleted?'#38BDF8':p.isDelayed?'#EF4444':'#22C55E';
    const prog = (p.isCompleted||p.isDelayed)?100:Math.min(100,(now-eng)/Math.max(1,del-eng)*100);

    const flagPct = p.isDelayed && p.plannedLaunch ? (p.plannedLaunch-rangeStart)/totalMs*100 : null;
    const delayCal = p.isDelayed && p.plannedLaunch ? Math.round((p.deliveryDate-p.plannedLaunch)/(1000*60*60*24*7)) : 0;
    const delayReason = p.delayReason || '';

    const prefix = RL[p.region]||'';
    const displayName = `${prefix} ${p.name}`;

    return `
    <div class="row ${i%2===0?'even':''}" data-region="${p.region}" data-status="${p.status}">
      <div class="row-left">
        <span class="tag" style="background:${RC[p.region]}22;color:${RC[p.region]};border:1px solid ${RC[p.region]}44">${p.region}</span>
        <span class="ctry">${p.country}</span>
        <span class="pname" title="${p.name}">${displayName.length>42?displayName.slice(0,40)+'…':displayName}</span>
      </div>
      <div class="row-chart">
        ${sp < 100 && ep > 0 ? `
        <div class="bar-track" style="left:${sp}%;width:${barW}%;background:${col}22;border:1px solid ${col}44;border-radius:4px;position:absolute;height:14px;top:50%;transform:translateY(-50%)">
          <div style="width:${prog}%;height:100%;background:${col};border-radius:4px;transition:width 0.3s"></div>
        </div>
        <div class="bar-dot" style="left:calc(${ep}% - 5px);background:${col}" title="${p.status}"></div>
        ${flagPct!==null ? `
        <div class="flag-line" style="left:${flagPct}%" title="Planned: ${p.plannedLaunch?.toLocaleDateString('en-GB')}${delayReason?'\nReason: '+delayReason:''}">
          <div class="flag-pole"></div>
          <div class="flag-banner">+${delayCal}w${delayReason?'\n'+delayReason:''}</div>
        </div>` : ''}
        ` : ''}
      </div>
      <div class="status-pill" style="color:${col};border-color:${col}44;background:${col}11">${p.status}</div>
    </div>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Upstream — Global PMO Roadmap</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap');
  :root {
    --bg: #0F172A; --bg2: #0A1628; --bg3: #0D1F35; --bg4: #1E293B;
    --border: #1E3A5F; --text: #E2E8F0; --muted: #64748B; --subtle: #94A3B8;
    --latam: #38BDF8; --africa: #22C55E; --emena: #A78BFA; --asia: #F59E0B;
    --delayed: #EF4444; --ontrack: #22C55E; --completed: #38BDF8; --today: #F59E0B;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: var(--bg); color: var(--text); font-family: 'Inter', sans-serif; min-height: 100vh; }

  /* PASSWORD GATE */
  #gate { position:fixed;inset:0;background:var(--bg);z-index:999;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:24px; }
  #gate h1 { font-size:28px;font-weight:700;letter-spacing:-0.5px; }
  #gate p { color:var(--muted);font-size:14px; }
  #gate input { background:var(--bg4);border:1px solid var(--border);color:var(--text);padding:12px 16px;border-radius:8px;font-size:15px;width:280px;outline:none; }
  #gate input:focus { border-color:var(--latam); }
  #gate button { background:var(--latam);color:#0F172A;font-weight:600;padding:12px 32px;border:none;border-radius:8px;cursor:pointer;font-size:15px;width:280px; }
  #gate button:hover { opacity:0.9; }
  #gate .err { color:var(--delayed);font-size:13px;height:16px; }

  /* MAIN APP */
  #app { display:none; }

  /* HEADER */
  header { background:var(--bg2);border-bottom:1px solid var(--border);padding:20px 32px;display:flex;align-items:center;justify-content:space-between; }
  .logo { display:flex;flex-direction:column;gap:2px; }
  .logo h1 { font-size:22px;font-weight:700;letter-spacing:-0.3px; }
  .logo span { font-size:11px;color:var(--muted);letter-spacing:2px;text-transform:uppercase; }
  .header-right { display:flex;align-items:center;gap:24px; }
  .updated { font-size:11px;color:var(--muted);font-family:'JetBrains Mono',monospace; }

  /* REGION LEGEND */
  .legend { display:flex;gap:12px; }
  .leg { display:flex;align-items:center;gap:6px;font-size:12px;font-weight:500;padding:4px 10px;border-radius:20px; }

  /* STATS BAR */
  .stats { background:var(--bg2);border-bottom:1px solid var(--border);padding:16px 32px;display:flex;gap:32px;align-items:center; }
  .stat { display:flex;align-items:baseline;gap:8px; }
  .stat-val { font-size:28px;font-weight:700;font-variant-numeric:tabular-nums; }
  .stat-lbl { font-size:12px;color:var(--muted); }
  .stats-divider { width:1px;height:32px;background:var(--border); }
  .region-stats { display:flex;gap:16px;margin-left:auto; }
  .rsv { font-size:12px;font-weight:500; }

  /* FILTERS */
  .filters { padding:12px 32px;border-bottom:1px solid var(--border);display:flex;gap:8px; }
  .filter-btn { background:var(--bg4);border:1px solid var(--border);color:var(--subtle);padding:5px 14px;border-radius:20px;font-size:12px;cursor:pointer;font-weight:500;transition:all .15s; }
  .filter-btn:hover,.filter-btn.active { border-color:var(--latam);color:var(--latam);background:#38BDF811; }

  /* GANTT */
  .gantt-wrap { padding:0 32px 32px;overflow-x:auto; }
  .gantt { min-width:900px; }

  /* TIMELINE HEADER */
  .timeline-header { display:flex;height:48px;margin-left:340px;position:relative;border-bottom:1px solid var(--border); }
  .month-label { position:absolute;font-size:11px;font-weight:600;color:var(--subtle);padding-top:8px;letter-spacing:0.5px; }
  .today-header { position:absolute;top:0;bottom:0;width:2px;background:var(--today);opacity:.6; }
  .today-label { position:absolute;top:6px;background:var(--today);color:#0F172A;font-size:9px;font-weight:700;padding:2px 5px;border-radius:3px;transform:translateX(-50%); }

  /* ROWS */
  .row { display:flex;align-items:center;height:36px;border-bottom:1px solid #1E293B22; }
  .row.even { background:var(--bg3); }
  .row-left { width:340px;min-width:340px;display:flex;align-items:center;gap:6px;padding:0 12px 0 0; }
  .tag { font-size:9px;font-weight:700;padding:2px 6px;border-radius:10px;white-space:nowrap;letter-spacing:.5px; }
  .ctry { font-size:10px;font-weight:600;color:var(--muted);background:var(--bg4);padding:2px 5px;border-radius:4px;min-width:20px;text-align:center; }
  .pname { font-size:12px;font-weight:400;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis; }
  .row-chart { flex:1;position:relative;height:100%; }
  .bar-dot { position:absolute;width:10px;height:10px;border-radius:50%;top:50%;transform:translateY(-50%);border:2px solid var(--bg);z-index:2; }

  /* DELAY FLAG */
  .flag-line { position:absolute;top:4px;bottom:4px;z-index:3;cursor:pointer; }
  .flag-pole { width:2px;height:100%;background:var(--today); }
  .flag-banner { position:absolute;top:-2px;left:4px;background:var(--today);color:#0F172A;font-size:9px;font-weight:700;padding:2px 5px;border-radius:3px;white-space:pre;line-height:1.4;max-width:120px; }

  /* STATUS PILL */
  .status-pill { font-size:10px;font-weight:600;padding:3px 8px;border-radius:10px;border:1px solid;white-space:nowrap;margin-right:8px; }

  /* GRID LINES */
  .grid-lines { position:absolute;inset:0;pointer-events:none; }
  .grid-line { position:absolute;top:0;bottom:0;width:1px;background:#1E293B; }

  /* TODAY LINE in rows */
  .today-row-line { position:absolute;top:0;bottom:0;width:1px;background:var(--today);opacity:.4;z-index:1; }

  /* RESPONSIVE */
  @media(max-width:768px) { header{flex-direction:column;gap:12px;align-items:flex-start} .stats{flex-wrap:wrap;gap:16px} .region-stats{margin-left:0} }
</style>
</head>
<body>

<!-- PASSWORD GATE -->
<div id="gate">
  <div style="text-align:center">
    <div style="font-size:32px;margin-bottom:8px">📊</div>
    <h1>Upstream PMO</h1>
    <p>Enter password to access the dashboard</p>
  </div>
  <div style="display:flex;flex-direction:column;gap:12px;align-items:center">
    <input type="password" id="pw" placeholder="Password" onkeydown="if(event.key==='Enter')checkPw()">
    <button onclick="checkPw()">Access Dashboard</button>
    <div class="err" id="err"></div>
  </div>
</div>

<!-- MAIN APP -->
<div id="app">
  <header>
    <div class="logo">
      <h1>UPSTREAM <span style="color:var(--latam)">PMO</span></h1>
      <span>Global Program Roadmap ${year}</span>
    </div>
    <div class="header-right">
      <div class="legend">
        ${['LATAM','AFRICA','EMENA','ASIA'].map(r=>`<div class="leg" style="background:${RC[r]}18;color:${RC[r]};border:1px solid ${RC[r]}33"><span style="width:7px;height:7px;border-radius:50%;background:${RC[r]};display:inline-block"></span>${r}</div>`).join('')}
      </div>
      <div class="updated">Updated: ${updatedStr}</div>
    </div>
  </header>

  <div class="stats">
    <div class="stat"><span class="stat-val" style="color:var(--text)">${stats.total}</span><span class="stat-lbl">Total</span></div>
    <div class="stats-divider"></div>
    <div class="stat"><span class="stat-val" style="color:var(--ontrack)">${stats.onTrack}</span><span class="stat-lbl">On Track</span></div>
    <div class="stat"><span class="stat-val" style="color:var(--delayed)">${stats.delayed}</span><span class="stat-lbl">Delayed</span></div>
    <div class="stat"><span class="stat-val" style="color:var(--completed)">${stats.completed}</span><span class="stat-lbl">Completed</span></div>
    <div class="region-stats">
      ${Object.entries(regionCounts).map(([r,c])=>`<div class="rsv" style="color:${RC[r]}">${r}: ${c}</div>`).join('')}
    </div>
  </div>

  <div class="filters">
    <button class="filter-btn active" onclick="filter('all',this)">All</button>
    <button class="filter-btn" onclick="filter('Delayed',this)" style="">🚩 Delayed</button>
    <button class="filter-btn" onclick="filter('On Track',this)">✅ On Track</button>
    <button class="filter-btn" onclick="filter('Completed',this)">🏁 Completed</button>
    ${['LATAM','AFRICA','EMENA','ASIA'].map(r=>`<button class="filter-btn" onclick="filterRegion('${r}',this)" style="color:${RC[r]}">${r}</button>`).join('')}
  </div>

  <div class="gantt-wrap">
    <div class="gantt">
      <!-- TIMELINE HEADER -->
      <div style="display:flex;height:40px;border-bottom:1px solid var(--border);position:relative;margin-left:340px;">
        ${months.map(m=>`<div class="month-label" style="left:${m.pct}%">${m.label}</div>`).join('')}
        <div style="position:absolute;left:${todayPct}%;top:0;bottom:0;width:1px;background:var(--today);opacity:.5"></div>
        <div style="position:absolute;left:${todayPct}%;top:6px;transform:translateX(-50%);background:var(--today);color:#0F172A;font-size:9px;font-weight:700;padding:2px 6px;border-radius:3px">TODAY</div>
      </div>

      <!-- PROJECT ROWS -->
      <div id="rows">
        ${rowsHTML}
      </div>
    </div>
  </div>
</div>

<script>
const RC = ${JSON.stringify(RC)};
const PW = 'Upstreammanagement!';

function checkPw() {
  const v = document.getElementById('pw').value;
  if (v === PW) {
    document.getElementById('gate').style.display='none';
    document.getElementById('app').style.display='block';
    sessionStorage.setItem('pmo_auth','1');
  } else {
    document.getElementById('err').textContent='Incorrect password';
    setTimeout(()=>document.getElementById('err').textContent='',2000);
  }
}

// Auto-login if already authenticated this session
if (sessionStorage.getItem('pmo_auth')==='1') {
  document.getElementById('gate').style.display='none';
  document.getElementById('app').style.display='block';
}

function filter(status, btn) {
  document.querySelectorAll('.filter-btn').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  document.querySelectorAll('.row').forEach(r=>{
    r.style.display = (status==='all'||r.dataset.status===status)?'flex':'none';
  });
}

function filterRegion(region, btn) {
  document.querySelectorAll('.filter-btn').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  document.querySelectorAll('.row').forEach(r=>{
    r.style.display = r.dataset.region===region?'flex':'none';
  });
}
</script>
</body>
</html>`;
}

main().catch(e=>{ console.error(e); process.exit(1); });
