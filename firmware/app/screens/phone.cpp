// iPhone : association Bluetooth, notifications et appels (protocole ANCS d'Apple),
// petit centre de contrôle et prochain événement.
#include <algorithm>

#include "../app.h"
#include "../hal.h"
#include "../phone_style.h"
#include "../ui.h"
#include "../util.h"

using namespace ui;

namespace {

lv_obj_t* g_modal = nullptr;

void closeModal() {
    if (g_modal) lv_obj_delete_async(g_modal);
    g_modal = nullptr;
}

/** Fenêtre centrée sur fond assombri ; renvoie la carte où placer le contenu. */
lv_obj_t* openModal(int width) {
    closeModal();
    g_modal = box(lv_layer_top());
    lv_obj_set_size(g_modal, SCREEN_W, SCREEN_H);
    setBg(g_modal, color::black(), 150);
    clickable(g_modal);
    onEvent(g_modal, LV_EVENT_CLICKED, [](lv_event_t* e) {
        if (lv_event_get_target(e) == lv_event_get_current_target(e)) closeModal();  // clic à côté
    });
    lv_obj_t* c = card(g_modal, 28, 28);
    lv_obj_set_width(c, width);
    lv_obj_set_style_pad_row(c, 12, 0);
    clickable(c);
    lv_obj_center(c);
    return c;
}

void controlTile(lv_obj_t* parent, const char* glyph, lv_color_t c, bool on, const std::string& title, const std::string& sub,
                 std::function<void()> onTap) {
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
    if (onTap) onClick(t, std::move(onTap));
}

void step(lv_obj_t* parent, int n, const std::string& text, bool active) {
    lv_obj_t* r = row(parent, 14);
    lv_obj_set_width(r, lv_pct(100));
    lv_obj_set_flex_align(r, LV_FLEX_ALIGN_START, LV_FLEX_ALIGN_START, LV_FLEX_ALIGN_START);
    lv_obj_t* num = box(r);
    lv_obj_set_size(num, 30, 30);
    lv_obj_set_style_radius(num, 15, 0);
    setBg(num, active ? color::blue() : th().chip);
    lv_obj_center(label(num, std::to_string(n), &fig_s16, active ? color::white() : th().text2));
    lv_obj_t* l = label(r, text, &fig_m16, active ? th().text : th().text2);
    lv_label_set_long_mode(l, LV_LABEL_LONG_WRAP);
    lv_obj_set_flex_grow(l, 1);
    lv_obj_set_style_pad_top(l, 4, 0);
}

void notificationDetail(const hal::PhoneNotification& n) {
    lv_obj_t* c = openModal(620);
    lv_obj_t* top = row(c, 10);
    lv_obj_set_width(top, lv_pct(100));
    iconTile(top, phone_style::appIcon(n.app), phone_style::appColor(n.app), 34, &icons_20, 9);
    label(top, n.app, &fig_s16, th().text2);
    spacer(top);
    label(top, util::relativeTime(n.at), &fig_m14, th().text2);
    lv_obj_t* t = label(c, n.title, &fig_b24, th().text);
    lv_label_set_long_mode(t, LV_LABEL_LONG_WRAP);
    lv_obj_set_width(t, lv_pct(100));
    lv_obj_t* b = label(c, n.body.empty() ? "(pas de texte)" : n.body, &fig_m18, th().dark ? lv_color_hex(0xD1D1D6) : th().text);
    lv_label_set_long_mode(b, LV_LABEL_LONG_WRAP);
    lv_obj_set_width(b, lv_pct(100));
    lv_obj_t* btns = row(c, 12);
    lv_obj_set_width(btns, lv_pct(100));
    lv_obj_set_style_pad_top(btns, 10, 0);
    uint32_t uid = n.uid;
    if (!n.negativeLabel.empty()) {
        lv_obj_t* neg = button(btns, n.negativeLabel, mix(th().card, color::red(), 40), lv_color_hex(0xFF6961), 50);
        onClick(neg, [uid] {
            App::get().phoneAction(uid, false);
            closeModal();
        });
    }
    if (!n.positiveLabel.empty()) {
        lv_obj_t* pos = button(btns, n.positiveLabel + " sur l’iPhone", mix(th().card, color::blue(), 40), lv_color_hex(0x64B5FF), 50);
        onClick(pos, [uid] {
            App::get().phoneAction(uid, true);
            closeModal();
        });
    }
    spacer(btns);
    onClick(button(btns, "Fermer", th().chip, th().text, 50), [] { closeModal(); });
}

void confirmForget() {
    lv_obj_t* c = openModal(560);
    label(c, "Oublier cet iPhone ?", &fig_b24, th().text);
    lv_obj_t* t = label(c,
                        "La tablette ne recevra plus ses notifications. Pense aussi à l’oublier sur l’iPhone : "
                        "Réglages › Bluetooth › «\u00A0Smart Dashboard\u00A0» › Oublier cet appareil.",
                        &fig_m16, th().text2);
    lv_label_set_long_mode(t, LV_LABEL_LONG_WRAP);
    lv_obj_set_width(t, lv_pct(100));
    lv_obj_t* btns = row(c, 12);
    lv_obj_set_style_pad_top(btns, 10, 0);
    onClick(button(btns, "Oublier", color::red(), color::white(), 50), [] {
        hal::get().phoneForget();
        closeModal();
        App::get().toast("iPhone oublié");
    });
    onClick(button(btns, "Annuler", th().chip, th().text, 50), [] { closeModal(); });
}

// --- Colonne centrale : association
void pairingCard(lv_obj_t* parent, const hal::PhoneState& p) {
    App& app = App::get();
    lv_obj_t* c = card(parent, 24, 26);
    lv_obj_set_height(c, lv_pct(100));
    lv_obj_set_flex_grow(c, 1);
    lv_obj_set_style_pad_row(c, 16, 0);

    lv_obj_t* hd = row(c, 14);
    iconTile(hd, ICON_BRAND_APPLE, th().dark ? lv_color_hex(0x3A3A40) : lv_color_hex(0x1C1C1E), 52, &icons_28, 15);
    lv_obj_t* ht = col(hd, 2);
    label(ht, "Associer ton iPhone", &fig_b24, th().text);
    label(ht, "Ses notifications et ses appels ici", &fig_m14, th().text2);

    if (!p.pairing) {
        step(c, 1, "Touche «\u00A0Associer un iPhone\u00A0» : la tablette reste visible 2\u00A0minutes.", true);
        step(c, 2, "Sur l’iPhone : Réglages › Bluetooth, puis touche «\u00A0Smart Dashboard\u00A0» dans «\u00A0Autres appareils\u00A0».", false);
        step(c, 3, "Saisis sur l’iPhone le code qui s’affiche ici, puis autorise le partage des notifications.", false);
        if (!p.status.empty()) {
            lv_obj_t* st = label(c, p.status, &fig_s14, color::orange());
            lv_label_set_long_mode(st, LV_LABEL_LONG_WRAP);
            lv_obj_set_width(st, lv_pct(100));
        }
        spacer(c);
        lv_obj_t* go = button(c, "Associer un iPhone", color::blue(), color::white(), 56, 0, &fig_s18);
        lv_obj_t* bt = icon(go, ICON_BLUETOOTH, &icons_24, color::white());
        lv_obj_move_to_index(bt, 0);
        onClick(go, [] {
            App::get().ui.phonePairingSinceMs = hal::get().millis();
            hal::get().phoneStartPairing();
            App::get().invalidate();
        });
        return;
    }

    bool code = !p.pairingCode.empty();
    step(c, 1, "La tablette est visible.", false);
    step(c, 2, "Sur l’iPhone : Réglages › Bluetooth › «\u00A0Smart Dashboard\u00A0» (dans «\u00A0Autres appareils\u00A0»).", !code);
    step(c, 3, code ? "Saisis ce code sur l’iPhone, puis touche «\u00A0Autoriser\u00A0» pour les notifications :" : "Saisis le code qui va s’afficher ici.", code);
    if (code) {
        std::string digits = p.pairingCode;
        if (digits.size() == 6) digits = digits.substr(0, 3) + " " + digits.substr(3);
        lv_obj_t* box_ = box(c);
        lv_obj_set_size(box_, lv_pct(100), 112);
        setBg(box_, th().card2);
        lv_obj_set_style_radius(box_, 20, 0);
        lv_obj_center(label(box_, digits, &fig_l72, th().text));
    }
    spacer(c);
    lv_obj_t* foot = row(c, 12);
    lv_obj_set_width(foot, lv_pct(100));
    lv_obj_t* left = label(foot, "", &fig_m14, th().text2);
    uint32_t since = app.ui.phonePairingSinceMs;
    auto tick = [left, since]() {
        uint32_t el = since ? (hal::get().millis() - since) / 1000 : 0;
        int remain = std::max(0, 120 - static_cast<int>(el));
        char b[64];
        snprintf(b, sizeof b, "Visible encore %d:%02d", remain / 60, remain % 60);
        lv_label_set_text(left, b);
    };
    tick();
    app.onSecond(tick);
    spacer(foot);
    onClick(button(foot, "Annuler", th().chip, th().text, 46), [] {
        hal::get().phoneCancelPairing();
        App::get().invalidate();
    });
}

// --- Colonne centrale : notifications
void notificationsCard(lv_obj_t* parent, const hal::PhoneState& p) {
    lv_obj_t* nc = card(parent, 24, 18);
    lv_obj_set_height(nc, lv_pct(100));
    lv_obj_set_flex_grow(nc, 1);
    lv_obj_set_style_pad_row(nc, 12, 0);
    lv_obj_t* nh = row(nc, 10);
    lv_obj_set_width(nh, lv_pct(100));
    label(nh, "Notifications", &fig_s20, th().text);
    if (p.connected && !p.notifications.empty()) label(nh, std::to_string(p.notifications.size()), &fig_m14, th().text2);
    spacer(nh);
    lv_obj_t* forget = button(nh, "Oublier l’iPhone", th().chip, th().text2, 36, 0, &fig_s14);
    onClick(forget, [] { confirmForget(); });

    if (!p.connected) {
        // Lien établi mais notifications pas (encore) partagées : on explique pourquoi.
        std::string text = !p.status.empty() ? p.status
                           : p.linked        ? "Connexion à l’iPhone…"
                                             : "iPhone hors de portée. La tablette se reconnecte toute seule dès qu’il est à "
                                               "proximité, Bluetooth activé.";
        lv_obj_t* l = label(nc, text, &fig_m16, p.status.empty() ? th().text2 : color::orange());
        lv_label_set_long_mode(l, LV_LABEL_LONG_WRAP);
        lv_obj_set_width(l, lv_pct(100));
        return;
    }
    if (p.notifications.empty()) {
        lv_obj_t* e = col(nc, 10);
        lv_obj_set_size(e, lv_pct(100), 0);
        lv_obj_set_flex_grow(e, 1);
        lv_obj_set_flex_align(e, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER);
        icon(e, ICON_BELL_OFF, &icons_40, th().text3);
        label(e, "Aucune notification", &fig_s18, th().text2);
        return;
    }
    lv_obj_t* list = col(nc, 10);
    lv_obj_set_size(list, lv_pct(100), 0);
    lv_obj_set_flex_grow(list, 1);
    lv_obj_add_flag(list, LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_set_scroll_dir(list, LV_DIR_VER);
    lv_obj_set_scrollbar_mode(list, LV_SCROLLBAR_MODE_OFF);
    for (size_t i = 0; i < p.notifications.size() && i < 20; i++) {
        const hal::PhoneNotification& n = p.notifications[i];
        lv_obj_t* a = col(list, 6);
        lv_obj_set_width(a, lv_pct(100));
        setBg(a, th().card2);
        lv_obj_set_style_radius(a, 18, 0);
        lv_obj_set_style_pad_hor(a, 16, 0);
        lv_obj_set_style_pad_ver(a, 12, 0);
        lv_obj_t* top = row(a, 8);
        lv_obj_set_width(top, lv_pct(100));
        iconTile(top, phone_style::appIcon(n.app), phone_style::appColor(n.app), 24, &icons_16, 7);
        label(top, n.app, &fig_s14, th().text2);
        spacer(top);
        label(top, util::relativeTime(n.at), &fig_m14, th().text2);
        lv_obj_t* t = label(a, n.title, &fig_s16, th().text);
        lv_label_set_long_mode(t, LV_LABEL_LONG_DOT);
        lv_obj_set_width(t, lv_pct(100));
        lv_obj_set_height(t, lv_font_get_line_height(&fig_s16));
        if (!n.body.empty()) {
            lv_obj_t* b = label(a, n.body, &fig_m16, th().dark ? lv_color_hex(0xC7C7CC) : th().text2);
            lv_label_set_long_mode(b, LV_LABEL_LONG_DOT);
            lv_obj_set_width(b, lv_pct(100));
            lv_obj_set_height(b, lv_font_get_line_height(&fig_m16));
        }
        hal::PhoneNotification copy = n;
        clickable(a);
        onClick(a, [copy] { notificationDetail(copy); });
    }
}

}  // namespace

void buildPhone(lv_obj_t* parent) {
    App& app = App::get();
    hal::PhoneState p = hal::get().phone();
    const App::PhonePrefs& prefs = app.phonePrefs();

    std::string subtitle = !p.supported ? "Bluetooth indisponible sur cet appareil"
                           : p.connected ? "Notifications et appels · Bluetooth basse consommation"
                           : p.paired    ? "iPhone associé · reconnexion automatique dès qu’il est à portée"
                                         : "Associe ton iPhone pour voir ses notifications et ses appels";
    lv_obj_t* actions = pageHeader(parent, "iPhone", subtitle);
    struct Status {
        const char* text;
        lv_color_t c;
    } status = !p.supported   ? Status{"Indisponible", color::orange()}
               : !p.enabled   ? Status{"Bluetooth désactivé", color::gray()}
               : p.pairing    ? Status{"Association…", color::blue()}
               : p.connected  ? Status{"Connecté", color::green()}
               : p.linked     ? (p.status.empty() ? Status{"Connexion…", color::blue()} : Status{"Notifications bloquées", color::orange()})
               : p.paired     ? Status{"Hors de portée", color::orange()}
                              : Status{"Non associé", color::gray()};
    lv_obj_t* st = pill(actions, status.text, mix(th().bg, status.c, 40), th().dark ? mix(status.c, color::white(), 90) : status.c, &fig_s16, 44);
    lv_obj_t* d = dot(st, 9, status.c);
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
    lv_obj_set_style_border_color(phoneShape, p.connected ? color::indigo() : th().ring, 0);
    if (p.connected) {
        lv_obj_set_style_shadow_width(phoneShape, 28, 0);
        lv_obj_set_style_shadow_color(phoneShape, color::indigo(), 0);
        lv_obj_set_style_shadow_opa(phoneShape, 90, 0);
    }
    lv_obj_center(icon(phoneShape, ICON_BRAND_APPLE, &icons_24, p.connected ? th().text : th().text3));
    lv_obj_t* info = col(dev, 6);
    lv_obj_set_flex_grow(info, 1);
    lv_obj_t* nm = label(info, p.paired ? (p.name.empty() ? "Mon iPhone" : p.name) : "Aucun iPhone", &fig_s20, th().text);
    fitLabel(nm, 200);
    auto kv = [&](const std::string& k, const std::string& v) {
        lv_obj_t* r = row(info, 0);
        lv_obj_set_width(r, lv_pct(100));
        label(r, k, &fig_m14, th().text2);
        spacer(r);
        label(r, v, &fig_s14, th().text);
    };
    kv("Batterie", p.connected && p.battery >= 0 ? std::to_string(p.battery) + " %" : "—");
    kv("Liaison", p.connected ? "Bluetooth LE" : "—");
    kv("Notifications", p.connected ? std::to_string(p.notifications.size()) : "—");

    lv_obj_t* grid = col(c1, 14);
    lv_obj_set_width(grid, lv_pct(100));
    lv_obj_set_flex_grow(grid, 1);
    lv_obj_t* r1 = row(grid, 14);
    lv_obj_set_width(r1, lv_pct(100));
    lv_obj_set_flex_grow(r1, 1);
    bool bt = p.supported && p.enabled;
    bool sup = p.supported;
    controlTile(r1, bt ? ICON_BLUETOOTH : ICON_BLUETOOTH_OFF, color::blue(), bt, "Bluetooth",
                !p.supported ? "Indisponible" : !p.enabled ? "Désactivé" : p.connected ? "Connecté" : "Activé", [bt, sup] {
                    if (!sup) return;
                    hal::get().phoneSetEnabled(!bt);
                    App::get().invalidate();
                });
    const Settings& s = app.state().settings;
    std::string dndSub = prefs.dnd ? "Activé" : s.nightEnabled ? "Auto " + s.nightStart + " – " + s.nightEnd : "Désactivé";
    controlTile(r1, ICON_MOON_FILLED, color::indigo(), prefs.dnd, "Ne pas déranger", dndSub, [] {
        App::PhonePrefs np = App::get().phonePrefs();
        np.dnd = !np.dnd;
        App::get().setPhonePrefs(np);
    });
    lv_obj_t* r2 = row(grid, 14);
    lv_obj_set_width(r2, lv_pct(100));
    lv_obj_set_flex_grow(r2, 1);
    controlTile(r2, prefs.banners ? ICON_BELL_FILLED : ICON_BELL_OFF, color::red(), prefs.banners, "Bandeaux", prefs.banners ? "À l’écran" : "Masqués", [] {
        App::PhonePrefs np = App::get().phonePrefs();
        np.banners = !np.banners;
        App::get().setPhonePrefs(np);
    });
    controlTile(r2, ICON_BELL_RINGING, color::green(), prefs.ringCalls, "Sonnerie appels", prefs.ringCalls ? "Activée" : "Silencieuse", [] {
        App::PhonePrefs np = App::get().phonePrefs();
        np.ringCalls = !np.ringCalls;
        App::get().setPhonePrefs(np);
    });

    // Colonne 2 : association ou notifications
    if (!p.supported || !p.enabled) {
        lv_obj_t* c = card(body, 24, 30);
        lv_obj_set_height(c, lv_pct(100));
        lv_obj_set_flex_grow(c, 1);
        lv_obj_set_flex_align(c, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER);
        lv_obj_set_style_pad_row(c, 14, 0);
        iconTile(c, ICON_BLUETOOTH_OFF, th().chip, 84, &icons_40, 24);
        label(c, p.supported ? "Bluetooth désactivé" : "Bluetooth indisponible", &fig_b24, th().text);
        if (p.supported) {
            onClick(button(c, "Activer le Bluetooth", color::blue(), color::white(), 50), [] {
                hal::get().phoneSetEnabled(true);
                App::get().invalidate();
            });
        }
    } else if (!p.paired || p.pairing) {
        pairingCard(body, p);
    } else {
        notificationsCard(body, p);
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
        lv_obj_t* l = label(calls, p.connected ? "Aucun appel récent." : "Les appels reçus s’afficheront ici.", &fig_m14, th().text2);
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
        lv_obj_t* who = label(t, cl.name, &fig_s16, cl.missed ? lv_color_hex(0xFF6961) : th().text);
        fitLabel(who, 170);
        label(t, cl.detail, &fig_m14, th().text2);
        label(r, util::relativeTime(cl.at), &fig_m14, th().text2);
    }

    lv_obj_t* ev = card(c3, 24, 0);
    lv_obj_set_width(ev, lv_pct(100));
    lv_obj_set_flex_grow(ev, 1);
    lv_obj_set_style_pad_hor(ev, 20, 0);
    lv_obj_set_style_pad_ver(ev, 18, 0);
    lv_obj_t* eh = row(ev, 8);
    icon(eh, ICON_CALENDAR, &icons_16, lv_color_hex(0xFF6961));
    label(eh, "CALENDRIER ICLOUD", &fig_s14, lv_color_hex(0xFF6961));
    const Agenda& a = app.state().agenda;
    struct tm now = util::localNow();
    int nowMin = now.tm_hour * 60 + now.tm_min;
    const Event* next = nullptr;
    for (const Event& e : a.today)
        if (util::minutesOf(e.start) > nowMin) {
            next = &e;
            break;
        }
    if (next) {
        lv_obj_t* big = label(ev, next->start, &fig_l54, th().text);
        lv_obj_set_style_pad_top(big, 6, 0);
        lv_obj_set_style_pad_bottom(big, 4, 0);
        lv_obj_t* tt = label(ev, next->title, &fig_s18, th().text);
        fitLabel(tt, 296);
        std::string dl = util::inDelay(static_cast<int64_t>(util::minutesOf(next->start) - nowMin) * 60);
        dl[0] = 'D';
        label(ev, dl + (next->reminderMinutes > 0 ? " · rappel " + std::to_string(next->reminderMinutes) + " min" : ""), &fig_m14, th().text2);
    } else {
        lv_obj_t* l = label(ev, a.valid ? "Plus rien aujourd’hui." : "Calendrier non connecté.", &fig_m16, th().text2);
        lv_obj_set_style_pad_top(l, 10, 0);
    }
}
