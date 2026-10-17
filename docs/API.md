# Contrat d'API — Smart Personal Dashboard

Deux familles de routes, servies par le même serveur Node.js (`server/`) :

- **Console web** (`/api/...`) : authentification par cookie de session (`sd_session`, HttpOnly, SameSite=Strict, Secure en production). Toute requête qui modifie quelque chose (POST/PUT/PATCH/DELETE) doit envoyer l'en-tête `X-Requested-With: smart-dashboard` (protection CSRF).
- **Tablette** (`/api/v1/...`) : authentification par `Authorization: Bearer <jeton de l'appareil>`. Le jeton est obtenu par appairage avec un code à 6 chiffres affiché dans la console.

Toutes les réponses sont en JSON (`application/json; charset=utf-8`). Erreurs : `{ "error": "code_machine", "message": "Texte lisible en français" }` avec le code HTTP adapté (400, 401, 403, 404, 409, 429, 500, 502).

Les dates de calendrier sont au format `YYYY-MM-DD`, les heures `HH:MM` (heure locale du serveur, fuseau `TZ`, par défaut `Europe/Paris`), les horodatages en ISO 8601. Les jours de la semaine sont un tableau de 7 booléens **du lundi au dimanche**.

---

## 1. Console web — authentification

| Méthode | Route | Corps | Réponse |
|---|---|---|---|
| GET | `/api/auth/status` | — | `{ setupRequired, authenticated, totpEnabled }` |
| POST | `/api/auth/setup` | `{ password }` (≥ 10 caractères) — seulement si aucun compte n'existe | `{ ok: true }` + cookie |
| POST | `/api/auth/login` | `{ password, totp? }` | `{ ok: true }` + cookie · `401 { error: "totp_required" }` si le code 2FA manque · `401 { error: "invalid_credentials" }` |
| POST | `/api/auth/logout` | — | `{ ok: true }` |
| POST | `/api/auth/password` | `{ current, next }` | `{ ok: true }` |
| POST | `/api/auth/totp/setup` | — | `{ secret, otpauthUrl, qrDataUrl }` (QR code en data URL PNG) |
| POST | `/api/auth/totp/enable` | `{ code }` | `{ ok: true }` |
| POST | `/api/auth/totp/disable` | `{ code }` | `{ ok: true }` |
| GET | `/api/auth/sessions` | — | `[{ id, userAgent, createdAt, lastSeenAt, current }]` |
| DELETE | `/api/auth/sessions/:id` | — | `{ ok: true }` |

## 2. Console web — vue d'ensemble

`GET /api/overview`

```json
{
  "device": { "paired": true, "online": true, "name": "Tab5", "lastSeenAt": "2026-10-17T05:41:00.000Z",
              "battery": 78, "charging": false, "firmware": "0.1.0", "rssi": -54, "ip": "192.168.1.42",
              "autonomyDays": 9 },
  "lastSync": "2026-10-17T05:41:00.000Z",
  "today": { "date": "2026-10-17", "done": 5, "total": 8, "streak": 23, "bestStreak": 31 },
  "services": [ { "id": "icloud", "name": "Calendrier iCloud", "status": "ok", "detail": "3 calendriers · synchro toutes les 15 min" } ],
  "events": [ { "id": 12, "ts": "…", "source": "pathe", "level": "warning", "message": "Récupération du programme : erreur 503" } ]
}
```

`status` ∈ `ok | warning | error | disabled | local`. `level` ∈ `info | success | warning | error`.

| Méthode | Route | Corps | Réponse |
|---|---|---|---|
| POST | `/api/sync` | — | `{ ok: true }` (relance toutes les intégrations actives) |
| POST | `/api/device/commands` | `{ type: "wake" \| "lock" \| "reboot" \| "message" \| "reload" \| "screenshot", text? }` | `{ id }` (la tablette la récupère à sa prochaine synchro) |
| GET | `/api/device/screenshot.jpg` | — | `image/jpeg` — dernière capture envoyée par la tablette (404 si aucune) |

## 3. Console web — habitudes

Objet **Habit** :

```json
{ "id": 6, "name": "Séance de sport", "icon": "dumbbell", "color": "#28A745",
  "days": [true,false,true,false,true,true,false], "goal": "45 min", "remindTimes": ["09:00"],
  "showOnDevice": true, "archived": false, "position": 5,
  "streak": 12, "bestStreak": 20, "rate30": 88, "doneToday": false }
```

Icônes disponibles : `bed, drop, moon, chat, briefcase, dumbbell, book, sparkles, run, heart, leaf, music, code, pill, sun, check`.

| Méthode | Route | Corps | Réponse |
|---|---|---|---|
| GET | `/api/habits?archived=0\|1` | — | `Habit[]` (triées par `position`) |
| POST | `/api/habits` | `{ name, icon, color, days, goal?, remindTimes?, showOnDevice? }` | `Habit` |
| PATCH | `/api/habits/:id` | champs partiels (dont `archived`) | `Habit` |
| DELETE | `/api/habits/:id` | — | `{ ok: true }` |
| POST | `/api/habits/reorder` | `{ ids: number[] }` | `{ ok: true }` |
| GET / PUT | `/api/streak-settings` | `{ threshold, resetTime, jokersPerWeek }` | idem |
| GET | `/api/badges` | — | `[{ id, label, unlocked, progress, target }]` |
| GET | `/api/history?days=30` | — | `[{ date, done, total, validated }]` |

`threshold` = nombre de tâches à faire pour valider une journée (si moins de tâches sont prévues ce jour-là, il faut toutes les faire). `jokersPerWeek` = jours ratés tolérés par semaine sans casser la série.

## 4. Console web — réveils et routine

Objet **Alarm** : `{ id, time: "06:45", label, days: [7 bool], sound: "aube" | "carillon" | "pulsation" | "douce", enabled, snoozeMinutes }`

| Méthode | Route | Corps | Réponse |
|---|---|---|---|
| GET | `/api/alarms` | — | `Alarm[]` |
| POST | `/api/alarms` | `{ time, label, days, sound?, enabled?, snoozeMinutes? }` | `Alarm` |
| PATCH | `/api/alarms/:id` | partiel | `Alarm` |
| DELETE | `/api/alarms/:id` | — | `{ ok: true }` |
| GET / PUT | `/api/routine` | `{ enabled, preLightMinutes, showBriefing, waterReminder }` | idem |

## 5. Console web — appareil

`GET /api/device`

```json
{ "paired": true, "name": "Tab5", "firmware": "0.1.0", "lastSeenAt": "…", "battery": 78, "charging": false,
  "online": true, "rssi": -54, "ip": "192.168.1.42", "pinSet": true, "pinUpdatedAt": "…",
  "settings": { "brightness": 60, "theme": "dark", "nightMode": { "enabled": true, "start": "22:00", "end": "07:00", "brightness": 10 },
                "warmTint": true, "screenSleepSeconds": 30, "deepSleepMinutes": 10, "touchWake": true,
                "lockOnWake": true, "lockAfterMinutes": 5, "pollSeconds": 60 },
  "layout": [ { "id": "clock", "span": 2 }, { "id": "weather", "span": 1 }, { "id": "music", "span": 1 },
              { "id": "agenda", "span": 2 }, { "id": "tasks", "span": 1 }, { "id": "roblox", "span": 1 } ],
  "availableWidgets": [ { "id": "cinema", "label": "Prochaine séance ciné" }, { "id": "streak", "label": "Série" } ] }
```

| Méthode | Route | Corps | Réponse |
|---|---|---|---|
| PUT | `/api/device/settings` | partiel de `settings` | `settings` |
| PUT | `/api/device/layout` | `{ widgets: [{ id, span }] }` (2 rangées de 4 colonnes) | `{ ok: true }` |
| PUT | `/api/device/pin` | `{ pin }` (4 à 6 chiffres) | `{ ok: true }` |
| POST | `/api/device/pairing-code` | — | `{ code: "483920", expiresAt }` (valable 10 min) |
| POST | `/api/device/regenerate-token` | — | `{ ok: true }` — l'écran devra être ré-appairé |
| DELETE | `/api/device` | — | `{ ok: true }` (désappairer) |
| GET | `/api/backup` | — | fichier JSON (toutes les données sauf secrets) |
| POST | `/api/backup` | le JSON exporté | `{ ok: true }` |

## 6. Console web — intégrations et clés API

Objet **Integration** :

```json
{ "id": "spotify", "name": "Spotify", "description": "Lecture, file d'attente et commandes",
  "enabled": true, "status": "ok", "statusDetail": "Connecté · Premium", "lastRunAt": "…",
  "config": { "clientId": "8f3c…", "redirectUri": "https://ton-domaine/api/oauth/spotify/callback", "account": "Arthur" },
  "secrets": { "clientSecret": { "set": true, "preview": "••••f5d3" } },
  "fields": [ { "key": "clientId", "label": "Client ID", "type": "text", "mono": true, "copyable": true },
              { "key": "clientSecret", "label": "Client Secret", "type": "secret" },
              { "key": "redirectUri", "label": "URI de redirection", "type": "readonly", "mono": true, "copyable": true } ],
  "actions": [ { "id": "connect", "label": "Connecter le compte Spotify" } ] }
```

`fields[].type` ∈ `text | secret | readonly | number | select | time-list | chips`. Pour `select`, `options: [{ value, label }]`.

| Méthode | Route | Corps | Réponse |
|---|---|---|---|
| GET | `/api/integrations` | — | `Integration[]` (`spotify`, `roblox`, `pathe`, `icloud`, `weather`) |
| PUT | `/api/integrations/:id` | `{ enabled?, config?: {...}, secrets?: { champ: "valeur" \| null } }` | `Integration` |
| POST | `/api/integrations/:id/test` | — | `{ ok, ms, message }` |
| POST | `/api/integrations/:id/refresh` | — | `{ ok: true }` |
| GET | `/api/integrations/:id/secret/:field` | — | `{ value }` (journalisé) |
| GET | `/api/integrations/spotify/connect` | — | redirection 302 vers Spotify |
| GET | `/api/oauth/spotify/callback` | (Spotify) | redirection 302 vers `/integrations?spotify=connected` ou `?spotify=error` |
| POST | `/api/integrations/roblox/resolve` | `{ placeId }` | `{ universeId, name }` |
| GET | `/api/integrations/pathe/cinemas` | — | `[{ id, name, city }]` |
| GET | `/api/integrations/icloud/calendars` | — | `[{ id, name, color }]` |

---

## 7. Tablette — `/api/v1`

| Méthode | Route | Corps | Réponse |
|---|---|---|---|
| POST | `/api/v1/pair` | `{ code, name?, firmware? }` (sans jeton, 5 essais / 10 min) | `{ token }` |
| GET | `/api/v1/state` | — | **DeviceState** (ci-dessous) |
| POST | `/api/v1/heartbeat` | `{ battery, charging, firmware, rssi, ip, screen, ackCommands: [id] }` | `{ ok: true }` |
| POST | `/api/v1/habits/:id/toggle` | `{ done }` | `tasks` (même forme que dans DeviceState) |
| PATCH | `/api/v1/alarms/:id` | `{ enabled }` | `Alarm` |
| PUT | `/api/v1/settings` | réglages d'affichage modifiés sur la tablette (mêmes champs que `PUT /api/device/settings`, partiels) | réglages complets |
| POST | `/api/v1/music/:action` | action ∈ `play, pause, next, previous, volume, like` ; `{ value? }` | `music` |
| POST | `/api/v1/cinema/notify/:filmId` | `{ notify }` | `{ ok: true }` |
| GET | `/api/v1/image?src=<url>&w=&h=` | — | `image/jpeg` baseline redimensionnée (hôtes autorisés uniquement) |
| POST | `/api/v1/screenshot` | corps binaire RGB565 little-endian, en-têtes `X-Width`, `X-Height` | `{ ok: true }` |

**DeviceState** (`GET /api/v1/state`) — chaque bloc vaut `null` si l'intégration est désactivée ou n'a jamais réussi :

```json
{
  "serverTime": 1792222920, "tz": "Europe/Paris", "tzPosix": "CET-1CEST,M3.5.0,M10.5.0/3",
  "settings": { "...": "comme /api/device", "pinSalt": "hex", "pinHash": "hex sha256(salt + pin)" },
  "layout": [ { "id": "clock", "span": 2 } ],
  "weather": { "label": "Domicile", "temp": 14, "text": "Éclaircies", "icon": "partly", "max": 17, "min": 9,
               "hourly": [ { "hour": "9 h", "temp": 12, "icon": "cloud" } ] },
  "agenda": { "today": [ { "id": "abc", "start": "09:30", "end": "10:30", "title": "Salle de sport", "location": "…",
                           "calendar": "Sport", "color": "#30D158", "allDay": false, "important": false, "reminderMinutes": 15 } ],
              "upcoming": [ { "id": "abc", "date": "2026-10-17", "start": "09:30", "title": "…", "color": "#30D158" } ],
              "week": [ { "date": "2026-10-12", "events": [ { "start": "09:00", "end": "10:00", "title": "Sport", "color": "#30D158", "allDay": false } ] } ],
              "monthDays": [12, 13, 14] },
  "tasks": { "date": "2026-10-17", "done": 5, "total": 8, "streak": 23, "bestStreak": 31, "weekRate": 86, "monthRate": 79,
             "items": [ { "id": 1, "name": "Faire son lit", "meta": "Matin", "icon": "bed", "color": "#0FA5C8", "done": true, "streak": 41 } ],
             "week": [ { "label": "L", "state": "done" } ],
             "badges": [ { "label": "Série de 21 j", "unlocked": true, "progress": 21, "target": 21 } ] },
  "alarms": [ { "id": 1, "time": "06:45", "label": "Semaine", "days": [true,true,true,true,true,false,false], "sound": "aube", "enabled": true, "snoozeMinutes": 9 } ],
  "nextAlarm": { "at": 1792310400, "label": "Dimanche", "time": "09:00" },
  "routine": { "enabled": true, "preLightMinutes": 10, "showBriefing": true, "waterReminder": true },
  "music": { "available": true, "isPlaying": true, "deviceName": "Enceinte du salon", "volume": 65, "liked": false,
             "track": { "id": "…", "title": "…", "artist": "…", "album": "…", "durationMs": 238000, "progressMs": 102000, "imageUrl": "/api/v1/image?src=…" },
             "queue": [ { "title": "…", "artist": "…", "durationMs": 201000, "imageUrl": "…" } ] },
  "roblox": { "name": "Mon jeu", "playing": 1284, "visits": 2400000, "favorites": 18600, "peak24h": 1912, "deltaPct": 18, "history": [620, 700] },
  "cinema": { "cinemaName": "Pathé Saint-Denis",
              "days": [ { "date": "2026-10-17", "label": "Aujourd’hui" }, { "date": "2026-10-18", "label": "Dim. 18" } ],
              "films": [ { "id": "slug", "title": "…", "genre": "Drame", "duration": "2 h 04", "rating": "", "isNew": true, "posterUrl": "/api/v1/image?src=…&w=176&h=256",
                           "shows": [ { "time": "14:10", "tag": "VF" } ],
                           "showsByDay": [ [ { "time": "14:10", "tag": "VF" } ], [ ] ] } ],
              "upcoming": [ { "id": "slug", "title": "…", "date": "2026-10-21", "genre": "Thriller", "posterUrl": "…", "notify": true } ] },
  "stats": { "monthTasks": 121, "monthDeltaPct": 12, "sportSessions": 9, "sportGoal": 12, "successRate": 86, "successDeltaPts": 4,
             "weekRate": 86, "threshold": 7,
             "daily": [ { "day": 4, "date": "2026-10-04", "value": 7, "max": 8, "validated": true, "today": false } ], "sportWeekly": [120, 150] },
  "commands": [ { "id": 3, "type": "message", "text": "À table !" } ]
}
```

Les URL d'images commençant par `/` sont relatives à l'adresse du serveur.
