# Generated weather data and publishing

`site.yml` replaces the separate deployment and collection workflows. It rebuilds
on every push to `main`, on manual runs, and on hourly scheduled runs that change
data. It uploads only the Pages deployment artifact. There is no application-shell
artifact lookup or expiry dependency. Public GitHub Actions and GitHub Pages keep
the existing zero-cost hosting arrangement.

## Snapshot storage

The `data` branch tree is the contents of `public/data`, without the enclosing
directory. Each changed collection is pushed as a root commit with no parents.
The archive writer is serialised separately from the Pages publisher. Comparing
Git tree hashes skips pushes and scheduled publication when no files change.

Both jobs use `scripts/data-branch.sh`. Only `git ls-remote` exit 2 permits bootstrap
from the tracked main-branch data. Lookup, authentication, fetch and archive errors
stop restoration before touching the destination. A temporary extraction replaces
the destination only after it succeeds, so removed files do not linger.

## Verification format

`forecasts.json` v2 is minified JSON containing station metadata, one model-location
entry per model, and `[modelId, validTimeSec, leadHours, celsius]` rows. It contains
no collection/fetch timestamps. Only temperature is requested and retained; wind
was not scored because the measurement definitions were incompatible.

The collector expands the compact rows in memory for the unchanged
`evaluateVerification` function. It retains 100 days and fixed lead offsets of
1, 2, 3, 5 and 7 days. A result less than 20 hours old skips provider requests.
Legacy conversion runs before that gate, preserving the current `results`, station
and `collectedAt` values. Every source failing leaves the previous collection time
intact so the next hourly run can retry.

`results.json` keeps the client fields and replaces `evaluations` with `daily`.
These entries are the last rolling score snapshot for each UTC collection date,
model and lead, containing only date, modelId, leadHours, n, mae and bias. They are
not scores for just the observations on that date. Both JSON files are minified.

The initial local migration of the tracked archive measured:

| File | Before | After |
| --- | ---: | ---: |
| forecasts.json | 6,872,800 bytes | 211,891 bytes |
| results.json | 269,383 bytes | 34,250 bytes |

All 25 evaluated model/lead results matched exactly. Station metadata and the
result collection time were unchanged. A second gated migration changed no bytes
and made no provider requests. Extrapolating the observed 8.625-day forecast row
volume gives about 2.46 MB for 100 days; this is an estimate, not a size cap.

## Initial cutover

1. Push the collector, new workflow and helpers while main still tracks its seed
   `public/data` files. The push builds the site using that seed if `data` is absent.
2. Dispatch `site.yml`. Verify the collect job succeeds, `data` contains v2 forecasts,
   and its reachable commit count is one. Wait for Pages publication and check
   `/peterborough-weather/data/verification/results.json`.
3. Only after that succeeds, remove `public/data` from the main index, ignore it,
   add `npm run data:pull` for local development, and push that follow-up commit.
4. Check further manual/scheduled runs, single-commit snapshots, and artifact names.
   A changing METAR/AuroraWatch/ISS feed can legitimately cause publication even when
   verification skips its daily refresh. Local integration tests separately cover
   the completely unchanged snapshot path.

No main-branch history rewrite is part of the cutover. Existing large blobs remain
in old commits; deleting that history would require a separate coordinated change.
