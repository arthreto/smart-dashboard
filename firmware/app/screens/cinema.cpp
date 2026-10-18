// Cinéma : tous les films à l'affiche (grille d'affiches), fiche du film choisi (résumé,
// réalisation, distribution, séances) avec sa bande-annonce, et prochaines sorties.
#include <algorithm>
#include <functional>

#include "../app.h"
#include "../images.h"
#include "../ui.h"
#include "../util.h"

using namespace ui;

namespace {

constexpr int POSTER_W = 166, POSTER_H = 240;
const lv_color_t TEAL_TEXT = lv_color_hex(0x4FD8CC);

lv_obj_t* g_trailerLayer = nullptr;

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

void closeTrailer() {
    if (g_trailerLayer) lv_obj_delete_async(g_trailerLayer);
    g_trailerLayer = nullptr;
}

/** Bande-annonce : un QR code à scanner avec le téléphone (la tablette ne lit pas de vidéo). */
void openTrailer(const std::string& title, const std::string& url, bool isPage) {
    if (g_trailerLayer) lv_obj_delete(g_trailerLayer);
    lv_obj_t* layer = box(lv_layer_top());
    g_trailerLayer = layer;
    lv_obj_set_size(layer, SCREEN_W, SCREEN_H);
    lv_obj_add_flag(layer, LV_OBJ_FLAG_CLICKABLE);
    setBg(layer, color::black(), 170);
    auto close = [] { closeTrailer(); };
    onClick(layer, close);
    lv_obj_t* c = card(layer, 28, 30);
    lv_obj_set_width(c, 620);
    lv_obj_center(c);
    lv_obj_add_flag(c, LV_OBJ_FLAG_CLICKABLE);  // un toucher sur la carte ne ferme pas
    lv_obj_set_flex_align(c, LV_FLEX_ALIGN_START, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER);
    lv_obj_set_style_pad_row(c, 14, 0);
    iconTile(c, ICON_PLAY_FILLED, color::teal(), 56, &icons_24, 18);
    lv_obj_t* t = label(c, "Bande-annonce · " + title, &fig_s20, th().text);
    lv_label_set_long_mode(t, LV_LABEL_LONG_DOT);
    lv_obj_set_width(t, 560);
    lv_obj_set_style_text_align(t, LV_TEXT_ALIGN_CENTER, 0);
    lv_obj_t* frame = box(c);
    lv_obj_set_size(frame, 300, 300);
    setBg(frame, color::white());
    lv_obj_set_style_radius(frame, 18, 0);
#if LV_USE_QRCODE
    lv_obj_t* qr = lv_qrcode_create(frame);
    lv_qrcode_set_size(qr, 264);
    lv_qrcode_set_dark_color(qr, color::black());
    lv_qrcode_set_light_color(qr, color::white());
    lv_qrcode_update(qr, url.data(), static_cast<uint32_t>(url.size()));
    lv_obj_center(qr);
#endif
    lv_obj_t* hint = label(c,
                           isPage ? "Scanne avec l’appareil photo de ton téléphone : la fiche du film s’ouvre, avec sa bande-annonce."
                                  : "Scanne avec l’appareil photo de ton téléphone pour la regarder.",
                           &fig_m16, th().text2);
    lv_label_set_long_mode(hint, LV_LABEL_LONG_WRAP);
    lv_obj_set_width(hint, 540);
    lv_obj_set_style_text_align(hint, LV_TEXT_ALIGN_CENTER, 0);
    lv_obj_t* ok = button(c, "Fermer", th().card2, th().text, 50, 200);
    onClick(ok, close);
}

namespace {

struct Item {
    std::string id, title, genre, posterUrl, sub;
    bool isNew = false;
};

/** Grille d'affiches défilante ; la position est gardée entre deux redessins. */
void posterGrid(lv_obj_t* parent, const std::vector<Item>& items, int selected, std::function<void(int)> onSelect) {
    App& app = App::get();
    lv_obj_t* grid = row(parent, 22);
    lv_obj_set_size(grid, lv_pct(100), 0);
    lv_obj_set_flex_grow(grid, 1);
    lv_obj_set_flex_flow(grid, LV_FLEX_FLOW_ROW_WRAP);
    lv_obj_set_style_pad_row(grid, 18, 0);
    lv_obj_set_style_pad_top(grid, 12, 0);
    lv_obj_set_style_pad_hor(grid, 4, 0);
    lv_obj_set_style_pad_bottom(grid, 16, 0);
    lv_obj_add_flag(grid, LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_set_scroll_dir(grid, LV_DIR_VER);
    lv_obj_set_scrollbar_mode(grid, LV_SCROLLBAR_MODE_ACTIVE);
    lv_obj_set_flex_align(grid, LV_FLEX_ALIGN_START, LV_FLEX_ALIGN_START, LV_FLEX_ALIGN_START);
    for (size_t i = 0; i < items.size(); i++) {
        const Item& it = items[i];
        bool sel = static_cast<int>(i) == selected;
        lv_obj_t* cell = col(grid, 6);
        lv_obj_set_width(cell, POSTER_W);
        lv_obj_t* p = poster(cell, it.posterUrl, it.title, POSTER_W, POSTER_H, 16);
        if (sel) {  // bordure dessinée par-dessus l'affiche (un contour extérieur serait rogné)
            lv_obj_set_style_border_width(p, 4, 0);
            lv_obj_set_style_border_color(p, color::teal(), 0);
            lv_obj_set_style_border_post(p, true, 0);
        }
        if (it.isNew) {
            lv_obj_t* nb = pill(p, "NOUVEAU", color::white(), lv_color_hex(0x0B0B0E), &fig_s14, 22);
            lv_obj_align(nb, LV_ALIGN_TOP_RIGHT, -10, 10);
        }
        lv_obj_t* tt = label(cell, it.title, &fig_s16, th().text);
        fitLabel(tt, POSTER_W);
        lv_obj_t* sub = label(cell, it.sub, &fig_m14, th().text2);
        fitLabel(sub, POSTER_W);
        int idx = static_cast<int>(i);
        onClick(cell, [idx, onSelect] { onSelect(idx); });
    }
    onEvent(grid, LV_EVENT_SCROLL_END, [grid](lv_event_t*) { App::get().ui.cinemaScroll = lv_obj_get_scroll_y(grid); });
    lv_obj_update_layout(grid);
    if (app.ui.cinemaScroll > 0) lv_obj_scroll_to_y(grid, app.ui.cinemaScroll, LV_ANIM_OFF);
}

/** Fiche du film : affiche, infos, résumé, séances, bande-annonce. */
void detailPanel(lv_obj_t* parent, const Item& it, const std::string& extraMeta, std::function<void(lv_obj_t*)> fillShows,
                 std::function<void(lv_obj_t*)> fillActions) {
    App& app = App::get();
    app.requestFilm(it.id);
    const FilmDetails* fd = app.film(it.id);

    lv_obj_t* sc = card(parent, 24, 0);
    lv_obj_set_size(sc, 540, lv_pct(100));
    lv_obj_set_style_pad_hor(sc, 22, 0);
    lv_obj_set_style_pad_ver(sc, 20, 0);
    lv_obj_set_style_pad_row(sc, 14, 0);

    lv_obj_t* top = row(sc, 18);
    lv_obj_set_width(top, lv_pct(100));
    lv_obj_set_flex_align(top, LV_FLEX_ALIGN_START, LV_FLEX_ALIGN_START, LV_FLEX_ALIGN_START);
    poster(top, fd && !fd->posterUrl.empty() ? fd->posterUrl : it.posterUrl, it.title, 120, 174, 14);
    lv_obj_t* info = col(top, 6);
    lv_obj_set_flex_grow(info, 1);
    lv_obj_t* tl = label(info, it.title, &fig_b24, th().text);
    lv_label_set_long_mode(tl, LV_LABEL_LONG_WRAP);
    lv_obj_set_width(tl, lv_pct(100));
    std::string meta = it.genre;
    if (fd && !fd->duration.empty()) meta += (meta.empty() ? "" : " · ") + fd->duration;
    if (fd && !fd->rating.empty()) meta += (meta.empty() ? "" : " · ") + fd->rating;
    if (!extraMeta.empty()) meta += (meta.empty() ? "" : " · ") + extraMeta;
    if (!meta.empty()) {
        lv_obj_t* m = label(info, meta, &fig_m14, th().text2);
        lv_label_set_long_mode(m, LV_LABEL_LONG_WRAP);
        lv_obj_set_width(m, lv_pct(100));
    }
    auto credit = [&](const char* who, const std::string& names) {
        if (names.empty()) return;
        lv_obj_t* l = label(info, std::string(who) + names, &fig_m14, th().text);
        lv_label_set_long_mode(l, LV_LABEL_LONG_WRAP);
        lv_obj_set_width(l, lv_pct(100));
    };
    if (fd) {
        credit("De ", fd->directors);
        credit("Avec ", fd->actors);
    }
    fillActions(info);

    // Résumé (défilant s'il est long).
    lv_obj_t* syn = col(sc, 0);
    lv_obj_set_width(syn, lv_pct(100));
    lv_obj_set_flex_grow(syn, 1);
    lv_obj_add_flag(syn, LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_set_scroll_dir(syn, LV_DIR_VER);
    lv_obj_set_scrollbar_mode(syn, LV_SCROLLBAR_MODE_ACTIVE);
    std::string synopsis = fd ? fd->synopsis : "";
    if (synopsis.empty()) synopsis = fd ? "Pas de résumé pour ce film." : (app.demoMode() ? "Résumé disponible avec ton serveur." : "Chargement de la fiche…");
    lv_obj_t* sl = label(syn, synopsis, &fig_m16, fd && !fd->synopsis.empty() ? th().text : th().text2);
    lv_label_set_long_mode(sl, LV_LABEL_LONG_WRAP);
    lv_obj_set_width(sl, lv_pct(100));
    lv_obj_set_style_text_line_space(sl, 4, 0);

    fillShows(sc);
}

}  // namespace

void buildCinema(lv_obj_t* parent) {
    App& app = App::get();
    const Cinema& c = app.state().cinema;
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

    // À l'affiche | Bientôt
    lv_obj_t* seg = row(actions, 2);
    setBg(seg, th().card2);
    lv_obj_set_style_radius(seg, 16, 0);
    lv_obj_set_style_pad_all(seg, 4, 0);
    for (int tab = 0; tab < 2; tab++) {
        bool sel = app.ui.cinemaTab == tab;
        std::string text = tab == 0 ? "À l’affiche (" + std::to_string(c.films.size()) + ")" : "Bientôt (" + std::to_string(c.upcoming.size()) + ")";
        lv_obj_t* b = button(seg, text, sel ? th().ring : th().card2, sel ? th().text : th().text2, 44, 0, &fig_s16);
        lv_obj_set_style_radius(b, 12, 0);
        onClick(b, [tab] {
            App& ap = App::get();
            if (ap.ui.cinemaTab == tab) return;
            ap.ui.cinemaTab = tab;
            ap.ui.cinemaScroll = 0;
            ap.invalidate();
        });
    }

    lv_obj_t* body = row(parent, 20);
    lv_obj_set_size(body, lv_pct(100), 0);
    lv_obj_set_flex_grow(body, 1);
    lv_obj_set_flex_align(body, LV_FLEX_ALIGN_START, LV_FLEX_ALIGN_START, LV_FLEX_ALIGN_START);
    lv_obj_t* left = col(body, 0);
    lv_obj_set_height(left, lv_pct(100));
    lv_obj_set_flex_grow(left, 1);

    if (app.ui.cinemaTab == 1) {
        // ---------------------------------------------------------- prochaines sorties
        if (c.upcoming.empty()) {
            lv_obj_t* l = label(left, "Aucune sortie annoncée.", &fig_m16, th().text2);
            lv_obj_set_style_pad_top(l, 16, 0);
            return;
        }
        std::vector<Item> items;
        for (const Upcoming& u : c.upcoming) items.push_back({u.id, u.title, u.genre, u.posterUrl, util::shortFrenchDate(u.date), false});
        app.ui.cinemaFilm = std::clamp(app.ui.cinemaFilm, 0, static_cast<int>(items.size()) - 1);
        posterGrid(left, items, app.ui.cinemaFilm, [](int i) {
            App::get().ui.cinemaFilm = i;
            App::get().invalidate();
        });
        const Upcoming& u = c.upcoming[app.ui.cinemaFilm];
        Item it = items[app.ui.cinemaFilm];
        detailPanel(
            body, it, "sortie le " + util::shortFrenchDate(u.date), [](lv_obj_t*) {},
            [&u, it](lv_obj_t* info) {
                lv_obj_t* btns = row(info, 10);
                lv_obj_set_style_pad_top(btns, 8, 0);
                std::string id = u.id;
                bool next = !u.notify;
                lv_obj_t* bell = button(btns, u.notify ? "Alerte activée" : "Me prévenir", u.notify ? mix(th().card, color::teal(), 60) : th().chip,
                                        u.notify ? TEAL_TEXT : th().text, 46, 0, &fig_s16);
                onClick(bell, [id, next] { App::get().setCinemaNotify(id, next); });
                const FilmDetails* fd = App::get().film(it.id);
                if (fd && !fd->trailerUrl.empty()) {
                    lv_obj_t* tb = button(btns, "Bande-annonce", color::teal(), lv_color_hex(0x0B0B0E), 46, 0, &fig_s16);
                    std::string title = it.title, url = fd->trailerUrl;
                    bool page = fd->trailerIsPage;
                    onClick(tb, [title, url, page] { openTrailer(title, url, page); });
                }
            });
        return;
    }

    // -------------------------------------------------------------- à l'affiche
    // Onglets des jours (dans la fiche).
    int dayCount = static_cast<int>(std::min<size_t>(c.days.size(), 4));
    app.ui.cinemaDay = std::clamp(app.ui.cinemaDay, 0, std::max(0, dayCount - 1));
    if (c.films.empty()) {
        lv_obj_t* l = label(left, "Aucun film programmé pour l’instant.", &fig_m16, th().text2);
        lv_obj_set_style_pad_top(l, 16, 0);
        return;
    }
    std::vector<Item> items;
    for (const Film& f : c.films) items.push_back({f.id, f.title, f.genre, f.posterUrl, f.genre + (f.duration.empty() ? "" : " · " + f.duration), f.isNew});
    app.ui.cinemaFilm = std::clamp(app.ui.cinemaFilm, 0, static_cast<int>(items.size()) - 1);
    posterGrid(left, items, app.ui.cinemaFilm, [](int i) {
        App::get().ui.cinemaFilm = i;
        App::get().invalidate();
    });

    const Film& f = c.films[app.ui.cinemaFilm];
    Item it = items[app.ui.cinemaFilm];
    detailPanel(
        body, it, "",
        [&f, &c, dayCount](lv_obj_t* sc) {
            App& ap = App::get();
            // Jours : onglets compacts au-dessus des séances.
            lv_obj_t* tabs = row(sc, 2);
            setBg(tabs, th().card2);
            lv_obj_set_style_radius(tabs, 14, 0);
            lv_obj_set_style_pad_all(tabs, 4, 0);
            for (int i = 0; i < dayCount; i++) {
                bool sel = i == ap.ui.cinemaDay;
                lv_obj_t* t = button(tabs, c.days[i].label, sel ? th().ring : th().card2, sel ? th().text : th().text2, 38, 0, &fig_s14);
                lv_obj_set_style_radius(t, 10, 0);
                onClick(t, [i] {
                    App::get().ui.cinemaDay = i;
                    App::get().invalidate();
                });
            }
            const std::vector<Show> noShows;
            const std::vector<Show>& shows = ap.ui.cinemaDay < static_cast<int>(f.showsByDay.size()) ? f.showsByDay[ap.ui.cinemaDay] : noShows;
            // Aujourd'hui : les séances passées sont estompées et la prochaine est mise en avant.
            bool today = ap.ui.cinemaDay == 0;
            struct tm now = util::localNow();
            int nowMin = now.tm_hour * 60 + now.tm_min;
            int nextIdx = -1;
            for (size_t i = 0; i < shows.size(); i++)
                if (!today || util::minutesOf(shows[i].time) > nowMin) {
                    nextIdx = static_cast<int>(i);
                    break;
                }
            lv_obj_t* chips = row(sc, 8);
            lv_obj_set_width(chips, lv_pct(100));
            lv_obj_set_flex_flow(chips, LV_FLEX_FLOW_ROW_WRAP);
            lv_obj_set_style_pad_row(chips, 8, 0);
            if (shows.empty()) label(chips, "Pas de séance ce jour-là.", &fig_m16, th().text2);
            else if (nextIdx < 0) label(chips, "Plus de séance aujourd’hui.", &fig_m16, th().text2);
            for (size_t i = 0; i < shows.size() && i < 12; i++) {
                bool highlight = today && static_cast<int>(i) == nextIdx;
                bool past = today && (nextIdx < 0 || static_cast<int>(i) < nextIdx);
                lv_obj_t* ch = col(chips, 0);
                lv_obj_set_size(ch, 88, 54);
                lv_obj_set_flex_align(ch, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER);
                lv_obj_set_style_radius(ch, 14, 0);
                setBg(ch, highlight ? mix(th().card, color::teal(), 56) : th().chip);
                if (highlight) {
                    lv_obj_set_style_border_width(ch, 2, 0);
                    lv_obj_set_style_border_color(ch, color::teal(), 0);
                }
                if (past) lv_obj_set_style_opa(ch, LV_OPA_40, 0);
                label(ch, shows[i].time, &fig_s18, highlight ? lv_color_hex(0x5EE0D4) : th().text);
                label(ch, shows[i].tag, &fig_s14, highlight ? lv_color_hex(0x5EE0D4) : th().text2);
            }
        },
        [it, &f](lv_obj_t* info) {
            App& ap = App::get();
            // Prochaine séance aujourd'hui.
            if (!f.showsByDay.empty()) {
                struct tm now = util::localNow();
                int nowMin = now.tm_hour * 60 + now.tm_min;
                for (const Show& s : f.showsByDay[0]) {
                    int m = util::minutesOf(s.time);
                    if (m > nowMin) {
                        lv_obj_t* nx = row(info, 6);
                        icon(nx, ICON_CLOCK, &icons_16, TEAL_TEXT);
                        label(nx, "Prochaine séance " + util::inDelay(static_cast<int64_t>(m - nowMin) * 60), &fig_s14, TEAL_TEXT);
                        break;
                    }
                }
            }
            const FilmDetails* fd = ap.film(it.id);
            if (fd && !fd->trailerUrl.empty()) {
                lv_obj_t* tb = button(info, "Bande-annonce", color::teal(), lv_color_hex(0x0B0B0E), 46, 0, &fig_s16);
                lv_obj_set_style_margin_top(tb, 6, 0);
                std::string title = it.title, url = fd->trailerUrl;
                bool page = fd->trailerIsPage;
                onClick(tb, [title, url, page] { openTrailer(title, url, page); });
            }
        });
}
