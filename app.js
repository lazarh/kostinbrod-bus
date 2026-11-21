(function () {
  'use strict';
  const D = window.KB_DATA;
  if (!D) { console.error('data.js not loaded'); return; }

  const map = L.map('map');
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
  }).addTo(map);

  const sofia = [42.7429, 23.2718];
  const kb = [42.8160, 23.2180];
  map.fitBounds(L.latLngBounds([sofia, kb]).pad(0.25));

  const poly = D.ROUTE_POLYLINE; // Sofia->KB
  const polyRev = poly.slice().reverse();

  function cumDist(coords) {
    const d = [0];
    for (let i = 1; i < coords.length; i++) d.push(d[i-1] + L.latLng(coords[i-1]).distanceTo(L.latLng(coords[i])));
    return d;
  }
  const cumFwd = cumDist(poly), totalFwd = cumFwd[cumFwd.length-1];
  const cumRev = cumDist(polyRev), totalRev = cumRev[cumRev.length-1];

  function pointAlong(coords, cum, total, frac) {
    frac = Math.max(0, Math.min(1, frac));
    const target = frac * total;
    let i = 0;
    while (i < cum.length - 1 && cum[i+1] < target) i++;
    if (i >= coords.length - 1) i = coords.length - 2;
    const segLen = cum[i+1] - cum[i];
    const t = segLen > 0 ? (target - cum[i]) / segLen : 0;
    return [coords[i][0] + (coords[i+1][0]-coords[i][0])*t,
            coords[i][1] + (coords[i+1][1]-coords[i][1])*t];
  }

  const routeLine = L.polyline(poly, { color: '#1f3864', weight: 4, opacity: 0.55 }).addTo(map);
  L.marker(sofia).addTo(map).bindPopup('<b>Sofia</b><br>Obelya / 61-во ОУ');
  L.marker(kb).addTo(map).bindPopup('<b>Kostinbrod</b><br>centre');

  const busLayer = L.layerGroup().addTo(map);
  const trainLayer = L.layerGroup().addTo(map);
  // stop markers
  const stopLayer = L.layerGroup().addTo(map);

  const state = { dayType: 'auto', dirFilter: 'both', showBuses: true, showTrains: true, lineFilter: 'all' };

  function allLines() { return [...D.lines, ...(D.trains || [])]; }
  function findLine(id) { return allLines().find(l => l.id === id); }

  function toMin(hhmm) { const [h,m] = hhmm.split(':').map(Number); return h*60+m; }
  function nowMin() { const n = new Date(); return n.getHours()*60 + n.getMinutes() + n.getSeconds()/60; }
  function isWeekend(d) { const day = d.getDay(); return day === 0 || day === 6; }
  function isHoliday(d) {
    const iso = d.toISOString().slice(0,10);
    return (D.BULGARIAN_HOLIDAYS || []).indexOf(iso) >= 0;
  }
  function resolveDayType() {
    if (state.dayType !== 'auto') return state.dayType;
    const d = new Date();
    if (isHoliday(d)) return 'holiday';
    if (isWeekend(d)) return 'weekend';
    return 'weekday';
  }

  function findDir(line, dirId) {
    return (line.directions || []).find(dd => dd.id === dirId);
  }
  function findBlock(dir, dt) {
    if (!dir) return null;
    let block = (dir.dayTypes || []).find(b => b.type === dt);
    if (!block || !block.trips || block.trips.length === 0) {
      // fallback to weekday
      block = (dir.dayTypes || []).find(b => b.type === 'weekday');
    }
    return block;
  }

  function defaultDur(line) {
    if (line.kind === 'train') return 26;
    return 30;
  }

  // Build trip list for the resolved day
  function buildTrips() {
    const dt = resolveDayType();
    const trips = [];
    const allLines = [...D.lines, { ...D.trains[0], kind: 'train' }]; // trains wrapped? trains is array
    // handle trains separately
    const lines = D.lines.map(l => ({...l, _isTrain: false}));
    const trains = (D.trains || []).map(t => ({...t, kind: 'train', _isTrain: true}));

    const processLine = (line) => {
      if (state.lineFilter !== 'all' && line.id !== state.lineFilter) return;
      const isTrain = line.kind === 'train' || line._isTrain;
      ['sofiaToKb','kbToSofia'].forEach(dirId => {
        if (state.dirFilter !== 'both' && state.dirFilter !== dirId) return;
        if (isTrain && !state.showTrains) return;
        if (!isTrain && !state.showBuses) return;
        const dir = findDir(line, dirId);
        const block = findBlock(dir, dt);
        if (!block || !block.trips) return;
        const stops = block.stops || [];
        block.trips.forEach(trip => {
          // collect non-null time points
          const pts = [];
          (trip.times || []).forEach((t, i) => { if (t) pts.push({ i, m: toMin(t) }); });
          // apply originStop/destinationStop
          let originIdx = 0, destIdx = stops.length - 1;
          if (trip.originStop) {
            const idx = stops.findIndex(s => s.name === trip.originStop);
            if (idx >= 0) originIdx = idx;
          }
          if (trip.destinationStop) {
            const idx = stops.findIndex(s => s.name === trip.destinationStop);
            if (idx >= 0) destIdx = idx;
          }
          const segPts = pts.filter(p => p.i >= originIdx && p.i <= destIdx);
          let originMin, arrMin;
          if (segPts.length >= 2) {
            originMin = segPts[0].m;
            arrMin = segPts[segPts.length-1].m;
            if (arrMin <= originMin) arrMin = originMin + defaultDur(line);
          } else if (segPts.length === 1) {
            originMin = segPts[0].m;
            arrMin = originMin + defaultDur(line);
          } else {
            // no times; skip
            return;
          }
          trips.push({
            line, dir: dirId, trip, stops, block,
            originMin, arrMin, originIdx, destIdx, segPts,
            color: line.color, kind: isTrain ? 'train' : 'bus',
            destination: trip.destinationStop || (stops[destIdx] && stops[destIdx].name) || ''
          });
        });
      });
    };

    lines.forEach(processLine);
    trains.forEach(processLine);
    return trips;
  }

  function stopFrac(stopIdx, nStops) {
    if (nStops <= 1) return 0;
    return Math.max(0, Math.min(1, stopIdx / (nStops - 1)));
  }

  function tripPosition(trip, now) {
    const { originMin, arrMin, segPts, stops, originIdx, destIdx } = trip;
    if (now < originMin || now > arrMin) return null;
    const fracTime = (now - originMin) / (arrMin - originMin);
    // map to corridor fraction using segPts if available
    let fracSpace;
    if (segPts.length >= 2) {
      // interpolate between consecutive segPts
      // find interval
      let i = 0;
      while (i < segPts.length - 1 && segPts[i+1].m < now) i++;
      if (i >= segPts.length - 1) i = segPts.length - 2;
      const p0 = segPts[i], p1 = segPts[i+1];
      const t = (p1.m - p0.m) > 0 ? (now - p0.m) / (p1.m - p0.m) : 0;
      const f0 = stopFrac(p0.i, stops.length);
      const f1 = stopFrac(p1.i, stops.length);
      fracSpace = f0 + (f1 - f0) * t;
    } else {
      fracSpace = fracTime; // full corridor
    }
    const coords = trip.dir === 'sofiaToKb' ? poly : polyRev;
    const cum = trip.dir === 'sofiaToKb' ? cumFwd : cumRev;
    const total = trip.dir === 'sofiaToKb' ? totalFwd : totalRev;
    return pointAlong(coords, cum, total, fracSpace);
  }

  // Draw stop markers (termini + any with coords)
  const drawnStops = new Set();
  D.lines.forEach(line => {
    line.directions.forEach(dd => {
      dd.dayTypes.forEach(dt => {
        (dt.stops || []).forEach(s => {
          if (!s.coord) return;
          const key = s.name + s.coord.join(',');
          if (drawnStops.has(key)) return;
          drawnStops.add(key);
          L.circleMarker(s.coord, { radius: 4, fillColor: '#555', color: '#fff', weight: 1, fillOpacity: 0.8 })
            .addTo(stopLayer).bindPopup(`<b>${s.name}</b>${s.code ? ' ('+s.code+')' : ''}`);
        });
      });
    });
  });

  function render() {
    busLayer.clearLayers();
    trainLayer.clearLayers();
    // highlight selected line on the route
    const selLine = state.lineFilter !== 'all' ? findLine(state.lineFilter) : null;
    routeLine.setStyle({ color: selLine ? selLine.color : '#1f3864', weight: selLine ? 6 : 4 });
    updateLineCard();

    const now = nowMin();
    const trips = buildTrips();
    const active = [];
    const upcoming = [];

    trips.forEach(trip => {
      const pos = tripPosition(trip, now);
      if (pos) {
        const marker = L.circleMarker(pos, { radius: 7, fillColor: trip.color, color: '#fff', weight: 2, fillOpacity: 0.9 });
        const dep = trip.originMin;
        const depStr = `${Math.floor(dep/60)}:${String(dep%60).padStart(2,'0')}`;
        const eta = Math.round(trip.arrMin - now);
        marker.bindPopup(`<b>${trip.line.name}</b><br>${trip.dir==='sofiaToKb'?'Sofia → Kostinbrod':'Kostinbrod → Sofia'}<br>→ ${trip.destination}<br>Dep ${depStr} · ~${eta} min left`);
        (trip.kind === 'bus' ? busLayer : trainLayer).addLayer(marker);
        active.push({ trip, eta });
      } else if (trip.originMin > now && trip.originMin - now <= 180) {
        upcoming.push({ trip, inMin: Math.round(trip.originMin - now) });
      }
    });

    active.sort((a,b) => a.trip.originMin - b.trip.originMin);
    upcoming.sort((a,b) => a.trip.originMin - b.trip.originMin);

    const activeList = document.getElementById('activeList');
    activeList.innerHTML = '';
    if (active.length === 0) activeList.innerHTML = '<li class="sub">No vehicles currently on the way.</li>';
    active.forEach(a => {
      const li = document.createElement('li'); li.className = 'active';
      const dep = `${Math.floor(a.trip.originMin/60)}:${String(a.trip.originMin%60).padStart(2,'0')}`;
      li.innerHTML = `<div class="line" style="color:${a.trip.color}">${a.trip.line.name}</div><div class="sub">${a.trip.dir==='sofiaToKb'?'Sofia → Kostinbrod':'Kostinbrod → Sofia'} · → ${a.trip.destination} · dep ${dep} · ~${a.eta} min left</div>`;
      activeList.appendChild(li);
    });

    const upcomingList = document.getElementById('upcomingList');
    upcomingList.innerHTML = '';
    if (upcoming.length === 0) upcomingList.innerHTML = '<li class="sub">No departures in next 3 hours.</li>';
    upcoming.forEach(u => {
      const li = document.createElement('li');
      const dep = `${Math.floor(u.trip.originMin/60)}:${String(u.trip.originMin%60).padStart(2,'0')}`;
      li.innerHTML = `<div class="line" style="color:${u.trip.color}">${u.trip.line.name}</div><div class="sub">${u.trip.dir==='sofiaToKb'?'Sofia → Kostinbrod':'Kostinbrod → Sofia'} · → ${u.trip.destination} · ${dep} (in ${u.inMin} min)</div>`;
      upcomingList.appendChild(li);
    });

    document.getElementById('now').textContent = `Now: ${new Date().toLocaleTimeString()} · ${resolveDayType()}`;
  }

  // Legend
  const legend = document.getElementById('legendItems');
  const seen = new Set();
  [...D.lines, ...(D.trains || [])].forEach(l => {
    if (seen.has(l.id)) return; seen.add(l.id);
    const div = document.createElement('div');
    div.className = 'item';
    div.innerHTML = `<span class="swatch" style="background:${l.color}"></span>${l.name}`;
    legend.appendChild(div);
  });

  // Line filter dropdown
  const lineSel = document.getElementById('lineFilter');
  allLines().forEach(l => {
    const opt = document.createElement('option');
    opt.value = l.id;
    opt.textContent = l.name;
    lineSel.appendChild(opt);
  });

  function updateLineCard() {
    const inner = document.getElementById('lineCardInner');
    if (state.lineFilter === 'all') {
      inner.innerHTML = 'Select a line above to see its route and terminals.';
      return;
    }
    const line = findLine(state.lineFilter);
    if (!line) { inner.innerHTML = 'Unknown line.'; return; }
    // gather terminals per direction from first dayType block
    const dirs = (line.directions || []).map(dd => {
      const block = (dd.dayTypes || []).find(b => b.type === 'weekday') || (dd.dayTypes || [])[0];
      const stops = (block && block.stops) || [];
      const start = stops.length ? stops[0].name : '—';
      const end = stops.length ? stops[stops.length-1].name : '—';
      return { label: dd.label || dd.id, start, end, n: stops.length };
    });
    const rows = dirs.map(d => `<div class="row"><b>${d.label}</b><span>${d.start} → ${d.end}</span></div>`).join('');
    const stops0 = (((line.directions[0]||{}).dayTypes||[]).find(b=>b.type==='weekday')||{}).stops || [];
    const stopsHtml = stops0.length ? `<div class="stops"><b>Stops:</b> ${stops0.map(s=>s.name).join(' · ')}</div>` : '';
    inner.innerHTML = `
      <div class="row"><b>Line</b><span><span class="swatch" style="background:${line.color}"></span>${line.name}</span></div>
      <div class="row"><b>Operator</b><span>${line.operator || '—'}</span></div>
      ${rows}
      ${line.notes ? `<div class="row"><b>Notes</b><span>${line.notes}</span></div>` : ''}
      ${stopsHtml}
    `;
  }

  document.getElementById('lineFilter').addEventListener('change', e => { state.lineFilter = e.target.value; render(); });
  document.getElementById('dirFilter').addEventListener('change', e => { state.dirFilter = e.target.value; render(); });
  document.getElementById('showBuses').addEventListener('change', e => { state.showBuses = e.target.checked; render(); });
  document.getElementById('showTrains').addEventListener('change', e => { state.showTrains = e.target.checked; render(); });
  document.getElementById('dayType').addEventListener('change', e => { state.dayType = e.target.value; render(); });

  render();
  setInterval(render, 30000);
})();