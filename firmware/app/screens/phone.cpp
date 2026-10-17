// iPhone : état de la connexion Bluetooth, notifications et appels (via ANCS),
// petit centre de contrôle et prochain événement.
#include "../app.h"
#include "../hal.h"
#include "../ui.h"
#include "../util.h"

using namespace ui;

namespace {

lv_color_t appColor(const std::string& app) {
    if (app == "MESSAGES") return color::green();
    if (app == "MAIL") return color::blue();
    if (app == "RAPPELS") return color::orange();
    if (app == "ACTIVITÉ" || app == "SANTÉ") return lv_color_hex(0xFF375F);
    return color::indigo();
}

const char* appIcon(const std::string& app) {
    if (app == "MESSAGES") return ICON_CHAT;
    if (app == "MAIL") return ICON_MAIL;
    if (app == "RAPPELS") return ICON_LIST;
    if (app == "ACTIVITÉ" || app == "SANTÉ") return ICON_HEART_FILLED;
    return ICON_BELL;
}

void controlTile(lv_obj_t* parent, const char* glyph, lv_color_t c, bool on, const std::string& title, const std::string& sub) {
    lv_obj_t* t = col(parent, 0);
    lv_obj_set_flex_grow(t, 1);
    lv_obj_set_height(t, lv_pct(100));
    setBg(t, th().card);
    lv_obj_set_style_radius(t, 22, 0);
    lv_obj_set_style_pad_all(t, 18, 0);
    lv_obj_set_flex_align(t, LV_FLEX_ALIGN_SPACE_BETWEEN, LV_FLEX_ALIGN_START, LV_FLEX_ALIGN_START);
    lv_obj_t* ic = iconTile(t, glyph, on ? c : th().ring, 46, &icons_20, 23);
    if (!on) lv_obj_set_style_text_color(lv_obj_get_child(ic, 0), th().text2, 0);
    lv_obj_t* tx = col(t, 2);
    label(tx, title, &fig_s16, th().text);
    label(tx, sub, &fig_m14, th().text2);
}

}  // namespace

void buildPhone(lv_obj_t* parent) {
    hal::PhoneState p = hal::get().phone();
    lv_obj_t* actions = pageHeader(parent, "iPhone", "Centre de contrôle · Bluetooth basse consommation");
    bool ok = p.supported && p.connected;
    lv_obj_t* st = pill(actions, ok ? "Connecté" : (p.supported ? "Non connecté" : "Bientôt disponible"),
                        mix(th().bg, ok ? color::green() : color::orange(), 40), ok ? lv_color_hex(0x6EE08E) : lv_color_hex(0xFFB340), &fig_s16, 44);
    lv_obj_t* d = dot(st, 9, ok ? color::green() : color::orange());
    lv_obj_move_to_index(d, 0);

    lv_obj_t* body = row(parent, 20);
    lv_obj_set_size(body, lv_pct(100), 0);
    lv_obj_set_flex_grow(body, 1);
    lv_obj_set_flex_align(body, LV_FLEX_ALIGN_START, LV_FLEX_ALIGN_START, LV_FLEX_ALIGN_START);

    // Colonne 1 : appareil + centre de contrôle
    lv_obj_t* c1 = col(body, 14);
    lv_obj_set_size(c1, 340, lv_pct(100));
    lv_obj_t* dev = card(c1, 24, 22);
    lv_obj_set_width(dev, lv_pct(100));
    lv_obj_set_flex_flow(dev, LV_FLEX_FLOW_ROW);
    lv_obj_set_style_pad_column(dev, 20, 0);
    lv_obj_set_flex_align(dev, LV_FLEX_ALIGN_START, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER);
    lv_obj_t* phoneShape = box(dev);
    lv_obj_set_size(phoneShape, 66, 124);
    lv_obj_set_style_radius(phoneShape, 16, 0);
    lv_obj_set_style_border_width(phoneShape, 3, 0);
    lv_obj_set_style_border_color(phoneShape, color::indigo(), 0);
    lv_obj_set_style_shadow_width(phoneShape, 28, 0);
    lv_obj_set_style_shadow_color(phoneShape, color::indigo(), 0);
    lv_obj_set_style_shadow_opa(phoneShape, 90, 0);
    lv_obj_t* info = col(dev, 6);
    lv_obj_set_flex_grow(info, 1);
    label(info, p.name.empty() ? "Mon iPhone" : p.name, &fig_s20, th().text);
    auto kv = [&](const std::string& k, const std::string& v) {
        lv_obj_t* r = row(info, 0);
        lv_obj_set_width(r, lv_pct(100));
        label(r, k, &fig_m14, th().text2);
        spacer(r);
        label(r, v, &fig_s14, th().text);
    };
    kv("Batterie", p.battery >= 0 ? std::to_string(p.battery) + " %" : "—");
    kv("Liaison", ok ? "Bluetooth LE" : "—");
    kv("Notifications", ok ? std::to_string(p.notifications.size()) : "—");

    lv_obj_t* grid = col(c1, 14);
    lv_obj_set_width(grid, lv_pct(100));
    lv_obj_set_flex_grow(grid, 1);
    lv_obj_t* r1 = row(grid, 14);
    lv_obj_set_width(r1, lv_pct(100));
    lv_obj_set_flex_grow(r1, 1);
    controlTile(r1, ICON_BLUETOOTH, color::blue(), ok, "Bluetooth", ok ? "Activé" : "En attente");
    controlTile(r1, ICON_MOON_FILLED, color::indigo(), true, "Ne pas déranger", "22:00 – 07:00");
    lv_obj_t* r2 = row(grid, 14);
    lv_obj_set_width(r2, lv_pct(100));
    lv_obj_set_flex_grow(r2, 1);
    controlTile(r2, ICON_BELL_FILLED, color::red(), ok, "Notifications", ok ? "Affichées" : "—");
    controlTile(r2, ICON_PHONE, color::green(), false, "Sonnerie appels", "Silencieux");

    // Colonne 2 : notifications
    lv_obj_t* nc = card(body, 24, 18);
    lv_obj_set_height(nc, lv_pct(100));
    lv_obj_set_flex_grow(nc, 1);
    lv_obj_set_style_pad_row(nc, 12, 0);
    lv_obj_t* nh = row(nc, 10);
    lv_obj_set_width(nh, lv_pct(100));
    label(nh, "Notifications", &fig_s20, th().text);
    label(nh, ok ? std::to_string(p.notifications.size()) + " nouvelles" : "", &fig_m14, th().text2);
    if (!p.supported) {
        lv_obj_t* l = label(nc,
                            "La réception des notifications de l’iPhone (Bluetooth, protocole ANCS d’Apple) arrive dans une prochaine version du "
                            "firmware de la tablette.",
                            &fig_m16, th().text2);
        lv_label_set_long_mode(l, LV_LABEL_LONG_WRAP);
        lv_obj_set_width(l, lv_pct(100));
    }
    for (size_t i = 0; i < p.notifications.size() && i < 4; i++) {
        const hal::PhoneNotification& n = p.notifications[i];
        lv_obj_t* a = col(nc, 6);
        lv_obj_set_width(a, lv_pct(100));
        setBg(a, th().card2);
        lv_obj_set_style_radius(a, 18, 0);
        lv_obj_set_style_pad_hor(a, 16, 0);
        lv_obj_set_style_pad_ver(a, 12, 0);
        lv_obj_t* top = row(a, 8);
        lv_obj_set_width(top, lv_pct(100));
        iconTile(top, appIcon(n.app), appColor(n.app), 24, &icons_16, 7);
        label(top, n.app, &fig_s14, th().text2);
        spacer(top);
        label(top, n.time, &fig_m14, th().text2);
        label(a, n.title, &fig_s16, th().text);
        lv_obj_t* b = label(a, n.body, &fig_m16, th().dark ? lv_color_hex(0xC7C7CC) : th().text2);
        lv_label_set_long_mode(b, LV_LABEL_LONG_DOT);
        lv_obj_set_width(b, lv_pct(100));
    }

    // Colonne 3 : appels + prochain événement
    lv_obj_t* c3 = col(body, 14);
    lv_obj_set_size(c3, 340, lv_pct(100));
    lv_obj_t* calls = card(c3, 24, 0);
    lv_obj_set_width(calls, lv_pct(100));
    lv_obj_set_style_pad_hor(calls, 20, 0);
    lv_obj_set_style_pad_ver(calls, 16, 0);
    label(calls, "Appels", &fig_s20, th().text);
    if (p.calls.empty()) {
        lv_obj_t* l = label(calls, "Aucun appel récent.", &fig_m14, th().text2);
        lv_obj_set_style_pad_top(l, 8, 0);
    }
    for (size_t i = 0; i < p.calls.size() && i < 4; i++) {
        const hal::PhoneCall& cl = p.calls[i];
        lv_obj_t* r = row(calls, 12);
        lv_obj_set_size(r, lv_pct(100), 60);
        if (i) {
            lv_obj_set_style_border_side(r, LV_BORDER_SIDE_TOP, 0);
            lv_obj_set_style_border_width(r, 1, 0);
            lv_obj_set_style_border_color(r, th().hairline, 0);
        }
        lv_obj_t* ic = iconTile(r, cl.missed ? ICON_PHONE_MISSED : ICON_PHONE, cl.missed ? mix(th().card, color::red(), 50) : th().chip, 38, &icons_20, 19);
        lv_obj_set_style_text_color(lv_obj_get_child(ic, 0), cl.missed ? lv_color_hex(0xFF6961) : th().text2, 0);
        lv_obj_t* t = col(r, 0);
        lv_obj_set_flex_grow(t, 1);
        label(t, cl.name, &fig_s16, cl.missed ? lv_color_hex(0xFF6961) : th().text);
        label(t, cl.detail, &fig_m14, th().text2);
        label(r, cl.when, &fig_m14, th().text2);
    }

    lv_obj_t* ev = card(c3, 24, 0);
    lv_obj_set_width(ev, lv_pct(100));
    lv_obj_set_flex_grow(ev, 1);
    lv_obj_set_style_pad_hor(ev, 20, 0);
    lv_obj_set_style_pad_ver(ev, 18, 0);
    lv_obj_t* eh = row(ev, 8);
    icon(eh, ICON_CALENDAR, &icons_16, lv_color_hex(0xFF6961));
    label(eh, "CALENDRIER ICLOUD", &fig_s14, lv_color_hex(0xFF6961));
    const Agenda& a = App::get().state().agenda;
    struct tm now = util::localNow();
    int nowMin = now.tm_hour * 60 + now.tm_min;
    const Event* next = nullptr;
    for (const Event& e : a.today)
        if (util::minutesOf(e.start) > nowMin) {
            next = &e;
            break;
        }
    if (next) {
        label(ev, next->start, &fig_l54, th().text);
        label(ev, next->title, &fig_s18, th().text);
        std::string d = util::inDelay(static_cast<int64_t>(util::minutesOf(next->start) - nowMin) * 60);
        d[0] = 'D';
        label(ev, d + (next->reminderMinutes > 0 ? " · rappel " + std::to_string(next->reminderMinutes) + " min avant" : ""), &fig_m14, th().text2);
    } else {
        lv_obj_t* l = label(ev, a.valid ? "Plus rien aujourd’hui." : "Calendrier non connecté.", &fig_m16, th().text2);
        lv_obj_set_style_pad_top(l, 10, 0);
    }
}
