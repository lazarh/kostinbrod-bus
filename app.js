(function () {
  'use strict';
  const D = window.KB_DATA;
  if (!D) { console.error('data.js not loaded'); return; }

  const map = L.map('map');
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
  }).addTo(map);

  // Full corridor view
  const sofia = D.TERMINI.sofia.coord;
  const kb = D.TERMINI.kostinbrod.coord;
  const bounds = L.latLngBounds([sofia, kb]).pad(0.25);
  map.fitBounds(bounds);

  const poly = D.ROUTE_POLYLINE; // [lat,lng] Sofia->KB
  const polyRev = poly.slice().reverse();

  // cumulative distances along polyline
  function cumDist(coords) {
    const d = [0];
    for (let i = 1; i < coords.length; i++) {
      d.push(d[i-1] + L.latLng(coords[i-1]).distanceTo(L.latLng(coords[i])));
    }
    return d;
  }
  const cumFwd = cumDist(poly);
  const totalFwd = cumFwd[cumFwd.length-1];
  const cumRev = cumDist(polyRev);
  const totalRev = cumRev[cumRev.length-1];

  function pointAlong(coords, cum, total, frac) {
    frac = Math.max(0, Math.min(1, frac));
    const target = frac * total;
    // find segment
    let i = 0;
    while (i < cum.length - 1 && cum[i+1] < target) i++;
    if (i >= coords.length - 1) i = coords.length - 2;
    const segLen = cum[i+1] - cum[i];
    const t = segLen > 0 ? (target - cum[i]) / segLen : 0;
    const lat = coords[i][0] + (coords[i+1][0]-coords[i][0])*t;
    const lng = coords[i][1] + (coords[i+1][1]-coords[i][1])*t;
    return [lat, lng];
  }

  // Draw route line (bus corridor)
  const routeLine = L.polyline(poly, { color: '#1f3864', weight: 4, opacity: 0.6 }).addTo(map);
  const trainLine = L.polyline(poly, { color: '#2c3e50', weight: 3, opacity: 0.5, dashArray: '6,6' }).addTo(map);

  // Termini markers
  L.marker(sofia).addTo(map).bindPopup('<b>Sofia</b><br>Obelya / 61-во ОУ (bus terminus)');
  L.marker(kb).addTo(map).bindPopup('<b>Kostinbrod</b><br>centre');

  // State
  const state = {
    dayType: 'auto',
    dirFilter: 'both',
    showBuses: true,
    showTrains: true
  };

  // Layer groups for moving vehicles
  const busLayer = L.layerGroup().addTo(map);
  const trainLayer = L.layerGroup().addTo(map);

  function isWeekend(d) { const day = d.getDay(); return day === 0 || day === 6; }
  function dayType() {
    if (state.dayType === 'weekday') return 'weekday';
    if (state.dayType === 'weekend') return 'weekend';
    return isWeekend(new Date()) ? 'weekend' : 'weekday';
  }
  function toMinutes(hhmm) {
    const [h, m] = hhmm.split(':').map(Number);
    return h*60 + m;
  }
  function nowMinutes() {
    const n = new Date();
    return n.getHours()*60 + n.getMinutes() + n.getSeconds()/60;
  }

  // Build list of trips for today
  // Each trip: { line, direction ('sofiaToKb'|'kbToSofia'), depMin, arrMin, color, kind }
  function buildTrips() {
    const trips = [];
    const dt = dayType();
    const mkTrips = (line) => {
      const sched = line.schedules;
      // sofiaToKb
      const depSofia = (sched.sofiaToKb && sched.sofiaToKb[dt]) || [];
      depSofia.forEach(t => {
        trips.push({ line, dir: 'sofiaToKb', dep: toMinutes(t), dur: line.estimatedDuration, color: line.color, kind: line.kind });
      });
      const depKb = (sched.kbToSofia && sched.kbToSofia[dt]) || [];
      depKb.forEach(t => {
        trips.push({ line, dir: 'kbToSofia', dep: toMinutes(t), dur: line.estimatedDuration, color: line.color, kind: line.kind });
      });
    };
    D.LINES.forEach(l => { if (l.kind === 'bus') mkTrips(l); });

    // trains
    const tr = D.TRAINS;
    tr.schedules.sofiaToKb.forEach(t => trips.push({ line: tr, dir: 'sofiaToKb', dep: toMinutes(t), dur: tr.estimatedDuration, color: tr.color, kind: 'train' }));
    tr.schedules.kbToSofia.forEach(t => trips.push({ line: tr, dir: 'kbToSofia', dep: toMinutes(t), dur: tr.estimatedDuration, color: tr.color, kind: 'train' }));

    return trips;
  }

  function dirAllowed(dir) {
    if (state.dirFilter === 'both') return true;
    return state.dirFilter === dir;
  }

  function kindAllowed(kind) {
    if (kind === 'bus') return state.showBuses;
    if (kind === 'train') return state.showTrains;
    return true;
  }

  function render() {
    busLayer.clearLayers();
    trainLayer.clearLayers();

    const now = nowMinutes();
    const trips = buildTrips();
    const active = [];
    const upcoming = [];

    trips.forEach(trip => {
      if (!dirAllowed(trip.dir)) return;
      if (!kindAllowed(trip.kind)) return;
      const arr = trip.dep + trip.dur;
      // handle trips crossing midnight? assume none for this corridor (last ~22:00)
      if (now >= trip.dep && now <= arr) {
        // active
        const frac = (now - trip.dep) / trip.dur;
        const coords = trip.dir === 'sofiaToKb' ? poly : polyRev;
        const cum = trip.dir === 'sofiaToKb' ? cumFwd : cumRev;
        const total = trip.dir === 'sofiaToKb' ? totalFwd : totalRev;
        const pos = pointAlong(coords, cum, total, frac);
        const marker = L.circleMarker(pos, { radius: 7, fillColor: trip.color, color: '#fff', weight: 2, fillOpacity: 0.9 });
        const popup = `<b>${trip.line.name}</b><br>${trip.dir === 'sofiaToKb' ? 'Sofia → Kostinbrod' : 'Kostinbrod → Sofia'}<br>Dep ${trip.dep/60|0}:${String(trip.dep%60|0).padStart(2,'0')} · ETA ${Math.round(arr-now)} min`;
        marker.bindPopup(popup);
        if (trip.kind === 'bus') busLayer.addLayer(marker); else trainLayer.addLayer(marker);
        active.push({ trip, frac, eta: Math.round(arr-now) });
      } else if (trip.dep > now && trip.dep - now <= 120) {
        upcoming.push({ trip, inMin: Math.round(trip.dep - now) });
      }
    });

    // sort upcoming by departure
    upcoming.sort((a,b) => a.trip.dep - b.trip.dep);

    // Render lists
    const activeList = document.getElementById('activeList');
    activeList.innerHTML = '';
    if (active.length === 0) activeList.innerHTML = '<li class="sub">No vehicles currently on the way.</li>';
    active.forEach(a => {
      const li = document.createElement('li');
      li.className = 'active';
      const dep = `${Math.floor(a.trip.dep/60)}:${String(a.trip.dep%60).padStart(2,'0')}`;
      li.innerHTML = `<div class="line" style="color:${a.trip.color}">${a.trip.line.name}</div><div class="sub">${a.trip.dir==='sofiaToKb'?'Sofia → Kostinbrod':'Kostinbrod → Sofia'} · dep ${dep} · ~${a.eta} min left</div>`;
      activeList.appendChild(li);
    });

    const upcomingList = document.getElementById('upcomingList');
    upcomingList.innerHTML = '';
    if (upcoming.length === 0) upcomingList.innerHTML = '<li class="sub">No departures in next 2 hours.</li>';
    upcoming.forEach(u => {
      const li = document.createElement('li');
      const dep = `${Math.floor(u.trip.dep/60)}:${String(u.trip.dep%60).padStart(2,'0')}`;
      li.innerHTML = `<div class="line" style="color:${u.trip.color}">${u.trip.line.name}</div><div class="sub">${u.trip.dir==='sofiaToKb'?'Sofia → Kostinbrod':'Kostinbrod → Sofia'} · ${dep} (in ${u.inMin} min)</div>`;
      upcomingList.appendChild(li);
    });

    // now label
    const n = new Date();
    document.getElementById('now').textContent = `Now: ${n.toLocaleTimeString()} · ${dayType()}`;
  }

  // Legend
  const legend = document.getElementById('legendItems');
  const seen = new Set();
  [...D.LINES, D.TRAINS].forEach(l => {
    if (seen.has(l.id || l.name)) return;
    seen.add(l.id || l.name);
    const div = document.createElement('div');
    div.className = 'item';
    div.innerHTML = `<span class="swatch" style="background:${l.color}"></span>${l.name}`;
    legend.appendChild(div);
  });

  // Controls
  document.getElementById('dirFilter').addEventListener('change', e => { state.dirFilter = e.target.value; render(); });
  document.getElementById('showBuses').addEventListener('change', e => { state.showBuses = e.target.checked; render(); });
  document.getElementById('showTrains').addEventListener('change', e => { state.showTrains = e.target.checked; render(); });
  document.getElementById('dayType').addEventListener('change', e => { state.dayType = e.target.value; render(); });

  // Auto refresh
  render();
  setInterval(render, 30000);
})();