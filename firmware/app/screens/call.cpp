// Superpositions iPhone : appel entrant (plein écran, façon CarPlay) et bandeau
// de notification en haut de l'écran.
#include "../app.h"
#include "../phone_style.h"
#include "../ui.h"
#include "../util.h"

using namespace ui;

void buildIncomingCall(lv_obj_t* layer, uint32_t uid, const std::string& name, bool quiet) {
    setBg(layer, lv_color_hex(0x07120B));
    lv_obj_set_style_bg_grad_color(layer, lv_color_hex(0x12301E), 0);
    lv_obj_set_style_bg_grad_dir(layer, LV_GRAD_DIR_VER, 0);
    lv_color_t ink = lv_color_hex(0xF2FFF5);
    lv_color_t ink2 = lv_color_hex(0x9DB8A6);

    lv_obj_t* c = col(layer, 0);
    lv_obj_set_size(c, lv_pct(100), lv_pct(100));
    lv_obj_set_flex_align(c, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER);

    lv_obj_t* src = row(c, 10);
    icon(src, ICON_BRAND_APPLE, &icons_20, ink2);
    label(src, quiet ? "Appel entrant · iPhone · ne pas déranger" : "Appel entrant · iPhone", &fig_s18, ink2);

    // Avatar avec halo qui pulse.
    lv_obj_t* halo = box(c);
    lv_obj_set_size(halo, 176, 176);
    lv_obj_set_style_margin_top(halo, 30, 0);
    lv_obj_set_style_radius(halo, 88, 0);
    lv_obj_set_style_border_width(halo, 3, 0);
    lv_obj_set_style_border_color(halo, color::green(), 0);
    lv_anim_t an;
    lv_anim_init(&an);
    lv_anim_set_var(&an, halo);
    lv_anim_set_values(&an, 30, 220);
    lv_anim_set_duration(&an, 800);
    lv_anim_set_playback_duration(&an, 800);
    lv_anim_set_repeat_count(&an, LV_ANIM_REPEAT_INFINITE);
    lv_anim_set_exec_cb(&an, [](void* o, int32_t v) { lv_obj_set_style_border_opa(static_cast<lv_obj_t*>(o), static_cast<lv_opa_t>(v), 0); });
    lv_anim_start(&an);
    lv_obj_t* avatar = box(halo);
    lv_obj_set_size(avatar, 148, 148);
    lv_obj_set_style_radius(avatar, 74, 0);
    setBg(avatar, lv_color_hex(0x5C6B62));
    lv_obj_set_style_bg_grad_color(avatar, lv_color_hex(0x2F3833), 0);
    lv_obj_set_style_bg_grad_dir(avatar, LV_GRAD_DIR_VER, 0);
    lv_obj_center(avatar);
    std::string ini = phone_style::initials(name);
    if (ini.empty()) lv_obj_center(icon(avatar, ICON_PHONE_INCOMING, &icons_40, ink));
    else lv_obj_center(label(avatar, ini, &fig_b44, ink));

    lv_obj_t* nm = label(c, name, &fig_b44, ink);
    lv_obj_set_style_margin_top(nm, 26, 0);
    fitLabel(nm, 900);
    label(c, "La conversation se fait sur ton iPhone", &fig_m18, ink2);

    lv_obj_t* btns = row(c, 140);
    lv_obj_set_style_pad_top(btns, 56, 0);
    auto action = [&](const char* glyph, lv_color_t bg, const char* text, bool positive) {
        lv_obj_t* a = col(btns, 12);
        lv_obj_set_flex_align(a, LV_FLEX_ALIGN_START, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER);
        lv_obj_t* b = iconButton(a, glyph, 104, bg, color::white(), &icons_40);
        lv_obj_set_ext_click_area(b, 16);
        onClick(b, [uid, positive] { App::get().phoneAction(uid, positive); });
        label(a, text, &fig_s18, ink);
    };
    action(ICON_PHONE_OFF, color::red(), "Refuser", false);
    action(ICON_PHONE_FILLED, color::green(), "Accepter", true);
}

lv_obj_t* buildPhoneBanner(lv_obj_t* parent, const hal::PhoneNotification& n, bool hideContent) {
    lv_obj_t* b = row(parent, 14);
    lv_obj_set_size(b, 640, 84);
    lv_obj_align(b, LV_ALIGN_TOP_MID, RAIL_W / 2, 14);
    lv_obj_set_style_pad_hor(b, 18, 0);
    lv_obj_set_style_radius(b, 24, 0);
    setBg(b, th().dark ? lv_color_hex(0x2A2A31) : color::white());
    lv_obj_set_style_border_width(b, 1, 0);
    lv_obj_set_style_border_color(b, th().dark ? lv_color_hex(0x3A3A42) : lv_color_hex(0xE2E2E8), 0);
    lv_obj_set_style_shadow_width(b, 40, 0);
    lv_obj_set_style_shadow_opa(b, 110, 0);
    lv_obj_set_style_shadow_offset_y(b, 8, 0);
    clickable(b);

    iconTile(b, phone_style::appIcon(n.app), phone_style::appColor(n.app), 48, &icons_24, 13);
    lv_obj_t* t = col(b, 2);
    lv_obj_set_flex_grow(t, 1);
    lv_obj_t* top = row(t, 8);
    lv_obj_set_width(top, lv_pct(100));
    label(top, n.app, &fig_s14, th().text2);
    spacer(top);
    label(top, "maintenant", &fig_m14, th().text2);
    lv_obj_t* title = label(t, hideContent ? "Nouvelle notification" : n.title, &fig_s18, th().text);
    fitLabel(title, 520);
    if (!hideContent && !n.body.empty()) {
        lv_obj_t* body = label(t, n.body, &fig_m16, th().text2);
        fitLabel(body, 520);
    }
    // Petite animation d'entrée depuis le haut.
    lv_anim_t an;
    lv_anim_init(&an);
    lv_anim_set_var(&an, b);
    lv_anim_set_values(&an, -100, 14);
    lv_anim_set_duration(&an, 260);
    lv_anim_set_path_cb(&an, lv_anim_path_ease_out);
    lv_anim_set_exec_cb(&an, [](void* o, int32_t v) { lv_obj_set_y(static_cast<lv_obj_t*>(o), v); });
    lv_anim_start(&an);
    return b;
}
