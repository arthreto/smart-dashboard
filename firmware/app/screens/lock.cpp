// Écran verrouillé : heure, widgets discrets (détails masqués) et clavier PIN.
#include "../app.h"
#include "../hal.h"
#include "../ui.h"
#include "../util.h"

using namespace ui;

namespace {

lv_obj_t* g_dots[6];
int g_dotCount = 0;
lv_obj_t* g_msg = nullptr;

void refreshDots() {
    const std::string& pin = App::get().ui.pin;
    for (int i = 0; i < g_dotCount; i++) {
        bool on = i < static_cast<int>(pin.size());
        setBg(g_dots[i], color::white(), on ? LV_OPA_COVER : LV_OPA_TRANSP);
    }
}

void check() {
    App& app = App::get();
    const Settings& s = app.state().settings;
    std::string& pin = app.ui.pin;
    if (pin.size() >= 4 && util::sha256Hex(s.pinSalt + pin) == s.pinHash) {
        AppAccess::unlock();
        return;
    }
    if (pin.size() >= 6) {
        pin.clear();
        if (g_msg) lv_label_set_text(g_msg, "Code incorrect, réessaie.");
        hal::get().playClick();
    }
    refreshDots();
}

lv_obj_t* glass(lv_obj_t* parent) {
    lv_obj_t* g = col(parent, 4);
    lv_obj_set_flex_grow(g, 1);
    setBg(g, color::white(), 23);
    lv_obj_set_style_radius(g, 22, 0);
    lv_obj_set_style_pad_hor(g, 18, 0);
    lv_obj_set_style_pad_ver(g, 16, 0);
    lv_obj_set_style_border_width(g, 1, 0);
    lv_obj_set_style_border_color(g, color::white(), 0);
    lv_obj_set_style_border_opa(g, 20, 0);
    return g;
}

}  // namespace

void buildLockScreen(lv_obj_t* layer) {
    App& app = App::get();
    const State& s = app.state();
    setBg(layer, lv_color_hex(0x0A0A14));
    lv_obj_set_style_bg_grad_color(layer, lv_color_hex(0x231F5C), 0);
    lv_obj_set_style_bg_grad_dir(layer, LV_GRAD_DIR_HOR, 0);
    lv_obj_set_style_bg_main_stop(layer, 40, 0);
    lv_color_t ink = lv_color_hex(0xF5F5F7);
    lv_color_t ink2 = lv_color_hex(0xC9C9D2);

    // Barre d'état
    lv_obj_t* status = row(layer, 10);
    lv_obj_align(status, LV_ALIGN_TOP_RIGHT, -32, 22);
    icon(status, ICON_WIFI, &icons_16, ink);
    hal::PowerStatus p = hal::get().power();
    label(status, std::to_string(p.battery < 0 ? 78 : p.battery) + " %", &fig_s14, ink);

    // Colonne gauche
    lv_obj_t* left = col(layer, 0);
    lv_obj_set_size(left, 620, 720);
    lv_obj_set_pos(left, 80, 0);
    lv_obj_set_flex_align(left, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_START, LV_FLEX_ALIGN_START);
    lv_obj_t* lk = row(left, 10);
    icon(lk, ICON_LOCK, &icons_20, ink2);
    label(lk, "Verrouillé", &fig_s16, ink2);
    lv_obj_t* date = label(left, "", &fig_s22, ink);
    lv_obj_set_style_pad_top(date, 26, 0);
    lv_obj_set_style_pad_bottom(date, 6, 0);
    app.registerClock(date, ClockFormat::LongDate);
    app.registerClock(label(left, "", &fig_l176, ink), ClockFormat::HHMM);

    lv_obj_t* widgets = row(left, 14);
    lv_obj_set_width(widgets, 560);
    lv_obj_set_style_pad_top(widgets, 34, 0);
    if (s.weather.valid) {
        lv_obj_t* g = glass(widgets);
        lv_obj_t* r = row(g, 8);
        weatherIcon(r, s.weather.icon, 22);
        label(r, std::to_string(s.weather.temp) + "°", &fig_b24, ink);
        label(g, s.weather.text, &fig_m14, ink2);
    }
    // Prochain événement du jour, sans son titre (l'écran est verrouillé).
    const Event* nextEvent = nullptr;
    if (s.agenda.valid) {
        struct tm now = util::localNow();
        int nowMin = now.tm_hour * 60 + now.tm_min;
        for (const Event& e : s.agenda.today)
            if (!e.allDay && util::minutesOf(e.start) > nowMin) {
                nextEvent = &e;
                break;
            }
    }
    if (nextEvent) {
        lv_obj_t* g = glass(widgets);
        lv_obj_t* r = row(g, 8);
        icon(r, ICON_CALENDAR, &icons_20, lv_color_hex(0xFF6961));
        label(r, nextEvent->start, &fig_b24, ink);
        label(g, "Prochain événement", &fig_m14, ink2);
    }
    if (s.nextAlarm.valid) {
        lv_obj_t* g = glass(widgets);
        lv_obj_t* r = row(g, 8);
        icon(r, ICON_ALARM, &icons_20, color::orange());
        label(r, s.nextAlarm.time, &fig_b24, ink);
        label(g, "Prochain réveil", &fig_m14, ink2);
    }

    // Clavier
    lv_obj_t* right = col(layer, 0);
    lv_obj_set_size(right, 520, 720);
    lv_obj_set_pos(right, 760, 0);
    lv_obj_set_flex_align(right, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER);
    bool hasPin = !s.settings.pinHash.empty();
    label(right, hasPin ? "Saisis ton code" : "Touchez pour déverrouiller", &fig_s22, ink);
    if (!hasPin) {
        lv_obj_t* b = button(right, "Déverrouiller", color::white(), lv_color_hex(0x0B0B0E), 56, 240);
        lv_obj_set_style_margin_top(b, 30, 0);
        onClick(b, [] { AppAccess::unlock(); });
        return;
    }
    lv_obj_t* dots = row(right, 20);
    lv_obj_set_style_pad_ver(dots, 22, 0);
    g_dotCount = 4;
    for (int i = 0; i < g_dotCount; i++) {
        g_dots[i] = box(dots);
        lv_obj_set_size(g_dots[i], 16, 16);
        lv_obj_set_style_radius(g_dots[i], 8, 0);
        lv_obj_set_style_border_width(g_dots[i], 2, 0);
        lv_obj_set_style_border_color(g_dots[i], color::white(), 0);
    }
    lv_obj_add_event_cb(right, [](lv_event_t*) { g_dotCount = 0; g_msg = nullptr; }, LV_EVENT_DELETE, nullptr);

    static int32_t cols[] = {88, 88, 88, LV_GRID_TEMPLATE_LAST};
    static int32_t rows[] = {88, 88, 88, 88, LV_GRID_TEMPLATE_LAST};
    lv_obj_t* pad = box(right);
    lv_obj_set_size(pad, 88 * 3 + 26 * 2, 88 * 4 + 16 * 3);
    lv_obj_set_layout(pad, LV_LAYOUT_GRID);
    lv_obj_set_grid_dsc_array(pad, cols, rows);
    lv_obj_set_style_pad_column(pad, 26, 0);
    lv_obj_set_style_pad_row(pad, 16, 0);
    const char* letters[] = {"", "ABC", "DEF", "GHI", "JKL", "MNO", "PQRS", "TUV", "WXYZ", "", "", ""};
    const char* digits[] = {"1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "x"};
    for (int i = 0; i < 12; i++) {
        if (i == 9) continue;
        lv_obj_t* k = col(pad, 0);
        lv_obj_set_grid_cell(k, LV_GRID_ALIGN_STRETCH, i % 3, 1, LV_GRID_ALIGN_STRETCH, i / 3, 1);
        lv_obj_set_flex_align(k, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER);
        lv_obj_set_style_radius(k, 44, 0);
        std::string d = digits[i];
        if (d == "x") {
            icon(k, ICON_BACKSPACE, &icons_28, ink);
            onClick(k, [] {
                std::string& pin = App::get().ui.pin;
                if (!pin.empty()) pin.pop_back();
                refreshDots();
            });
            continue;
        }
        setBg(k, color::white(), 33);
        label(k, d, &fig_b32, ink);
        if (letters[i][0]) label(k, letters[i], &fig_s14, ink2);
        onClick(k, [d] {
            std::string& pin = App::get().ui.pin;
            if (pin.size() < 6) pin += d;
            if (pin.size() > static_cast<size_t>(g_dotCount) && g_dotCount < 6) {
                // Code de 5 ou 6 chiffres : on ajoute des points au fur et à mesure.
                lv_obj_t* parent = lv_obj_get_parent(g_dots[0]);
                g_dots[g_dotCount] = box(parent);
                lv_obj_set_size(g_dots[g_dotCount], 16, 16);
                lv_obj_set_style_radius(g_dots[g_dotCount], 8, 0);
                lv_obj_set_style_border_width(g_dots[g_dotCount], 2, 0);
                lv_obj_set_style_border_color(g_dots[g_dotCount], color::white(), 0);
                g_dotCount++;
            }
            if (g_msg) lv_label_set_text(g_msg, "");
            check();
        });
    }
    g_msg = label(right, "", &fig_m16, lv_color_hex(0xFF8E86));
    lv_obj_set_style_pad_top(g_msg, 20, 0);
    lv_obj_t* help = label(right, "Code oublié ? Change-le depuis la console web.", &fig_m14, ink2);
    lv_obj_set_style_pad_top(help, 6, 0);
    refreshDots();
}
