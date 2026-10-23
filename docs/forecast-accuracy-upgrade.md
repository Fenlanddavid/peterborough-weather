# Forecast accuracy upgrade — 23 October 2026

Implemented in the existing application and its GitHub Actions/data-branch workflow. The defaults are configured heuristics. No improvement in measured forecast accuracy is claimed.

## Operation and one-time connection

After this code is deployed, the existing hourly workflow collects METAR observations and app forecast products automatically. Weekly learning, publication, monitoring and rollback run in the collector. They do not depend on a browser, manual trials, an approval queue or an owner-maintained diary. The legacy Previous Runs temperature comparison remains separate.

For the optional Met Office feed:

1. Subscribe to **Met Office Site-Specific Blended Probabilistic Forecast v2**, **Free plan**, for the Peterborough site. Do not select a paid plan or the Global Spot product. A v1 key does not authenticate v2.
2. Add its key as repository **Settings → Secrets and variables → Actions → New repository secret → `MET_OFFICE_API_KEY`**. Never use a `VITE_` variable or put the key in a public data file.
3. The next scheduled run connects it. An initial **Actions → Build and publish weather site → Run workflow** can connect immediately after deployment. No further testing/tuning is requested from the owner.

Authenticated Met Office delivery was verified on 23 October 2026 through the repository secret, without retrieving its value into the development process. The returned Peterborough site is `00310120`, about 0.52 km from the requested point, at 2 m elevation. Discovery prefers the UK collections; far-away global-domain sites are excluded. Connection status is published at `data/forecast/metoffice-status.json`.

The adapter uses the documented `2.0.0` EDR/CoverageJSON service and v2 parameter keys. It discovers available compatible collections/instances, batches diagnostics, caches discovery for 24 hours and instances for six hours, and fetches at most every three hours. Every request is reserved before sending, including metadata/discovery and failures. Its persistent limit is **48 calls per UTC day**, below the currently published 55-call free allowance. A 429 retains the previous product and defers until the next UTC day. No subscription is created by the code.

## 1. Freshness and run discovery

- Provider metadata supplies initialisation, availability, cadence and native resolution. A ten-minute publication buffer handles eventually consistent servers.
- Only three recent UKV candidate runs are probed. The five-day historical comparison retains its original six-hour sampling, with recent optional diagnostics only.
- Latest usable forecasts are delivered to the screen before comparison backfill. Requests are coalesced; unavailable/incomplete runs use bounded exponential backoff. An optional-variable rejection can fall back to the core request.
- A live check on 23 October found metadata announcing UKV 14 UTC while Single Runs rejected 14/13 UTC and served 12 UTC. Consequently the latest operational UKV forecast is a separate product: its response issue time is **unknown**, the provider's reference time is labelled as metadata, and it never enters the raw comparison charts. Identical downloaded content retains its first-seen time.
- Freshness is publication delay plus two expected update intervals and the buffer, capped at 24 hours. UKV has an hourly fallback cadence; global products use six hours. Unknown-issue operational output also has a six-hour content-recency limit.
- Visible pages refresh around expected publication, with a minimum 15-minute interval. Hidden pages stop scheduling requests and catch up on reopening. Fetch/check times never replace issue times. Older forecasts remain explicitly identified fallbacks.

## 2. Shared blending

`src/forecast/policy.ts` and `signals.ts` supply the forecast, hourly values, briefing and event estimates. Raw runs remain unchanged for Trends and legacy verification.

ECMWF IFS/AIFS share one family allocation; GFS/AIGFS share NOAA; UKMO Global/UKV, MOGREPS and the processed Met Office product overlap within UKMO. Repeated runs and ensemble members do not create family votes. The default is equal families and equal models within each raw family, renormalised over eligible sources.

Temperature, sustained wind, gusts, cloud, rainfall amounts and genuine occurrence probabilities have separate policies. Lead bands are 0–6, 6–24, 24–48, 48–120 and 120–168 hours; training merges them when necessary. Source weights remain non-negative and sum to one. Learned model factors are bounded to 0.5–1.5, family factors to 0.75–1.25, and the Met Office share to 0.25–0.75. Fitting shrinks towards defaults; temperature corrections are capped at ±1°C and remain specific to the observation location.

When a compatible fresh Met Office central value exists, it receives half the UKMO allocation and the existing raw UKMO estimate receives half. With three families this is about one sixth of the final central estimate. Without compatible raw UKMO, it can supply that family alone. Without the optional feed, the default calculation recovers the original equal-family arithmetic exactly. This split is a heuristic, not a measured optimum.

There is **no validated numerical radar nowcast** connected. Immediate forecasts use fresh model data; source details explain this limitation.

## 3. Automatic verification and learning

The collector produces forecast cases for Peterborough and separately at the observation/gauge locations. It archives default/active/frozen-candidate outputs, generation time, policy/model versions, requested location, quantity definition, units, valid interval and source versions. Gzipped daily generation files reference content-addressed source inputs, including ensemble members, enabling decisions to be reproduced without storing the same full input on every check. Retention is 120 days; unreferenced generated inputs are removed during weekly evaluation.

Only forecasts generated before the verifying observation are eligible. Matching requires the same location, coordinates, quantity definition, units and interval. Repeated predictions of the same interval are reduced before scoring. Wittering temperature observations are checked for time offset, plausible values and report validity; each model is requested at Wittering with its station elevation. A station policy is scoped to `EGXT` and is never silently transferred to central Peterborough.

Candidates are fitted on preceding dates and frozen before their subsequent evaluation weeks. The implementation uses regularised bounded weights, a small station-specific temperature correction and a separate regularised linear occurrence calibration. Rainfall amounts never receive additive offsets; model agreement is never treated as a probability. Greater fresh short-range UKV influence is a candidate only when training observations support it. The processed/raw UKMO split can also receive a small regularised candidate adjustment.

Initial promotion gates:

- At least 200 matched training cases across 20 dates.
- At least seven subsequent held-out dates, 80% paired interval coverage and an appropriate interval-based sample count.
- Probability fitting requires at least 50 events and 50 non-events in training, plus both outcomes in held-out evaluation.
- Exactly the same observation cases for candidate/default scores; at least 5% held-out improvement and an absolute improvement of 0.1°C, 0.2 m/s for gusts, 0.05 mm for amounts or 0.005 Brier score.
- No material increase in false alarms/misses. A leave-one-date-out check rejects gains carried by one unusual day.
- Two successful consecutive, non-overlapping weekly blocks from the same frozen candidate. Candidate outputs must actually have been archived; retrospective predictions cannot substitute for them.

Scores retain MAE/bias, rainfall Brier/reliability bins, amount errors, false alarms/misses and chronological persistence/climatology comparisons where available. Minimum samples alone do not establish skill.

Approved versions are automatically published in `data/forecast/policy.json`. The client validates schema, definitions, bounds, finite values, evidence age and expiry, and retains a valid last-known-good policy. A published default/rollback explicitly clears it. Malformed state is rejected; a model-schema change or unsuitable/stale evidence invokes conservative defaults. Subsequent adequately covered weekly blocks compare actual active outputs with the default. Two consecutive blocks with more than 5% deterioration automatically roll back. Reasons are retained in diagnostics.

## 4. Rainfall interpretation

Three-hour windows reuse member-level event calculations, initially at least 0.2 mm over the stated interval. Probabilities combine only matching locations, thresholds, precipitation definitions and intervals. A deterministic percentage remains **wet agreement**, with a separate Met Office probability when no compatible probability blend exists.

Ensemble expectations, wet-condition medians and deterministic central totals have distinct labels. A supplied rainfall median never adjusts an expected amount. Missing rainfall stays unknown; zero and trace remain separate and thresholds use unrounded values. Coarser model output is identified, with three-hour windows (six hours when required by native output) in place of unsupported hourly timing. Incompatible finer intervals do not enter verification or event agreement. Daily cards, briefing and hourly rows disclose when ensemble and deterministic statistics differ instead of forcing their totals to match.

## 5. Gusts

Sustained wind remains distinct from preceding-hour maximum gusts. The central estimate retains a blend of model maxima. Source peak times determine an honest peak window when timing differs. Compatible member distributions provide a genuine family-weighted mixture 90th percentile and threshold probability, including 30 mph. Percentiles are not averaged, and probabilities are not inferred from the gap between a mean and a percentile.

Met Office source period 90th percentiles remain separately labelled references. Strong plausible outcomes can trigger the app's **Strong-wind outlook** even when the typical estimate is lower. App wind/snow advice is labelled separately from official warnings. The Forecast home keeps the owner’s preferred compact layout: one highest available gust per day, no explanatory wind-banner sentence and no separate rain/wind uncertainty box. Detailed statistics remain in Summary and diagnostics.

## 6. Conditions and missing values

The condition pipeline retains categorical family-weighted support. Thunder, freezing precipitation and snow require at least 50% eligible support for the main hourly icon, configurable in `CONDITION_CONFIG`. Weaker signals remain qualified risks. Daily conditions use duration and support; brief hazards retain their timing instead of taking over the day. Missing/incomplete rainfall produces an unavailable/incomplete message and cannot become “a mostly dry day”. Local daylight and hourly gusts are retained.

Night Sky's hour strip now uses stars, cloud-and-stars and cloud symbols with short condition labels. Viewing suitability remains a separate small badge because moonlight, rain, wind and darkness also matter. Cards offer selectable details, keyboard access, 44-pixel controls and horizontal scrolling at narrow widths. Large numerical scores have moved into the detail panel.

## 7. Met Office sanity checks

Before adjustment, matching raw app/Met Office values and their differences are retained in `signals.disagreements`. Flags start at 3°C, 10 mph for matching central gust maxima, and 30 percentage points for the identical precipitation event. The display can say “Forecast sources disagree” and retain ranges/timing. Disagreement neither discards a source nor reduces a probability. Met Office agreement is never a training target or evidence of observed skill. Rainfall medians are not compared as if they were means.

## Source connections and verification limits

- **Met Office:** connected through the repository Actions secret `MET_OFFICE_API_KEY`; compatible fresh values contribute within UKMO. The owner does not need to repeat the setup above.
- **Central Peterborough:** no validated representative temperature observations are connected. Wittering learning remains station-specific.
- **Gust observations:** METAR gust reporting periods are incompatible with the app's preceding-hour maxima, so gust learning remains disabled.
- **Rainfall:** a nearby EA gauge is discovered automatically and measured amounts are archived. Its public feed documents totals/cadence but does not establish start-versus-end timestamp semantics in the inspected metadata. These readings remain provisional and excluded from interval-matched learning. The adapter supports complete, quality-checked intervals once a compatible source supplies validated semantics; no timing convention is invented.
- **Numerical radar nowcast:** none validated/connected.

These limits disable only the affected learning/feed contribution. The forecast and other automatic collection continue on defaults. No measured central Peterborough accuracy gain is claimed.

## Development checks

`npm test`, `npm run test:timezones`, `npm run lint`, `npm run check:scripts`, `npm run build`, and `npm run smoke:upgrade` (with the local production preview and `CHROMIUM_PATH` when needed). The focused browser report is [upgrade-browser-smoke.json](upgrade-browser-smoke.json); screenshots cover 320, 390 and 1280 pixels. Fixtures verify behaviour, failure modes and publishing, not forecast accuracy.

## Source attribution and references

- [Open-Meteo model metadata and availability](https://open-meteo.com/en/docs/model-updates), [Single Runs](https://open-meteo.com/en/docs/single-runs-api), [UKMO](https://open-meteo.com/en/docs/ukmo-api).
- [Met Office site-specific overview](https://datahub.metoffice.gov.uk/docs/f/category/site-specific/overview), [v2 API guide](https://datahub.metoffice.gov.uk/docs/f/category/site-specific/type/probabilistic-forecast-feature/api-user-guide), [parameter mapping](https://datahub.metoffice.gov.uk/downloads/bpf-v2-parameter-name-changes), [migration notices](https://datahub.metoffice.gov.uk/support/changes-and-updates), [free plan](https://datahub.metoffice.gov.uk/pricing/site-specific).
- [AviationWeather.gov METAR observations](https://aviationweather.gov/data/api/).
- This uses Environment Agency rainfall data from the real-time data API (Beta). [EA rainfall API](https://environment.data.gov.uk/flood-monitoring/doc/rainfall).

## T1: live 18Z coverage probe (2026-10-23 UTC)

Requested GFS Global Single Runs for `run=2026-10-22T18:00`,
`forecast_days=7`, UTC, at 52.5739, -0.2417, with temperature and gusts.
The returned axis starts **2026-10-22T18:00** and ends
**2026-10-29T17:00** (168 hours). Both variables' first and last non-null
values have those same timestamps; neither has any nulls. The initial
2026-10-23T18:00 request was unavailable (HTTP 400), so the probe used the
previous UTC day's published cycle.

This live non-00Z axis is anchored at initialisation, unlike the 00Z fixture
which cannot distinguish the two conventions. Keep `forecast_days=7` in the
shared app/collector URL. Under the owner's conditional instruction, neither
the extra day nor a completeness rewrite is warranted by this probe. A
previous-day 18Z run reaches day index 6 through 17Z, but cannot promise a
complete midnight-to-midnight day. Missing remaining hours stay unknown.

Baseline `report:budget`: planned HTTP 476/620/692 and weighted
644/788/860 for publication lag 0/6/9 h; scheduled weighted limit 1500,
Met Office persistent cap 48 calls/day. No request changes in T1.

## Native day-window alignment

For event windows of at least 12 hours, each system may use the same-length
window shifted to its nearest native UTC boundary, only if both boundaries
then fit and the shift is at most one hour. BST 23Z–23Z daily windows thus
include IFS and GEFS at 00Z–00Z, alongside hourly MOGREPS-G at the original
window. Deterministic agreement uses the same rule. Estimates record
`alignedWindows`; provenance and Summary retain the shift. Three-hour slots
and already aligned GMT windows are unchanged. No extra requests are made.

## Existing strong-wind outlook

The existing banner lists a day only for central gust >=30 mph or genuine
ensemble P(>=30 mph) >=40%. It displays the central figure; probability-only
triggers append the chance of 30+. Ensemble and Met Office p90 references
remain in Summary. The banner's structure and styling are unchanged.

## Existing snow outlook and hourly snow

Summary now carries the 0.5 cm snow event. The existing snow banner and the
briefing's snowfall-signal text require blended snowfall >=0.5 cm or ensemble
P(>=0.5 cm) >=30%. Deterministic agreement alone cannot trigger it. Trace
amounts remain in day detail. Hourly snow support counts only amounts >=0.1 cm
per hour, in both hourly slots and daily-condition sampling. No new banner,
box or explanatory home sentence is added.

## Rain occurrence and icons

Hourly rain support is the equal-family share of fresh models with at least
0.1 mm in the hour. A rain icon/label requires >=50% support, and its wet code
comes from those wet models. Positive support below that threshold retains
the sky condition and adds “Showers possible” through the existing risks
mechanism, explicitly described as family support, never probability. Trace
plus a lone drizzle/shower code no longer suffices. Daily headlines use the
same hourly evidence. Displayed amounts remain unchanged; missing amounts
retain their unavailable description. Cached-only rainfall cannot supply
fresh occurrence support. No UI elements or styles are added.
