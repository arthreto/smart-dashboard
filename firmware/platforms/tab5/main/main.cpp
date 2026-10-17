// Point d'entrée du firmware M5Stack Tab5.
#include <bsp/m5stack_tab5.h>
#include <esp_log.h>

#include "app.h"
#include "hal_tab5.h"

extern "C" void app_main(void) {
    static Tab5Hal platform;
    platform.begin();
    hal::install(&platform);

    lv_display_t* disp = platform.startDisplay();
    if (!disp) return;

    // L'interface (firmware/app) tourne ensuite dans la tâche LVGL de esp_lvgl_port :
    // App::init() crée ses minuteurs LVGL, on la lance donc sous le verrou de l'écran.
    bsp_display_lock(0);
    App::get().init();
    bsp_display_unlock();
    ESP_LOGI("main", "Smart Dashboard %s démarré", platform.firmwareVersion().c_str());
}
