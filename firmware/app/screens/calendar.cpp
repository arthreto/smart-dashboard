// Calendrier : vue semaine façon Apple ou vue mois, navigation libre dans le temps
// (jours, semaines, mois, années) et détail du jour choisi.
#include <algorithm>
#include <cstdio>
#include <ctime>

#include "../app.h"
#include "../ui.h"
#include "../util.h"

using namespace ui;

namespace {

constexpr int GRID_TOP = 9;  // marge pour que l'heure soit centrée sur sa ligne, même la première
constexpr int LINE_H = 18;   // hauteur d'une ligne de texte fig_s14 / fig_m14
const char* const DAY_SHORT[7] = {"LUN.", "MAR.", "MER.", "JEU.", "VEN.", "SAM.", "DIM."};
const char* const DAY_LETTER[7] = {"L", "M", "M", "J", "V", "S", "D"};

int isoWeek(const struct tm& t) {
    struct tm c = t;
    int wd = (c.tm_wday + 6) % 7;
    c.tm_mday += 3 - wd;  // jeudi de la semaine
    c.tm_hour = 12;
    c.tm_isdst = -1;
    mktime(&c);
    return c.tm_yday / 7 + 1;
}

lv_color_t eventText(lv_color_t base) { return th().dark ? mix(base, color::white(), 120) : mix(base, color::black(), 70); }
lv_color_t todayRed() { return th().dark ? lv_color_hex(0xFF6961) : lv_color_hex(0xD70015); }

std::string capitalize(std::string s) {
    if (!s.empty() && s[0] >= 'a' && s[0] <= 'z') s[0] = static_cast<char>(s[0] - 32);
    return s;
}

struct tm tmOf(const std::string& iso) {
    struct tm t{};
    if (!util::parseIso(iso, t)) t = util::localNow();
    return t;
}

/** Premier jour (lundi) de la grille du mois contenant `iso`, et nombre de semaines. */
std::string monthGridStart(const std::string& iso, int& weeks) {
    struct tm t = tmOf(iso);
    t.tm_mday = 1;
    t.tm_isdst = -1;
    mktime(&t);
    int offset = util::weekdayMon0(t);
    struct tm last = t;
    last.tm_mon += 1;
    last.tm_mday = 0;
    last.tm_isdst = -1;
    mktime(&last);
    weeks = (offset + last.tm_mday + 6) / 7;
    return util::addDaysIso(util::isoDate(t), -offset);
}

std::string firstOfMonth(const std::string& iso, int deltaMonths) {
    struct tm t = tmOf(iso);
    t.tm_mday = 1;
    t.tm_mon += deltaMonths;
    t.tm_isdst = -1;
    mktime(&t);
    return util::isoDate(t);
}

/** « Lundi 20 octobre » (ou Aujourd'hui / Demain). */
std::string dayTitle(const std::string& iso) {
    std::string rel = util::relativeDay(iso);
    if (rel == "Aujourd’hui" || rel == "Demain") return rel;
    struct tm t = tmOf(iso);
    return util::weekdayName(t.tm_wday, true) + " " + std::to_string(t.tm_mday) + " " + util::monthName(t.tm_mon);
}

void select(const std::string& iso) {
    App::get().ui.calSelected = iso;
    App::get().invalidate();
}

// ---------------------------------------------------------------- vue semaine

/** Couloirs côte à côte pour les événements qui se chevauchent dans une journée. */
struct Placed {
    const Event* e;
    int s, en, lane, lanes;
};

std::vector<Placed> layoutDay(const DayEvents& de) {
    std::vector<Placed> out;
    for (const Event& e : de.events) {
        if (e.allDay) continue;
        int s = util::minutesOf(e.start), en = util::minutesOf(e.end);
        if (s < 0) continue;
        if (en <= s) en = std::min(24 * 60, s + 60);
        en = std::max(en, s + 30);  // un rendez-vous très court garde une hauteur lisible
        out.push_back({&e, s, en, 0, 1});
    }
    std::sort(out.begin(), out.end(), [](const Placed& x, const Placed& y) { return x.s < y.s || (x.s == y.s && x.en > y.en); });
    // Groupes d'événements qui se chevauchent : chacun reçoit un couloir libre.
    size_t i = 0;
    while (i < out.size()) {
        size_t j = i;
        int groupEnd = out[i].en;
        std::vector<int> laneEnd;
        for (; j < out.size() && out[j].s < groupEnd; j++) {
            int lane = 0;
            while (lane < static_cast<int>(laneEnd.size()) && laneEnd[lane] > out[j].s) lane++;
            if (lane == static_cast<int>(laneEnd.size())) laneEnd.push_back(0);
            laneEnd[lane] = out[j].en;
            out[j].lane = lane;
            groupEnd = std::max(groupEnd, out[j].en);
        }
        for (size_t k = i; k < j; k++) out[k].lanes = static_cast<int>(laneEnd.size());
        i = j;
    }
    return out;
}

/** Vue sur 1, 3 ou 7 jours : grille horaire de 0 h à 24 h qui défile, événements en entier. */
void buildDays(lv_obj_t* wk, const std::string& start, int count, const std::string& today, const std::string& selected) {
    App& app = App::get();
    std::vector<std::string> days;
    for (int d = 0; d < count; d++) days.push_back(util::addDaysIso(start, d));
    const int HOUR_H = count == 7 ? 44 : 60;
    const int GUTTER = 52;

    // En-têtes des jours.
    lv_obj_t* heads = row(wk, 0);
    lv_obj_set_size(heads, lv_pct(100), 60);
    lv_obj_t* gutter = box(heads);
    lv_obj_set_width(gutter, GUTTER);
    for (const std::string& date : days) {
        struct tm t = tmOf(date);
        bool isToday = date == today, isSel = date == selected;
        lv_obj_t* c = row(heads, 8);
        lv_obj_set_flex_grow(c, 1);
        lv_obj_set_height(c, 60);
        lv_obj_set_flex_align(c, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER);
        if (count == 7) lv_obj_set_flex_flow(c, LV_FLEX_FLOW_COLUMN);
        std::string dayName = count == 7 ? std::string(DAY_SHORT[util::weekdayMon0(t)]) : util::weekdayName(t.tm_wday, true);
        label(c, dayName, count == 7 ? &fig_s14 : &fig_s18, isToday ? todayRed() : th().text2);
        lv_obj_t* num = box(c);
        lv_obj_set_size(num, 34, 34);
        lv_obj_set_style_radius(num, 17, 0);
        if (isToday) {
            setBg(num, color::red());
            lv_obj_center(label(num, std::to_string(t.tm_mday), &fig_s20, color::white()));
        } else {
            if (isSel) setBg(num, th().ring);
            lv_obj_center(label(num, std::to_string(t.tm_mday), &fig_s22, th().text));
        }
        onClick(c, [date] { select(date); });
    }

    // Journées entières : une ligne par événement (titre complet si la colonne le permet).
    size_t allDayMax = 0;
    for (const std::string& date : days)
        if (const DayEvents* de = app.agendaDay(date))
            allDayMax = std::max<size_t>(allDayMax, std::count_if(de->events.begin(), de->events.end(), [](const Event& e) { return e.allDay; }));
    if (allDayMax) {
        const int ROW_H = 26;
        int rows = static_cast<int>(std::min<size_t>(allDayMax, count == 7 ? 2 : 3));
        lv_obj_t* band = row(wk, 0);
        lv_obj_set_size(band, lv_pct(100), rows * ROW_H + 6);
        lv_obj_set_flex_align(band, LV_FLEX_ALIGN_START, LV_FLEX_ALIGN_START, LV_FLEX_ALIGN_START);
        lv_obj_t* lg = box(band);
        lv_obj_set_size(lg, GUTTER, rows * ROW_H);
        lv_obj_t* ll = label(lg, "Jour", &fig_m14, th().text3);
        lv_obj_set_pos(ll, 0, (ROW_H - LINE_H) / 2);
        for (const std::string& date : days) {
            lv_obj_t* cell = col(band, 3);
            lv_obj_set_height(cell, rows * ROW_H + 6);
            lv_obj_set_flex_grow(cell, 1);
            lv_obj_set_style_pad_hor(cell, 2, 0);
            const DayEvents* de = app.agendaDay(date);
            if (!de) continue;
            std::vector<const Event*> list;
            for (const Event& e : de->events)
                if (e.allDay) list.push_back(&e);
            for (size_t i = 0; i < list.size() && static_cast<int>(i) < rows; i++) {
                bool more = static_cast<int>(i) == rows - 1 && list.size() > static_cast<size_t>(rows);
                lv_color_t base = hex(list[i]->color);
                lv_obj_t* p = box(cell);
                lv_obj_set_size(p, lv_pct(100), ROW_H - 3);
                lv_obj_set_style_radius(p, 6, 0);
                setBg(p, mix(th().card, base, 70));
                std::string text = more ? "+" + std::to_string(list.size() - i) + " autres" : list[i]->title;
                lv_obj_t* t = label(p, text, &fig_s14, eventText(base));
                lv_label_set_long_mode(t, LV_LABEL_LONG_DOT);
                lv_obj_set_width(t, lv_pct(100));
                lv_obj_set_style_pad_hor(t, 6, 0);
                lv_obj_align(t, LV_ALIGN_LEFT_MID, 0, 0);
                onClick(p, [date] { select(date); });
            }
        }
    }

    // Grille horaire complète (0 h – 24 h) dans une zone qui défile.
    lv_obj_t* scroller = col(wk, 0);
    lv_obj_set_width(scroller, lv_pct(100));
    lv_obj_set_flex_grow(scroller, 1);
    lv_obj_add_flag(scroller, LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_set_scroll_dir(scroller, LV_DIR_VER);
    lv_obj_set_scrollbar_mode(scroller, LV_SCROLLBAR_MODE_ACTIVE);
    lv_obj_t* grid = row(scroller, 0);
    lv_obj_set_size(grid, lv_pct(100), GRID_TOP * 2 + HOUR_H * 24);
    lv_obj_set_flex_align(grid, LV_FLEX_ALIGN_START, LV_FLEX_ALIGN_START, LV_FLEX_ALIGN_START);
    lv_obj_t* hours = box(grid);
    lv_obj_set_size(hours, GUTTER, lv_pct(100));
    for (int h = 0; h <= 24; h++) {
        char b[16];
        snprintf(b, sizeof b, "%02d:00", h % 100);
        lv_obj_t* l = label(hours, b, &fig_m14, th().text3);
        lv_obj_set_pos(l, 0, GRID_TOP + h * HOUR_H - LINE_H / 2);
    }

    struct tm now = util::localNow();
    int nowMin = now.tm_hour * 60 + now.tm_min;
    int firstEvent = 24 * 60;
    for (const std::string& date : days) {
        lv_obj_t* column = box(grid);
        lv_obj_set_height(column, lv_pct(100));
        lv_obj_set_flex_grow(column, 1);
        lv_obj_set_style_border_side(column, LV_BORDER_SIDE_LEFT, 0);
        lv_obj_set_style_border_width(column, 1, 0);
        lv_obj_set_style_border_color(column, th().hairline, 0);
        if (date == today) setBg(column, mix(th().card, color::red(), 12));
        else if (date == selected) setBg(column, mix(th().card, th().text, 10));
        onClick(column, [date] { select(date); });
        for (int h = 0; h <= 24; h++) {
            lv_obj_t* line = box(column);
            lv_obj_set_size(line, lv_pct(100), 1);
            lv_obj_set_pos(line, 0, GRID_TOP + h * HOUR_H);
            setBg(line, th().hairline);
        }
        lv_obj_update_layout(column);
        int colW = lv_obj_get_width(column) - 6;
        if (const DayEvents* de = app.agendaDay(date)) {
            for (const Placed& p : layoutDay(*de)) {
                const Event& e = *p.e;
                firstEvent = std::min(firstEvent, p.s);
                int top = p.s * HOUR_H / 60, h = std::max(26, (p.en - p.s) * HOUR_H / 60 - 2);
                int laneW = colW / p.lanes;
                lv_color_t base = hex(e.color);
                lv_obj_t* ev = col(column, 1);
                lv_obj_set_size(ev, laneW - 3, h);
                lv_obj_set_pos(ev, 3 + p.lane * laneW, GRID_TOP + top + 1);
                setBg(ev, mix(th().card, base, 60));
                lv_obj_set_style_radius(ev, 8, 0);
                lv_obj_set_style_pad_hor(ev, 7, 0);
                lv_obj_set_style_pad_ver(ev, 4, 0);
                lv_obj_set_style_clip_corner(ev, true, 0);
                lv_obj_set_style_border_side(ev, LV_BORDER_SIDE_LEFT, 0);
                lv_obj_set_style_border_width(ev, 3, 0);
                lv_obj_set_style_border_color(ev, base, 0);
                // Tout ce qui tient : titre (sur plusieurs lignes), heures, lieu.
                int room = std::max(1, (h - 8) / LINE_H);
                lv_obj_t* t = label(ev, e.title, &fig_s14, eventText(base));
                lv_label_set_long_mode(t, room > 1 ? LV_LABEL_LONG_WRAP : LV_LABEL_LONG_DOT);
                lv_obj_set_width(t, lv_pct(100));
                int titleLines = room > 1 ? std::min(room - 1, 1 + static_cast<int>(lv_text_get_width(e.title.c_str(), static_cast<uint32_t>(e.title.size()), &fig_s14, 0)) / std::max(20, laneW - 16)) : 1;
                if (room > 1) lv_obj_set_height(t, titleLines * LINE_H);
                int left = room - titleLines;
                if (left > 0) {
                    lv_obj_t* tm = label(ev, e.start + " – " + (e.end == "24:00" ? "minuit" : e.end), &fig_m14, eventText(base));
                    lv_label_set_long_mode(tm, LV_LABEL_LONG_DOT);
                    lv_obj_set_size(tm, lv_pct(100), LINE_H);
                    left--;
                }
                if (left > 0 && !e.location.empty()) {
                    lv_obj_t* lo = label(ev, e.location, &fig_m14, eventText(base));
                    lv_label_set_long_mode(lo, LV_LABEL_LONG_DOT);
                    lv_obj_set_width(lo, lv_pct(100));
                }
                onClick(ev, [date] { select(date); });
            }
        }
        if (date == today) {
            int y = GRID_TOP + nowMin * HOUR_H / 60;
            lv_obj_t* nl = box(column);
            lv_obj_set_size(nl, lv_pct(100), 2);
            lv_obj_set_pos(nl, 0, y);
            setBg(nl, color::red());
            lv_obj_t* nd = dot(column, 9, color::red());
            lv_obj_set_pos(nd, -5, y - 4);
        }
    }

    // Position de départ : celle laissée par l'utilisateur, sinon un peu avant l'heure
    // actuelle (aujourd'hui affiché) ou le premier événement, sinon 7 h.
    lv_obj_update_layout(scroller);
    int y = app.ui.calScroll;
    if (y < 0) {
        bool todayShown = std::find(days.begin(), days.end(), today) != days.end();
        int startMin = todayShown ? std::max(0, nowMin - 90) : (firstEvent < 24 * 60 ? std::max(0, firstEvent - 30) : 7 * 60);
        y = startMin * HOUR_H / 60;
    }
    lv_obj_scroll_to_y(scroller, y, LV_ANIM_OFF);
    onEvent(scroller, LV_EVENT_SCROLL_END, [scroller](lv_event_t*) { App::get().ui.calScroll = lv_obj_get_scroll_y(scroller); });
}

// ---------------------------------------------------------------- vue mois

void buildMonth(lv_obj_t* mc, const std::string& anchor, const std::string& today, const std::string& selected) {
    App& app = App::get();
    int weeks = 5;
    std::string start = monthGridStart(anchor, weeks);
    int month = tmOf(anchor).tm_mon;

    lv_obj_t* heads = row(mc, 0);
    lv_obj_set_size(heads, lv_pct(100), 30);
    for (int i = 0; i < 7; i++) {
        lv_obj_t* h = box(heads);
        lv_obj_set_flex_grow(h, 1);
        lv_obj_set_height(h, 30);
        lv_obj_center(label(h, DAY_SHORT[i], &fig_s14, i >= 5 ? th().text3 : th().text2));
    }
    const int CELL_H = (520 - 30) / weeks;
    const int maxLines = std::max(1, (CELL_H - 34) / 20);
    for (int w = 0; w < weeks; w++) {
        lv_obj_t* r = row(mc, 0);
        lv_obj_set_size(r, lv_pct(100), CELL_H);
        for (int d = 0; d < 7; d++) {
            std::string date = util::addDaysIso(start, w * 7 + d);
            struct tm t = tmOf(date);
            bool other = t.tm_mon != month, isToday = date == today, isSel = date == selected;
            lv_obj_t* cell = col(r, 2);
            lv_obj_set_flex_grow(cell, 1);
            lv_obj_set_height(cell, CELL_H);
            lv_obj_set_style_pad_all(cell, 4, 0);
            lv_obj_set_style_border_side(cell, LV_BORDER_SIDE_TOP, 0);
            lv_obj_set_style_border_width(cell, 1, 0);
            lv_obj_set_style_border_color(cell, th().hairline, 0);
            lv_obj_set_style_radius(cell, 10, 0);
            if (isSel) setBg(cell, mix(th().card, th().text, 16));
            lv_obj_t* num = box(cell);
            lv_obj_set_size(num, 28, 28);
            lv_obj_set_style_radius(num, 14, 0);
            if (isToday) setBg(num, color::red());
            lv_obj_center(label(num, std::to_string(t.tm_mday), isToday ? &fig_s16 : &fig_m16,
                                isToday ? color::white() : other ? th().text3 : (d >= 5 ? th().text2 : th().text)));
            const DayEvents* de = app.agendaDay(date);
            if (de) {
                int shown = 0;
                int total = static_cast<int>(de->events.size());
                for (const Event& e : de->events) {
                    if (shown >= maxLines) break;
                    bool last = shown == maxLines - 1 && total > maxLines;
                    lv_obj_t* line = row(cell, 4);
                    lv_obj_set_size(line, lv_pct(100), 18);
                    if (last) {
                        label(line, "+" + std::to_string(total - shown) + " autres", &fig_s14, th().text2);
                    } else {
                        lv_obj_t* bar = box(line);
                        lv_obj_set_size(bar, 3, 14);
                        lv_obj_set_style_radius(bar, 2, 0);
                        setBg(bar, hex(e.color));
                        lv_obj_t* tl = label(line, e.title, &fig_m14, other ? th().text3 : th().text);
                        lv_label_set_long_mode(tl, LV_LABEL_LONG_CLIP);
                        lv_obj_set_flex_grow(tl, 1);
                    }
                    shown++;
                }
            }
            onClick(cell, [date] { select(date); });
        }
    }
}

// ---------------------------------------------------------------- mini-mois (vue semaine)

void buildMiniMonth(lv_obj_t* parent, const std::string& anchor, const std::string& today, const std::string& selected) {
    App& app = App::get();
    lv_obj_t* mc = card(parent, 24, 18);
    lv_obj_set_width(mc, lv_pct(100));
    struct tm a = tmOf(anchor);
    lv_obj_t* head = row(mc, 6);
    lv_obj_set_width(head, lv_pct(100));
    label(head, capitalize(util::monthName(a.tm_mon)) + " " + std::to_string(a.tm_year + 1900), &fig_s18, th().text);
    spacer(head);
    int weeks = 5;
    std::string start = monthGridStart(anchor, weeks);
    static int32_t cols[] = {LV_GRID_FR(1), LV_GRID_FR(1), LV_GRID_FR(1), LV_GRID_FR(1), LV_GRID_FR(1), LV_GRID_FR(1), LV_GRID_FR(1), LV_GRID_TEMPLATE_LAST};
    static int32_t rows4[] = {24, 37, 37, 37, 37, LV_GRID_TEMPLATE_LAST};
    static int32_t rows5[] = {24, 37, 37, 37, 37, 37, LV_GRID_TEMPLATE_LAST};
    static int32_t rows6[] = {24, 37, 37, 37, 37, 37, 37, LV_GRID_TEMPLATE_LAST};
    lv_obj_t* mg = box(mc);
    lv_obj_set_size(mg, lv_pct(100), LV_SIZE_CONTENT);
    lv_obj_set_style_margin_top(mg, 10, 0);
    lv_obj_set_layout(mg, LV_LAYOUT_GRID);
    lv_obj_set_grid_dsc_array(mg, cols, weeks <= 4 ? rows4 : weeks == 5 ? rows5 : rows6);
    for (int i = 0; i < 7; i++) {
        lv_obj_t* l = label(mg, DAY_LETTER[i], &fig_s14, th().text3);
        lv_obj_set_grid_cell(l, LV_GRID_ALIGN_CENTER, i, 1, LV_GRID_ALIGN_CENTER, 0, 1);
    }
    for (int i = 0; i < weeks * 7; i++) {
        std::string date = util::addDaysIso(start, i);
        struct tm t = tmOf(date);
        if (t.tm_mon != a.tm_mon) continue;
        lv_obj_t* cell = box(mg);
        lv_obj_set_size(cell, 34, 34);
        lv_obj_set_grid_cell(cell, LV_GRID_ALIGN_CENTER, i % 7, 1, LV_GRID_ALIGN_CENTER, i / 7 + 1, 1);
        lv_obj_set_style_radius(cell, 17, 0);
        bool isToday = date == today, isSel = date == selected;
        if (isToday) setBg(cell, color::red());
        else if (isSel) setBg(cell, th().ring);
        lv_obj_center(label(cell, std::to_string(t.tm_mday), isToday ? &fig_s16 : &fig_m16,
                            isToday ? color::white() : (i % 7 >= 5 ? th().text2 : th().text)));
        const DayEvents* de = app.agendaDay(date);
        if (!isToday && de && !de->events.empty()) lv_obj_align(dot(cell, 4, th().text3), LV_ALIGN_BOTTOM_MID, 0, 0);
        onClick(cell, [date] {
            App::get().ui.calAnchor = date;  // la semaine commence au jour touché
            select(date);
        });
    }
}

// ---------------------------------------------------------------- détail du jour

void buildDayPanel(lv_obj_t* parent, const std::string& date, bool grow) {
    App& app = App::get();
    lv_obj_t* tc = card(parent, 24, 18);
    lv_obj_set_width(tc, lv_pct(100));
    if (grow) lv_obj_set_flex_grow(tc, 1);
    lv_obj_t* th_ = row(tc, 0);
    lv_obj_set_width(th_, lv_pct(100));
    std::string title = dayTitle(date);
    label(th_, title, &fig_s18, title == "Aujourd’hui" ? todayRed() : th().text);
    spacer(th_);
    struct tm t = tmOf(date);
    if (title == "Aujourd’hui" || title == "Demain")
        label(th_, util::weekdayName(t.tm_wday, true) + " " + std::to_string(t.tm_mday), &fig_m14, th().text2);

    lv_obj_t* list = col(tc, 0);
    lv_obj_set_width(list, lv_pct(100));
    lv_obj_set_flex_grow(list, 1);
    lv_obj_add_flag(list, LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_set_scroll_dir(list, LV_DIR_VER);
    lv_obj_set_scrollbar_mode(list, LV_SCROLLBAR_MODE_OFF);
    const DayEvents* de = app.agendaDay(date);
    if (!de) {
        lv_obj_t* l = label(list, app.agendaLoading() ? "Chargement…" : app.agendaError().empty() ? "Pas encore chargé." : app.agendaError(),
                            &fig_m16, th().text2);
        lv_label_set_long_mode(l, LV_LABEL_LONG_WRAP);
        lv_obj_set_width(l, lv_pct(100));
        lv_obj_set_style_pad_top(l, 10, 0);
        return;
    }
    if (de->events.empty()) {
        lv_obj_t* l = label(list, "Rien de prévu ce jour-là.", &fig_m16, th().text2);
        lv_obj_set_style_pad_top(l, 10, 0);
    }
    for (size_t i = 0; i < de->events.size(); i++) {
        const Event& e = de->events[i];
        lv_obj_t* r = row(list, 14);
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
        std::string when = e.allDay ? std::string("Toute la journée")
                                    : (e.start == "00:00" && e.end == "24:00" ? std::string("Toute la journée")
                                                                                : e.start + " – " + (e.end == "24:00" ? "minuit" : e.end));
        lv_obj_t* meta = label(c, when + (e.location.empty() ? "" : " · " + e.location), &fig_m14, th().text2);
        fitLabel(meta, 300);
        if (e.reminderMinutes > 0) {
            lv_obj_t* rm = row(c, 6);
            icon(rm, ICON_BELL, &icons_16, lv_color_hex(0xFFB340));
            label(rm, "Rappel " + std::to_string(e.reminderMinutes) + " min avant", &fig_s14, lv_color_hex(0xFFB340));
        }
    }
}

lv_obj_t* navButton(lv_obj_t* parent, const char* glyph, std::function<void()> fn) {
    lv_obj_t* b = iconButton(parent, glyph, 52, th().card2, th().text, &icons_24);
    onClick(b, std::move(fn));
    return b;
}

}  // namespace

void buildCalendar(lv_obj_t* parent) {
    App& app = App::get();
    const Agenda& a = app.state().agenda;
    struct tm now = util::localNow();
    const std::string today = util::isoDate(now);
    int view = app.ui.calendarView;
    if (view != 0 && view != 1 && view != 2 && view != 3) view = app.ui.calendarView = 3;
    bool month = view == 2;
    const int span = view == 0 ? 1 : view == 3 ? 3 : 7;  // jours affichés hors vue mois
    std::string anchor = app.ui.calAnchor.empty() ? today : app.ui.calAnchor;
    std::string selected = app.ui.calSelected.empty() ? today : app.ui.calSelected;

    // Titre : le mois affiché (vue mois) ou la période de la semaine.
    std::string title, subtitle;
    struct tm at = tmOf(anchor);
    if (month) {
        title = capitalize(util::monthName(at.tm_mon)) + " " + std::to_string(at.tm_year + 1900);
    } else if (span == 1) {
        title = util::weekdayName(at.tm_wday, true) + " " + std::to_string(at.tm_mday) + " " + util::monthName(at.tm_mon) + " " +
                std::to_string(at.tm_year + 1900);
        subtitle = "Semaine " + std::to_string(isoWeek(at));
    } else {
        struct tm end = tmOf(util::addDaysIso(anchor, span - 1));
        title = std::to_string(at.tm_mday) + (at.tm_mon == end.tm_mon ? "" : " " + util::monthName(at.tm_mon)) + " – " +
                std::to_string(end.tm_mday) + " " + util::monthName(end.tm_mon) + " " + std::to_string(end.tm_year + 1900);
        subtitle = "Semaine " + std::to_string(isoWeek(at));
    }
    if (!a.valid) subtitle = "Connecte ton calendrier iCloud dans la console";
    else if (app.agendaLoading()) subtitle += subtitle.empty() ? "Chargement…" : " · chargement…";
    else if (!app.agendaError().empty()) subtitle += (subtitle.empty() ? "" : " · ") + app.agendaError();
    else subtitle += subtitle.empty() ? "Calendrier iCloud" : " · iCloud";

    lv_obj_t* actions = pageHeader(parent, title, subtitle);
    // Jour | 3 jours | Semaine | Mois
    lv_obj_t* seg = row(actions, 2);
    setBg(seg, th().card2);
    lv_obj_set_style_radius(seg, 16, 0);
    lv_obj_set_style_pad_all(seg, 4, 0);
    static const struct {
        int v;
        const char* label;
    } views[] = {{0, "Jour"}, {3, "3 jours"}, {1, "Semaine"}, {2, "Mois"}};
    for (const auto& vw : views) {
        bool sel = view == vw.v;
        lv_obj_t* b = button(seg, vw.label, sel ? th().ring : th().card2, sel ? th().text : th().text2, 44, 0, &fig_s16);
        lv_obj_set_style_radius(b, 12, 0);
        int v = vw.v;
        onClick(b, [v] {
            App& ap = App::get();
            ap.ui.calendarView = v;
            ap.ui.calAnchor = ap.ui.calSelected;  // la vue commence au jour choisi
            ap.ui.calScroll = -1;
            ap.invalidate();
        });
    }
    // Navigation : « année (vue mois), ‹ période, Aujourd'hui, période ›, année ».
    // Le jour détaillé suit la navigation : premier jour de la semaine ou du mois affiché
    // (aujourd'hui s'il en fait partie).
    auto go = [today, span](const std::string& newAnchor, bool monthView) {
        App& ap = App::get();
        ap.ui.calAnchor = newAnchor;
        ap.ui.calScroll = -1;
        std::string sel = newAnchor;
        if (monthView && today.substr(0, 7) == newAnchor.substr(0, 7)) sel = today;
        if (!monthView && today >= newAnchor && today < util::addDaysIso(newAnchor, span)) sel = today;
        ap.ui.calSelected = sel;
        ap.invalidate();
    };
    if (month) navButton(actions, ICON_CHEVRON_LEFT, [anchor, go] { go(firstOfMonth(anchor, -12), true); });
    navButton(actions, ICON_CHEVRON_LEFT, [anchor, month, go, span] { go(month ? firstOfMonth(anchor, -1) : util::addDaysIso(anchor, -span), month); });
    lv_obj_t* tb = button(actions, "Aujourd’hui", mix(th().bg, color::red(), 40), todayRed(), 52);
    onClick(tb, [] {
        App& ap = App::get();
        ap.ui.calAnchor.clear();
        ap.ui.calSelected.clear();
        ap.ui.calScroll = -1;
        ap.invalidate();
    });
    navButton(actions, ICON_CHEVRON_RIGHT, [anchor, month, go, span] { go(month ? firstOfMonth(anchor, 1) : util::addDaysIso(anchor, span), month); });
    if (month) navButton(actions, ICON_CHEVRON_RIGHT, [anchor, go] { go(firstOfMonth(anchor, 12), true); });
    if (month) {
        // Les doubles flèches (année) se distinguent des simples par un libellé.
        lv_obj_t* first = lv_obj_get_child(actions, 1);
        lv_obj_t* last = lv_obj_get_child(actions, -1);
        for (lv_obj_t* b : {first, last}) {
            lv_obj_t* yl = label(b, b == first ? "-1 an" : "+1 an", &fig_s14, th().text2);
            lv_obj_align(yl, LV_ALIGN_BOTTOM_MID, 0, 2);
            lv_obj_set_size(b, 64, 52);
            lv_obj_set_style_radius(b, 16, 0);
            lv_obj_t* ic = lv_obj_get_child(b, 0);
            lv_obj_align(ic, LV_ALIGN_TOP_MID, 0, 4);
        }
    }

    // Données à charger : la période affichée (+ le mois du mini-calendrier en vue semaine).
    if (a.valid) {
        int weeks = 5;
        std::string gridStart = monthGridStart(month ? anchor : selected, weeks);
        std::string gridEnd = util::addDaysIso(gridStart, weeks * 7);
        std::string from = gridStart, to = gridEnd;
        if (!month) {
            std::string wEnd = util::addDaysIso(anchor, span);
            from = std::min(from, anchor);
            to = std::max(to, wEnd);
            // Plus de 62 jours (semaine loin du mois choisi) : la semaine seule.
            struct tm f = tmOf(from), t = tmOf(to);
            if (difftime(mktime(&t), mktime(&f)) > 60 * 86400.0) {
                from = anchor;
                to = wEnd;
            }
        }
        app.requestAgenda(from, to);
    }

    lv_obj_t* body = row(parent, 20);
    lv_obj_set_size(body, lv_pct(100), 0);
    lv_obj_set_flex_grow(body, 1);
    lv_obj_set_flex_align(body, LV_FLEX_ALIGN_START, LV_FLEX_ALIGN_START, LV_FLEX_ALIGN_START);

    lv_obj_t* main = card(body, 24, 0);
    lv_obj_set_height(main, lv_pct(100));
    lv_obj_set_flex_grow(main, 1);
    lv_obj_set_style_pad_hor(main, 18, 0);
    lv_obj_set_style_pad_top(main, 14, 0);
    lv_obj_set_style_pad_bottom(main, 16, 0);
    // Colonne de droite créée tout de suite : la largeur de la vue principale est alors
    // définitive et peut être mesurée.
    lv_obj_t* right = col(body, 14);
    lv_obj_set_size(right, 380, lv_pct(100));

    if (month) buildMonth(main, anchor, today, selected);
    else buildDays(main, anchor, span, today, selected);

    if (!month) buildMiniMonth(right, selected, today, selected);
    buildDayPanel(right, selected, true);
}
