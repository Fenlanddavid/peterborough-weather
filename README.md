# Peterborough Weather

A mobile-friendly seven-day forecast for Peterborough, UK, with a detailed forecast briefing, weather model comparisons, a four-week outlook, wind alerts for gusts of 30 mph or more, and snowfall alerts.

## Use on a phone

Open the published GitHub Pages link in your phone's browser.

- **iPhone:** open in Safari, tap Share, then **Add to Home Screen**.
- **Android:** open in Chrome and tap **Install weather app** when it appears. The browser menu also offers **Add to Home screen** or **Install app**.

Forecasts are fetched from Open-Meteo. Cached forecasts remain available offline after an online visit; refresh online for current information. Each phone keeps its own forecast cache.

## Development

Requires Node.js 22.12 or later (the deployment uses Node.js 24).

```sh
npm ci
npm run dev
```

Build the production app:

```sh
npm run build
```

## GitHub Pages

The workflow in `.github/workflows/deploy.yml` builds and publishes changes pushed to `main`. Enable **Settings → Pages → Source → GitHub Actions** in the GitHub repository.

The deployment sets Vite's base path to the repository name. The manifest, icons and service worker work beneath that path.

## Data

Weather forecasts are provided by [Open-Meteo](https://open-meteo.com/). The home screen combines available ECMWF, GFS and UKMO model forecasts. Wind and snow banners reflect the app's forecasts.

The monthly outlook uses ECMWF EC46 weekly temperature and rainfall anomalies via Open-Meteo. It covers the next four full weeks and describes broad regional trends compared with seasonal averages. Its separate cache keeps the last successful outlook available offline.

The Drivers tab shows the latest reported teleconnection indices and MJO observations via the [Global Teleconnections Dashboard](https://iamelnino.com/teleconnections). Observation dates may lag behind the time the app checks for updates. Regime labels are simple index-based estimates, and the MJO temperature guidance is limited to winter outlooks; neither replaces the local forecast. A separate cache retains successful index data for offline use.

The Summary tab gives a detailed briefing on temperatures, rainfall timing, wind, cold and snowfall signals, model agreement, and each of the next seven days. Today covers the current hour onwards; subsequent days use full Peterborough calendar days, including clock changes. Missing data and incomplete rainfall totals are identified explicitly.

Run the forecast summary and teleconnection regression checks with `npm test`.

## Forecasting and Night Sky upgrade (21 October 2026)

See [the phase-by-phase implementation report](docs/implementation-report.md) for changed files, source capabilities, validation, units/provenance, optional collectors, limitations and attribution. The original description above predates this upgrade.

Forecast and Summary now use complete-window family-weighted deterministic signals and separately cached IFS/GEFS/MOGREPS-G ensemble estimates. UKV contributes within its actual forecast range while remaining an overlay in Trends. Percentages explicitly distinguish ensemble estimates, deterministic agreement and recent-run support; none is calibrated.

Night Sky loads Astronomy Engine and satellite.js only when opened. It calculates local darkness, Moon events, planet visibility, local eclipse portions and ISS visible segments, with weather-based observing windows and separate aurora products. Scores and geographic aurora tiers are configurable planning heuristics, not measured seeing or verified visibility probabilities. Optional observation verification appears in Trends; corrections and reweighting stay disabled.

```sh
npm test
npm run test:timezones
npm run lint
npm run check:scripts
npm run build -- --base /peterborough-weather/
npm run report:bundle
npm run report:budget
```

Live probes are **separate** from unit tests: `npm run probe:sources` and `npm run probe:browser`. The browser probe defaults to the real published Pages origin. Set `CHROMIUM_PATH` to an installed Chromium executable when needed. Run production browser checks against `npm run preview -- --host 127.0.0.1 --port 5187 --base /peterborough-weather/` with `npm run smoke:browser`.

Optional collectors are disabled unless the public repository variables `COLLECT_METAR`, `COLLECT_VERIFICATION`, `COLLECT_AURORAWATCH` or `COLLECT_ISS` are `true`. Deploy the application once first to create the reusable `site-shell` artifact. The hourly collector publishes data by overlaying it on that built shell, avoiding hourly full application rebuilds. See the report for source timestamps, retention, recovery and deployment checks; a collector commit alone does not establish that Pages is current.
