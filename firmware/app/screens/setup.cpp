// Assistant de première installation : Wi-Fi (tablette), adresse du serveur, code d'appairage.
#include <memory>

#include "../api.h"
#include "../app.h"
#include "../hal.h"
#include "../ui.h"
#include "../util.h"
#include "../third_party/cjson/cJSON.h"

using namespace ui;

namespace {

lv_obj_t* g_layer = nullptr;
std::vector<hal::WifiNetwork> g_networks;
bool g_scanning = false;
bool g_scanDone = false;  // un seul scan automatique : ensuite, bouton « Actualiser »

enum Step { WIFI_LIST = 0, WIFI_PASSWORD = 1, SERVER = 2, CODE = 3 };

void rebuild() {
    if (!g_layer) return;
    lv_obj_clean(g_layer);
    buildSetup(g_layer);
}

void go(int step) {
    App::get().ui.setupStep = step;
    App::get().ui.setupError.clear();
    rebuild();
}

lv_obj_t* textField(lv_obj_t* parent, const std::string& value, const char* placeholder, bool password) {
    lv_obj_t* ta = lv_textarea_create(parent);
    lv_obj_remove_style_all(ta);
    lv_textarea_set_one_line(ta, true);
    lv_textarea_set_password_mode(ta, password);
    lv_textarea_set_placeholder_text(ta, placeholder);
    lv_textarea_set_text(ta, value.c_str());
    lv_obj_set_size(ta, lv_pct(100), 60);
    setBg(ta, th().card2);
    lv_obj_set_style_radius(ta, 16, 0);
    lv_obj_set_style_pad_hor(ta, 18, 0);
    lv_obj_set_style_pad_ver(ta, 16, 0);
    lv_obj_set_style_text_font(ta, &fig_m18, 0);
    lv_obj_set_style_text_color(ta, th().text, 0);
    lv_obj_set_style_text_color(ta, th().text3, LV_PART_TEXTAREA_PLACEHOLDER);
    lv_obj_set_style_border_width(ta, 2, LV_STATE_FOCUSED);
    lv_obj_set_style_border_color(ta, color::blue(), LV_STATE_FOCUSED);
    lv_obj_set_style_bg_color(ta, color::blue(), LV_PART_CURSOR);
    lv_obj_set_style_bg_opa(ta, LV_OPA_COVER, LV_PART_CURSOR);
    lv_obj_set_style_width(ta, 2, LV_PART_CURSOR);
    lv_obj_add_state(ta, LV_STATE_FOCUSED);
    if (lv_group_get_default()) lv_group_add_obj(lv_group_get_default(), ta);
    return ta;
}

// Les touches spéciales du clavier LVGL (effacer, entrée, flèches…) sont des
// symboles absents de Figtree : on ajoute Montserrat 20 comme police de repli.
const lv_font_t* keyboardFont() {
    static lv_font_t font = fig_s18;
    font.fallback = &lv_font_montserrat_20;
    return &font;
}

lv_obj_t* keyboard(lv_obj_t* parent, lv_obj_t* ta) {
    lv_obj_t* kb = lv_keyboard_create(parent);
    lv_keyboard_set_textarea(kb, ta);
    lv_obj_set_size(kb, ui::SCREEN_W, 300);
    lv_obj_align(kb, LV_ALIGN_BOTTOM_MID, 0, 0);
    lv_obj_set_style_bg_color(kb, th().rail, 0);
    lv_obj_set_style_text_font(kb, keyboardFont(), LV_PART_ITEMS);
    lv_obj_set_style_bg_color(kb, th().card2, LV_PART_ITEMS);
    lv_obj_set_style_text_color(kb, th().text, LV_PART_ITEMS);
    lv_obj_set_style_radius(kb, 10, LV_PART_ITEMS);
    lv_obj_set_style_border_width(kb, 0, LV_PART_ITEMS);
    lv_obj_set_style_shadow_width(kb, 0, LV_PART_ITEMS);
    return kb;
}

void pair() {
    App& app = App::get();
    std::string url = app.ui.setupUrl;
    while (!url.empty() && url.back() == '/') url.pop_back();
    if (url.rfind("http", 0) != 0) url = "https://" + url;
    app.ui.setupUrl = url;
    app.ui.pairing = true;
    app.ui.setupError.clear();
    rebuild();
    std::string body = fmt(R"({"code":"%s","name":"Tab5","firmware":"%s"})", app.ui.setupCode.c_str(),
                           api::jsonEscape(hal::get().firmwareVersion()).c_str());
    api::request("POST", url + "/api/v1/pair", body, [url](const hal::HttpResponse& r) {
        App& a = App::get();
        a.ui.pairing = false;
        if (r.status == 200) {
            cJSON* root = cJSON_Parse(r.body.c_str());
            const cJSON* tok = root ? cJSON_GetObjectItem(root, "token") : nullptr;
            std::string token = cJSON_IsString(tok) ? tok->valuestring : "";
            if (root) cJSON_Delete(root);
            if (!token.empty()) {
                a.ui.setupCode.clear();
                g_layer = nullptr;
                AppAccess::finishPairing(url, token);
                return;
            }
        }
        a.ui.setupCode.clear();
        if (r.status == 0) a.ui.setupError = "Serveur injoignable : " + (r.error.empty() ? std::string("vérifie l’adresse") : r.error);
        else {
            std::string m = parseErrorMessage(r.body);
            a.ui.setupError = m.empty() ? "Erreur " + std::to_string(r.status) : m;
        }
        rebuild();
    }, false, 15000);
}

void scan() {
    g_scanning = true;
    g_scanDone = true;
    auto list = std::make_shared<std::vector<hal::WifiNetwork>>();
    api::runInWorker([list] { *list = hal::get().wifiScan(); },
                     [list] {
                         g_networks = *list;
                         g_scanning = false;
                         rebuild();
                     });
}

void stepsList(lv_obj_t* parent, int current) {
    bool wifi = hal::get().hasWifiSetup();
    struct S {
        int from;
        const char* text;
    } steps[] = {{WIFI_LIST, "Connexion au Wi-Fi"}, {SERVER, "Adresse de ton serveur"}, {CODE, "Code d’appairage"}};
    int n = 1;
    for (const S& s : steps) {
        if (s.from == WIFI_LIST && !wifi) continue;
        bool done = current > s.from + (s.from == WIFI_LIST ? 1 : 0);
        bool active = current == s.from || (s.from == WIFI_LIST && current == WIFI_PASSWORD);
        lv_obj_t* r = row(parent, 14);
        lv_obj_set_height(r, 48);
        lv_obj_t* b = box(r);
        lv_obj_set_size(b, 34, 34);
        lv_obj_set_style_radius(b, 17, 0);
        setBg(b, done ? color::green() : active ? color::blue() : th().chip);
        lv_obj_t* l = label(b, done ? ICON_CHECK : std::to_string(n).c_str(), done ? &icons_20 : &fig_s16, done || active ? color::white() : th().text2);
        lv_obj_center(l);
        label(r, s.text, active ? &fig_s18 : &fig_m18, active ? th().text : th().text2);
        n++;
    }
}

}  // namespace

void buildSetup(lv_obj_t* layer) {
    g_layer = layer;
    App& app = App::get();
    hal::Hal& h = hal::get();
    setBg(layer, th().bg);
    lv_obj_add_event_cb(layer, [](lv_event_t* e) {
        if (lv_event_get_target(e) == g_layer) g_layer = nullptr;
    }, LV_EVENT_DELETE, nullptr);

    if (app.ui.setupStep == WIFI_LIST && !h.hasWifiSetup()) app.ui.setupStep = SERVER;
    if (app.ui.setupUrl.empty()) app.ui.setupUrl = api::baseUrl().empty() ? "https://" : api::baseUrl();
    int step = app.ui.setupStep;
    bool withKeyboard = step == WIFI_PASSWORD || step == SERVER;

    // Panneau gauche : présentation et étapes.
    lv_obj_t* left = col(layer, 18);
    lv_obj_set_size(left, 400, withKeyboard ? 420 : 720);
    lv_obj_set_pos(left, 0, 0);
    lv_obj_set_style_pad_all(left, 48, 0);
    setBg(left, th().rail);
    lv_obj_t* logo = box(left);
    lv_obj_set_size(logo, 64, 42);
    lv_obj_set_style_radius(logo, 10, 0);
    lv_obj_set_style_border_width(logo, 4, 0);
    lv_obj_set_style_border_color(logo, color::gray(), 0);
    lv_obj_t* bar = box(logo);
    lv_obj_set_size(bar, 28, 4);
    lv_obj_center(bar);
    setBg(bar, color::blue());
    label(left, "Bienvenue", &fig_b32, th().text);
    if (!withKeyboard) {
        lv_obj_t* intro = label(left, "Relie cet écran à ton serveur pour afficher tes tâches, ton agenda, ta musique et le reste.", &fig_m16, th().text2);
        lv_label_set_long_mode(intro, LV_LABEL_LONG_WRAP);
        lv_obj_set_width(intro, 304);
    }
    stepsList(left, step);

    // Panneau droit : étape en cours.
    lv_obj_t* right = col(layer, 16);
    lv_obj_set_size(right, ui::SCREEN_W - 400, withKeyboard ? 420 : 720);
    lv_obj_set_pos(right, 400, 0);
    lv_obj_set_style_pad_hor(right, 64, 0);
    lv_obj_set_style_pad_ver(right, withKeyboard ? 40 : 64, 0);

    if (step == WIFI_LIST) {
        lv_obj_t* hd = row(right, 0);
        lv_obj_set_width(hd, lv_pct(100));
        label(hd, "Choisis ton réseau Wi-Fi", &fig_b32, th().text);
        spacer(hd);
        lv_obj_t* rs = button(hd, g_scanning ? "Recherche…" : "Actualiser", th().card2, th().text, 46);
        onClick(rs, [] { if (!g_scanning) { scan(); rebuild(); } });
        if (!g_scanDone && !g_scanning) scan();
        lv_obj_t* list = card(right, 22, 6);
        lv_obj_set_size(list, lv_pct(100), 0);
        lv_obj_set_flex_grow(list, 1);
        lv_obj_add_flag(list, LV_OBJ_FLAG_SCROLLABLE);
        if (g_networks.empty()) {
            lv_obj_t* l = label(list, g_scanning ? "Recherche des réseaux…" : "Aucun réseau trouvé. Rapproche-toi de la box puis touche « Actualiser ».",
                                &fig_m16, th().text2);
            lv_label_set_long_mode(l, LV_LABEL_LONG_WRAP);
            lv_obj_set_width(l, lv_pct(100));
            lv_obj_set_style_pad_all(l, 14, 0);
        }
        for (const auto& n : g_networks) {
            lv_obj_t* r = row(list, 14);
            lv_obj_set_size(r, lv_pct(100), 58);
            lv_obj_set_style_pad_hor(r, 14, 0);
            icon(r, ICON_WIFI, &icons_20, n.rssi > -60 ? th().text : th().text2);
            lv_obj_t* l = label(r, n.ssid, &fig_s18, th().text);
            lv_obj_set_flex_grow(l, 1);
            if (n.secure) icon(r, ICON_LOCK, &icons_16, th().text2);
            std::string ssid = n.ssid;
            bool secure = n.secure;
            onClick(r, [ssid, secure] {
                App::get().ui.setupSsid = ssid;
                if (secure) go(WIFI_PASSWORD);
                else {
                    auto ok = std::make_shared<bool>(false);
                    api::runInWorker([ssid, ok] { *ok = hal::get().wifiConnect(ssid, ""); },
                                     [ok] {
                                         if (*ok) go(SERVER);
                                         else {
                                             App::get().ui.setupError = "Connexion impossible.";
                                             rebuild();
                                         }
                                     });
                }
            });
        }
    } else if (step == WIFI_PASSWORD) {
        label(right, "Mot de passe de « " + app.ui.setupSsid + " »", &fig_b24, th().text);
        lv_obj_t* ta = textField(right, "", "Mot de passe Wi-Fi", true);
        lv_obj_t* actions = row(right, 12);
        lv_obj_t* back = button(actions, "Retour", th().card2, th().text, 52);
        onClick(back, [] { go(WIFI_LIST); });
        lv_obj_t* ok = button(actions, "Se connecter", color::blue(), color::white(), 52);
        onClick(ok, [ta] {
            std::string pass = lv_textarea_get_text(ta);
            std::string ssid = App::get().ui.setupSsid;
            App::get().ui.setupError = "Connexion en cours…";
            rebuild();
            auto res = std::make_shared<bool>(false);
            api::runInWorker([ssid, pass, res] { *res = hal::get().wifiConnect(ssid, pass); },
                             [ssid, res] {
                                 if (*res) {
                                     hal::get().save("wifi_ssid", ssid);
                                     go(SERVER);
                                 } else {
                                     App::get().ui.setupError = "Mot de passe incorrect ou réseau hors de portée.";
                                     App::get().ui.setupStep = WIFI_PASSWORD;
                                     rebuild();
                                 }
                             });
        });
        keyboard(layer, ta);
    } else if (step == SERVER) {
        label(right, "Adresse de ton serveur", &fig_b24, th().text);
        lv_obj_t* hint = label(right, "Celle de ta console web, par exemple https://dashboard.mon-domaine.fr", &fig_m16, th().text2);
        (void)hint;
        lv_obj_t* ta = textField(right, app.ui.setupUrl, "https://…", false);
        lv_obj_t* actions = row(right, 12);
        if (h.hasWifiSetup()) {
            lv_obj_t* back = button(actions, "Wi-Fi", th().card2, th().text, 52);
            onClick(back, [] { go(WIFI_LIST); });
        }
        lv_obj_t* next = button(actions, "Suivant", color::blue(), color::white(), 52);
        onClick(next, [ta] {
            std::string url = lv_textarea_get_text(ta);
            if (url.size() < 10) {
                App::get().ui.setupError = "Adresse trop courte.";
                rebuild();
                return;
            }
            App::get().ui.setupUrl = url;
            go(CODE);
        });
        if (!h.hasWifiSetup()) {
            lv_obj_t* demo = button(actions, "Essayer le mode démo", th().card2, th().text, 52);
            onClick(demo, [] {
                g_layer = nullptr;
                App::get().startDemo();
            });
        }
        lv_obj_t* kb = keyboard(layer, ta);
        lv_obj_add_event_cb(kb, [](lv_event_t* e) {
            if (lv_event_get_code(e) == LV_EVENT_READY) {
                lv_obj_t* kbd = static_cast<lv_obj_t*>(lv_event_get_target(e));
                lv_obj_t* t = lv_keyboard_get_textarea(kbd);
                App::get().ui.setupUrl = lv_textarea_get_text(t);
                go(CODE);
            }
        }, LV_EVENT_READY, nullptr);
    } else {
        label(right, "Code d’appairage", &fig_b32, th().text);
        lv_obj_t* hint = label(right, "Dans la console : Appareil & réveils › « Associer une tablette ». Le code est valable 10 minutes.", &fig_m16,
                               th().text2);
        lv_label_set_long_mode(hint, LV_LABEL_LONG_WRAP);
        lv_obj_set_width(hint, lv_pct(100));
        label(right, app.ui.setupUrl, &fig_m14, th().text3);
        lv_obj_t* boxes = row(right, 12);
        lv_obj_set_style_pad_ver(boxes, 8, 0);
        for (int i = 0; i < 6; i++) {
            lv_obj_t* b = box(boxes);
            lv_obj_set_size(b, 64, 76);
            lv_obj_set_style_radius(b, 14, 0);
            setBg(b, th().card2);
            bool filled = i < static_cast<int>(app.ui.setupCode.size());
            if (i == static_cast<int>(app.ui.setupCode.size())) {
                lv_obj_set_style_border_width(b, 2, 0);
                lv_obj_set_style_border_color(b, color::blue(), 0);
            }
            if (filled) {
                lv_obj_t* l = label(b, std::string(1, app.ui.setupCode[i]), &fig_b32, th().text);
                lv_obj_center(l);
            }
        }
        static int32_t cols[] = {110, 110, 110, 110, 110, 110, LV_GRID_TEMPLATE_LAST};
        static int32_t rows[] = {64, 64, LV_GRID_TEMPLATE_LAST};
        lv_obj_t* pad = box(right);
        lv_obj_set_size(pad, 110 * 6 + 10 * 5, 64 * 2 + 10);
        lv_obj_set_layout(pad, LV_LAYOUT_GRID);
        lv_obj_set_grid_dsc_array(pad, cols, rows);
        lv_obj_set_style_pad_column(pad, 10, 0);
        lv_obj_set_style_pad_row(pad, 10, 0);
        const char* keys[] = {"1", "2", "3", "4", "5", "6", "7", "8", "9", "0", "<", "OK"};
        for (int i = 0; i < 12; i++) {
            std::string k = keys[i];
            bool ok = k == "OK";
            lv_obj_t* b = button(pad, k == "<" ? "Effacer" : k, ok ? color::blue() : th().card2, ok ? color::white() : th().text, 64, 0,
                                 k.size() == 1 && k != "<" ? &fig_b24 : &fig_s16);
            lv_obj_set_style_radius(b, 16, 0);
            lv_obj_set_grid_cell(b, LV_GRID_ALIGN_STRETCH, i % 6, 1, LV_GRID_ALIGN_STRETCH, i / 6, 1);
            onClick(b, [k] {
                App& a = App::get();
                if (a.ui.pairing) return;
                if (k == "<") {
                    if (!a.ui.setupCode.empty()) a.ui.setupCode.pop_back();
                } else if (k == "OK") {
                    if (a.ui.setupCode.size() == 6) {
                        pair();
                        return;
                    }
                } else if (a.ui.setupCode.size() < 6) {
                    a.ui.setupCode += k;
                    if (a.ui.setupCode.size() == 6) {
                        pair();
                        return;
                    }
                }
                rebuild();
            });
        }
        lv_obj_t* actions = row(right, 12);
        lv_obj_t* back = button(actions, "Changer d’adresse", th().card2, th().text, 48);
        onClick(back, [] { go(SERVER); });
        if (app.ui.pairing) label(actions, "Association en cours…", &fig_s16, color::blue());
    }

    if (!app.ui.setupError.empty()) {
        lv_obj_t* err = label(right, app.ui.setupError, &fig_s16, lv_color_hex(0xFF8E86));
        lv_label_set_long_mode(err, LV_LABEL_LONG_WRAP);
        lv_obj_set_width(err, lv_pct(100));
    }
    // Permet de fermer l'assistant si une configuration existe déjà.
    if (api::configured() || app.demoMode()) {
        lv_obj_t* close = iconButton(layer, ICON_CLOSE, 52, th().card2, th().text, &icons_24);
        lv_obj_align(close, LV_ALIGN_TOP_RIGHT, -24, 24);
        onClick(close, [] {
            g_layer = nullptr;
            AppAccess::closeSetup();
        });
    }
}
