// Thème (couleurs des maquettes), polices et petits composants réutilisables.
#pragma once

#include <functional>
#include <string>
#include <vector>

#include "icons.h"
#include "lvgl.h"

LV_FONT_DECLARE(fig_m14)
LV_FONT_DECLARE(fig_m16)
LV_FONT_DECLARE(fig_m18)
LV_FONT_DECLARE(fig_s14)
LV_FONT_DECLARE(fig_s16)
LV_FONT_DECLARE(fig_s18)
LV_FONT_DECLARE(fig_s20)
LV_FONT_DECLARE(fig_s22)
LV_FONT_DECLARE(fig_b24)
LV_FONT_DECLARE(fig_b32)
LV_FONT_DECLARE(fig_b44)
LV_FONT_DECLARE(fig_l54)
LV_FONT_DECLARE(fig_l72)
LV_FONT_DECLARE(fig_l96)
LV_FONT_DECLARE(fig_l124)
LV_FONT_DECLARE(fig_l176)
LV_FONT_DECLARE(fig_bd54)
LV_FONT_DECLARE(icons_16)
LV_FONT_DECLARE(icons_20)
LV_FONT_DECLARE(icons_24)
LV_FONT_DECLARE(icons_28)
LV_FONT_DECLARE(icons_40)

namespace ui {

constexpr int SCREEN_W = 1280;
constexpr int SCREEN_H = 720;
constexpr int RAIL_W = 104;

struct Theme {
    bool dark = true;
    lv_color_t bg, rail, card, card2, chip, text, text2, text3, track, hairline, ring;
};

const Theme& th();
void setDarkTheme(bool dark);

// Couleurs d'accent (identiques en clair et en sombre).
namespace color {
inline lv_color_t blue() { return lv_color_hex(0x0A84FF); }
inline lv_color_t green() { return lv_color_hex(0x30D158); }
inline lv_color_t orange() { return lv_color_hex(0xFF9F0A); }
inline lv_color_t red() { return lv_color_hex(0xFF453A); }
inline lv_color_t purple() { return lv_color_hex(0xBF5AF2); }
inline lv_color_t indigo() { return lv_color_hex(0x5E5CE6); }
inline lv_color_t pink() { return lv_color_hex(0xFF2D55); }
inline lv_color_t teal() { return lv_color_hex(0x00A699); }
inline lv_color_t gray() { return lv_color_hex(0x48484F); }
inline lv_color_t yellow() { return lv_color_hex(0xFFD60A); }
inline lv_color_t white() { return lv_color_hex(0xFFFFFF); }
inline lv_color_t black() { return lv_color_hex(0x000000); }
}  // namespace color

lv_color_t hex(const std::string& css, lv_color_t fallback = lv_color_hex(0x0A84FF));

// --- Création d'objets « nus » (sans le thème par défaut de LVGL) ---
lv_obj_t* box(lv_obj_t* parent);
lv_obj_t* row(lv_obj_t* parent, int gap = 0);
lv_obj_t* col(lv_obj_t* parent, int gap = 0);
lv_obj_t* card(lv_obj_t* parent, int radius = 26, int pad = 22);
lv_obj_t* spacer(lv_obj_t* parent);  // prend la place restante (flex-grow)
lv_obj_t* label(lv_obj_t* parent, const std::string& text, const lv_font_t* font, lv_color_t color);
/** Limite la largeur d'un libellé d'une ligne à `maxW` (points de suspension au-delà). */
void fitLabel(lv_obj_t* label, int maxW);
lv_obj_t* icon(lv_obj_t* parent, const char* glyph, const lv_font_t* font, lv_color_t color);
lv_obj_t* iconTile(lv_obj_t* parent, const char* glyph, lv_color_t bg, int size, const lv_font_t* font, int radius = -1);
lv_obj_t* pill(lv_obj_t* parent, const std::string& text, lv_color_t bg, lv_color_t fg, const lv_font_t* font = &fig_s14, int h = 32);
lv_obj_t* dot(lv_obj_t* parent, int size, lv_color_t color);
lv_obj_t* progressBar(lv_obj_t* parent, int w, int h, int percent, lv_color_t fill, lv_color_t track);
lv_obj_t* hairline(lv_obj_t* parent);
/** Bouton plein (fond + texte), largeur auto si w = 0. */
lv_obj_t* button(lv_obj_t* parent, const std::string& text, lv_color_t bg, lv_color_t fg, int h = 46, int w = 0,
                 const lv_font_t* font = &fig_s16);
lv_obj_t* iconButton(lv_obj_t* parent, const char* glyph, int size, lv_color_t bg, lv_color_t fg, const lv_font_t* font);
/** Interrupteur façon iOS (64×38). */
lv_obj_t* toggle(lv_obj_t* parent, bool on, std::function<void(bool)> onChange);

void setWidth(lv_obj_t* o, int w);
void setFlexGrow(lv_obj_t* o, int grow = 1);
void setBg(lv_obj_t* o, lv_color_t c, lv_opa_t opa = LV_OPA_COVER);
void setRadius(lv_obj_t* o, int r);
void setPad(lv_obj_t* o, int all);
void setPad(lv_obj_t* o, int ver, int hor);
void clickable(lv_obj_t* o);

// --- Événements avec lambdas (libérées automatiquement à la destruction de l'objet) ---
void onClick(lv_obj_t* o, std::function<void()> fn);
void onEvent(lv_obj_t* o, lv_event_code_t code, std::function<void(lv_event_t*)> fn);

/** Courbe simple (lv_line) : valeurs mises à l'échelle dans w×h. */
lv_obj_t* sparkline(lv_obj_t* parent, const std::vector<int>& values, int w, int h, lv_color_t color, int width = 3);
/** Anneau de progression (lv_arc non interactif). */
lv_obj_t* ring(lv_obj_t* parent, int size, int thickness, int percent, lv_color_t color, lv_color_t track);
/** Icône météo composée (soleil + nuage colorés). */
lv_obj_t* weatherIcon(lv_obj_t* parent, const std::string& kind, int size);

// Mélange deux couleurs (ratio 0..255 vers b).
lv_color_t mix(lv_color_t a, lv_color_t b, uint8_t ratio);

// Icônes des habitudes et de la météo.
const char* habitIcon(const std::string& name);

// Format « 1 284 » avec espace des milliers.
std::string thousands(int64_t n);
std::string fmt(const char* format, ...);

}  // namespace ui
