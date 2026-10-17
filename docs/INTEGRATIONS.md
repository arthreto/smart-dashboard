# Brancher les services

Tout se règle dans la console web, page **Intégrations**. Chaque carte indique ce
qui manque, un bouton **Tester** et l'état de la dernière mise à jour. Les secrets
(Client Secret, mot de passe iCloud…) sont chiffrés sur le serveur et ne sont
jamais envoyés à la tablette.

## Météo (Open-Meteo)

Aucune clé nécessaire. Indique un nom (« Domicile ») et les coordonnées de ton
logement (clic droit sur Google Maps → les deux nombres affichés, par exemple
`48.8566` et `2.3522`).

## Spotify — lecture en cours et commandes

1. Va sur <https://developer.spotify.com/dashboard> et connecte-toi avec ton compte
   Spotify (**Premium obligatoire** : depuis février 2026, le propriétaire d'une app
   en « Development Mode » doit avoir un abonnement Premium, et les commandes de
   lecture l'exigent aussi).
2. **Create app** :
   - *App name* : `Smart Dashboard` (au choix), *App description* : au choix ;
   - *Redirect URI* : copie celle affichée dans la console, carte Spotify, champ
     « URI de redirection » — de la forme
     `https://dashboard.mon-domaine.fr/api/oauth/spotify/callback` ;
   - *Which API/SDKs are you planning to use?* : coche **Web API** ;
   - accepte les conditions puis **Save**.
3. Dans **Settings** de l'app : copie le **Client ID**, puis **View client secret**
   et copie le **Client Secret**. Colle-les dans la console et enregistre.
4. Clique **Connecter le compte Spotify**, accepte les autorisations : tu reviens
   sur la console avec le compte affiché.

Bon à savoir :

- En Development Mode, une app est limitée à 5 utilisateurs : c'est largement
  suffisant puisque seul ton compte s'y connecte.
- Les commandes agissent sur l'appareil Spotify actif (téléphone, ordinateur,
  enceinte connectée). Si rien ne joue, lance d'abord une lecture quelque part.

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

## La tablette (ou l'émulateur)

Page **Appareil & réveils** → **Associer une tablette** : la console affiche
l'adresse du serveur et un code à 6 chiffres valable 10 minutes. Sur l'écran,
l'assistant demande le Wi-Fi (tablette uniquement), l'adresse du serveur, puis le
code. Le jeton obtenu peut être révoqué à tout moment (« Régénérer le jeton » ou
« Désappairer »).
