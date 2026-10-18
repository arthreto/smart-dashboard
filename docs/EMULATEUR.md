# Essayer l'écran sur ton PC (émulateur)

L'émulateur affiche **exactement la même interface** que la Tab5 (même code
LVGL, fenêtre 1280×720), avec la souris à la place du doigt. Il peut tourner avec
des données d'exemple ou se connecter à ton vrai serveur, comme la tablette.

## Sous Windows : avec WSL2 (Ubuntu)

WSL2 fait tourner Linux dans Windows et affiche directement ses fenêtres
(Windows 11, ou Windows 10 à jour).

### 1. Installer WSL2 (une seule fois)

Ouvre **PowerShell en administrateur** (clic droit sur le menu Démarrer →
Terminal (administrateur)) et tape :

```powershell
wsl --install
```

Redémarre le PC quand c'est demandé. Au redémarrage, la fenêtre « Ubuntu »
s'ouvre et te demande de choisir un nom d'utilisateur et un mot de passe Linux.
(Si WSL était déjà installé : `wsl --update`.)

### 2. Lancer l'émulateur

Dans **Ubuntu** (menu Démarrer → Ubuntu), tape :

```bash
cd /mnt/c/Users/super/source/smart-dashboard
bash firmware/tools/emulateur.sh --demo
```

La première fois, le script installe les outils (il demande ton mot de passe
Linux), télécharge LVGL et compile : quelques minutes. Ensuite, il démarre en
quelques secondes.

## Sous Linux (Debian/Ubuntu)

```bash
bash firmware/tools/emulateur.sh --demo
```

## Utilisation

| Commande | Effet |
|---|---|
| `emulateur.sh --demo` | données d'exemple, sans serveur (pour cette fois seulement : le lancement suivant sans `--demo` revient à l'assistant ou au serveur associé) |
| `emulateur.sh` | assistant d'installation, comme sur la tablette : adresse de ton serveur + code affiché par la console (Mes écrans › Ajouter un écran) |
| `emulateur.sh --server https://dashboard.mon-domaine.fr --token sdb_…` | appairage direct avec un jeton existant |
| `emulateur.sh --reset` | oublie l'appairage (revient à l'assistant) |
| `emulateur.sh --mute` | sans son |
| `emulateur.sh --screenshots dossier` | enregistre une capture de chaque écran puis quitte |

Raccourcis clavier dans la fenêtre :

| Touche | Action |
|---|---|
| **B** | bouton du boîtier (éteindre/rallumer l'écran, couper une alarme) |
| **R** | faire sonner une alarme de test |
| **L** | verrouiller (code PIN de démonstration : **1234**) |
| **N** | simuler une notification de l'iPhone (bandeau en haut de l'écran) |
| **P** | simuler un appel entrant sur l'iPhone |
| **S** | capture d'écran (`capture-N.ppm` dans le dossier courant) |
| **Échap** | fermer les superpositions (verrouillage, alarme, assistant) |

L'émulateur garde ses réglages dans `~/.smart-dashboard-sim` (côté Linux), ou dans le
dossier indiqué par la variable `SD_SIM_DIR`.

## Différences avec la tablette

- Pas de Wi-Fi à configurer : le PC est déjà connecté.
- Chaque émulateur associé compte comme un écran de ton foyer (pratique pour essayer
  plusieurs écrans : lance un second émulateur avec son propre dossier de réglages,
  `SD_SIM_DIR=~/.smart-dashboard-sim-2 bash firmware/tools/emulateur.sh`, puis
  associe-le avec un nouveau code).
- La veille profonde est simulée (un message indique l'heure de réveil prévue).
- L'iPhone est simulé : **Associer un iPhone** affiche un code au bout de 3 s et
  l'association réussit seule 9 s plus tard. Les notifications et les appels sont
  des exemples (touches **N** et **P**). Sur la tablette, c'est le vrai iPhone, en
  Bluetooth (voir [FIRMWARE.md](FIRMWARE.md#associer-ton-iphone)).
- Batterie fictive (78 %).

## Problèmes fréquents

- **« cannot open display » / aucune fenêtre** : mets WSL à jour (`wsl --update`
  dans PowerShell) puis redémarre-le (`wsl --shutdown`).
- **Pas de son** : normal sur certains PC sous WSL ; lance avec `--mute`.
- **« Serveur injoignable » à l'appairage** : vérifie l'adresse (avec `https://`)
  et que la console s'ouvre bien dans ton navigateur.
- **Recompiler de zéro** : `rm -rf ~/.cache/smart-dashboard-sim-build`.
