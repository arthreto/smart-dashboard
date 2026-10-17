// Réglages locaux de la tablette (synchronisés avec la console).
#include <algorithm>
#include <ctime>

#include "../api.h"
#include "../app.h"
#include "../hal.h"
#include "../ui.h"
#include "../util.h"

using namespace ui;

namespace {

lv_obj_t* group(lv_obj_t* parent, const char* title) {
    lv_obj_t* c = card(parent, 22, 0);
    lv_obj_set_width(c, lv_pct(100));
    lv_obj_set_style_pad_hor(c, 20, 0);
    lv_obj_set_style_pad_ver(c, 16, 0);
    label(c, title, &fig_s14, th().text2);
    return c;
}

lv_obj_t* settingRow(lv_obj_t* parent, const std::string& title, const std::string& sub, bool first = false) {
    lv_obj_t* r = row(parent, 14);
    lv_obj_set_width(r, lv_pct(100));
    lv_obj_set_style_min_height(r, 58, 0);
    if (!first) {
        lv_obj_set_style_border_side(r, LV_BORDER_SIDE_TOP, 0);
        lv_obj_set_style_border_width(r, 1, 0);
        lv_obj_set_style_border_color(r, th().hairline, 0);
    }
    lv_obj_t* t = col(r, 2);
    lv_obj_set_flex_grow(t, 1);
    label(t, title, &fig_s16, th().text);
    if (!sub.empty()) label(t, sub, &fig_m14, th().text2);
    return r;
}

/** Sélecteur à pastilles (valeurs entières). */
void choice(lv_obj_t* parent, const std::vector<std::pair<int, std::string>>& opts, int current, std::function<void(int)> pick) {
    lv_obj_t* seg = row(parent, 2);
    setBg(seg, th().card2);
    lv_obj_set_style_radius(seg, 12, 0);
    lv_obj_set_style_pad_all(seg, 3, 0);
    for (const auto& [v, text] : opts) {
        bool sel = v == current;
        lv_obj_t* b = button(seg, text, sel ? th().ring : th().card2, sel ? th().text : th().text2, 40, 0, &fig_s14);
        lv_obj_set_style_radius(b, 10, 0);
        lv_obj_set_style_pad_hor(b, 12, 0);
        int value = v;
        onClick(b, [pick, value] { pick(value); });
    }
}

void displaySection(lv_obj_t* parent) {
    Settings& s = App::get().state().settings;
    lv_obj_t* cols = row(parent, 16);
    lv_obj_set_size(cols, lv_pct(100), LV_SIZE_CONTENT);
    lv_obj_set_flex_align(cols, LV_FLEX_ALIGN_START, LV_FLEX_ALIGN_START, LV_FLEX_ALIGN_START);
    lv_obj_t* a = col(cols, 16);
    lv_obj_set_flex_grow(a, 1);
    lv_obj_t* b = col(cols, 16);
    lv_obj_set_flex_grow(b, 1);

    lv_obj_t* look = group(a, "APPARENCE");
    lv_obj_t* themes = row(look, 12);
    lv_obj_set_style_pad_top(themes, 12, 0);
    struct T {
        const char* id;
        const char* name;
        uint32_t bg, card;
    } ts[] = {{"dark", "Sombre", 0x0B0B0E, 0x222227}, {"light", "Clair", 0xF2F2F7, 0xFFFFFF}, {"auto", "Auto", 0x6C6C72, 0xA1A1AA}};
    for (const T& t : ts) {
        bool sel = s.theme == t.id;
        lv_obj_t* c = col(themes, 8);
        lv_obj_set_flex_align(c, LV_FLEX_ALIGN_START, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER);
        lv_obj_t* prev = col(c, 5);
        lv_obj_set_size(prev, 104, 70);
        lv_obj_set_style_radius(prev, 12, 0);
        lv_obj_set_style_pad_all(prev, 8, 0);
        setBg(prev, lv_color_hex(t.bg));
        lv_obj_set_style_border_width(prev, sel ? 3 : 1, 0);
        lv_obj_set_style_border_color(prev, sel ? color::blue() : th().ring, 0);
        lv_obj_t* bar = box(prev);
        lv_obj_set_size(bar, 56, 8);
        lv_obj_set_style_radius(bar, 3, 0);
        setBg(bar, lv_color_hex(t.card));
        lv_obj_t* blk = box(prev);
        lv_obj_set_size(blk, lv_pct(100), 0);
        lv_obj_set_flex_grow(blk, 1);
        lv_obj_set_style_radius(blk, 5, 0);
        setBg(blk, lv_color_hex(t.card));
        label(c, t.name, &fig_s16, th().text);
        std::string id = t.id;
        onClick(c, [id] {
            App::get().state().settings.theme = id;
            App::get().updateSettings("{\"theme\":\"" + id + "\"}");
        });
    }

    lv_obj_t* light = group(a, "LUMINOSITÉ");
    lv_obj_t* lr = row(light, 12);
    lv_obj_set_size(lr, lv_pct(100), 50);
    icon(lr, ICON_SUN, &icons_16, th().text2);
    lv_obj_t* slider = lv_slider_create(lr);
    lv_obj_remove_style_all(slider);
    lv_obj_set_height(slider, 12);
    lv_obj_set_flex_grow(slider, 1);
    lv_slider_set_range(slider, 5, 100);
    lv_slider_set_value(slider, s.brightness, LV_ANIM_OFF);
    setBg(slider, th().track);
    lv_obj_set_style_radius(slider, 6, 0);
    lv_obj_set_style_bg_color(slider, th().text, LV_PART_INDICATOR);
    lv_obj_set_style_bg_opa(slider, LV_OPA_COVER, LV_PART_INDICATOR);
    lv_obj_set_style_radius(slider, 6, LV_PART_INDICATOR);
    lv_obj_set_style_bg_color(slider, color::white(), LV_PART_KNOB);
    lv_obj_set_style_bg_opa(slider, LV_OPA_COVER, LV_PART_KNOB);
    lv_obj_set_style_radius(slider, LV_RADIUS_CIRCLE, LV_PART_KNOB);
    lv_obj_set_style_pad_all(slider, 8, LV_PART_KNOB);
    lv_obj_set_style_shadow_width(slider, 8, LV_PART_KNOB);
    lv_obj_set_style_shadow_opa(slider, 80, LV_PART_KNOB);
    lv_obj_set_ext_click_area(slider, 16);
    lv_obj_t* val = label(lr, std::to_string(s.brightness) + " %", &fig_s16, th().text);
    onEvent(slider, LV_EVENT_VALUE_CHANGED, [slider, val](lv_event_t*) {
        int v = lv_slider_get_value(slider);
        App::get().state().settings.brightness = v;
        lv_label_set_text(val, (std::to_string(v) + " %").c_str());
        hal::get().setBrightness(v);
    });
    onEvent(slider, LV_EVENT_RELEASED, [slider](lv_event_t*) {
        App::get().updateSettings("{\"brightness\":" + std::to_string(lv_slider_get_value(slider)) + "}");
    });
    lv_obj_t* nr = settingRow(light, "Mode nuit automatique", s.nightStart + " – " + s.nightEnd + " · luminosité " + std::to_string(s.nightBrightness) + " %");
    toggle(nr, s.nightEnabled, [](bool on) {
        App::get().state().settings.nightEnabled = on;
        App::get().updateSettings(std::string("{\"nightMode\":{\"enabled\":") + (on ? "true" : "false") + "}}");
    });
    lv_obj_t* wr = settingRow(light, "Teinte chaude le soir", "Réduit la lumière bleue");
    toggle(wr, s.warmTint, [](bool on) {
        App::get().state().settings.warmTint = on;
        App::get().updateSettings(std::string("{\"warmTint\":") + (on ? "true" : "false") + "}");
    });

    lv_obj_t* sleep = group(b, "VEILLE");
    lv_obj_t* s1 = settingRow(sleep, "Veille écran", "", true);
    choice(s1, {{15, "15 s"}, {30, "30 s"}, {60, "1 min"}, {120, "2 min"}}, s.screenSleepSeconds, [](int v) {
        App::get().state().settings.screenSleepSeconds = v;
        App::get().updateSettings("{\"screenSleepSeconds\":" + std::to_string(v) + "}");
    });
    lv_obj_t* s2 = settingRow(sleep, "Veille profonde", "");
    choice(s2, {{5, "5 min"}, {10, "10 min"}, {30, "30 min"}}, s.deepSleepMinutes, [](int v) {
        App::get().state().settings.deepSleepMinutes = v;
        App::get().updateSettings("{\"deepSleepMinutes\":" + std::to_string(v) + "}");
    });
    lv_obj_t* s3 = settingRow(sleep, "Réveil par toucher", "Sinon, uniquement avec le bouton du dessus");
    toggle(s3, s.touchWake, [](bool on) {
        App::get().state().settings.touchWake = on;
        App::get().updateSettings(std::string("{\"touchWake\":") + (on ? "true" : "false") + "}");
    });
    lv_obj_t* s4 = settingRow(sleep, "Verrouiller au réveil", s.pinHash.empty() ? "Définis un code PIN dans la console" : "Code PIN demandé");
    toggle(s4, s.lockOnWake, [](bool on) {
        App::get().state().settings.lockOnWake = on;
        App::get().updateSettings(std::string("{\"lockOnWake\":") + (on ? "true" : "false") + "}");
    });

    lv_obj_t* bat = group(b, "BATTERIE");
    hal::PowerStatus p = hal::get().power();
    int level = p.battery < 0 ? 0 : p.battery;
    lv_obj_t* br = row(bat, 0);
    lv_obj_set_width(br, lv_pct(100));
    lv_obj_set_style_pad_top(br, 8, 0);
    label(br, p.battery < 0 ? "—" : std::to_string(level) + " %", &fig_b32, th().text);
    spacer(br);
    label(br, p.charging ? "En charge" : (p.battery < 0 ? "Inconnue" : "Environ " + std::to_string(level * 115 / 1000) + " jours restants"), &fig_m14, th().text2);
    lv_obj_t* pb = progressBar(bat, 0, 12, level, level <= 15 ? color::red() : color::green(), th().track);
    lv_obj_set_width(pb, lv_pct(100));
    lv_obj_set_style_margin_top(pb, 10, 0);
}

void connectionSection(lv_obj_t* parent) {
    App& app = App::get();
    lv_obj_t* g = group(parent, "CONNEXION AU SERVEUR");
    lv_obj_t* r1 = settingRow(g, "Serveur", app.demoMode() ? "Mode démo (aucun serveur)" : api::baseUrl(), true);
    (void)r1;
    std::string status;
    if (app.demoMode()) status = "Données d’exemple";
    else if (app.online()) status = "En ligne";
    else status = app.lastError().empty() ? "Connexion en cours…" : app.lastError();
    lv_obj_t* r2 = settingRow(g, "État", status);
    dot(r2, 10, app.online() || app.demoMode() ? color::green() : color::orange());
    std::string last = "Jamais";
    if (app.lastSyncEpoch()) {
        time_t t = static_cast<time_t>(app.lastSyncEpoch());
        struct tm tm_;
        localtime_r(&t, &tm_);
        last = "Aujourd’hui à " + util::hhmm(tm_);
    }
    lv_obj_t* r3 = settingRow(g, "Dernière synchronisation", app.demoMode() ? "—" : last);
    lv_obj_t* sync = button(r3, "Synchroniser", th().card2, th().text, 44);
    onClick(sync, [] { App::get().syncNow(); });
    if (hal::get().hasWifiSetup()) {
        hal::PowerStatus p = hal::get().power();
        settingRow(g, "Wi-Fi", hal::get().wifiSsid() + (p.rssi ? " · " + std::to_string(p.rssi) + " dBm" : ""));
    }
    lv_obj_t* r4 = settingRow(g, "Associer à nouveau", "Saisir un nouveau code d’appairage depuis la console");
    lv_obj_t* re = button(r4, "Associer", color::blue(), color::white(), 44);
    onClick(re, [] { App::get().openSetup(); });
    lv_obj_t* r5 = settingRow(g, "Oublier ce serveur", "Supprime le jeton enregistré sur la tablette");
    lv_obj_t* rs = button(r5, "Réinitialiser", mix(th().card, color::red(), 40), lv_color_hex(0xFF6961), 44);
    onClick(rs, [] { App::get().factoryReset(); });
}

void aboutSection(lv_obj_t* parent) {
    lv_obj_t* g = group(parent, "À PROPOS");
    settingRow(g, "Appareil", hal::get().platformName(), true);
    settingRow(g, "Firmware", hal::get().firmwareVersion());
    settingRow(g, "Écran", "5 pouces · 1280 × 720 · tactile");
    settingRow(g, "Interface", std::string("LVGL ") + std::to_string(LVGL_VERSION_MAJOR) + "." + std::to_string(LVGL_VERSION_MINOR) + "." +
                                   std::to_string(LVGL_VERSION_PATCH));
    lv_obj_t* r = settingRow(g, "Redémarrer", "");
    lv_obj_t* b = button(r, "Redémarrer", th().card2, th().text, 44);
    onClick(b, [] { hal::get().reboot(); });
}

}  // namespace

void buildSettings(lv_obj_t* parent) {
    App& app = App::get();
    lv_obj_set_flex_flow(parent, LV_FLEX_FLOW_ROW);
    lv_obj_set_flex_align(parent, LV_FLEX_ALIGN_START, LV_FLEX_ALIGN_START, LV_FLEX_ALIGN_START);

    lv_obj_t* menu = col(parent, 14);
    lv_obj_set_size(menu, 300, lv_pct(100));
    lv_obj_t* devCard = card(menu, 22, 16);
    lv_obj_set_width(devCard, lv_pct(100));
    lv_obj_set_flex_flow(devCard, LV_FLEX_FLOW_ROW);
    lv_obj_set_style_pad_column(devCard, 14, 0);
    lv_obj_set_flex_align(devCard, LV_FLEX_ALIGN_START, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER);
    lv_obj_t* mini = box(devCard);
    lv_obj_set_size(mini, 56, 36);
    lv_obj_set_style_radius(mini, 8, 0);
    lv_obj_set_style_border_width(mini, 3, 0);
    lv_obj_set_style_border_color(mini, color::gray(), 0);
    setBg(mini, th().bg);
    lv_obj_t* dt = col(devCard, 0);
    label(dt, "Smart Dashboard", &fig_s16, th().text);
    label(dt, "Firmware " + hal::get().firmwareVersion(), &fig_m14, th().text2);

    lv_obj_t* list = card(menu, 22, 8);
    lv_obj_set_width(list, lv_pct(100));
    lv_obj_set_flex_grow(list, 1);
    struct Item {
        const char* glyph;
        lv_color_t c;
        const char* name;
    } items[] = {{ICON_SUN_FILLED, lv_color_hex(0xFFB800), "Affichage & énergie"},
                 {ICON_WIFI, color::blue(), "Connexion"},
                 {ICON_TABLET, color::gray(), "À propos"}};
    for (int i = 0; i < 3; i++) {
        bool sel = app.ui.settingsSection == i;
        lv_obj_t* r = row(list, 12);
        lv_obj_set_size(r, lv_pct(100), 54);
        lv_obj_set_style_pad_hor(r, 12, 0);
        lv_obj_set_style_radius(r, 14, 0);
        if (sel) setBg(r, mix(th().card, color::blue(), 56));
        iconTile(r, items[i].glyph, items[i].c, 32, &icons_16, 9);
        label(r, items[i].name, sel ? &fig_s16 : &fig_m16, th().text);
        onClick(r, [i] {
            App::get().ui.settingsSection = i;
            App::get().invalidate();
        });
    }
    lv_obj_t* note = label(list, "Les intégrations (Spotify, Pathé, Roblox, iCloud) et les clés API se gèrent dans la console web.", &fig_m14, th().text2);
    lv_label_set_long_mode(note, LV_LABEL_LONG_WRAP);
    lv_obj_set_width(note, lv_pct(100));
    lv_obj_set_style_pad_all(note, 12, 0);

    lv_obj_t* pane = col(parent, 16);
    lv_obj_set_height(pane, lv_pct(100));
    lv_obj_set_flex_grow(pane, 1);
    lv_obj_set_style_margin_left(pane, 20, 0);
    lv_obj_add_flag(pane, LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_set_scrollbar_mode(pane, LV_SCROLLBAR_MODE_OFF);
    const char* titles[] = {"Affichage & énergie", "Connexion", "À propos"};
    label(pane, titles[app.ui.settingsSection], &fig_b32, th().text);
    if (app.ui.settingsSection == 0) displaySection(pane);
    else if (app.ui.settingsSection == 1) connectionSection(pane);
    else aboutSection(pane);
}
