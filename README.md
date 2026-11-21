# Sofia ↔ Kostinbrod Bus & Train Tracker

A static web app that shows **approximate current positions** of buses and trains
between Sofia and Kostinbrod on an OpenStreetMap map, derived from public
timetables. There is no public real-time GPS feed for these regional operators,
so positions are interpolated along the route from scheduled departure times.

## Run locally
Just open `index.html` in a browser. No build step, no backend.

## Deploy (GitHub Pages)
This repo is intended to be served via GitHub Pages:
Settings → Pages → Source: `main` branch / root. The app will be available at
`https://<user>.github.io/kostinbrod-bus/`.

## Data sources
- Buses: Kostinbrod municipality (https://kostinbrod.bg/transport) — Line 2
  Sofia↔Kostinbrod, Sofia–Petarch, Sofia–Dragovishtitsa. Schedule in force
  since 26.08.2019; summer (Jul–Aug) course cancellations apply.
- Intercity: Sofia Central Bus Station (https://avtobusi-sofia.com) —
  Sofia→Kostinbrod at 13:00 and 17:30.
- Trains: BDZh (https://razpisanie.bdz.bg) — Sofia↔Kostinbrod.
- Map tiles: © OpenStreetMap contributors (https://www.openstreetmap.org/copyright).
- Route geometry: OSRM public routing API.

## Caveats
- Trip durations are **estimates** (~30 min bus, ~26 min train); operators do
  not publish arrival times.
- Sofia–Petarch and Sofia–Dragovishtitsa lines pass through Kostinbrod; their
  times are treated as Sofia departures.
- Central bus station return trips are not published (one-way shown).
- Slivnitsa Local Transport hourly service was intentionally excluded.

## Updating schedules
All schedules live in `data.js` (`LINES` and `TRAINS`). Edit the `"HH:MM"`
arrays; the app picks them up on reload. Mark a line `oneWay: true` if no
return trips are published.