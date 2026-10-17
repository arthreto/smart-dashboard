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

Limites actuelles :

- **iPhone (notifications, appels)** : la page affiche « Bientôt disponible ».
  Le Bluetooth est porté par l'ESP32-C6 ; la liaison ANCS avec l'iPhone viendra
  dans une version suivante.
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

(Le projet a été compilé avec ESP-IDF 5.4.2 pour l'ESP32-P4 : environ 2,5 Mo, la
partition de 12 Mo en laisse 80 % de libre. Il n'a pas encore pu être essayé sur une
vraie tablette.)

La première compilation télécharge les composants (LVGL, ESP-Hosted, pilotes
d'écran et du codec…) depuis le registre d'Espressif et prend une dizaine de
minutes. `set-target` n'est à refaire que si tu supprimes le dossier `build`.

## 3. Flasher

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
3. **Code** : dans la console, Appareil & réveils → **Associer une tablette**,
   puis saisis le code à 6 chiffres.

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
