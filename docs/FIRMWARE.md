# Firmware de la M5Stack Tab5

Le firmware se trouve dans `firmware/platforms/tab5` (projet **ESP-IDF**). Il
compile la même interface que l'émulateur (`firmware/app`) avec une couche
matérielle propre à la tablette (`main/hal_tab5.cpp`).

## Ce que fait le firmware

| Fonction | Matériel / composant |
|---|---|
| Écran 5″ 720×1280 utilisé en paysage 1280×720, tactile | BSP M5Stack (`components/m5stack_tab5`), LVGL 9.2, `esp_lvgl_port` adapté par M5Stack |
| Wi-Fi (assistant de connexion à l'écran) | ESP32-C6 de la tablette via ESP-Hosted (`esp_hosted` 1.4.0 + `esp_wifi_remote` 0.8.5) |
| HTTPS vers ton serveur | `esp_http_client` + certificats racine intégrés (Let's Encrypt inclus) |
| Réglages, jeton, Wi-Fi, dernier état reçu | NVS (flash interne) — l'état est écrit au plus toutes les 15 min pour ménager la flash |
| Heure | SNTP (`pool.ntp.org`), sauvegardée dans l'horloge RX8130 |
| Batterie | INA226 (tension de la batterie 2 cellules), USB-C détecté = en charge |
| Son des alarmes et clics | codec ES8388 + haut-parleur, sonneries synthétisées (même son que l'émulateur) |
| Veille profonde | extinction complète ; l'horloge RX8130 rallume la tablette 2 min avant l'alarme suivante (et avant la routine de pré-éclairage) |
| Galerie : vidéo + son, chiffrés sur la tablette puis envoyés au serveur | caméra SC2356 (MIPI-CSI 1280×720, 30 i/s) et encodeur H.264 matériel (`esp_video`), micros ES7210 en AAC (`esp_audio_codec`), AES-256-GCM et RSA-OAEP (mbedTLS) |
| iPhone : notifications, appels entrants (accepter / refuser) | Bluetooth basse consommation de l'ESP32-C6 (même firmware ESP-Hosted que le Wi-Fi), pile NimBLE sur le P4, service Apple ANCS |

Limites actuelles :

- **iPhone** : la tablette reçoit les notifications et les appels, et peut accepter,
  refuser ou effacer. La conversation elle-même reste sur l'iPhone (le Tab5 n'a ni
  micro ni haut-parleur « mains libres » reliés au Bluetooth classique, que l'ESP32-C6
  ne gère pas). Pas de réponse aux messages : iOS ne le permet pas aux accessoires.
- **Sur secteur (USB branché)**, la tablette ne peut pas se couper : à la place de
  la veille profonde, elle reste allumée écran éteint (l'alarme sonne normalement,
  un toucher rallume l'écran).
- Le bouton physique sert à allumer la tablette (et à la rallumer après une veille
  profonde) ; l'écran s'éteint après le délai réglé et se rallume au toucher.

## 1. Installer ESP-IDF 5.4.2 (une seule fois)

M5Stack recommande **ESP-IDF v5.4.2** pour la Tab5. Sous Windows, le plus simple
est l'installateur officiel d'Espressif :

1. Télécharge l'installateur Windows d'ESP-IDF depuis
   <https://dl.espressif.com/dl/esp-idf/> et choisis la version **v5.4.2**.
   (Guide détaillé : <https://docs.espressif.com/projects/esp-idf/en/v5.4.2/esp32p4/get-started/windows-setup.html>.)
2. À la fin, il crée un raccourci **« ESP-IDF 5.4 PowerShell »** : c'est dans ce
   terminal que tu tapes les commandes ci-dessous.

Sous Linux ou macOS :

```bash
git clone -b v5.4.2 --recursive https://github.com/espressif/esp-idf.git ~/esp/esp-idf
~/esp/esp-idf/install.sh esp32p4
. ~/esp/esp-idf/export.sh
```

## 2. Compiler

```powershell
cd C:\Users\super\source\smart-dashboard\firmware\platforms\tab5
idf.py set-target esp32p4
idf.py build
```

(Le projet a été compilé avec ESP-IDF 5.4.2 pour l'ESP32-P4 : environ 3,7 Mo, la
partition de 12 Mo en laisse 70 % de libre.)

La première compilation télécharge les composants (LVGL, ESP-Hosted, pilotes
d'écran et du codec…) depuis le registre d'Espressif et prend une dizaine de
minutes. `set-target` n'est à refaire que si tu supprimes le dossier `build`.

## 3. Flasher

### Sans rien installer (navigateur Chrome ou Edge)

Un seul fichier contient tout (chargeur, table des partitions, application) : on l'écrit à
l'adresse `0x0` avec [esptool-js](https://espressif.github.io/esptool-js/).

1. Branche la Tab5 en USB-C (câble de données) et mets-la en mode téléchargement :
   bouton appuyé jusqu'à ce que la LED verte clignote vite.
2. Sur la page, **Connect**, choisis le port (« USB JTAG/serial debug unit »).
3. Adresse **0x0**, fichier `smart-dashboard-tab5.bin`, puis **Program**.
4. À la fin, débranche/rebranche et fais un appui bref sur le bouton.

Pour produire ce fichier après une compilation :

```bash
cd build
esptool.py --chip esp32p4 merge_bin -o smart-dashboard-tab5.bin --flash_mode dio --flash_size 16MB --flash_freq 80m \
  0x2000 bootloader/bootloader.bin 0x8000 partition_table/partition-table.bin 0x50000 smart_dashboard.bin
```

La partie **Console** de la même page (115200 bauds, puis appui bref sur le bouton) affiche les
messages de démarrage, utiles en cas d'écran noir.

### Avec ESP-IDF

1. Branche la Tab5 en USB-C.
2. Trouve son port : Gestionnaire de périphériques → « Ports (COM et LPT) »
   (par exemple `COM5`).
3. Lance :

   ```powershell
   idf.py -p COM5 flash monitor
   ```

   `monitor` affiche les messages de la tablette (quitter : `Ctrl+]`).

Si le flash n'arrive pas à se connecter : **maintiens le bouton Reset jusqu'à ce
que la LED verte clignote rapidement**, relâche (mode téléchargement), puis
relance la commande. Après le flash, appuie une fois sur Reset pour redémarrer.

## 4. Premier démarrage

L'assistant s'affiche à l'écran :

1. **Wi-Fi** : choisis ton réseau et saisis le mot de passe (clavier à l'écran).
2. **Serveur** : l'adresse de ta console, par exemple `https://dashboard.mon-domaine.fr`.
3. **Code** : dans la console, **Mes écrans → Ajouter un écran**, puis saisis le
   code à 6 chiffres. Chaque tablette associée devient un écran de ton foyer.

Tu peux aussi appuyer sur « Essayer le mode démo » pour voir l'interface sans serveur.
Pour recommencer l'appairage : Réglages → Connexion → « Associer à nouveau ».

## Réglages avancés

- `idf.py menuconfig` → *Component config* → *Board Support Package (ESP32-P4)*
  pour le mode de rafraîchissement de l'écran, et → *LVGL configuration* pour LVGL.
- La version affichée par la tablette et la console vient de `PROJECT_VER` dans
  `firmware/platforms/tab5/CMakeLists.txt`.
- Fuseau horaire : envoyé par le serveur (`TZ_POSIX` dans `server/.env`) ;
  la tablette le garde en mémoire pour démarrer à la bonne heure hors ligne.

## Dépannage

- **Écran noir après le flash** : regarde le moniteur série (`idf.py -p COM5 monitor`).
  La BSP détecte seule le modèle d'écran (ILI9881C, ou ST7123 sur les Tab5
  récentes).
- **Le Wi-Fi ne démarre pas** (message `Wi-Fi indisponible` au démarrage) : le
  firmware ESP-Hosted de l'ESP32-C6 doit correspondre à la version 1.4 utilisée
  ici (celle de la démo M5Stack d'origine). M5Stack fournit ce firmware dans
  <https://github.com/m5stack/M5Tab5-UserDemo> (`platforms/tab5/wifi_c6_fw`).
- **Heure fausse** : elle se corrige dès la connexion Wi-Fi (SNTP), et sinon avec
  l'heure du serveur à la première synchronisation.
- **Repartir de zéro** (efface Wi-Fi, appairage et cache) : `idf.py -p COM5 erase-flash flash`.

## Composants inclus

Voir `firmware/platforms/tab5/components/THIRD_PARTY.md` : la BSP du Tab5 et la
version d'`esp_lvgl_port` adaptée par M5Stack sont copiées depuis la démo
officielle **M5Tab5-UserDemo** (licence Apache-2.0), pour que le projet se
compile sans étape supplémentaire.


## Galerie (enregistrements vidéo)

Dans la console, l'onglet **Galerie** lance et arrête un enregistrement de la caméra de la
tablette. Pendant l'enregistrement, la tablette affiche en haut de l'écran une pastille
**« ● REC 00:42 »** avec un bouton **Arrêter** ; personne ne peut être filmé sans le voir.

- La vidéo (1280×720, 30 images/s, environ 2 Mb/s, son AAC) est chiffrée sur la tablette
  avant l'envoi, par morceaux de 3 secondes. Le serveur ne reçoit que des données illisibles.
- Si le Wi-Fi coupe, la tablette garde la vidéo en mémoire (12 Mo, soit environ 45 secondes) et
  envoie le retard dès que la connexion revient.
- Un enregistrement dure 1 heure au plus. La veille profonde est suspendue pendant ce temps.
- Les messages de la caméra sont visibles dans le moniteur série (préfixes `camera` et
  `[galerie]`).

## Associer ton iPhone

Le Bluetooth du Tab5 est fourni par la puce **ESP32-C6**, comme le Wi-Fi : son
firmware d'usine (ESP-Hosted) contient le contrôleur Bluetooth basse consommation.
Rien à flasher de plus. L'iPhone partage ses notifications grâce au service Apple
**ANCS**, prévu exactement pour les montres et accessoires.

1. Sur la tablette : page **iPhone** › **Associer un iPhone**. La tablette devient
   visible pendant 2 minutes.
2. Sur l'iPhone : **Réglages › Bluetooth**, touche **Smart Dashboard** (rubrique
   « Autres appareils »).
3. L'iPhone demande un code : tape le **code à 6 chiffres affiché sur la tablette**.
4. L'iPhone demande ensuite s'il peut partager ses notifications avec
   « Smart Dashboard » : choisis **Autoriser**.

C'est tout : l'iPhone se reconnecte tout seul dès qu'il est à portée (une dizaine
de mètres). Les notifications arrivent en bandeau en haut de l'écran, et un appel
entrant ouvre l'écran d'appel avec **Refuser** / **Accepter**.

Réglages sur la page iPhone :

| Tuile | Effet |
|---|---|
| Bluetooth | coupe complètement la liaison (mémorisé) |
| Ne pas déranger | plus de bandeau ni de sonnerie ; s'active aussi tout seul pendant le mode nuit |
| Bandeaux | afficher ou non les bandeaux de notification |
| Sonnerie appels | faire sonner la tablette pendant un appel entrant |

En cas de souci :

- **Les notifications n'arrivent pas** : sur l'iPhone, Réglages › Bluetooth ›
  Smart Dashboard › ⓘ › active **« Partager les notifications système »**. Une app
  dont les notifications sont coupées dans Réglages › Notifications n'envoie rien
  à la tablette non plus.
- **« L'iPhone ne reconnaît plus la tablette »** : sur l'iPhone, Réglages ›
  Bluetooth › Smart Dashboard › ⓘ › **Oublier cet appareil**, puis recommence
  l'association. Sur la tablette, **Oublier l'iPhone** fait l'inverse.
- Les messages de la pile Bluetooth sont visibles dans `idf.py monitor` (préfixe
  `iphone`).

Un seul iPhone est associé à la fois : en associer un nouveau oublie l'ancien.
Pendant une veille profonde (sur batterie), la tablette est réellement éteinte : ni
bandeau ni sonnerie d'appel. Au réveil, l'iPhone se reconnecte et la liste des
notifications se remet à jour.
