/**
 * Configuration LVGL pour l'émulateur PC (les valeurs absentes gardent leur défaut).
 * Sur la tablette, la configuration équivalente est dans platforms/tab5/sdkconfig.defaults.
 */
#ifndef LV_CONF_H
#define LV_CONF_H

#define LV_COLOR_DEPTH 16

#define LV_USE_STDLIB_MALLOC LV_STDLIB_CLIB
#define LV_USE_STDLIB_STRING LV_STDLIB_CLIB
#define LV_USE_STDLIB_SPRINTF LV_STDLIB_CLIB

#define LV_USE_OS LV_OS_NONE
#define LV_DEF_REFR_PERIOD 16
#define LV_DPI_DEF 300

#define LV_DRAW_SW_COMPLEX 1
#define LV_DRAW_BUF_ALIGN 4

#define LV_USE_LOG 1
#define LV_LOG_LEVEL LV_LOG_LEVEL_WARN
#define LV_LOG_PRINTF 1

#define LV_FONT_MONTSERRAT_14 1
#define LV_FONT_MONTSERRAT_20 1  /* symboles du clavier (repli de fig_s18) */
#define LV_FONT_DEFAULT &lv_font_montserrat_14

#define LV_USE_TJPGD 1
#define LV_USE_SNAPSHOT 1

/* Pilote SDL (fenêtre + souris + clavier) */
#define LV_USE_SDL 1
#define LV_SDL_INCLUDE_PATH <SDL2/SDL.h>
#define LV_SDL_RENDER_MODE LV_DISPLAY_RENDER_MODE_DIRECT
#define LV_SDL_BUF_COUNT 1
#define LV_SDL_ACCELERATED 1
#define LV_SDL_FULLSCREEN 0
#define LV_SDL_DIRECT_EXIT 1
#define LV_SDL_MOUSEWHEEL_MODE LV_SDL_MOUSEWHEEL_MODE_ENCODER

#endif /* LV_CONF_H */
