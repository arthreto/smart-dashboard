// Cinéma : films à l'affiche (affiches + séances par jour) et prochaines sorties.
#include <algorithm>
#include <functional>

#include "../app.h"
#include "../images.h"
#include "../ui.h"
#include "../util.h"

using namespace ui;

namespace {

/** Affiche « dessinée » quand le serveur n'a pas d'image (mode démo). */
lv_obj_t* poster(lv_obj_t* parent, const std::string& url, const std::string& title, int w, int h, int radius) {
    if (!url.empty()) return images::create(parent, url, w, h, radius, th().card2);
    static const uint32_t palette[][2] = {{0x1F5C7A, 0xE8B86B}, {0x2B0F3A, 0xF25C3B}, {0xFF7A3D, 0xFFD23F}, {0x25324A, 0x8C1C2B}, {0x1C4A3A, 0x6BD49A}};
    size_t k = std::hash<std::string>{}(title) % 5;
    lv_obj_t* p = box(parent);
    lv_obj_set_size(p, w, h);
    lv_obj_set_style_radius(p, radius, 0);
    lv_obj_set_style_clip_corner(p, true, 0);
    setBg(p, lv_color_hex(palette[k][0]));
    lv_obj_set_style_bg_grad_color(p, lv_color_hex(palette[k][1]), 0);
    lv_obj_set_style_bg_grad_dir(p, LV_GRAD_DIR_VER, 0);
    if (w >= 120) {
        lv_obj_t* l = label(p, title, &fig_b24, color::white());
        lv_label_set_long_mode(l, LV_LABEL_LONG_WRAP);
        lv_obj_set_width(l, w - 28);
        lv_obj_align(l, LV_ALIGN_BOTTOM_LEFT, 14, -14);
    }
    return p;
}

}  // namespace

void buildCinema(lv_obj_t* parent) {
    State& s = App::get().state();
    App& app = App::get();
    const Cinema& c = s.cinema;
    lv_obj_t* actions = pageHeader(parent, "Cinéma", c.valid ? c.cinemaName : "Choisis ton cinéma Pathé dans la console");
    if (!c.valid) {
        lv_obj_t* box_ = card(parent, 24, 30);
        lv_obj_set_size(box_, lv_pct(100), 0);
        lv_obj_set_flex_grow(box_, 1);
        lv_obj_set_flex_align(box_, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER);
        lv_obj_set_style_pad_row(box_, 14, 0);
        iconTile(box_, ICON_MOVIE, color::teal(), 96, &icons_40, 28);
        label(box_, "Programme indisponible", &fig_b32, th().text);
        label(box_, "Active l’intégration Pathé et choisis ton cinéma dans la console web.", &fig_m16, th().text2);
        return;
    }

    // Onglets des jours.
    int dayCount = static_cast<int>(std::min<size_t>(c.days.size(), 4));
    app.ui.cinemaDay = std::clamp(app.ui.cinemaDay, 0, std::max(0, dayCount - 1));
    lv_obj_t* tabs = row(actions, 2);
    setBg(tabs, th().card2);
    lv_obj_set_style_radius(tabs, 16, 0);
    lv_obj_set_style_pad_all(tabs, 4, 0);
    for (int i = 0; i < dayCount; i++) {
        bool sel = i == app.ui.cinemaDay;
        lv_obj_t* t = button(tabs, c.days[i].label, sel ? th().ring : th().card2, sel ? th().text : th().text2, 44, 0, &fig_s16);
        lv_obj_set_style_radius(t, 12, 0);
        onClick(t, [i] {
            App::get().ui.cinemaDay = i;
            App::get().invalidate();
        });
    }

    lv_obj_t* body = row(parent, 20);
    lv_obj_set_size(body, lv_pct(100), 0);
    lv_obj_set_flex_grow(body, 1);
    lv_obj_set_flex_align(body, LV_FLEX_ALIGN_START, LV_FLEX_ALIGN_START, LV_FLEX_ALIGN_START);

    lv_obj_t* left = col(body, 0);
    lv_obj_set_height(left, lv_pct(100));
    lv_obj_set_flex_grow(left, 1);
    label(left, "À L’AFFICHE", &fig_s14, th().text2);

    if (c.films.empty()) {
        lv_obj_t* l = label(left, "Aucun film programmé pour l’instant.", &fig_m16, th().text2);
        lv_obj_set_style_pad_top(l, 16, 0);
    } else {
        app.ui.cinemaFilm = std::clamp(app.ui.cinemaFilm, 0, static_cast<int>(c.films.size()) - 1);
        // Défilement horizontal si plus de 4 films.
        lv_obj_t* strip = row(left, 24);
        lv_obj_set_width(strip, lv_pct(100));
        lv_obj_set_style_pad_top(strip, 12, 0);
        lv_obj_set_style_pad_bottom(strip, 20, 0);
        lv_obj_set_style_pad_left(strip, 6, 0);
        lv_obj_add_flag(strip, LV_OBJ_FLAG_SCROLLABLE);
        lv_obj_set_scroll_dir(strip, LV_DIR_HOR);
        lv_obj_set_scrollbar_mode(strip, LV_SCROLLBAR_MODE_OFF);
        lv_obj_set_flex_align(strip, LV_FLEX_ALIGN_START, LV_FLEX_ALIGN_START, LV_FLEX_ALIGN_START);
        for (size_t i = 0; i < c.films.size(); i++) {
            const Film& f = c.films[i];
            bool sel = static_cast<int>(i) == app.ui.cinemaFilm;
            lv_obj_t* cell = col(strip, 8);
            lv_obj_set_width(cell, 166);
            lv_obj_t* p = poster(cell, f.posterUrl, f.title, 166, 240, 16);
            if (sel) {  // bordure dessinée par-dessus l'affiche (un contour extérieur serait rogné)
                lv_obj_set_style_border_width(p, 4, 0);
                lv_obj_set_style_border_color(p, color::teal(), 0);
                lv_obj_set_style_border_post(p, true, 0);
            }
            if (f.isNew) {
                lv_obj_t* nb = pill(p, "NOUVEAU", color::white(), lv_color_hex(0x0B0B0E), &fig_s14, 22);
                lv_obj_align(nb, LV_ALIGN_TOP_RIGHT, -10, 10);
            }
            lv_obj_t* tt = label(cell, f.title, &fig_s16, th().text);
            fitLabel(tt, 166);
            label(cell, f.genre + (f.duration.empty() ? "" : " · " + f.duration), &fig_m14, th().text2);
            int idx = static_cast<int>(i);
            onClick(cell, [idx] {
                App::get().ui.cinemaFilm = idx;
                App::get().invalidate();
            });
        }

        const Film& f = c.films[app.ui.cinemaFilm];
        lv_obj_t* sc = card(left, 24, 0);
        lv_obj_set_width(sc, lv_pct(100));
        lv_obj_set_flex_grow(sc, 1);  // (pas de marge ici : LVGL l'ajouterait en débordant en bas)
        lv_obj_set_style_pad_hor(sc, 22, 0);
        lv_obj_set_style_pad_ver(sc, 18, 0);
        lv_obj_set_flex_align(sc, LV_FLEX_ALIGN_START, LV_FLEX_ALIGN_START, LV_FLEX_ALIGN_START);
        lv_obj_t* info = col(sc, 4);
        label(info, f.title, &fig_b24, th().text);
        std::string meta = f.genre;
        if (!f.duration.empty()) meta += " · " + f.duration;
        if (!f.rating.empty()) meta += " · " + f.rating;
        label(info, meta, &fig_m14, th().text2);
        const std::vector<Show> noShows;
        const std::vector<Show>& shows =
            app.ui.cinemaDay < static_cast<int>(f.showsByDay.size()) ? f.showsByDay[app.ui.cinemaDay] : noShows;
        // Aujourd'hui : les séances passées sont estompées et la prochaine est mise en avant.
        bool today = app.ui.cinemaDay == 0;
        struct tm now = util::localNow();
        int nowMin = now.tm_hour * 60 + now.tm_min;
        int nextIdx = -1;
        for (size_t i = 0; i < shows.size(); i++)
            if (!today || util::minutesOf(shows[i].time) > nowMin) {
                nextIdx = static_cast<int>(i);
                break;
            }
        if (today && nextIdx >= 0) {
            int delta = util::minutesOf(shows[nextIdx].time) - nowMin;
            lv_obj_t* nx = row(info, 6);
            lv_obj_set_style_pad_top(nx, 4, 0);
            icon(nx, ICON_CLOCK, &icons_16, lv_color_hex(0x4FD8CC));
            label(nx, "Prochaine séance " + util::inDelay(static_cast<int64_t>(delta) * 60), &fig_s14, lv_color_hex(0x4FD8CC));
        }
        lv_obj_t* chips = row(sc, 10);
        lv_obj_set_width(chips, lv_pct(100));
        lv_obj_set_style_pad_top(chips, 18, 0);
        lv_obj_set_flex_flow(chips, LV_FLEX_FLOW_ROW_WRAP);
        lv_obj_set_style_pad_row(chips, 10, 0);
        if (shows.empty()) label(chips, "Pas de séance ce jour-là.", &fig_m16, th().text2);
        else if (nextIdx < 0) label(chips, "Plus de séance aujourd’hui.", &fig_m16, th().text2);
        for (size_t i = 0; i < shows.size() && i < 10; i++) {
            bool highlight = today && static_cast<int>(i) == nextIdx;
            bool past = today && (nextIdx < 0 || static_cast<int>(i) < nextIdx);
            lv_obj_t* ch = col(chips, 2);
            lv_obj_set_size(ch, 108, 64);
            lv_obj_set_flex_align(ch, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER);
            lv_obj_set_style_radius(ch, 16, 0);
            setBg(ch, highlight ? mix(th().card, color::teal(), 56) : th().chip);
            if (highlight) {
                lv_obj_set_style_border_width(ch, 2, 0);
                lv_obj_set_style_border_color(ch, color::teal(), 0);
            }
            if (past) lv_obj_set_style_opa(ch, LV_OPA_40, 0);
            label(ch, shows[i].time, &fig_s20, highlight ? lv_color_hex(0x5EE0D4) : th().text);
            label(ch, shows[i].tag, &fig_s14, highlight ? lv_color_hex(0x5EE0D4) : th().text2);
        }
    }

    // Prochaines sorties.
    lv_obj_t* up = card(body, 24, 0);
    lv_obj_set_size(up, 340, lv_pct(100));
    lv_obj_set_style_pad_hor(up, 20, 0);
    lv_obj_set_style_pad_ver(up, 18, 0);
    lv_obj_t* uh = row(up, 0);
    lv_obj_set_width(uh, lv_pct(100));
    label(uh, "Prochaines sorties", &fig_s18, th().text);
    spacer(uh);
    label(uh, "Près de chez toi", &fig_m14, th().text2);
    if (c.upcoming.empty()) {
        lv_obj_t* l = label(up, "Aucune sortie annoncée.", &fig_m16, th().text2);
        lv_obj_set_style_pad_top(l, 12, 0);
    }
    for (size_t i = 0; i < c.upcoming.size() && i < 5; i++) {
        const Upcoming& u = c.upcoming[i];
        lv_obj_t* r = row(up, 14);
        lv_obj_set_size(r, lv_pct(100), 98);
        if (i) {
            lv_obj_set_style_border_side(r, LV_BORDER_SIDE_TOP, 0);
            lv_obj_set_style_border_width(r, 1, 0);
            lv_obj_set_style_border_color(r, th().hairline, 0);
        }
        poster(r, u.posterUrl, u.title, 54, 80, 8);
        lv_obj_t* t = col(r, 2);
        lv_obj_set_flex_grow(t, 1);
        lv_obj_t* tl = label(t, u.title, &fig_s16, th().text);
        lv_label_set_long_mode(tl, LV_LABEL_LONG_DOT);
        lv_obj_set_width(tl, 170);
        label(t, util::shortFrenchDate(u.date), &fig_s14, lv_color_hex(0x4FD8CC));
        label(t, u.genre, &fig_m14, th().text2);
        lv_obj_t* bell = iconButton(r, u.notify ? ICON_BELL_FILLED : ICON_BELL, 44, u.notify ? mix(th().card, color::teal(), 60) : th().chip,
                                    u.notify ? lv_color_hex(0x4FD8CC) : th().text2, &icons_20);
        std::string id = u.id;
        bool next = !u.notify;
        onClick(bell, [id, next] { App::get().setCinemaNotify(id, next); });
    }
}
