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
npm run data:pull  # optional: download the current observation/verification snapshot
npm run dev
```

Build the production app:

```sh
npm run build
```

## GitHub Pages

The workflow in `.github/workflows/site.yml` builds and publishes changes pushed to `main`. Enable **Settings → Pages → Source → GitHub Actions** in the GitHub repository.

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

Night Sky loads Astronomy Engine and satellite.js only when opened. It calculates local darkness, Moon events, planet visibility, local eclipse portions and ISS visible segments, with weather-based observing windows and separate aurora products. Scores and geographic aurora tiers are configurable planning heuristics, not measured seeing or verified visibility probabilities. Legacy observation verification appears in Trends. The automatic learning described below is a separate system with observation-based gates.

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

METAR and app forecast collection run automatically on the hourly schedule. Legacy Previous Runs verification, AuroraWatch and ISS collection remain optional through `COLLECT_VERIFICATION`, `COLLECT_AURORAWATCH` and `COLLECT_ISS`. The workflow publishes a fresh build when data changes. Code pushes always build and publish. The `data` branch stores only the current generated snapshot in one root commit; it is replaced on each change. There is no retained application-shell artifact to expire. Only the Pages deployment artifact is uploaded.

Verification collects temperature once per 20 hours, retaining 100 days of compact model/time/lead/value rows. The same station-matched scoring function produces the client results. Daily history keeps the last score set for each UTC collection date, rather than an hourly copy of the full evaluation. Failed source requests retain the previous usable data; a failed data-branch lookup stops the job.

Generated `public/data` files are ignored on `main`. Run `npm run data:pull` to restore the current snapshot for local development; this replaces the local generated directory after a successful fetch and extraction. Changes to collection/publishing code belong on `main`, while generated files belong only on `data`. See [the archive migration notes](docs/data-archive-migration.md) for validation and recovery.

## Forecast accuracy and Night Sky cards (23 October 2026)

See [the upgrade documentation](docs/forecast-accuracy-upgrade.md) for all seven areas, defaults, automatic promotion/rollback, attribution and current source limits. The new learning pipeline archives scheduled app forecasts and verifies compatible observations; Wittering temperature corrections stay at Wittering. Missing compatible observations leave that variable/location on the default policy. No measured accuracy improvement is claimed.

The optional processed Met Office feed uses the **Site-Specific Blended Probabilistic Forecast v2 Free plan** and one repository Actions secret, **`MET_OFFICE_API_KEY`**. Once connected, collection and policy management are automatic. The feed shares the UKMO allocation and recovers the original blend when unavailable, stale or incompatible.

Night Sky hour cards now use stars and cloud symbols, short viewing labels and selectable details. `npm run smoke:upgrade` checks the forecast and these cards at desktop and phone widths using fixtures.


Forecast-quality fixes retain the existing compact home layout and styles.
The live GFS 18Z probe returned 18Z–17Z over seven days with no leading nulls,
so Single Runs stays at seven days and the conditional completeness change
was not needed. Long BST event windows can shift by at most one hour to
native boundaries, recorded in provenance and Summary.

Deterministic central values use `lead-ecmwf-prior-v1`: ECMWF's factor is 1
through 48 h, rises linearly to 2 by 96 h, then stays 2; NOAA/UKMO remain 1.
Bounded learned factors multiply this prior. Probability mixtures, categorical
votes and deterministic agreement retain equal-family defaults. This is a
heuristic based on a nine-day Wittering rescore, not a measured optimum:
24 h temperature MAE 0.675→0.675°C; 120 h 1.175→1.090°C (208 matched hours
per lead, nearest eligible METAR within ±30 min). Full per-lead figures and
reproduction instructions are in the upgrade documentation.

The existing wind outlook requires central gust >=30 mph or ensemble chance
>=40%, and displays the central figure. The existing snow outlook requires
>=0.5 cm or ensemble chance >=30%; hourly snow support counts >=0.1 cm/hour.
Rain icons require >=50% fresh family support for >=0.1 mm/hour; weaker
occurrence uses the existing “Showers possible” risk mechanism. Displayed
amounts stay unchanged. Day-card rain wording now uses amount and genuine
ensemble probability tiers, with deterministic agreement labelled separately.

Approved station/gauge rules can now affect Peterborough family/model weights
and the Met Office share through explicit `derivedFrom` rules. Temperature
corrections and occurrence slope/intercept never transfer; conflicting source
keys are skipped and source rollback removes the transfer. This regional
weight transfer remains a heuristic. No immediate learned effect is expected:
20 training dates, subsequent held-out dates and two weekly blocks need about
five or more weeks. EA gauge timestamps are explicitly **assumed period-end**;
the possible 15-minute offset is at most 1/12 of the three-hour verification
window. Cached unknown metadata migrates automatically; EA quality filters
and complete-window requirements stay in place.

Three recent IFS Single Runs confirm missing gusts at +93–149 h; Summary
lists each day's contributing peak-gust families. No interpolation or new
fill was added. The optional UKV default factor is not included.
