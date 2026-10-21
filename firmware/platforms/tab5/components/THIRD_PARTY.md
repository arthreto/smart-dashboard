# Composants tiers inclus

Ces composants viennent de la démo officielle de M5Stack pour le Tab5 :
https://github.com/m5stack/M5Tab5-UserDemo (commit `b4e356bc491ca070d54004718dad789c07d5fc93`,
dossier `platforms/tab5/components`). Ils sont copiés ici pour que le projet se
compile sans étape supplémentaire.

| Dossier | Origine | Licence | Modifications |
|---|---|---|---|
| `m5stack_tab5/` | BSP Espressif adaptée par M5Stack (écrans ILI9881C, ST7123, ST7121, codec ES8388/ES7210, extenseurs d'E/S, alimentation) | Apache-2.0 (`m5stack_tab5/LICENSE`) | `idf_component.yml` : ajout de `esp_lcd_ili9881c` (déclaré dans le projet d'origine), versions fixées sur celles de la démo ; `CMakeLists.txt` : `esp_lcd_touch_gt911` ajouté aux `REQUIRES` ; `m5stack_tab5.c` : compatibilité avec les noms `ES7210_SEL_MIC*` d'`esp_codec_dev` ≥ 1.4 |
| `esp_lcd_st7121/` | Pilote d'écran ST7121 (Espressif) | Apache-2.0 | `CMakeLists.txt` : suppression de `cu_pkg_define_version` (outil interne absent) |
| `esp_video/` | `esp_video` 0.7.0 (Espressif) : caméra MIPI-CSI, ISP et encodeur H.264 matériel en périphériques V4L2 | Apache-2.0 | dossiers `examples` et `test_apps` retirés |
| `esp_cam_sensor/` | `esp_cam_sensor` 0.7.1 (Espressif) : pilotes de capteurs, dont le SC202CS/SC2356 de la Tab5 | Apache-2.0 | `test_apps` retiré |
| `esp_ipa/` | `esp_ipa` 0.1.0 (Espressif) : réglages automatiques de l'image (balance des blancs, exposition…) | Apache-2.0 (bibliothèque précompilée) | `test_apps` retiré |
| `esp_sccb_intf/` | `esp_sccb_intf` 0.0.4 (Espressif) : bus de configuration des capteurs | Apache-2.0 | `test_apps` retiré |
| `esp_lvgl_port/` | `esp_lvgl_port` 2.5.0 (Espressif) modifié par M5Stack pour la rotation logicielle de l'écran avec LVGL 9 (dossier `espressif__esp_lvgl_port` d'origine) | Apache-2.0 (`license.txt`) | dossiers `examples`, `test_apps` et `docs` retirés |

Le reste (LVGL, ESP-Hosted, esp_wifi_remote, pilotes d'écran et tactiles, codec,
encodeurs H.264 `esp_h264` 1.0.4 et AAC `esp_audio_codec` 2.5.0)
est téléchargé automatiquement par `idf.py` depuis le registre de composants
Espressif, aux versions fixées dans `main/idf_component.yml` et dans les
`idf_component.yml` de ces composants.
