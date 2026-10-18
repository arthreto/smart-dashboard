# Brancher les services

Deux niveaux :

- **L'administrateur** (toi) choisit, une fois pour tout le serveur, les services
  proposés aux foyers et renseigne les clés d'application communes : page
  **Administration › Clés API & services**. Aujourd'hui, seul Spotify en a besoin
  (une « app » Spotify pour tout le serveur).
- **Chaque foyer** connecte ses propres comptes et choisit ses réglages dans sa page
  **Services** : son compte Spotify, son identifiant iCloud, son cinéma, son jeu
  Roblox, sa ville. Ces réglages sont partagés par tous les écrans du foyer et
  invisibles pour les autres foyers (et pour l'administrateur).

Chaque carte indique ce qui manque, un bouton **Tester** et l'état de la dernière
mise à jour. Les secrets (Client Secret, mot de passe iCloud…) sont chiffrés sur le
serveur et ne sont jamais envoyés aux écrans.

## Météo (Open-Meteo)

Aucune clé nécessaire. Indique un nom (« Domicile ») et les coordonnées de ton
logement (clic droit sur Google Maps → les deux nombres affichés, par exemple
`48.8566` et `2.3522`).

## Spotify — lecture en cours et commandes

### Une fois, par l'administrateur : l'app Spotify du serveur

1. Va sur <https://developer.spotify.com/dashboard> et connecte-toi avec ton compte
   Spotify (**Premium obligatoire** : depuis février 2026, le propriétaire d'une app
   en « Development Mode » doit avoir un abonnement Premium).
2. **Create app** :
   - *App name* : `Smart Dashboard` (au choix), *App description* : au choix ;
   - *Redirect URI* : copie celle affichée dans la console, **Administration › Clés
     API & services**, carte Spotify, champ « URI de redirection » — de la forme
     `https://dashboard.mon-domaine.fr/api/oauth/spotify/callback` ;
   - *Which API/SDKs are you planning to use?* : coche **Web API** ;
   - accepte les conditions puis **Save**.
3. Dans **Settings** de l'app : copie le **Client ID**, puis **View client secret**
   et copie le **Client Secret**. Colle-les dans la carte Spotify et enregistre.
4. **Settings › User Management** : ajoute le nom et l'e-mail du compte Spotify de
   **chaque personne** qui connectera son compte (toi compris). En Development Mode,
   Spotify refuse les comptes qui ne sont pas dans cette liste, et la limite est de
   **5 comptes** par app.

### Dans chaque foyer : connecter son compte

Page **Services** › carte Spotify › **Connecter mon compte Spotify**, accepte les
autorisations : tu reviens sur la console avec le compte affiché. Chaque foyer
connecte le sien ; tous les écrans du foyer affichent et pilotent ce compte.

Bon à savoir :

- Si la connexion échoue avec un compte d'un autre foyer, c'est presque toujours
  qu'il n'a pas été ajouté dans *User Management* (étape 4).
- Changer de Client ID (nouvelle app) déconnecte les comptes de tous les foyers :
  chacun devra cliquer de nouveau sur « Connecter mon compte Spotify ».
- Les commandes agissent sur l'appareil Spotify actif (téléphone, ordinateur,
  enceinte connectée). Si rien ne joue, lance d'abord une lecture quelque part ;
  les commandes de lecture demandent un compte Premium.

## Roblox — joueurs connectés à ton jeu

Aucune clé : le serveur lit les compteurs publics de Roblox.

- Il faut l'**Universe ID** (ID de l'expérience), différent de l'ID de la place
  qui apparaît dans l'adresse `roblox.com/games/<ID de la place>/…`.
- Le plus simple : colle l'ID de la place et clique **J'ai seulement l'ID de la
  place** ; la console trouve l'Universe ID toute seule. (Tu peux aussi le copier
  depuis le Creator Hub : *Creations* → ton expérience → menu ⋯ → *Copy Universe ID*.)
- Choisis la fréquence de mise à jour (30 s, 1 min ou 5 min) et la durée
  d'historique conservée pour les statistiques.

## Pathé — films et séances près de chez toi

1. Choisis ton cinéma dans la liste (chargée depuis pathe.fr).
2. Indique à quelles heures récupérer le programme (par défaut 07:30 et 13:30).
3. Sur la tablette, l'écran Cinéma affiche les films à l'affiche avec leurs
   affiches et les séances des 4 prochains jours, et les prochaines sorties : la
   cloche 🔔 demande une alerte le jour de la sortie.

> Pathé n'a pas d'API publique officielle : le serveur utilise les mêmes données
> que le site pathe.fr. Si Pathé les modifie ou les bloque, la carte passe en
> erreur dans la console (le reste du tableau de bord continue de fonctionner) et
> il faudra adapter `server/src/integrations/pathe.ts`.

## Calendrier iCloud

Apple ne propose pas d'API : on passe par CalDAV avec un **mot de passe pour app**
(ton vrai mot de passe Apple n'est jamais utilisé).

1. Va sur <https://account.apple.com> → **Connexion et sécurité** → **Mots de
   passe pour app** → **+**, nomme-le « Smart Dashboard ». Copie le mot de passe
   généré (format `abcd-efgh-ijkl-mnop`).
2. Dans la console : ton **identifiant Apple** (adresse e-mail) et ce mot de passe.
3. Clique **Choisir les calendriers** et coche ceux à afficher.

Les rappels de tes événements (alarme « 15 min avant »…) sont repris sur la
tablette, et les événements de priorité haute sont marqués « Important ».

## Les écrans (tablettes ou émulateur)

Page **Mes écrans** → **Ajouter un écran** : la console affiche l'adresse du serveur
et un code à 6 chiffres valable 10 minutes. Sur l'écran, l'assistant demande le
Wi-Fi (tablette uniquement), l'adresse du serveur, puis le code. Tu peux associer
autant d'écrans que tu veux à ton foyer : ils partagent les tâches, l'agenda, la
musique et les services, et chacun garde ses réveils, sa disposition et ses
réglages d'affichage (page de l'écran, en cliquant dessus).

Depuis la page d'un écran : **Ré-associer** (nouveau code, l'ancien jeton cesse de
fonctionner, l'écran garde ses réglages) ou **Retirer cet écran**.
