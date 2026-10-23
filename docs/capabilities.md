# Live source capability probe

Report assembled 2026-10-21T20:08:02.673Z; individual retrieval times remain in the sidecars. Exact URLs, headers, units, keys, ranges and samples are in tests/fixtures/live/*.meta.json. Fixtures are real responses, not synthetic. Node headers do not confirm browser CORS; actual-origin results are in docs/browser-probes.json.

| Source | Model | Variable | HTTP | Columns/members | Behaviour |
|---|---|---|---|---|---|
| Open-Meteo Ensemble | ecmwf_ifs025 | cloud_cover | 200 | 51 | finite (check min/max in sidecar) |
| Open-Meteo Ensemble | ecmwf_ifs025 | precipitation | 200 | 51 | finite (check min/max in sidecar) |
| Open-Meteo Ensemble | ecmwf_ifs025 | snowfall | 200 | 51 | finite (check min/max in sidecar) |
| Open-Meteo Ensemble | ecmwf_ifs025 | temperature_2m | 200 | 51 | finite (check min/max in sidecar) |
| Open-Meteo Ensemble | ecmwf_ifs025 | wind_gusts_10m | 200 | 51 | finite (check min/max in sidecar) |
| Open-Meteo Ensemble | gfs025 | cloud_cover | 200 | 31 | finite (check min/max in sidecar) |
| Open-Meteo Ensemble | gfs025 | precipitation | 200 | 31 | finite (check min/max in sidecar) |
| Open-Meteo Ensemble | gfs025 | snowfall | 200 | 31 | finite (check min/max in sidecar) |
| Open-Meteo Ensemble | gfs025 | temperature_2m | 200 | 31 | finite (check min/max in sidecar) |
| Open-Meteo Ensemble | gfs025 | wind_gusts_10m | 200 | 31 | finite (check min/max in sidecar) |
| Open-Meteo Ensemble | ukmo_global_ensemble_20km | cloud_cover | 200 | 18 | finite (check min/max in sidecar) |
| Open-Meteo Ensemble | ukmo_global_ensemble_20km | precipitation | 200 | 18 | finite (check min/max in sidecar) |
| Open-Meteo Ensemble | ukmo_global_ensemble_20km | snowfall | 200 | 18 | finite (check min/max in sidecar) |
| Open-Meteo Ensemble | ukmo_global_ensemble_20km | temperature_2m | 200 | 18 | finite (check min/max in sidecar) |
| Open-Meteo Ensemble | ukmo_global_ensemble_20km | wind_gusts_10m | 200 | 18 | finite (check min/max in sidecar) |
| Open-Meteo Forecast | ecmwf_ifs025 | cloud_cover | 200 | 1 | finite (check min/max in sidecar) |
| Open-Meteo Forecast | ecmwf_ifs025 | cloud_cover_high | 200 | 1 | finite (check min/max in sidecar) |
| Open-Meteo Forecast | ecmwf_ifs025 | cloud_cover_low | 200 | 1 | finite (check min/max in sidecar) |
| Open-Meteo Forecast | ecmwf_ifs025 | cloud_cover_mid | 200 | 1 | finite (check min/max in sidecar) |
| Open-Meteo Forecast | ecmwf_ifs025 | dew_point_2m | 200 | 1 | finite (check min/max in sidecar) |
| Open-Meteo Forecast | ecmwf_ifs025 | relative_humidity_2m | 200 | 1 | finite (check min/max in sidecar) |
| Open-Meteo Forecast | ecmwf_ifs025 | temperature_2m | 200 | 1 | finite (check min/max in sidecar) |
| Open-Meteo Forecast | ecmwf_ifs025 | visibility | 200 | 1 | all null |
| Open-Meteo Forecast | ecmwf_ifs025 | wind_speed_250hPa | 200 | 1 | finite (check min/max in sidecar) |
| Open-Meteo Forecast | gfs_global | cloud_cover | 200 | 1 | finite (check min/max in sidecar) |
| Open-Meteo Forecast | gfs_global | cloud_cover_high | 200 | 1 | finite (check min/max in sidecar) |
| Open-Meteo Forecast | gfs_global | cloud_cover_low | 200 | 1 | finite (check min/max in sidecar) |
| Open-Meteo Forecast | gfs_global | cloud_cover_mid | 200 | 1 | finite (check min/max in sidecar) |
| Open-Meteo Forecast | gfs_global | dew_point_2m | 200 | 1 | finite (check min/max in sidecar) |
| Open-Meteo Forecast | gfs_global | relative_humidity_2m | 200 | 1 | finite (check min/max in sidecar) |
| Open-Meteo Forecast | gfs_global | temperature_2m | 200 | 1 | finite (check min/max in sidecar) |
| Open-Meteo Forecast | gfs_global | visibility | 200 | 1 | finite (check min/max in sidecar) |
| Open-Meteo Forecast | gfs_global | wind_speed_250hPa | 200 | 1 | finite (check min/max in sidecar) |
| Open-Meteo Forecast | ukmo_global_deterministic_10km | cloud_cover | 200 | 1 | partial nulls |
| Open-Meteo Forecast | ukmo_global_deterministic_10km | cloud_cover_high | 200 | 1 | partial nulls |
| Open-Meteo Forecast | ukmo_global_deterministic_10km | cloud_cover_low | 200 | 1 | partial nulls |
| Open-Meteo Forecast | ukmo_global_deterministic_10km | cloud_cover_mid | 200 | 1 | partial nulls |
| Open-Meteo Forecast | ukmo_global_deterministic_10km | dew_point_2m | 200 | 1 | partial nulls |
| Open-Meteo Forecast | ukmo_global_deterministic_10km | relative_humidity_2m | 200 | 1 | partial nulls |
| Open-Meteo Forecast | ukmo_global_deterministic_10km | temperature_2m | 200 | 1 | partial nulls |
| Open-Meteo Forecast | ukmo_global_deterministic_10km | visibility | 200 | 1 | partial nulls |
| Open-Meteo Forecast | ukmo_global_deterministic_10km | wind_speed_250hPa | 200 | 1 | partial nulls |

## Single Runs actual non-null coverage (probed run, not a hard-coded model horizon)

| Model | Variable | HTTP | Finite/returned hours | First valid UTC | Last valid UTC |
|---|---|---|---|---|---|
| ecmwf_aifs025_single | temperature_2m | 200 | 168/168 | 2026-10-20T00:00 | 2026-10-26T23:00 |
| ecmwf_aifs025_single | precipitation | 200 | 167/168 | 2026-10-20T01:00 | 2026-10-26T23:00 |
| ecmwf_aifs025_single | wind_speed_10m | 200 | 168/168 | 2026-10-20T00:00 | 2026-10-26T23:00 |
| ecmwf_aifs025_single | wind_gusts_10m | 200 | 0/168 | none | none |
| ecmwf_aifs025_single | pressure_msl | 200 | 168/168 | 2026-10-20T00:00 | 2026-10-26T23:00 |
| ecmwf_aifs025_single | snowfall | 200 | 167/168 | 2026-10-20T01:00 | 2026-10-26T23:00 |
| ecmwf_aifs025_single | weather_code | 200 | 167/168 | 2026-10-20T01:00 | 2026-10-26T23:00 |
| ecmwf_aifs025_single | is_day | 200 | 168/168 | 2026-10-20T00:00 | 2026-10-26T23:00 |
| ecmwf_aifs025_single | cloud_cover | 200 | 168/168 | 2026-10-20T00:00 | 2026-10-26T23:00 |
| ecmwf_ifs025 | temperature_2m | 200 | 168/168 | 2026-10-20T00:00 | 2026-10-26T23:00 |
| ecmwf_ifs025 | precipitation | 200 | 167/168 | 2026-10-20T01:00 | 2026-10-26T23:00 |
| ecmwf_ifs025 | wind_speed_10m | 200 | 168/168 | 2026-10-20T00:00 | 2026-10-26T23:00 |
| ecmwf_ifs025 | wind_gusts_10m | 200 | 105/168 | 2026-10-20T03:00 | 2026-10-26T23:00 |
| ecmwf_ifs025 | pressure_msl | 200 | 168/168 | 2026-10-20T00:00 | 2026-10-26T23:00 |
| ecmwf_ifs025 | snowfall | 200 | 167/168 | 2026-10-20T01:00 | 2026-10-26T23:00 |
| ecmwf_ifs025 | weather_code | 200 | 167/168 | 2026-10-20T01:00 | 2026-10-26T23:00 |
| ecmwf_ifs025 | is_day | 200 | 168/168 | 2026-10-20T00:00 | 2026-10-26T23:00 |
| ecmwf_ifs025 | cloud_cover | 200 | 168/168 | 2026-10-20T00:00 | 2026-10-26T23:00 |
| gfs_global | temperature_2m | 200 | 168/168 | 2026-10-20T00:00 | 2026-10-26T23:00 |
| gfs_global | precipitation | 200 | 167/168 | 2026-10-20T01:00 | 2026-10-26T23:00 |
| gfs_global | wind_speed_10m | 200 | 168/168 | 2026-10-20T00:00 | 2026-10-26T23:00 |
| gfs_global | wind_gusts_10m | 200 | 168/168 | 2026-10-20T00:00 | 2026-10-26T23:00 |
| gfs_global | pressure_msl | 200 | 168/168 | 2026-10-20T00:00 | 2026-10-26T23:00 |
| gfs_global | snowfall | 200 | 167/168 | 2026-10-20T01:00 | 2026-10-26T23:00 |
| gfs_global | weather_code | 200 | 167/168 | 2026-10-20T01:00 | 2026-10-26T23:00 |
| gfs_global | is_day | 200 | 168/168 | 2026-10-20T00:00 | 2026-10-26T23:00 |
| gfs_global | cloud_cover | 200 | 167/168 | 2026-10-20T01:00 | 2026-10-26T23:00 |
| ncep_aigfs025 | temperature_2m | 200 | 162/168 | 2026-10-20T06:00 | 2026-10-26T23:00 |
| ncep_aigfs025 | precipitation | 200 | 161/168 | 2026-10-20T07:00 | 2026-10-26T23:00 |
| ncep_aigfs025 | wind_speed_10m | 200 | 162/168 | 2026-10-20T06:00 | 2026-10-26T23:00 |
| ncep_aigfs025 | wind_gusts_10m | 200 | 0/168 | none | none |
| ncep_aigfs025 | pressure_msl | 200 | 162/168 | 2026-10-20T06:00 | 2026-10-26T23:00 |
| ncep_aigfs025 | snowfall | 200 | 161/168 | 2026-10-20T07:00 | 2026-10-26T23:00 |
| ncep_aigfs025 | weather_code | 200 | 161/168 | 2026-10-20T07:00 | 2026-10-26T23:00 |
| ncep_aigfs025 | is_day | 200 | 168/168 | 2026-10-20T00:00 | 2026-10-26T23:00 |
| ncep_aigfs025 | cloud_cover | 200 | 162/168 | 2026-10-20T06:00 | 2026-10-26T23:00 |
| ukmo_global_deterministic_10km | temperature_2m | 200 | 168/168 | 2026-10-20T00:00 | 2026-10-26T23:00 |
| ukmo_global_deterministic_10km | precipitation | 200 | 167/168 | 2026-10-20T01:00 | 2026-10-26T23:00 |
| ukmo_global_deterministic_10km | wind_speed_10m | 200 | 168/168 | 2026-10-20T00:00 | 2026-10-26T23:00 |
| ukmo_global_deterministic_10km | wind_gusts_10m | 200 | 168/168 | 2026-10-20T00:00 | 2026-10-26T23:00 |
| ukmo_global_deterministic_10km | pressure_msl | 200 | 168/168 | 2026-10-20T00:00 | 2026-10-26T23:00 |
| ukmo_global_deterministic_10km | snowfall | 200 | 167/168 | 2026-10-20T01:00 | 2026-10-26T23:00 |
| ukmo_global_deterministic_10km | weather_code | 200 | 167/168 | 2026-10-20T01:00 | 2026-10-26T23:00 |
| ukmo_global_deterministic_10km | is_day | 200 | 168/168 | 2026-10-20T00:00 | 2026-10-26T23:00 |
| ukmo_global_deterministic_10km | cloud_cover | 200 | 168/168 | 2026-10-20T00:00 | 2026-10-26T23:00 |
| ukmo_uk_deterministic_2km | temperature_2m | 200 | 55/168 | 2026-10-20T00:00 | 2026-10-22T06:00 |
| ukmo_uk_deterministic_2km | precipitation | 200 | 54/168 | 2026-10-20T01:00 | 2026-10-22T06:00 |
| ukmo_uk_deterministic_2km | wind_speed_10m | 200 | 55/168 | 2026-10-20T00:00 | 2026-10-22T06:00 |
| ukmo_uk_deterministic_2km | wind_gusts_10m | 200 | 55/168 | 2026-10-20T00:00 | 2026-10-22T06:00 |
| ukmo_uk_deterministic_2km | pressure_msl | 200 | 55/168 | 2026-10-20T00:00 | 2026-10-22T06:00 |
| ukmo_uk_deterministic_2km | snowfall | 200 | 54/168 | 2026-10-20T01:00 | 2026-10-22T06:00 |
| ukmo_uk_deterministic_2km | weather_code | 200 | 54/168 | 2026-10-20T01:00 | 2026-10-22T06:00 |
| ukmo_uk_deterministic_2km | is_day | 200 | 168/168 | 2026-10-20T00:00 | 2026-10-26T23:00 |
| ukmo_uk_deterministic_2km | cloud_cover | 200 | 55/168 | 2026-10-20T00:00 | 2026-10-22T06:00 |

Combined production nine-day ensemble/core/optional requests are saved as runtime-*.response.txt and sidecars. All were HTTP 200. Negative IFS precipitation cells are finite but invalid; the parser excludes them as unknown and marks affected member windows partial.

## IFS Single Runs gust source limitation (23 October 2026)

Live probes of 2026-10-23 00Z, 06Z and 12Z confirm null `wind_gusts_10m`
through +93 to +149 h. The 06Z run continues null through +167 h; 00Z and
12Z also have +153–155 h nulls. All three start with +0–2 h nulls.
Exact requests, axes and null spans are in [ifs-gust-probe.json](ifs-gust-probe.json).
AIFS and AIGFS provide no gusts in the existing capability fixtures.
No interpolation or new gap filling was added. Summary lists the contributing
families of each day's complete source peak-gust windows, so the loss of ECMWF
coverage is visible beside the central figure.
