# Console web — Smart Dashboard

Console de gestion (React + Vite + TypeScript) servie par le serveur Node.js du projet.
Toute l’interface parle à l’API décrite dans `../docs/API.md` (routes `/api/...`, cookie de session).

## Développement

```bash
npm install
npm run dev        # http://localhost:5173 — /api est relayé vers http://localhost:8787
```

Lance le serveur (`../server`) sur le port 8787 en parallèle.

## Production

```bash
npm run build      # vérifie les types puis génère web/dist
npm run typecheck  # vérification TypeScript seule
```

Le serveur sert `web/dist` et renvoie `index.html` pour toute route qui ne commence pas par `/api`
(routage côté navigateur : `/`, `/habitudes`, `/integrations`, `/appareil`).

## Organisation

- `src/api.ts` : client `fetch` (cookie, en-tête anti-CSRF `X-Requested-With`, erreurs en français)
- `src/types.ts` : types calqués sur le contrat d’API
- `src/pages/` : une page par entrée du menu (`device/` regroupe les cartes de la page Appareil)
- `src/components/` : mise en page, modales, notifications, champs génériques des intégrations
- `src/styles/` : jetons de design (`tokens.css`) et classes réutilisables

Les polices (Figtree, JetBrains Mono) sont embarquées via `@fontsource` : aucun CDN à l’exécution.
