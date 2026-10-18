# Contrat d'API — Smart Personal Dashboard

Trois familles de routes, servies par le même serveur Node.js (`server/`) :

- **Console web — foyer** (`/api/...`) : authentification par cookie de session (`sd_session`, HttpOnly, SameSite=Strict, Secure en production). Chaque compte appartient à **un foyer** et ne voit que les données de son foyer (une base SQLite par foyer : `data/households/<id>.db`). Toute requête qui modifie quelque chose (POST/PUT/PATCH/DELETE) doit envoyer l'en-tête `X-Requested-With: smart-dashboard` (protection CSRF).
- **Console web — administration** (`/api/admin/...`) : mêmes règles, réservé au rôle `admin` (403 sinon).
- **Écrans** (`/api/v1/...`) : authentification par `Authorization: Bearer <jeton de l'écran>`. Le jeton est obtenu par appairage avec un code à 6 chiffres affiché dans la console. Un écran ne voit que les données de son foyer, et seulement **ses** réveils, réglages et commandes.

Ce qui est **commun aux écrans d'un foyer** : tâches et habitudes, historique, agenda, Spotify, cinéma, Roblox, météo, code PIN. Ce qui est **propre à chaque écran** : réveils et routine matinale, réglages d'affichage (thème, luminosité, mode nuit, veille, verrouillage), disposition de l'accueil, commandes, capture.

Toutes les réponses sont en JSON (`application/json; charset=utf-8`). Erreurs : `{ "error": "code_machine", "message": "Texte lisible en français" }` avec le code HTTP adapté (400, 401, 403, 404, 409, 410, 429, 500, 502).

Les dates de calendrier sont au format `YYYY-MM-DD`, les heures `HH:MM` (heure locale du serveur, fuseau `TZ`, par défaut `Europe/Paris`), les horodatages en ISO 8601. Les jours de la semaine sont un tableau de 7 booléens **du lundi au dimanche**.

---

## 1. Console web — comptes et authentification

Objet **User** : `{ id, login, name, role: "admin" | "user", totpEnabled, household: { id, name } }`

| Méthode | Route | Corps | Réponse |
|---|---|---|---|
| GET | `/api/auth/status` | — | `{ setupRequired, authenticated, user: User \| null }` |
| POST | `/api/auth/setup` | `{ login, password, name? }` — seulement si aucun administrateur n'existe (en production : depuis le serveur, voir `cli.js ensure-admin`) | `{ ok: true }` + cookie |
| POST | `/api/auth/login` | `{ login, password, totp? }` | `{ ok: true }` + cookie · `401 totp_required` si le code 2FA manque · `401 invalid_totp` · `401 invalid_credentials` · `403 disabled` |
| POST | `/api/auth/logout` | — | `{ ok: true }` |
| PATCH | `/api/auth/profile` | `{ login?, name?, householdName? }` | `User` |
| POST | `/api/auth/password` | `{ current, next }` | `{ ok: true }` (les autres sessions sont fermées) |
| POST | `/api/auth/totp/setup` | — | `{ secret, otpauthUrl, qrDataUrl }` (QR code en data URL PNG) |
| POST | `/api/auth/totp/enable` | `{ code }` | `{ ok: true }` |
| POST | `/api/auth/totp/disable` | `{ code }` | `{ ok: true }` |
| GET | `/api/auth/sessions` | — | `[{ id, userAgent, createdAt, lastSeenAt, current }]` |
| DELETE | `/api/auth/sessions/:id` | — | `{ ok: true }` |

`login` : 3 à 32 caractères parmi lettres, chiffres, `.`, `-`, `_` (insensible à la casse). Mot de passe : au moins 10 caractères.

**Invitations et réinitialisations** (liens créés par l'administrateur, à usage unique, sans session) :

| Méthode | Route | Corps | Réponse |
|---|---|---|---|
| GET | `/api/invites/:token` | — | `{ valid: false }` ou `{ valid: true, kind: "invite" \| "reset", expiresAt, note, login }` |
| POST | `/api/invites/:token/accept` | invitation : `{ login, password, name?, householdName? }` — réinitialisation : `{ password }` | `{ ok: true }` + cookie · `410 invite_invalid` |

Une invitation crée un compte **avec son propre foyer** (données vides, habitudes d'exemple). Une réinitialisation change le mot de passe, désactive la double authentification et ferme toutes les sessions du compte.

## 2. Console web — vue d'ensemble du foyer

`GET /api/overview`

```json
{
  "devices": [ { "id": 1, "name": "Chambre", "paired": true, "online": true, "firmware": "0.3.0",
                 "lastSeenAt": "2026-10-17T05:41:00.000Z", "lastSyncAt": "2026-10-17T05:41:00.000Z",
                 "battery": 78, "charging": false, "rssi": -54, "ip": "192.168.1.42", "autonomyDays": 9,
                 "pairedAt": "2026-10-01T18:12:00.000Z" } ],
  "today": { "date": "2026-10-17", "done": 5, "total": 8, "streak": 23, "bestStreak": 31 },
  "services": [ { "id": "icloud", "name": "Calendrier iCloud", "status": "ok", "detail": "3 calendriers · synchro toutes les 15 min" } ],
  "events": [ { "id": 12, "ts": "…", "source": "pathe", "level": "warning", "message": "Récupération du programme : erreur 503" } ]
}
```

`status` ∈ `ok | warning | error | disabled | local`. `level` ∈ `info | success | warning | error`. Les éléments de `devices` ont la forme **DeviceSummary**.

| Méthode | Route | Corps | Réponse |
|---|---|---|---|
| POST | `/api/sync` | — | `{ ok: true }` (relance toutes les intégrations actives du foyer) |

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

## 4. Console web — écrans du foyer

| Méthode | Route | Corps | Réponse |
|---|---|---|---|
| GET | `/api/devices` | — | `DeviceSummary[]` |
| POST | `/api/devices/pairing-code` | `{ name?, deviceId? }` — `deviceId` pour ré-associer un écran existant (il garde ses réveils et réglages) | `{ code: "483920", expiresAt }` (valable 10 min) |
| POST | `/api/devices/broadcast` | `{ text }` (1 à 140 caractères) | `{ ok: true, screens }` — message affiché sur tous les écrans associés |
| GET | `/api/devices/:id` | — | **DeviceInfo** (ci-dessous) |
| PATCH | `/api/devices/:id` | `{ name }` | `DeviceInfo` |
| DELETE | `/api/devices/:id` | — | `{ ok: true }` — retire l'écran (jeton, réveils, réglages, capture) |
| PUT | `/api/devices/:id/settings` | partiel de `settings` | `settings` |
| PUT | `/api/devices/:id/layout` | `{ widgets: [{ id, span }] }` (2 rangées de 4 colonnes) | `{ ok: true }` |
| POST | `/api/devices/:id/commands` | `{ type: "wake" \| "lock" \| "reboot" \| "message" \| "reload" \| "screenshot", text? }` | `{ id }` (l'écran la récupère à sa prochaine synchro) |
| GET | `/api/devices/:id/screenshot.jpg` | — | `image/jpeg` — dernière capture envoyée par cet écran (404 si aucune) |

Un `:id` qui n'appartient pas au foyer du compte renvoie 404.

**DeviceInfo** = DeviceSummary +

```json
{ "pinSet": true, "pinUpdatedAt": "…",
  "settings": { "brightness": 60, "theme": "dark", "nightMode": { "enabled": true, "start": "22:00", "end": "07:00", "brightness": 10 },
                "warmTint": true, "screenSleepSeconds": 30, "deepSleepMinutes": 10, "touchWake": true,
                "lockOnWake": true, "lockAfterMinutes": 5, "pollSeconds": 60 },
  "layout": [ { "id": "clock", "span": 2 }, { "id": "weather", "span": 1 }, { "id": "music", "span": 1 },
              { "id": "agenda", "span": 2 }, { "id": "tasks", "span": 1 }, { "id": "roblox", "span": 1 } ],
  "availableWidgets": [ { "id": "cinema", "label": "Prochaine séance ciné" }, { "id": "streak", "label": "Série" } ] }
```

## 5. Console web — réveils, code PIN et sauvegarde

Objet **Alarm** : `{ id, deviceId, time: "06:45", label, days: [7 bool], sound: "aube" | "carillon" | "pulsation" | "douce", enabled, snoozeMinutes }`

| Méthode | Route | Corps | Réponse |
|---|---|---|---|
| GET | `/api/devices/:id/alarms` | — | `Alarm[]` de cet écran |
| POST | `/api/devices/:id/alarms` | `{ time, label, days, sound?, enabled?, snoozeMinutes? }` | `Alarm` |
| PATCH | `/api/alarms/:id` | partiel | `Alarm` |
| DELETE | `/api/alarms/:id` | — | `{ ok: true }` |
| GET / PUT | `/api/devices/:id/routine` | `{ enabled, preLightMinutes, showBriefing, waterReminder }` | idem |
| GET | `/api/pin` | — | `{ pinSet, pinUpdatedAt }` |
| PUT | `/api/pin` | `{ pin }` (4 à 6 chiffres, commun aux écrans du foyer) | `{ ok: true }` |
| GET | `/api/backup` | — | fichier JSON (données du foyer, sans les secrets) |
| POST | `/api/backup` | le JSON exporté | `{ ok: true }` |

## 6. Console web — services du foyer

Objet **Integration** :

```json
{ "id": "spotify", "name": "Spotify", "description": "Lecture, file d'attente et commandes",
  "enabled": true, "status": "ok", "statusDetail": "Connecté · Premium", "lastRunAt": "…",
  "config": { "account": "Arthur · Premium", "appStatus": "Configurée par l’administrateur" },
  "secrets": {},
  "fields": [ { "key": "account", "label": "Compte connecté", "type": "readonly" },
              { "key": "appStatus", "label": "Application Spotify du serveur", "type": "readonly" } ],
  "actions": [ { "id": "connect", "label": "Reconnecter le compte" } ] }
```

`fields[].type` ∈ `text | secret | readonly | number | select | time-list | chips`. Pour `select`, `options: [{ value, label }]`. Seuls les services que l'administrateur propose aux foyers sont listés (les autres renvoient 400).

| Méthode | Route | Corps | Réponse |
|---|---|---|---|
| GET | `/api/integrations` | — | `Integration[]` (parmi `spotify`, `roblox`, `pathe`, `icloud`, `weather`) |
| PUT | `/api/integrations/:id` | `{ enabled?, config?: {...}, secrets?: { champ: "valeur" \| null } }` | `Integration` |
| POST | `/api/integrations/:id/test` | — | `{ ok, ms, message }` |
| POST | `/api/integrations/:id/refresh` | — | `{ ok: true }` |
| GET | `/api/integrations/:id/secret/:field` | — | `{ value }` (journalisé) |
| GET | `/api/integrations/spotify/connect` | — | redirection 302 vers Spotify (ou `/services?spotify=missing` si l'app du serveur n'est pas configurée) |
| GET | `/api/oauth/spotify/callback` | (Spotify) | redirection 302 vers `/services?spotify=connected` ou `?spotify=error` ; le paramètre `state` (usage unique, 10 min) relie le retour au foyer qui a lancé la connexion |
| POST | `/api/integrations/roblox/resolve` | `{ placeId }` | `{ universeId, name }` |
| GET | `/api/integrations/pathe/cinemas` | — | `[{ id, name, city }]` |
| GET | `/api/integrations/icloud/calendars` | — | `[{ id, name, color }]` |

## 7. Administration — `/api/admin` (rôle `admin`)

| Méthode | Route | Corps | Réponse |
|---|---|---|---|
| GET | `/api/admin/overview` | — | `{ users, disabledUsers, households, devices, devicesOnline, pendingInvites, services: [{ id, name, available, configured }], publicUrl, events }` (journal du serveur) |
| GET | `/api/admin/users` | — | `[{ id, login, name, role, disabled, totpEnabled, createdAt, lastLoginAt, household: { id, name }, devices, devicesOnline }]` |
| PATCH | `/api/admin/users/:id` | `{ disabled?, role? }` (pas sur son propre compte) | `{ ok: true }` — désactiver ferme les sessions |
| DELETE | `/api/admin/users/:id` | — | `{ ok: true }` — supprime le compte ; le foyer et ses écrans aussi s'il n'y reste personne |
| POST | `/api/admin/users/:id/reset-link` | — | `{ url, expiresAt }` (valable 2 jours) |
| GET | `/api/admin/invites` | — | `[{ id, note, createdAt, expiresAt, usedAt, usedBy, status: "pending" \| "used" \| "expired" }]` |
| POST | `/api/admin/invites` | `{ note?, days? }` (1 à 30, 7 par défaut) | `{ id, url, expiresAt }` — l'URL n'est donnée qu'une fois |
| DELETE | `/api/admin/invites/:id` | — | `{ ok: true }` (invitation non utilisée) |
| GET | `/api/admin/services` | — | `[{ id, name, description, help, available, configured, missing, fields, config, secrets }]` |
| PUT | `/api/admin/services/:id` | `{ available?, config?: { clientId }, secrets?: { clientSecret: "…" \| null } }` | le service mis à jour |
| GET | `/api/admin/services/:id/secret/:field` | — | `{ value }` (journalisé) |

`available: false` masque le service pour tous les foyers (console et écrans). Changer le Client ID de l'app Spotify oblige chaque foyer à reconnecter son compte.

---

## 8. Écrans — `/api/v1`

| Méthode | Route | Corps | Réponse |
|---|---|---|---|
| POST | `/api/v1/pair` | `{ code, name?, firmware? }` (sans jeton, 5 essais / 10 min) | `{ token }` |
| GET | `/api/v1/state?known=<stateHash>` | — | **DeviceState** (ci-dessous), ou `{ unchanged: true, serverTime, stateHash }` si l'état n'a pas changé depuis `known` |
| POST | `/api/v1/heartbeat` | `{ battery, charging, firmware, rssi, ip, screen, ackCommands: [id] }` | `{ ok: true }` |
| POST | `/api/v1/habits/:id/toggle` | `{ done }` | `tasks` (même forme que dans DeviceState) |
| PATCH | `/api/v1/alarms/:id` | `{ enabled }` (réveil de cet écran uniquement) | `Alarm` |
| PUT | `/api/v1/settings` | réglages d'affichage modifiés sur l'écran (mêmes champs que `PUT /api/devices/:id/settings`, partiels) | réglages complets de cet écran |
| POST | `/api/v1/music/:action` | action ∈ `play, pause, next, previous, volume, like` ; `{ value? }` | `music` |
| GET | `/api/v1/agenda?from=AAAA-MM-JJ&to=AAAA-MM-JJ` | — | `{ from, to, days: [{ date, events: [Event] }] }` (62 jours au plus, `to` exclu ; hors de la période en cache, iCloud est interrogé et le résultat gardé 10 min) |
| GET | `/api/v1/cinema/film/:id` | — | `{ id, title, genre, duration, rating, releaseDate, synopsis, directors, actors, trailerUrl, trailerIsPage, posterUrl }` (`trailerIsPage` : pas de lien direct, `trailerUrl` est la fiche pathe.fr) |
| POST | `/api/v1/cinema/notify/:filmId` | `{ notify }` | `{ ok: true }` |
| GET | `/api/v1/image?src=<url>&w=&h=` | — | `image/jpeg` baseline redimensionnée (hôtes autorisés uniquement) |
| POST | `/api/v1/screenshot` | corps binaire RGB565 little-endian, en-têtes `X-Width`, `X-Height` | `{ ok: true }` |

**DeviceState** (`GET /api/v1/state`) — chaque bloc vaut `null` si l'intégration est désactivée ou n'a jamais réussi :

```json
{
  "serverTime": 1792222920, "tz": "Europe/Paris", "tzPosix": "CET-1CEST,M3.5.0,M10.5.0/3",
  "device": { "id": 1, "name": "Chambre" },
  "settings": { "...": "réglages de cet écran (comme DeviceInfo.settings)", "pinSalt": "hex", "pinHash": "hex sha256(salt + pin)" },
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

`alarms`, `nextAlarm`, `routine`, `layout`, `settings` et `commands` sont ceux de l'écran qui fait la requête ; le reste est commun au foyer.

`stateHash` : empreinte de l'état (sans `serverTime` ni l'avancement du morceau). L'écran la renvoie dans `?known=` : tant que rien ne change, la réponse est courte et l'écran ne redessine rien.

`agenda.week` : aujourd'hui puis les 6 jours suivants (`date` de chaque jour fournie) ; un événement sur plusieurs jours apparaît dans chacun d'eux (`start` à `00:00`, `end` à `24:00` aux jours intermédiaires).

Textes : les polices de l'écran contiennent l'alphabet latin et une sélection d'emojis (liste dans `server/src/deviceText.ts`). Le serveur retire le reste avant l'envoi (drapeaux, tons de peau, emojis composés réduits au premier, autres alphabets).

Les URL d'images commençant par `/` sont relatives à l'adresse du serveur.
