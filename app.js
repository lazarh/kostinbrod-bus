(function () {
  'use strict';
  const API = 'https://live.transport.kostinbrod.bg';
  const POLL_MS = 15000;

  const map = L.map('map');
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
  }).addTo(map);

  const routeLayer = L.layerGroup().addTo(map);
  const stopLayer = L.layerGroup().addTo(map);
  const vehicleLayer = L.layerGroup().addTo(map);

  let network = null;   // {stops: Map, routes: Map, baseRoutes: Map name->route}
  let vehicles = new Map(); // plate -> marker
  let selectedRouteLayers = new Map(); // routeKey -> layer (for active vehicles)
  const state = { lineFilter: 'all', showVehicles: true };

  // ---------- network ----------
  async function loadNetwork() {
    const res = await fetch(API + '/api/network', { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error('network ' + res.status);
    const data = await res.json();
    const stops = new Map();
    data.stops.forEach(s => stops.set(s.id, s));
    const routes = new Map();
    data.routes.forEach(r => routes.set(r.routeKey, r));
    // one representative route per distinct routeName (prefer shortest routeKey = base)
    const byName = new Map();
    data.routes.forEach(r => {
      const cur = byName.get(r.name);
      if (!cur || r.routeKey.length < cur.routeKey.length) byName.set(r.name, r);
    });
    network = { stops, routes, baseRoutes: byName, revision: data.revision };
    renderStops();
    renderRoutes();
    populateLineFilter();
  }

  function renderStops() {
    stopLayer.clearLayers();
    network.stops.forEach(s => {
      L.circleMarker([s.latitude, s.longitude], { radius: 3, fillColor: '#555', color: '#fff', weight: 1, fillOpacity: 0.8 })
        .addTo(stopLayer).bindPopup('<b>' + s.name + '</b>');
    });
  }

  function renderRoutes() {
    routeLayer.clearLayers();
    selectedRouteLayers.clear();
    const toDraw = state.lineFilter === 'all'
      ? [...network.baseRoutes.values()]
      : [network.baseRoutes.get(state.lineFilter)].filter(Boolean);
    toDraw.forEach(r => {
      L.polyline(r.geometry.map(p => [p.latitude, p.longitude]), {
        color: '#' + (r.color || '3366CC'), weight: 3, opacity: 0.5
      }).addTo(routeLayer);
    });
    // fit bounds once
    if (!map._fitted) {
      const pts = [];
      network.stops.forEach(s => pts.push([s.latitude, s.longitude]));
      if (pts.length) { map.fitBounds(L.latLngBounds(pts).pad(0.1)); map._fitted = true; }
    }
  }

  function populateLineFilter() {
    const sel = document.getElementById('lineFilter');
    // clear except first
    while (sel.options.length > 1) sel.remove(1);
    [...network.baseRoutes.keys()].sort().forEach(name => {
      const opt = document.createElement('option');
      opt.value = name; opt.textContent = name;
      sel.appendChild(opt);
    });
    // legend
    const legend = document.getElementById('legendItems');
    legend.innerHTML = '';
    network.baseRoutes.forEach((r, name) => {
      const div = document.createElement('div');
      div.className = 'item';
      div.innerHTML = `<span class="swatch" style="background:#${r.color}"></span>${name}`;
      legend.appendChild(div);
    });
  }

  // ---------- fleet ----------
  async function pollFleet() {
    try {
      const res = await fetch(API + '/api/fleet', { headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error('fleet ' + res.status);
      const data = await res.json();
      updateVehicles(data.vehicles || []);
      updateActiveList(data.vehicles || []);
      document.getElementById('liveStatus').textContent = 'На живо · ' + new Date(data.generatedAt).toLocaleTimeString();
      document.getElementById('liveStatus').className = 'badge live';
    } catch (e) {
      console.warn('fleet fetch failed', e);
      document.getElementById('liveStatus').textContent = 'Няма връзка';
      document.getElementById('liveStatus').className = 'badge';
    }
    document.getElementById('now').textContent = 'Обновено: ' + new Date().toLocaleTimeString();
  }

  function makeIcon(v) {
    const color = '#' + (v.routeColor || '3366CC');
    const html = `<div style="width:16px;height:16px;border-radius:50%;background:${color};border:2px solid #fff;box-shadow:0 0 4px #000;display:flex;align-items:center;justify-content:center;font-size:9px;color:#fff;font-weight:bold;">${(v.plate||'').slice(-2)}</div>`;
    return L.divIcon({ html, className: '', iconSize: [16,16], iconAnchor: [8,8] });
  }

  function makePopup(v) {
    const dep = v.departure ? new Date(v.departure).toLocaleTimeString() : '—';
    const arr = v.plannedArrival ? new Date(v.plannedArrival).toLocaleTimeString() : '—';
    const age = v.recordedAt ? Math.round((Date.now() - new Date(v.recordedAt)) / 1000) : '?';
    const dev = v.departureSeconds != null && v.recordedAt
      ? '' : '';
    return `<b>${v.plate}</b><br>${v.routeName}<br>Скорост: ${v.speedKph} km/h · посока ${v.bearingDegrees}°<br>Тръгване: ${dep} · Пристигане: ${arr}<br>GPS сигнал: преди ${age} s`;
  }

  function updateVehicles(list) {
    if (!state.showVehicles) { vehicleLayer.clearLayers(); vehicles.clear(); return; }
    const seen = new Set();
    list.forEach(v => {
      if (state.lineFilter !== 'all' && v.routeName !== state.lineFilter) return;
      seen.add(v.plate);
      const latlng = [v.latitude, v.longitude];
      let m = vehicles.get(v.plate);
      if (!m) {
        m = L.marker(latlng, { icon: makeIcon(v) }).addTo(vehicleLayer);
        vehicles.set(v.plate, m);
      } else {
        m.setLatLng(latlng);
      }
      m.setIcon(makeIcon(v));
      m.bindPopup(makePopup(v));
    });
    for (const [plate, m] of vehicles) {
      if (!seen.has(plate)) { vehicleLayer.removeLayer(m); vehicles.delete(plate); }
    }
  }

  function updateActiveList(list) {
    const filtered = state.lineFilter === 'all' ? list : list.filter(v => v.routeName === state.lineFilter);
    const ul = document.getElementById('activeList');
    ul.innerHTML = '';
    if (filtered.length === 0) { ul.innerHTML = '<li class="sub">Няма активни автобуси.</li>'; return; }
    filtered.forEach(v => {
      const li = document.createElement('li');
      const age = v.recordedAt ? Math.round((Date.now() - new Date(v.recordedAt)) / 1000) : '?';
      li.innerHTML = `<div class="line" style="color:#${v.routeColor}">${v.plate} · ${v.routeName}</div><div class="sub">${v.speedKph} km/h · GPS преди ${age}s · ${v.hasActiveTrip ? 'по разписание' : 'без курс'}</div>`;
      li.addEventListener('click', () => {
        const m = vehicles.get(v.plate);
        if (m) { map.setView(m.getLatLng(), 15); m.openPopup(); }
      });
      ul.appendChild(li);
    });
  }

  // ---------- schedule / upcoming ----------
  async function loadSchedule() {
    try {
      const res = await fetch(API + '/api/schedule', { headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error('schedule ' + res.status);
      const data = await res.json();
      renderUpcoming(data);
    } catch (e) { console.warn('schedule fetch failed', e); }
  }

  function renderUpcoming(data) {
    const now = Date.now();
    const horizon = now + 3 * 3600 * 1000;
    const items = [];
    (data.lanes || []).forEach(lane => {
      (lane.trips || []).forEach(t => {
        const dep = new Date(data.serviceDate + 'T00:00:00Z').getTime() + t.departureSeconds * 1000;
        if (dep < now - 60000 || dep > horizon) return;
        if (state.lineFilter !== 'all' && t.routeName !== state.lineFilter) return;
        items.push({ t, lane, dep });
      });
    });
    items.sort((a, b) => a.dep - b.dep);
    const ul = document.getElementById('upcomingList');
    ul.innerHTML = '';
    if (items.length === 0) { ul.innerHTML = '<li class="sub">Няма тръгвания в следващите 3 часа.</li>'; return; }
    items.slice(0, 40).forEach(it => {
      const li = document.createElement('li');
      const depStr = new Date(it.dep).toLocaleTimeString();
      const arrStr = new Date(it.dep + (it.t.plannedArrivalSeconds - it.t.departureSeconds) * 1000).toLocaleTimeString();
      li.innerHTML = `<div class="line" style="color:#${it.t.routeColor}">${it.t.routeName}</div><div class="sub">${it.t.origin} → ${it.t.destination} · ${depStr} – ${arrStr} · ${it.lane.plate}</div>`;
      ul.appendChild(li);
    });
  }

  // ---------- controls ----------
  document.getElementById('lineFilter').addEventListener('change', e => { state.lineFilter = e.target.value; renderRoutes(); pollFleet(); loadSchedule(); });
  document.getElementById('showVehicles').addEventListener('change', e => { state.showVehicles = e.target.checked; if (!state.showVehicles) { vehicleLayer.clearLayers(); vehicles.clear(); } else { pollFleet(); } });

  // ---------- boot ----------
  (async () => {
    try {
      await loadNetwork();
    } catch (e) {
      console.error('network load failed', e);
      document.getElementById('liveStatus').textContent = 'Грешка при зареждане на мрежата';
    }
    await pollFleet();
    await loadSchedule();
    setInterval(pollFleet, POLL_MS);
    setInterval(loadSchedule, 60000);
  })();
})();