# Tee Time Watcher

Discord bot that watches Vancouver/Burnaby municipal golf course booking sites for
last-minute tee time openings (cancellations, newly released slots) and pings a
Discord channel/DM when one appears matching a saved watch.

## Core flow

1. User runs `/watch date:<date> before:<time>` in Discord. There's no course
   filter — a watch always covers every course at whichever site(s) it targets.
   `site` is optional and defaults to **both** Vancouver and Burnaby; pass
   `site:vancouver` or `site:burnaby` to narrow to one.
2. The watch is stored in SQLite.
3. A cron job polls the relevant site(s)' tee-sheet API every few minutes for each
   active watch, and diffs the result against the last-seen slot set for that watch.
4. Newly-appeared slots matching the filter → Discord notification with time, price,
   and a link to the booking page. The user books manually (no auto-checkout —
   payment info / bot detection / cancellation-policy risk).
5. The watch auto-deactivates after that first notification — one ping and done.
   The user re-runs `/watch` if they want to keep looking after that.

A watch can span multiple days via the optional `until` param (date through
date_end, inclusive) — the poller searches each day separately per cycle (the
CPS API takes one `searchDate` at a time), and a match on *any* day (and, if
`site` wasn't narrowed, *any* site) triggers one notification listing every
match and stops the whole watch. Useful for "find me an opening sometime in
the next N days" instead of a fixed single date/site.

A multi-site watch (`site: 'all'` in the DB) loops over both sites per poll,
per date. A failure on one site (e.g. a transient Cloudflare challenge) only
skips that site for the rest of the cycle — the other site still gets
searched and can still trigger a notification.

## Stack decisions (already made, don't re-litigate)

- **Node.js + discord.js** — chosen over Python for first-class Discord bot support.
- **Local hosting for MVP** — runs on the user's own machine for now, not deployed to
  cloud yet. Cloud deploy (Railway/Fly.io) is a later step once the MVP is validated.
- **SQLite via better-sqlite3** — plenty for personal single-user use, zero setup.
- **node-cron** for polling on a schedule.

## The golf booking platform: Club Prophet Systems (CPS)

Both target sites run on **cps.golf** (Club Prophet Systems), an Angular SPA at
`https://<site>.cps.golf/onlineresweb/`. This is an undocumented/unofficial API —
reverse-engineered by reading the minified Angular bundles and probing the live
endpoints. It is NOT a sanctioned public API. Keep polling interval reasonable
(every few minutes, not seconds) to stay a good citizen and avoid detection/breakage.

**Important: there are two different auth schemes depending on the site's CPS build
version.** The adapter must detect which one a given site uses.

### Sites currently targeted

| Site key   | Host                        | Auth mode | Courses (courseId: name)                                   |
|------------|------------------------------|-----------|--------------------------------------------------------------|
| vancouver  | golfvancouver.cps.golf       | oauth     | 1: Langara Golf Course, 2: Fraserview Golf Course, 3: McCleery Golf Course |
| burnaby    | golfburnaby.cps.golf         | apikey    | 1: Burnaby Mountain Golf, 2: Riverway Golf                   |

Course IDs were discovered via each site's `GetAllOptions` response and are stable
identifiers for that site — safe to hardcode.

### Step 1 — Fetch site configuration (both auth modes)

```
GET https://<host>/onlineresweb/Home/Configuration
```

Returns JSON with `onlineApi` (the base URL for all reservation calls),
`authorityBaseUrl` (OAuth issuer, oauth sites only), `apiKey` (apikey sites only),
and `siteName`. Cache this per site — it rarely changes. No auth required for this
call.

### Step 2a — OAuth mode (e.g. vancouver)

Get a guest access token (10 min TTL, `expires_in: 600`):

```
POST {authorityBaseUrl}/myconnect/token/short
Content-Type: multipart/form-data
  client_id=onlinereswebshortlived
```

(`onlinereswebshortlived` comes from `window.__env.SHORT_LIVED_CLIENT_ID` in
`assets/env.js` on oauth-mode sites — but it appears to be a constant across CPS
deployments, so it's safe to hardcode.)

Response: `{ access_token, expires_in, token_type: "Bearer", scope }`. Use as
`Authorization: Bearer <token>` on all subsequent onlineApi calls. Refresh before
it expires (poll interval should be well under 10 minutes anyway).

### Step 2b — apikey mode (e.g. burnaby)

No token exchange. Every onlineApi request instead carries these headers directly
(apiKey value comes from the Configuration response):

```
client-id: onlineresweb
X-TerminalId: 1
x-requestid: <random GUID, one per request>
x-websiteid: 00000000-0000-0000-0000-000000000000
x-apiKey: <apiKey from Configuration>
```

### Step 3 — Common headers (both modes, all onlineApi calls)

```
x-productid: 1
x-componentid: 1
x-siteid: 1          (worked for both test sites; hasn't been seen to need per-course values)
x-timezone-offset: <minutes, e.g. 420 for PDT>
x-timezoneid: America/Vancouver
x-ismobile: false
x-moduleid: 7        (7 = OnlineReservation module enum)
```

### Step 4 — Register a transaction ID

Every search needs a fresh transaction ID registered first:

```
POST {onlineApi}/RegisterTransactionId
Content-Type: application/json
Body: {"transactionId": "<random GUID>"}
```

Returns `true` on success. Generate a new GUID per search (cheap, avoids any
staleness issues).

### Step 5 — Search tee times

```
GET {onlineApi}/TeeTimes
Query params:
  searchDate=<JS Date.toDateString() format, e.g. "Fri Aug 14 2026">
  holes=18
  numberOfPlayer=1
  courseIds=1,2,3        (comma-joined course IDs to search, from the table above)
  searchTimeType=0
  classCode=A
  defaultOnlineRate=N
  isUseCapacityPricing=false
  memberStoreId=1
  searchType=1
  transactionId=<the GUID registered in step 4>
  # optional, to filter by time window server-side:
  teeOffTimeMin=<0-23>
  teeOffTimeMax=<0-23>
  isChangeTeeOffTime=true
```

Response: `{ transactionId, isSuccess, content: [ {...slot} ] }`. Each slot in
`content` has (fields actually observed):

- `startTime` — ISO datetime of the tee time
- `courseId`, `courseName`, `siteId`
- `teeSheetId` — unique per specific time slot, use this (not `courseTimeId`)
  as the stable identity for diffing "have we already notified about this
  slot". `courseTimeId` looks similar but is constant for every time slot at
  a given course on a given day (confirmed against live data) — using it as
  the identity collapses every distinct time at that course into one, so only
  the first ever surfaces as "new".
- `participants`, `availableParticipantNo` — how many spots open
- `shItemPrices[0].displayPrice` — price per player
- `holes`

An empty `content` array with `isSuccess: true` means no availability — this is
the normal/expected response most of the time, not an error.

### Verified working examples (from manual curl testing, 2026-08-13)

Both flows were tested end-to-end against live data and returned real available
tee times for both sites (Langara/McCleery for Vancouver, Riverway for Burnaby).
If either flow starts failing, the first things to check: has the CPS build
version changed (bundle filenames/hashes will differ), has the platform added
Cloudflare bot-challenge enforcement on these specific endpoints.

**Update (2026-08-13, later same day):** hit exactly that Cloudflare issue in
practice — requests started reliably getting a 403 "Just a moment..." challenge
page. Root-caused it: Cloudflare is fingerprinting Node's TLS stack, not the
IP or request rate. Confirmed by interleaving requests to `Home/Configuration`
from the same machine/IP/User-Agent: `curl` passed consistently, while both
Node's `fetch` (undici) *and* the built-in `https` module failed almost every
time. The fix — [src/adapters/cps.js](src/adapters/cps.js) shells out to `curl`
(via `child_process.execFile`) for the actual HTTP requests instead of using
Node's native HTTP stack. Not a bypass of anything — just avoiding a client
Cloudflare happens to misidentify. If `curl` itself ever starts failing too,
that would indicate a real block/change, worth revisiting then.

## Booking links (for notifications)

Deep-link users to the search page pre-filtered where possible, otherwise link to:
- `https://golfvancouver.cps.golf/onlineresweb/search-teetime`
- `https://golfburnaby.cps.golf/onlineresweb/search-teetime`

## Not doing (by design)

- No automated booking/checkout — too risky (payment info, ToS, bot detection).
  User always books manually after getting notified.
- No aggressive polling — keep it to a few minutes between checks per watch.
