# Peterborough Weather

A mobile-friendly seven-day forecast for Peterborough, UK, with weather model comparisons, a four-week outlook, wind alerts for gusts of 30 mph or more, and snowfall alerts.

## Use on a phone

Open the published GitHub Pages link in your phone's browser.

- **iPhone:** open in Safari, tap Share, then **Add to Home Screen**.
- **Android:** open in Chrome, open the menu, then **Add to Home screen** or **Install app**.

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
