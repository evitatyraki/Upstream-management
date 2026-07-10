const https = require('https');
const fs = require('fs');

const SHEET_IDS = {
  LATAM:   '11TuH4d9soP3QZqSj7OCLUqfvB1Tj-JJSkMYCUgvS0Gg',
  AFRICA:  '171vqzuZpNsFTJliBVek-OqVFPGWPomkKP-HnxZPj-S4',
  EMENA:   '1C3Wqp2YwvP7mtuS0UqAZA1y3bP08mHZLtbDyqhT_qd0',
  ASIA:    '1KO08YiD_U-mGkVVr6wYaeqJsr7U_uPa75vrSgvfSetA',
  REASONS: '1tHF1FaQhfjAGltsQviqtloxmbKeW6oeyFJMXZ480Yus',
  HISTORY: '1yb-6ukbsnDuqy-Xjm8zjPUVgAIg4Dp53V3jg97D8e8Q',
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
  return lines.slice(1).map(line=>{ const c=split(line),r={}; headers.forEach((h,i)=>{r[h]=c[i]||'';}); return r; }).filter(r=>Object.values(r).some(v=>v));
}

function fetchSheet(fileId, token, sheetName='') {
  return new Promise((resolve, reject) => {
    const path = sheetName
      ? `/drive/v3/files/${fileId}/export?mimeType=text%2Fcsv&exportFormat=csv&sheetId=0`
      : `/drive/v3/files/${fileId}/export?mimeType=text%2Fcsv`;
    const opts = {
      hostname: 'www.googleapis.com',
      path,
      headers: { Authorization: `Bearer ${token}` }
    };
    https.get(opts, res => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        if (res.statusCode !== 200) reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0,200)}`));
        else resolve(data);
      });
    }).on('error', reject);
  });
}

// Fetch a specific sheet tab by gid
function fetchSheetTab(fileId, token, gid) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: 'docs.google.com',
      path: `/spreadsheets/d/${fileId}/export?format=csv&gid=${gid}`,
      headers: { Authorization: `Bearer ${token}` }
    };
    https.get(opts, res => {
      // Handle redirect
      if (res.statusCode === 302 || res.statusCode === 301) {
        const loc = res.headers.location;
        const url = new URL(loc);
        const opts2 = { hostname: url.hostname, path: url.pathname+url.search, headers: { Authorization: `Bearer ${token}` } };
        https.get(opts2, res2 => {
          let data=''; res2.on('data',d=>data+=d); res2.on('end',()=>resolve(data));
        }).on('error', reject);
        return;
      }
      let data=''; res.on('data',d=>data+=d); res.on('end',()=>resolve(data));
    }).on('error', reject);
  });
}

// Update Google Sheet via Sheets API
function updateSheet(fileId, token, range, values) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ values });
    const opts = {
      hostname: 'sheets.googleapis.com',
      path: `/v4/spreadsheets/${fileId}/values/${encodeURIComponent(range)}?valueInputOption=RAW`,
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    };
    const req = https.request(opts, res => {
      let data=''; res.on('data',d=>data+=d);
      res.on('end',()=>{ if(res.statusCode>=200&&res.statusCode<300) resolve(JSON.parse(data)); else reject(new Error(`Sheets API ${res.statusCode}: ${data.slice(0,200)}`)); });
    });
    req.on('error',reject); req.write(body); req.end();
  });
}

// Append rows to Google Sheet
function appendSheet(fileId, token, range, values) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ values });
    const opts = {
      hostname: 'sheets.googleapis.com',
      path: `/v4/spreadsheets/${fileId}/values/${encodeURIComponent(range)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    };
    const req = https.request(opts, res => {
      let data=''; res.on('data',d=>data+=d);
      res.on('end',()=>{ if(res.statusCode>=200&&res.statusCode<300) resolve(JSON.parse(data)); else reject(new Error(`Sheets API ${res.statusCode}: ${data.slice(0,200)}`)); });
    });
    req.on('error',reject); req.write(body); req.end();
  });
}

// Get sheet metadata (to find tab gids)
function getSheetMeta(fileId, token) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: 'sheets.googleapis.com',
      path: `/v4/spreadsheets/${fileId}?fields=sheets.properties`,
      headers: { Authorization: `Bearer ${token}` }
    };
    https.get(opts, res => {
      let data=''; res.on('data',d=>data+=d);
      res.on('end',()=>{ try{resolve(JSON.parse(data));}catch(e){reject(e);} });
    }).on('error', reject);
  });
}

// Add a new tab to a spreadsheet
function addSheetTab(fileId, token, title) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ requests: [{ addSheet: { properties: { title } } }] });
    const opts = {
      hostname: 'sheets.googleapis.com',
      path: `/v4/spreadsheets/${fileId}:batchUpdate`,
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    };
    const req = https.request(opts, res => {
      let data=''; res.on('data',d=>data+=d);
      res.on('end',()=>{ try{resolve(JSON.parse(data));}catch(e){reject(e);} });
    });
    req.on('error',reject); req.write(body); req.end();
  });
}

function processSheet(csv, region) {
  const rows = parseCSV(csv);
  const now = new Date();
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
      tlc: r['3LC']?.trim()||'',
      country: r['Country']?.trim()||'',
      region, isDelayed:!!isD, isCompleted:isC,
      status: isC?'Completed':isD?'Delayed':'On Track',
      engDate:eng, plannedLaunch:pl, actualLaunch:al,
      deliveryDate: al||pl||now,
      delayReason: ''
    };
  }).filter(p=>(p.engDate||p.plannedLaunch) && (p.plannedLaunch||p.actualLaunch));
}

async function main() {
  const token = process.env.GOOGLE_TOKEN;
  if (!token) { console.error('GOOGLE_TOKEN not set'); process.exit(1); }

  const now = new Date();
  const dateStr = now.toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'});

  // 1. Fetch all 4 project sheets
  const allProjects = [];
  for (const [region, id] of Object.entries(SHEET_IDS)) {
    if (region === 'REASONS') continue;
    try {
      const csv = await fetchSheet(id, token);
      const projects = processSheet(csv, region);
      console.log(`${region}: ${projects.length} projects`);
      allProjects.push(...projects);
    } catch(e) { console.error(`${region} error:`, e.message); }
  }

  // 2. Fetch Reasons & History sheets
  let currentReasons = {}, historyRows = [];
  try {
    const csv = await fetchSheet(SHEET_IDS.REASONS, token);
    const rows = parseCSV(csv);
    rows.forEach(r => {
      if (r['Project Name'] && r['Delay Reason']) {
        currentReasons[r['Project Name'].trim()] = r['Delay Reason'].trim();
      }
    });
    console.log(`Loaded ${Object.keys(currentReasons).length} existing reasons`);
  } catch(e) { console.error('Reasons sheet error:', e.message); }

  try {
    const csv2 = await fetchSheet(SHEET_IDS.HISTORY, token);
    historyRows = parseCSV(csv2);
    console.log(`Loaded ${historyRows.length} history rows`);
  } catch(e) { console.error('History sheet error:', e.message); }

  // 3. Apply reasons to projects + detect changes
  const newHistoryRows = [];
  allProjects.forEach(p => {
    const existing = currentReasons[p.name] || '';
    p.delayReason = existing;
  });

  // 4. Sync Current Reasons sheet:
  //    - Add new projects not yet in sheet
  //    - Remove projects no longer in dashboard
  //    - Keep manual reasons intact
  const projectNames = new Set(allProjects.map(p=>p.name));
  const sheetNames = new Set(Object.keys(currentReasons));

  // Build new Current Reasons data
  const newCurrentRows = [['Project Name','Region','Country','Status','Delay Reason']];
  allProjects.forEach(p => {
    newCurrentRows.push([p.name, p.region, p.country, p.status, currentReasons[p.name]||'']);
  });

  // Detect reason changes (for history)
  // We'll compare with what was previously in the sheet
  // If a project existed before with a different reason → log to history
  allProjects.forEach(p => {
    const prev = currentReasons[p.name];
    // Only log if project had a reason and it changed (manual input changed)
    // This run: we don't change reasons, we just read them
    // History is written when user manually changes a reason in the sheet
    // So we just ensure history has at least one entry per project that has a reason
    if (prev && prev.trim()) {
      const alreadyLogged = historyRows.some(h =>
        h['Project Name']===p.name && h['New Reason']===prev
      );
      if (!alreadyLogged) {
        newHistoryRows.push([dateStr, p.name, p.region, p.country, '', prev]);
      }
    }
  });

  // 5. Write updated Current Reasons
  try {
    await updateSheet(SHEET_IDS.REASONS, token, 'A1', newCurrentRows);
    console.log(`Updated Current Reasons: ${newCurrentRows.length-1} projects`);
  } catch(e) { console.error('Update Current Reasons error:', e.message); }

  // 6. Clear history sheet and rewrite (first run = headers only, then append changes)
  const isFirstRun = historyRows.length === 0;
  if (isFirstRun) {
    try {
      await updateSheet(SHEET_IDS.HISTORY, token, 'A1', [['Date','Project Name','Region','Country','Previous Reason','New Reason']]);
      console.log('History sheet cleared and initialized');
    } catch(e) { console.error('Clear history error:', e.message); }
  } else if (newHistoryRows.length > 0) {
    try {
      await appendSheet(SHEET_IDS.HISTORY, token, 'A1', newHistoryRows);
      console.log(`Appended ${newHistoryRows.length} history rows`);
    } catch(e) { console.error('Append history error:', e.message); }
  }

  // 7. Reload full history for dashboard
  let fullHistory = [...historyRows.map(r=>[r['Date'],r['Project Name'],r['Region'],r['Country'],r['Previous Reason']||'',r['New Reason']||r['Previous Reason']||'']), ...newHistoryRows];

  // 8. Generate HTML
  const html = generateHTML(allProjects, fullHistory);
  fs.writeFileSync('index.html', html);
  console.log(`Generated index.html with ${allProjects.length} projects, ${fullHistory.length} history entries`);
}

function generateHTML(projects, historyData) {
  const now = new Date();
  const year = now.getFullYear();
  const rangeStart = new Date(year,0,1);
  const rangeEnd = new Date(year,now.getMonth()+4,1);
  const totalMs = rangeEnd - rangeStart;
  const RC = {LATAM:'#38BDF8',AFRICA:'#22C55E',EMENA:'#A78BFA',ASIA:'#F59E0B'};
  const RL = {LATAM:'L',AFRICA:'F',EMENA:'E',ASIA:'A'};
  const updatedStr = now.toLocaleString('en-GB',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'});

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
  ['LATAM','AFRICA','EMENA','ASIA'].forEach(r=>regionCounts[r]=projects.filter(p=>p.region===r).length);

  // Month markers
  const months=[], seenM=new Set();
  const wd=new Date(rangeStart);
  while(wd.getDay()!==1) wd.setDate(wd.getDate()+1);
  while(wd<=rangeEnd){
    const k=wd.getFullYear()+'-'+wd.getMonth();
    if(!seenM.has(k)){seenM.add(k);months.push({pct:(wd-rangeStart)/totalMs*100,label:wd.toLocaleString('en',{month:'short',year:'numeric'})});}
    wd.setDate(wd.getDate()+7);
  }
  const todayPct=(now-rangeStart)/totalMs*100;

  // Gantt rows
  const rowsHTML = sorted.map((p,i)=>{
    const eng=(p.engDate||p.plannedLaunch||now).getTime();
    const rawDel = p.deliveryDate.getTime();
    // For delayed with future actual: solid bar to TODAY, ghost bar TODAY→actual
    const isFutureDelayed = p.isDelayed && !p.isCompleted && rawDel > now.getTime();
    const del = isFutureDelayed ? now.getTime() : rawDel;
    const sp=Math.max(0,(eng-rangeStart)/totalMs*100);
    const ep=Math.min(100,(del-rangeStart)/totalMs*100);
    const epFull=Math.min(100,(rawDel-rangeStart)/totalMs*100);
    const barW=Math.max(0.5,ep-sp);
    const col=p.isCompleted?'#38BDF8':p.isDelayed?'#EF4444':'#22C55E';
    const prog=(p.isCompleted||p.isDelayed)?100:Math.min(100,(now-eng)/Math.max(1,del-eng)*100);
    const flagPct=p.isDelayed&&p.plannedLaunch?(p.plannedLaunch-rangeStart)/totalMs*100:null;
    const delayCal=p.isDelayed&&p.plannedLaunch?Math.round((p.deliveryDate-p.plannedLaunch)/(1000*60*60*24*7)):0;
    const tlcSuffix=p.tlc?' ['+p.tlc+']':'';
    const fullName=p.name+tlcSuffix;
    const dn=fullName.length>44?p.name.slice(0,40)+'…'+tlcSuffix:fullName;
    return `
    <div class="row ${i%2===0?'even':''}" data-region="${p.region}" data-status="${p.status}">
      <div class="row-left">
        <span class="tag" style="background:${RC[p.region]}22;color:${RC[p.region]};border:1px solid ${RC[p.region]}44">${p.region}</span>
        <span class="ctry">${p.country}</span>
        <span class="pname" title="${p.name}">${dn}</span>
      </div>
      <div class="row-chart">
        ${sp<100&&ep>0?`
        <div style="position:absolute;left:${sp}%;width:${barW}%;background:${col}22;border:1px solid ${col}44;border-radius:4px;height:14px;top:50%;transform:translateY(-50%)">
          <div style="width:${prog}%;height:100%;background:${col};border-radius:4px"></div>
        </div>
        <div style="position:absolute;left:calc(${ep}% - 5px);width:10px;height:10px;border-radius:50%;background:${col};top:50%;transform:translateY(-50%);border:2px solid #0F172A;z-index:2"></div>
        ${isFutureDelayed?'<div style="position:absolute;left:'+ep+'%;width:'+(epFull-ep)+'%;background:'+col+'33;border:1px solid '+col+'66;border-radius:0 4px 4px 0;height:14px;top:50%;transform:translateY(-50%)"></div>'+'<div style="position:absolute;left:calc('+epFull+'% - 5px);width:10px;height:10px;border-radius:50%;background:'+col+'44;top:50%;transform:translateY(-50%);border:2px dashed '+col+';z-index:2"></div>':''}
        ${(function(){
          let out='';
          const pl=p.plannedLaunch;
          if(pl){
            const plPct=Math.min(100,(pl-rangeStart)/totalMs*100);
            const dd=String(pl.getDate()).padStart(2,'0');
            const mm=String(pl.getMonth()+1).padStart(2,'0');
            out+='<div style="position:absolute;left:calc('+plPct+'% - 4px);top:calc(50% - 9px);transform:translateY(-50%);z-index:4">'
              +'<div style="width:8px;height:8px;border-radius:50%;background:#FFFFFF;border:2px solid #94A3B8" title="Planned: '+dd+'/'+mm+'"></div>'
              +'<div style="position:absolute;top:10px;left:50%;transform:translateX(-50%);font-size:7px;color:#94A3B8;white-space:nowrap;font-weight:600">P '+dd+'/'+mm+'</div>'
              +'</div>';
          }
          const al=p.actualLaunch;
          const sameDate = al && pl && al.toDateString()===pl.toDateString();
          if(al && !sameDate){
            const alPct=Math.min(100,(al-rangeStart)/totalMs*100);
            const add=String(al.getDate()).padStart(2,'0');
            const amm=String(al.getMonth()+1).padStart(2,'0');
            out+='<div style="position:absolute;left:calc('+alPct+'% - 4px);top:calc(50% + 5px);transform:translateY(-50%);z-index:4">'
              +'<div style="width:8px;height:8px;border-radius:50%;background:'+col+';border:2px solid #0F172A" title="Actual: '+add+'/'+amm+'"></div>'
              +'<div style="position:absolute;top:10px;left:50%;transform:translateX(-50%);font-size:7px;color:'+col+';white-space:nowrap;font-weight:600">A '+add+'/'+amm+'</div>'
              +'</div>';
          }
          return out;
        })()}
        ${flagPct!==null?`
        <div style="position:absolute;left:${flagPct}%;top:3px;bottom:3px;z-index:3" title="${p.delayReason||('Planned: '+(p.plannedLaunch?.toLocaleDateString('en-GB')||''))}">
          <div style="width:2px;height:100%;background:#F59E0B"></div>
          <div title="${p.delayReason||''}" style="position:absolute;top:-1px;left:3px;background:#F59E0B;color:#0F172A;font-size:9px;font-weight:700;padding:2px 5px;border-radius:3px;cursor:help">+${delayCal}w</div>
        </div>`:''}
        `:''}
      </div>
      <div style="font-size:10px;font-weight:600;padding:3px 8px;border-radius:10px;border:1px solid ${col}44;background:${col}11;color:${col};white-space:nowrap;margin-right:8px">${p.status}</div>
    </div>`;
  }).join('');

  // History tab data as JSON
  const historyByProject = {};
  historyData.forEach(row => {
    const name = Array.isArray(row) ? row[1] : row['Project Name'];
    const region = Array.isArray(row) ? row[2] : row['Region'];
    const date = Array.isArray(row) ? row[0] : row['Date'];
    const reason = Array.isArray(row) ? (row[5]||row[4]||'') : (row['New Reason']||row['Previous Reason']||'');
    if (!name || !reason) return;
    if (!historyByProject[name]) historyByProject[name] = {region, entries:[]};
    historyByProject[name].entries.push({date, reason});
  });

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Upstream — Global PMO Roadmap</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap');
:root{--bg:#0F172A;--bg2:#0A1628;--bg3:#0D1F35;--bg4:#1E293B;--border:#1E3A5F;--text:#E2E8F0;--muted:#64748B;--subtle:#94A3B8}
*{box-sizing:border-box;margin:0;padding:0}
body{background:var(--bg);color:var(--text);font-family:'Inter',sans-serif;min-height:100vh}
#gate{position:fixed;inset:0;background:var(--bg);z-index:999;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:24px}
#gate h1{font-size:28px;font-weight:700}
#gate input{background:var(--bg4);border:1px solid var(--border);color:var(--text);padding:12px 16px;border-radius:8px;font-size:15px;width:280px;outline:none}
#gate input:focus{border-color:#38BDF8}
#gate button{background:#38BDF8;color:#0F172A;font-weight:600;padding:12px 32px;border:none;border-radius:8px;cursor:pointer;font-size:15px;width:280px}
.err{color:#EF4444;font-size:13px;height:16px}
#app{display:none}
header{background:var(--bg2);border-bottom:1px solid var(--border);padding:16px 32px;display:flex;align-items:center;justify-content:space-between}
.logo h1{font-size:20px;font-weight:700}
.main-tabs{display:flex;gap:0;background:var(--bg2);border-bottom:1px solid var(--border);padding:0 32px}
.main-tab{padding:12px 20px;font-size:13px;font-weight:500;cursor:pointer;color:var(--muted);border-bottom:2px solid transparent;margin-bottom:-1px;transition:all .15s}
.main-tab.active{color:#38BDF8;border-bottom-color:#38BDF8}
.stats{background:var(--bg2);border-bottom:1px solid var(--border);padding:14px 32px;display:flex;gap:28px;align-items:center}
.stat-val{font-size:26px;font-weight:700}
.stat-lbl{font-size:12px;color:var(--muted)}
.filters{padding:10px 32px;border-bottom:1px solid var(--border);display:flex;gap:8px;flex-wrap:wrap}
.filter-btn{background:var(--bg4);border:1px solid var(--border);color:var(--subtle);padding:5px 14px;border-radius:20px;font-size:12px;cursor:pointer;font-weight:500;transition:all .15s}
.filter-btn:hover,.filter-btn.active{border-color:#38BDF8;color:#38BDF8;background:#38BDF811}
.gantt-wrap{padding:0 32px 32px;overflow-x:auto}
.gantt{min-width:900px}
.row{display:flex;align-items:center;height:38px;border-bottom:1px solid #1E293B33}
.row.even{background:var(--bg3)}
.row-left{width:340px;min-width:340px;display:flex;align-items:center;gap:6px;padding:0 12px 0 0}
.tag{font-size:9px;font-weight:700;padding:2px 6px;border-radius:10px;white-space:nowrap}
.ctry{font-size:10px;font-weight:600;color:var(--muted);background:var(--bg4);padding:2px 5px;border-radius:4px;min-width:20px;text-align:center}
.pname{font-size:12px;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.row-chart{flex:1;position:relative;height:100%}
/* History tab */
#history-tab{display:none;padding:24px 32px}
.hist-filters{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:20px}
.hist-select{background:var(--bg4);border:1px solid var(--border);color:var(--text);padding:6px 12px;border-radius:8px;font-size:13px;cursor:pointer}
.project-block{border:1px solid var(--border);border-radius:12px;overflow:hidden;margin-bottom:12px}
.project-header{padding:12px 16px;background:var(--bg3);display:flex;align-items:center;justify-content:space-between}
.ph-left{display:flex;align-items:center;gap:10px}
.ph-name{font-size:14px;font-weight:500}
.ph-count{font-size:12px;color:var(--muted)}
.timeline{padding:16px 16px 4px}
.tl-item{display:flex;gap:12px;position:relative}
.tl-item:not(:last-child)::before{content:'';position:absolute;left:10px;top:22px;width:1px;height:calc(100% + 4px);background:var(--border)}
.tl-dot{width:20px;height:20px;border-radius:50%;border:2px solid var(--border);background:var(--bg);flex-shrink:0;margin-top:4px;z-index:1;display:flex;align-items:center;justify-content:center}
.tl-dot.latest{border-color:#EF4444;background:#EF444422}
.tl-content{padding:2px 0 20px}
.tl-date{font-size:11px;color:var(--muted);margin-bottom:4px}
.tl-reason{font-size:13px;color:var(--text);line-height:1.5}
.region-badge{font-size:9px;font-weight:700;padding:2px 6px;border-radius:10px;display:inline-block}
.empty{color:var(--muted);font-size:14px;padding:40px;text-align:center}
</style>
</head>
<body>
<div id="gate">
  <div style="text-align:center">
    <div style="font-size:40px;margin-bottom:8px">📊</div>
    <h1>Upstream <span style="color:#38BDF8">PMO</span></h1>
    <p style="color:var(--muted);margin-top:4px;font-size:14px">Enter password to access the dashboard</p>
  </div>
  <div style="display:flex;flex-direction:column;gap:12px;align-items:center">
    <input type="password" id="pw" placeholder="Password" onkeydown="if(event.key==='Enter')checkPw()">
    <button onclick="checkPw()">Access Dashboard</button>
    <div class="err" id="err"></div>
  </div>
</div>

<div id="app">
  <header>
    <div class="logo">
      <h1>UPSTREAM <span style="color:#38BDF8">PMO</span></h1>
      <div style="font-size:11px;color:var(--muted);letter-spacing:2px;margin-top:2px">GLOBAL PROGRAM ROADMAP ${year}</div>
    </div>
    <div style="display:flex;align-items:center;gap:16px">
      <div style="display:flex;gap:8px">
        ${['LATAM','AFRICA','EMENA','ASIA'].map(r=>`<div style="display:flex;align-items:center;gap:5px;font-size:12px;font-weight:600;padding:3px 8px;border-radius:20px;background:${RC[r]}18;color:${RC[r]};border:1px solid ${RC[r]}33"><span style="width:6px;height:6px;border-radius:50%;background:${RC[r]};display:inline-block"></span>${r}</div>`).join('')}
      </div>
      <div style="font-size:11px;color:var(--muted);font-family:'JetBrains Mono',monospace">Updated: ${updatedStr}</div>
    </div>
  </header>

  <div class="main-tabs">
    <div class="main-tab active" onclick="showMainTab('roadmap',this)">Roadmap</div>
    <div class="main-tab" onclick="showMainTab('history',this)">Delay History</div>
  </div>

  <div id="roadmap-tab">
    <div class="stats">
      <div style="display:flex;align-items:baseline;gap:8px"><span class="stat-val" style="color:#E2E8F0">${stats.total}</span><span class="stat-lbl">Total</span></div>
      <div style="width:1px;height:28px;background:var(--border)"></div>
      <div style="display:flex;align-items:baseline;gap:8px"><span class="stat-val" style="color:#22C55E">${stats.onTrack}</span><span class="stat-lbl">On Track</span></div>
      <div style="display:flex;align-items:baseline;gap:8px"><span class="stat-val" style="color:#EF4444">${stats.delayed}</span><span class="stat-lbl">Delayed</span></div>
      <div style="display:flex;align-items:baseline;gap:8px"><span class="stat-val" style="color:#38BDF8">${stats.completed}</span><span class="stat-lbl">Completed</span></div>
      <div style="display:flex;gap:16px;margin-left:auto">
        ${Object.entries(regionCounts).map(([r,c])=>`<div style="font-size:12px;font-weight:500;color:${RC[r]}">${r}: ${c}</div>`).join('')}
      </div>
    </div>
    <div class="filters">
      <button class="filter-btn active" onclick="filter('all',this)">All</button>
      <button class="filter-btn" onclick="filter('Delayed',this)">🚩 Delayed</button>
      <button class="filter-btn" onclick="filter('On Track',this)">✅ On Track</button>
      <button class="filter-btn" onclick="filter('Completed',this)">🏁 Completed</button>
      ${['LATAM','AFRICA','EMENA','ASIA'].map(r=>`<button class="filter-btn" onclick="filterRegion('${r}',this)" style="color:${RC[r]}">${r}</button>`).join('')}
    </div>
    <div class="gantt-wrap">
      <div class="gantt">
        <div style="display:flex;height:40px;border-bottom:1px solid var(--border);position:relative;margin-left:340px;">
          ${months.map(m=>`<div style="position:absolute;left:${m.pct}%;font-size:11px;font-weight:600;color:var(--subtle);padding-top:10px">${m.label}</div>`).join('')}
          <div style="position:absolute;left:${todayPct}%;top:0;bottom:0;width:2px;background:#F59E0B;z-index:10"></div>
        </div>
        <div id="rows">${rowsHTML}</div>
      </div>
    </div>
  </div>

  <div id="history-tab">
    <div class="hist-filters">
      <select class="hist-select" id="h-region" onchange="renderHistory()">
        <option value="">All regions</option>
        <option>LATAM</option><option>AFRICA</option><option>EMENA</option><option>ASIA</option>
      </select>
      <select class="hist-select" id="h-status" onchange="renderHistory()">
        <option value="">All statuses</option>
        <option>Delayed</option><option>On Track</option><option>Completed</option>
      </select>
    </div>
    <div id="history-content"></div>
  </div>
</div>

<script>
const PW='Upstreammanagement!';
const RC=${JSON.stringify(RC)};
const historyData=${JSON.stringify(historyByProject)};
const projectStatuses=${JSON.stringify(Object.fromEntries(projects.map(p=>[p.name,p.status])))};

function checkPw(){
  if(document.getElementById('pw').value===PW){
    document.getElementById('gate').style.display='none';
    document.getElementById('app').style.display='block';
    sessionStorage.setItem('pmo_auth','1');
    renderHistory();
  } else {
    document.getElementById('err').textContent='Incorrect password';
    setTimeout(()=>document.getElementById('err').textContent='',2000);
  }
}
if(sessionStorage.getItem('pmo_auth')==='1'){
  document.getElementById('gate').style.display='none';
  document.getElementById('app').style.display='block';
  renderHistory();
}

function showMainTab(tab, el){
  document.querySelectorAll('.main-tab').forEach(t=>t.classList.remove('active'));
  el.classList.add('active');
  document.getElementById('roadmap-tab').style.display = tab==='roadmap'?'block':'none';
  document.getElementById('history-tab').style.display = tab==='history'?'block':'none';
}

function filter(s,btn){
  document.querySelectorAll('.filter-btn').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  document.querySelectorAll('.row').forEach(r=>{r.style.display=(s==='all'||r.dataset.status===s)?'flex':'none';});
}
function filterRegion(r,btn){
  document.querySelectorAll('.filter-btn').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  document.querySelectorAll('.row').forEach(row=>{row.style.display=row.dataset.region===r?'flex':'none';});
}

function renderHistory(){
  const region=document.getElementById('h-region').value;
  const statusF=document.getElementById('h-status').value;
  const rc={LATAM:'#38BDF8',AFRICA:'#22C55E',EMENA:'#A78BFA',ASIA:'#F59E0B'};

  const projects=Object.entries(historyData).filter(([name,data])=>{
    if(region&&data.region!==region) return false;
    if(statusF&&projectStatuses[name]!==statusF) return false;
    return true;
  });

  if(projects.length===0){
    document.getElementById('history-content').innerHTML='<div class="empty">No delay history found for the selected filters.</div>';
    return;
  }

  document.getElementById('history-content').innerHTML=projects.map(([name,data])=>{
    const entries=[...data.entries].reverse();
    const col=rc[data.region]||'#64748B';
    const curStatus=projectStatuses[name]||'';
    const statusCol=curStatus==='Completed'?'#38BDF8':curStatus==='Delayed'?'#EF4444':'#22C55E';
    const tl=entries.map(function(e,i){
      return '<div class="tl-item">'
        +'<div class="tl-dot'+(i===0?' latest':'')+'"></div>'
        +'<div class="tl-content">'
        +'<div class="tl-date">'+e.date+'</div>'
        +'<div class="tl-reason">'+e.reason+'</div>'
        +'</div></div>';
    }).join('');
    return '<div class="project-block">'
      +'<div class="project-header">'
      +'<div class="ph-left">'
      +'<span class="region-badge" style="background:'+col+'22;color:'+col+';border:1px solid '+col+'44">'+data.region+'</span>'
      +'<span class="ph-name">'+name+'</span>'
      +'</div>'
      +'<div style="display:flex;align-items:center;gap:12px">'
      +'<span style="font-size:10px;font-weight:600;padding:2px 8px;border-radius:10px;background:'+statusCol+'18;color:'+statusCol+';border:1px solid '+statusCol+'33">'+curStatus+'</span>'
      +'<span class="ph-count">'+entries.length+' update'+(entries.length!==1?'s':'')+'</span>'
      +'</div></div>'
      +'<div class="timeline">'+tl+'</div>'
      +'</div>';
  }).join('');
}
</script>
</body>
</html>`;
}

main().catch(e=>{ console.error(e); process.exit(1); });
