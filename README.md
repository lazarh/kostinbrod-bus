# Костинброд — Автобуси на живо

Уеб приложение, показващо **реално-времеви GPS позиции** на автобусите на
Община Костинброд на OpenStreetMap карта.

Данните идват от официалния API на
[live.transport.kostinbrod.bg](https://live.transport.kostinbrod.bg):
- `/api/fleet` — GPS позиции (обновяват се на 15 s).
- `/api/network` — маршрути, спирки, геометрия.
- `/api/schedule` — разписания за днешния ден.

## Стартиране локално
Просто отворете `index.html` в браузър. Няма build стъпка, няма backend.

## Деплой (GitHub Pages)
Settings → Pages → Source: `main` branch / root. Достъпно на
`https://lazarh.github.io/kostinbrod-bus/`.

## Файлове
- `index.html`, `styles.css`, `app.js` — приложението.
- `assets/` — снимки на разписанията (line1.jpg … line9.jpg).
- `line1.txt` … `line9.txt` — координати на спирките (архив).

## Бележки
- Позициите са реални GPS данни, не приближения по разписание.
- Polling на всеки 15 s.