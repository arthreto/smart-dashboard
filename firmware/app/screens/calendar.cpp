// Calendrier : vue semaine façon Apple, mini-mois et événements du jour.
#include <algorithm>
#include <cstdio>
#include <ctime>

#include "../app.h"
#include "../ui.h"
#include "../util.h"

using namespace ui;

namespace {

constexpr int HOUR_H = 36;
constexpr int FIRST_HOUR = 7;
constexpr int LAST_HOUR = 20;
constexpr int GRID_TOP = 9;  // marge pour que l'heure soit centrée sur sa ligne, même la première
constexpr int LINE_H = 18;   // hauteur d'une ligne de texte fig_s14 / fig_m14
const char* const DAY_SHORT[7] = {"LUN.", "MAR.", "MER.", "JEU.", "VEN.", "SAM.", "DIM."};

int isoWeek(const struct tm& t) {
    struct tm c = t;
    int wd = (c.tm_wday + 6) % 7;
    c.tm_mday += 3 - wd;  // jeudi de la semaine
    c.tm_hour = 12;
    mktime(&c);
    return c.tm_yday / 7 + 1;
}

lv_color_t eventText(lv_color_t base) { return th().dark ? mix(base, color::white(), 120) : mix(base, color::black(), 70); }

}  // namespace

void buildCalendar(lv_obj_t* parent) {
    const Agenda& a = App::get().state().agenda;
    struct tm now = util::localNow();
    std::string title = util::monthName(now.tm_mon);
    title[0] = static_cast<char>(title[0] - 32);
    title += " " + std::to_string(now.tm_year + 1900);
    lv_obj_t* actions = pageHeader(parent, title, "Semaine " + std::to_string(isoWeek(now)) + (a.valid ? " · calendrier iCloud" : " · iCloud non connecté"));
    lv_obj_t* today = button(actions, "Aujourd’hui", mix(th().bg, color::red(), 40), th().dark ? lv_color_hex(0xFF6961) : lv_color_hex(0xD70015), 52);
    (void)today;

    lv_obj_t* body = row(parent, 20);
    lv_obj_set_size(body, lv_pct(100), 0);
    lv_obj_set_flex_grow(body, 1);
    lv_obj_set_flex_align(body, LV_FLEX_ALIGN_START, LV_FLEX_ALIGN_START, LV_FLEX_ALIGN_START);

    // --- Vue semaine
    lv_obj_t* wk = card(body, 24, 0);
    lv_obj_set_height(wk, lv_pct(100));
    lv_obj_set_flex_grow(wk, 1);
    lv_obj_set_style_pad_hor(wk, 18, 0);
    lv_obj_set_style_pad_top(wk, 14, 0);
    lv_obj_set_style_pad_bottom(wk, 16, 0);
    // Colonne de droite créée tout de suite (remplie plus bas) : la largeur de la vue
    // semaine est alors définitive et peut être mesurée.
    lv_obj_t* right = col(body, 14);
    lv_obj_set_size(right, 380, lv_pct(100));

    int wdToday = util::weekdayMon0(now);
    lv_obj_t* heads = row(wk, 0);
    lv_obj_set_size(heads, lv_pct(100), 60);
    lv_obj_t* gutter = box(heads);
    lv_obj_set_width(gutter, 48);
    for (int d = 0; d < 7; d++) {
        struct tm day = now;
        day.tm_mday += d - wdToday;
        day.tm_hour = 12;
        mktime(&day);
        lv_obj_t* c = col(heads, 2);
        lv_obj_set_flex_grow(c, 1);
        lv_obj_set_flex_align(c, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER);
        bool isToday = d == wdToday;
        label(c, DAY_SHORT[d], &fig_s14, isToday ? (th().dark ? lv_color_hex(0xFF6961) : lv_color_hex(0xD70015)) : th().text2);
        // Même case de 34 px pour tous les jours : les en-têtes restent alignés.
        lv_obj_t* num = box(c);
        lv_obj_set_size(num, 34, 34);
        if (isToday) {
            lv_obj_set_style_radius(num, 17, 0);
            setBg(num, color::red());
            lv_obj_center(label(num, std::to_string(day.tm_mday), &fig_s20, color::white()));
        } else {
            lv_obj_center(label(num, std::to_string(day.tm_mday), &fig_s22, th().text));
        }
    }

    // Largeur utile du texte dans un événement (colonne − marges), pour savoir si le
    // titre tient sur une ligne.
    lv_obj_update_layout(heads);
    int evTextW = lv_obj_get_width(lv_obj_get_child(heads, 1)) * 94 / 100 - 15;
    if (evTextW < 40) evTextW = 70;

    lv_obj_t* grid = row(wk, 0);
    lv_obj_set_size(grid, lv_pct(100), GRID_TOP + HOUR_H * (LAST_HOUR - FIRST_HOUR));
    lv_obj_set_style_margin_top(grid, 2, 0);
    lv_obj_set_flex_align(grid, LV_FLEX_ALIGN_START, LV_FLEX_ALIGN_START, LV_FLEX_ALIGN_START);
    lv_obj_t* hours = box(grid);
    lv_obj_set_size(hours, 48, lv_pct(100));
    for (int h = FIRST_HOUR; h < LAST_HOUR; h++) {
        char b[8];
        snprintf(b, sizeof b, "%02d:00", h);
        lv_obj_t* l = label(hours, b, &fig_m14, th().text3);
        lv_obj_set_pos(l, 0, GRID_TOP + (h - FIRST_HOUR) * HOUR_H - LINE_H / 2);
    }
    for (int d = 0; d < 7; d++) {
        lv_obj_t* column = box(grid);
        lv_obj_set_height(column, lv_pct(100));
        lv_obj_set_flex_grow(column, 1);
        lv_obj_set_style_border_side(column, LV_BORDER_SIDE_LEFT, 0);
        lv_obj_set_style_border_width(column, 1, 0);
        lv_obj_set_style_border_color(column, th().hairline, 0);
        if (d == wdToday) setBg(column, mix(th().card, color::red(), 12));
        for (int h = 0; h < LAST_HOUR - FIRST_HOUR; h++) {
            lv_obj_t* line = box(column);
            lv_obj_set_size(line, lv_pct(100), 1);
            lv_obj_set_pos(line, 0, GRID_TOP + h * HOUR_H);
            setBg(line, th().hairline);
        }
        if (a.valid && d < static_cast<int>(a.week.size())) {
            for (const Event& e : a.week[d].events) {
                if (e.allDay) continue;
                int s = util::minutesOf(e.start), en = util::minutesOf(e.end);
                if (s < 0) continue;
                if (en <= s) en = s + 60;
                int top = std::max(0, (s - FIRST_HOUR * 60) * HOUR_H / 60);
                int bottom = std::min(HOUR_H * (LAST_HOUR - FIRST_HOUR), (en - FIRST_HOUR * 60) * HOUR_H / 60);
                if (bottom <= top) continue;
                lv_color_t base = hex(e.color);
                int h = std::max(28, bottom - top - 2);
                lv_obj_t* ev = col(column, 0);
                lv_obj_set_size(ev, lv_pct(94), h);
                lv_obj_set_pos(ev, 3, GRID_TOP + top + 1);
                setBg(ev, mix(th().card, base, 60));
                lv_obj_set_style_radius(ev, 8, 0);
                lv_obj_set_style_pad_hor(ev, 7, 0);
                lv_obj_set_style_pad_ver(ev, 5, 0);
                lv_obj_set_style_clip_corner(ev, true, 0);
                // Autant de lignes que la hauteur le permet : jamais de texte coupé.
                int room = (h - 10) / LINE_H;
                int titleW = lv_text_get_width(e.title.c_str(), static_cast<uint32_t>(e.title.size()), &fig_s14, 0);
                bool longTitle = titleW > evTextW;
                // Titre long sur deux lignes plutôt que coupé ; l'heure vient ensuite s'il reste de la place.
                int titleLines = std::max(1, std::min({2, room, longTitle ? 2 : 1}));
                bool showTime = room > titleLines;
                if (!showTime) lv_obj_set_flex_align(ev, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_START, LV_FLEX_ALIGN_START);
                lv_obj_t* t = label(ev, e.title, &fig_s14, eventText(base));
                lv_label_set_long_mode(t, LV_LABEL_LONG_DOT);
                lv_obj_set_size(t, lv_pct(100), titleLines * LINE_H);
                if (showTime) label(ev, e.start, &fig_m14, eventText(base));
            }
        }
        if (d == wdToday) {
            int nowMin = now.tm_hour * 60 + now.tm_min;
            if (nowMin >= FIRST_HOUR * 60 && nowMin < LAST_HOUR * 60) {
                int y = GRID_TOP + (nowMin - FIRST_HOUR * 60) * HOUR_H / 60;
                lv_obj_t* nl = box(column);
                lv_obj_set_size(nl, lv_pct(100), 2);
                lv_obj_set_pos(nl, 0, y);
                setBg(nl, color::red());
                lv_obj_t* nd = dot(column, 9, color::red());
                lv_obj_set_pos(nd, -5, y - 4);
            }
        }
    }

    // --- Colonne droite : mini-mois + aujourd'hui
    lv_obj_t* mc = card(right, 24, 18);
    lv_obj_set_width(mc, lv_pct(100));
    std::string mname = util::monthName(now.tm_mon);
    mname[0] = static_cast<char>(mname[0] - 32);
    label(mc, mname, &fig_s18, th().text);
    static int32_t cols[] = {LV_GRID_FR(1), LV_GRID_FR(1), LV_GRID_FR(1), LV_GRID_FR(1), LV_GRID_FR(1), LV_GRID_FR(1), LV_GRID_FR(1), LV_GRID_TEMPLATE_LAST};
    // Autant de lignes que de semaines dans le mois (4 à 6) : pas de vide en bas.
    static int32_t rows4[] = {24, 37, 37, 37, 37, LV_GRID_TEMPLATE_LAST};
    static int32_t rows5[] = {24, 37, 37, 37, 37, 37, LV_GRID_TEMPLATE_LAST};
    static int32_t rows6[] = {24, 37, 37, 37, 37, 37, 37, LV_GRID_TEMPLATE_LAST};
    lv_obj_t* mg = box(mc);
    lv_obj_set_size(mg, lv_pct(100), LV_SIZE_CONTENT);
    lv_obj_set_style_margin_top(mg, 10, 0);
    lv_obj_set_layout(mg, LV_LAYOUT_GRID);
    const char* letters[7] = {"L", "M", "M", "J", "V", "S", "D"};
    for (int i = 0; i < 7; i++) {
        lv_obj_t* l = label(mg, letters[i], &fig_s14, th().text3);
        lv_obj_set_grid_cell(l, LV_GRID_ALIGN_CENTER, i, 1, LV_GRID_ALIGN_CENTER, 0, 1);
    }
    struct tm first = now;
    first.tm_mday = 1;
    first.tm_hour = 12;
    mktime(&first);
    int offset = util::weekdayMon0(first);
    struct tm next = first;
    next.tm_mon += 1;
    mktime(&next);
    struct tm last = next;
    last.tm_mday = 0;
    mktime(&last);
    int days = last.tm_mday;
    int weeks = (offset + days + 6) / 7;
    lv_obj_set_grid_dsc_array(mg, cols, weeks <= 4 ? rows4 : weeks == 5 ? rows5 : rows6);
    for (int d = 1; d <= days; d++) {
        int idx = offset + d - 1;
        int c = idx % 7, r = idx / 7 + 1;
        if (r > 6) break;
        // Cases de taille fixe : le chiffre reste centré, avec ou sans point d'événement.
        lv_obj_t* cell = box(mg);
        lv_obj_set_size(cell, 34, 34);
        lv_obj_set_grid_cell(cell, LV_GRID_ALIGN_CENTER, c, 1, LV_GRID_ALIGN_CENTER, r, 1);
        bool isToday = d == now.tm_mday;
        if (isToday) {
            lv_obj_set_style_radius(cell, 17, 0);
            setBg(cell, color::red());
            lv_obj_center(label(cell, std::to_string(d), &fig_s16, color::white()));
        } else {
            lv_obj_center(label(cell, std::to_string(d), &fig_m16, c >= 5 ? th().text2 : th().text));
            if (std::find(a.monthDays.begin(), a.monthDays.end(), d) != a.monthDays.end())
                lv_obj_align(dot(cell, 4, th().text3), LV_ALIGN_BOTTOM_MID, 0, 0);
        }
    }

    lv_obj_t* tc = card(right, 24, 18);
    lv_obj_set_width(tc, lv_pct(100));
    lv_obj_set_flex_grow(tc, 1);
    lv_obj_t* th_ = row(tc, 0);
    lv_obj_set_width(th_, lv_pct(100));
    label(th_, "Aujourd’hui", &fig_s18, th().text);
    spacer(th_);
    std::string wd = util::weekdayName(now.tm_wday, true) + " " + std::to_string(now.tm_mday);
    label(th_, wd, &fig_m14, th().text2);
    if (!a.valid) {
        lv_obj_t* l = label(tc, "Ajoute ton identifiant Apple et un mot de passe pour app dans la console.", &fig_m16, th().text2);
        lv_label_set_long_mode(l, LV_LABEL_LONG_WRAP);
        lv_obj_set_width(l, lv_pct(100));
        lv_obj_set_style_pad_top(l, 10, 0);
        return;
    }
    if (a.today.empty()) {
        lv_obj_t* l = label(tc, "Rien de prévu aujourd’hui.", &fig_m16, th().text2);
        lv_obj_set_style_pad_top(l, 10, 0);
    }
    for (size_t i = 0; i < a.today.size() && i < 4; i++) {
        const Event& e = a.today[i];
        lv_obj_t* r = row(tc, 14);
        lv_obj_set_width(r, lv_pct(100));
        lv_obj_set_style_pad_ver(r, 11, 0);
        lv_obj_set_flex_align(r, LV_FLEX_ALIGN_START, LV_FLEX_ALIGN_START, LV_FLEX_ALIGN_START);
        if (i) {
            lv_obj_set_style_border_side(r, LV_BORDER_SIDE_TOP, 0);
            lv_obj_set_style_border_width(r, 1, 0);
            lv_obj_set_style_border_color(r, th().hairline, 0);
        }
        lv_obj_t* bar = box(r);
        lv_obj_set_size(bar, 4, 44);
        lv_obj_set_style_radius(bar, 2, 0);
        setBg(bar, hex(e.color));
        lv_obj_t* c = col(r, 2);
        lv_obj_set_flex_grow(c, 1);
        lv_obj_t* tr = row(c, 8);
        lv_obj_t* tt = label(tr, e.title, &fig_s16, th().text);
        fitLabel(tt, e.important ? 200 : 300);
        if (e.important) pill(tr, "Important", mix(th().card, color::red(), 50), lv_color_hex(0xFF8E86), &fig_s14, 22);
        label(c, (e.allDay ? std::string("Toute la journée") : e.start + " – " + e.end) + (e.location.empty() ? "" : " · " + e.location), &fig_m14,
              th().text2);
        if (e.reminderMinutes > 0) {
            lv_obj_t* rm = row(c, 6);
            icon(rm, ICON_BELL, &icons_16, lv_color_hex(0xFFB340));
            label(rm, "Rappel " + std::to_string(e.reminderMinutes) + " min avant", &fig_s14, lv_color_hex(0xFFB340));
        }
    }
}
