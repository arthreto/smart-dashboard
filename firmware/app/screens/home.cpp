// Accueil : widgets disposés selon la configuration envoyée par la console.
#include <algorithm>
#include <ctime>

#include "../app.h"
#include "../hal.h"
#include "../images.h"
#include "../ui.h"
#include "../util.h"

using namespace ui;

namespace {

lv_obj_t* chip(lv_obj_t* parent, const char* glyph, lv_color_t iconColor, const std::string& text) {
    lv_obj_t* c = row(parent, 10);
    lv_obj_set_height(c, 46);
    lv_obj_set_style_pad_hor(c, 18, 0);
    lv_obj_set_style_radius(c, 23, 0);
    setBg(c, th().card2);
    if (glyph) icon(c, glyph, &icons_20, iconColor);
    label(c, text, &fig_m16, th().text);
    return c;
}

std::string nextAlarmText(const State& s) {
    if (!s.nextAlarm.valid) return "Aucun réveil prévu";
    time_t at = static_cast<time_t>(s.nextAlarm.at);
    struct tm t;
    localtime_r(&at, &t);
    struct tm now = util::localNow();
    int diffDays = (t.tm_year - now.tm_year) * 366 + (t.tm_yday - now.tm_yday);
    std::string day = diffDays == 0 ? "aujourd’hui" : diffDays == 1 ? "demain" : util::weekdayName(t.tm_wday);
    return "Réveil " + day + " · " + s.nextAlarm.time;
}

void clockWidget(lv_obj_t* cell, int span) {
    State& s = App::get().state();
    lv_obj_t* c = card(cell, 26, span > 1 ? 28 : 22);
    lv_obj_set_size(c, lv_pct(100), lv_pct(100));
    lv_obj_set_flex_align(c, LV_FLEX_ALIGN_SPACE_BETWEEN, LV_FLEX_ALIGN_START, LV_FLEX_ALIGN_START);

    lv_obj_t* top = row(c, 0);
    lv_obj_set_width(top, lv_pct(100));
    lv_obj_set_flex_align(top, LV_FLEX_ALIGN_SPACE_BETWEEN, LV_FLEX_ALIGN_START, LV_FLEX_ALIGN_START);
    lv_obj_t* left = col(top, 6);
    App::get().registerClock(label(left, "", &fig_m18, th().text2), ClockFormat::LongDate);
    App::get().registerClock(label(left, "", span > 1 ? &fig_l124 : &fig_l72, th().text), ClockFormat::HHMM);
    if (span > 1) {
        hal::PowerStatus p = hal::get().power();
        int level = p.battery < 0 ? 78 : p.battery;
        lv_obj_t* bat = pill(top, std::to_string(level) + " %", th().card2, th().text, &fig_s14, 36);
        lv_obj_t* ico = icon(bat, p.charging ? ICON_BOLT : ICON_PLUG, &icons_16, p.charging ? color::green() : th().text2);
        lv_obj_move_to_index(ico, 0);
    }

    lv_obj_t* chips = row(c, 12);
    lv_obj_t* a = chip(chips, ICON_ALARM, color::orange(), nextAlarmText(s));
    onClick(a, [] { App::get().navigate(Screen::Alarm); });
    if (span > 1) {
        // Prochaine séance de cinéma si un film est encore programmé aujourd'hui.
        const Film* best = nullptr;
        std::string bestTime;
        if (s.cinema.valid) {
            for (const Film& f : s.cinema.films) {
                if (f.showsByDay.empty() || f.showsByDay[0].empty()) continue;
                const std::string& t = f.showsByDay[0].front().time;
                if (!best || t < bestTime) {
                    best = &f;
                    bestTime = t;
                }
            }
        }
        if (best) {
            lv_obj_t* m = chip(chips, ICON_MOVIE, lv_color_hex(0x2FD3C4), best->title + " · " + bestTime);
            onClick(m, [] { App::get().navigate(Screen::Cinema); });
        } else {
            bool ok = App::get().online() || App::get().demoMode();
            chip(chips, nullptr, th().text2, ok ? (App::get().demoMode() ? "Mode démo" : "VPS synchronisé") : "Hors ligne");
            lv_obj_t* last = lv_obj_get_child(chips, -1);
            lv_obj_t* d = dot(last, 9, ok ? color::green() : color::orange());
            lv_obj_move_to_index(d, 0);
        }
    }
}

void weatherWidget(lv_obj_t* cell) {
    const Weather& w = App::get().state().weather;
    lv_obj_t* c = card(cell, 26, 22);
    lv_obj_set_size(c, lv_pct(100), lv_pct(100));
    bool dark = th().dark;
    lv_color_t fg = dark ? color::white() : lv_color_hex(0x0B2545);
    lv_color_t fg2 = dark ? lv_color_hex(0xC5D3E8) : lv_color_hex(0x34507A);
    setBg(c, dark ? lv_color_hex(0x132A4D) : lv_color_hex(0xD9E8FD));
    if (!w.valid) {
        label(c, "Météo", &fig_s18, fg);
        lv_obj_t* l = label(c, "Indique ta position dans la console : Intégrations › Météo", &fig_m16, fg2);
        lv_label_set_long_mode(l, LV_LABEL_LONG_WRAP);
        lv_obj_set_width(l, lv_pct(100));
        return;
    }
    lv_obj_t* top = row(c, 0);
    lv_obj_set_width(top, lv_pct(100));
    label(top, w.label, &fig_s18, fg);
    spacer(top);
    weatherIcon(top, w.icon, 32);
    label(c, std::to_string(w.temp) + "°", &fig_l72, fg);
    label(c, w.text, &fig_s18, fg);
    label(c, "Max " + std::to_string(w.max) + "° · Min " + std::to_string(w.min) + "°", &fig_m14, fg2);
    spacer(c);
    lv_obj_t* hours = row(c, 0);
    lv_obj_set_width(hours, lv_pct(100));
    lv_obj_set_flex_align(hours, LV_FLEX_ALIGN_SPACE_AROUND, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER);
    lv_obj_set_style_pad_top(hours, 12, 0);
    lv_obj_set_style_border_side(hours, LV_BORDER_SIDE_TOP, 0);
    lv_obj_set_style_border_width(hours, 1, 0);
    lv_obj_set_style_border_color(hours, fg, 0);
    lv_obj_set_style_border_opa(hours, 40, 0);
    for (size_t i = 0; i < w.hourly.size() && i < 4; i++) {
        lv_obj_t* h = col(hours, 4);
        lv_obj_set_flex_align(h, LV_FLEX_ALIGN_START, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER);
        label(h, w.hourly[i].hour, &fig_m14, fg2);
        weatherIcon(h, w.hourly[i].icon, 20);
        label(h, std::to_string(w.hourly[i].temp) + "°", &fig_s14, fg);
    }
}

void musicWidget(lv_obj_t* cell) {
    Music& m = App::get().state().music;
    lv_obj_t* c = card(cell, 26, 20);
    lv_obj_set_size(c, lv_pct(100), lv_pct(100));
    lv_obj_t* head = row(c, 0);
    lv_obj_set_width(head, lv_pct(100));
    label(head, "SPOTIFY", &fig_s14, th().text2);
    spacer(head);
    icon(head, ICON_CHEVRON_RIGHT, &icons_20, th().text2);
    onClick(head, [] { App::get().navigate(Screen::Music); });

    if (!m.valid || !m.hasTrack) {
        spacer(c);
        lv_obj_t* l = label(c, !m.valid ? "Connecte Spotify dans la console." : (m.message.empty() ? "Rien en lecture." : m.message), &fig_m16,
                            th().text2);
        lv_label_set_long_mode(l, LV_LABEL_LONG_WRAP);
        lv_obj_set_width(l, lv_pct(100));
        spacer(c);
        if (m.valid) {
            lv_obj_t* p = iconButton(c, ICON_PLAY_FILLED, 60, th().text, th().bg, &icons_24);
            lv_obj_set_align(p, LV_ALIGN_CENTER);
            onClick(p, [] { App::get().music("play"); });
        }
        return;
    }
    lv_obj_t* r = row(c, 14);
    lv_obj_set_style_pad_top(r, 12, 0);
    lv_obj_set_width(r, lv_pct(100));
    images::artwork(r, m.track.imageUrl, m.track.album + m.track.title, 72, 72, 14, th().card2);
    lv_obj_t* t = col(r, 2);
    lv_obj_set_flex_grow(t, 1);
    lv_obj_t* title = label(t, m.track.title, &fig_s18, th().text);
    lv_label_set_long_mode(title, LV_LABEL_LONG_DOT);
    lv_obj_set_width(title, lv_pct(100));
    lv_obj_t* artist = label(t, m.track.artist, &fig_m14, th().text2);
    lv_label_set_long_mode(artist, LV_LABEL_LONG_DOT);
    lv_obj_set_width(artist, lv_pct(100));

    lv_obj_t* bar = progressBar(c, 0, 4, 0, th().text, th().track);
    lv_obj_set_width(bar, lv_pct(100));
    lv_obj_set_style_margin_top(bar, 16, 0);
    lv_obj_t* fill = lv_obj_get_child(bar, 0);
    lv_obj_t* times = row(c, 0);
    lv_obj_set_width(times, lv_pct(100));
    lv_obj_set_style_pad_top(times, 6, 0);
    lv_obj_t* el = label(times, "", &fig_m14, th().text2);
    spacer(times);
    label(times, util::mmss(m.track.durationMs), &fig_m14, th().text2);
    auto refresh = [fill, el]() {
        Music& mm = App::get().state().music;
        int pos = mm.track.progressMs + (mm.isPlaying ? static_cast<int>(hal::get().millis() - mm.receivedAtMs) : 0);
        pos = std::min(pos, mm.track.durationMs);
        int pct = mm.track.durationMs > 0 ? pos * 100 / mm.track.durationMs : 0;
        lv_obj_clear_flag(fill, LV_OBJ_FLAG_HIDDEN);
        lv_obj_set_width(fill, lv_pct(std::max(1, pct)));
        lv_label_set_text(el, util::mmss(pos).c_str());
    };
    refresh();
    App::get().onSecond(refresh);

    spacer(c);
    lv_obj_t* ctrl = row(c, 18);
    lv_obj_set_width(ctrl, lv_pct(100));
    lv_obj_set_flex_align(ctrl, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER);
    onClick(iconButton(ctrl, ICON_PREV_FILLED, 52, th().card, th().text, &icons_24), [] { App::get().music("previous"); });
    lv_obj_t* play = iconButton(ctrl, m.isPlaying ? ICON_PAUSE_FILLED : ICON_PLAY_FILLED, 60, th().text, th().bg, &icons_24);
    onClick(play, [] { App::get().music(App::get().state().music.isPlaying ? "pause" : "play"); });
    onClick(iconButton(ctrl, ICON_NEXT_FILLED, 52, th().card, th().text, &icons_24), [] { App::get().music("next"); });
}

void agendaRow(lv_obj_t* parent, const Event& e, bool first, const std::string& badge) {
    lv_obj_t* r = row(parent, 16);
    lv_obj_set_size(r, lv_pct(100), 82);
    if (!first) {
        lv_obj_set_style_border_side(r, LV_BORDER_SIDE_TOP, 0);
        lv_obj_set_style_border_width(r, 1, 0);
        lv_obj_set_style_border_color(r, th().hairline, 0);
    }
    // Jour, puis heure : on sait toujours de quand on parle.
    lv_obj_t* times = col(r, 1);
    lv_obj_set_width(times, 96);
    std::string day = util::relativeDay(e.date);
    bool isToday = day == "Aujourd’hui";
    label(times, day.empty() ? " " : day, &fig_s14, isToday ? (th().dark ? lv_color_hex(0xFF6961) : lv_color_hex(0xD70015)) : th().text2);
    label(times, e.allDay ? "Journée" : e.start, &fig_s18, th().text);
    if (!e.allDay && !e.end.empty()) label(times, e.end, &fig_m14, th().text3);
    dot(r, 10, hex(e.color));
    lv_obj_t* txt = col(r, 2);
    lv_obj_set_flex_grow(txt, 1);
    lv_obj_t* t = label(txt, e.title, &fig_s18, th().text);
    lv_label_set_long_mode(t, LV_LABEL_LONG_DOT);
    lv_obj_set_width(t, lv_pct(100));
    std::string meta = e.location.empty() ? e.calendar : e.location;
    if (e.reminderMinutes > 0) meta += (meta.empty() ? "" : " · ") + std::string("rappel ") + std::to_string(e.reminderMinutes) + " min avant";
    if (!meta.empty()) {
        lv_obj_t* m = label(txt, meta, &fig_m14, th().text2);
        lv_label_set_long_mode(m, LV_LABEL_LONG_DOT);
        lv_obj_set_width(m, lv_pct(100));
    }
    if (!badge.empty()) pill(r, badge, mix(th().card, color::blue(), 60), th().dark ? lv_color_hex(0x8CC4FF) : lv_color_hex(0x0060C9));
}

void agendaWidget(lv_obj_t* cell) {
    const Agenda& a = App::get().state().agenda;
    lv_obj_t* c = card(cell, 26, 0);
    lv_obj_set_style_pad_hor(c, 26, 0);
    lv_obj_set_style_pad_ver(c, 18, 0);
    lv_obj_set_size(c, lv_pct(100), lv_pct(100));
    lv_obj_t* head = row(c, 10);
    lv_obj_set_width(head, lv_pct(100));
    label(head, "Agenda", &fig_s20, th().text);

    struct tm now = util::localNow();
    int nowMin = now.tm_hour * 60 + now.tm_min;
    char todayKey[11];
    strftime(todayKey, sizeof todayKey, "%Y-%m-%d", &now);

    // Ce qui est en cours aujourd'hui, puis les prochains événements (aujourd'hui ou plus tard).
    std::vector<Event> list;
    auto has = [&](const Event& e) {
        return std::any_of(list.begin(), list.end(), [&](const Event& x) { return !e.id.empty() && x.id == e.id; });
    };
    for (Event e : a.today) {
        if (e.date.empty()) e.date = todayKey;
        int st = util::minutesOf(e.start), en = util::minutesOf(e.end);
        bool ongoing = e.allDay || (st >= 0 && st <= nowMin && (en < 0 || en > nowMin || en <= st));
        if (ongoing) list.push_back(e);
    }
    for (const Event& e : a.upcoming) if (!has(e)) list.push_back(e);
    if (list.empty()) {
        // Ancien serveur (sans « upcoming » complet) : les événements du jour encore à venir.
        for (Event e : a.today) {
            if (e.date.empty()) e.date = todayKey;
            if (e.allDay || util::minutesOf(e.start) >= nowMin) list.push_back(e);
        }
    }

    size_t todayCount = a.today.size();
    label(head, a.valid ? (todayCount ? std::to_string(todayCount) + " aujourd’hui" : "À venir") : "", &fig_m16, th().text2);
    spacer(head);
    lv_obj_t* link = row(head, 4);
    label(link, "Calendrier", &fig_s16, th().dark ? lv_color_hex(0xFF6961) : lv_color_hex(0xD70015));
    icon(link, ICON_CHEVRON_RIGHT, &icons_20, th().dark ? lv_color_hex(0xFF6961) : lv_color_hex(0xD70015));
    lv_obj_set_height(link, 44);
    onClick(link, [] { App::get().navigate(Screen::Calendar); });

    if (!a.valid) {
        lv_obj_t* l = label(c, "Connecte ton calendrier iCloud dans la console pour voir tes événements ici.", &fig_m16, th().text2);
        lv_label_set_long_mode(l, LV_LABEL_LONG_WRAP);
        lv_obj_set_width(l, lv_pct(100));
        return;
    }
    if (list.empty()) {
        label(c, "Rien de prévu pour le moment.", &fig_m16, th().text2);
        return;
    }
    bool badgeDone = false;
    for (size_t i = 0; i < list.size() && i < 3; i++) {
        std::string badge;
        int st = util::minutesOf(list[i].start);
        if (!badgeDone && list[i].date == todayKey && !list[i].allDay && st > nowMin) {
            badge = util::inDelay(static_cast<int64_t>(st - nowMin) * 60);
            badge[0] = 'D';
            badgeDone = true;
        } else if (!badgeDone && list[i].date == todayKey && !list[i].allDay && st >= 0 && st <= nowMin) {
            badge = "En cours";
        }
        agendaRow(c, list[i], i == 0, badge);
    }
}

void tasksWidget(lv_obj_t* cell) {
    Tasks& t = App::get().state().tasks;
    lv_obj_t* c = card(cell, 26, 20);
    lv_obj_set_size(c, lv_pct(100), lv_pct(100));
    lv_obj_t* head = row(c, 12);
    lv_obj_t* r = box(head);
    lv_obj_set_size(r, 52, 52);
    ring(r, 52, 6, t.total ? t.done * 100 / t.total : 0, color::green(), th().track);
    lv_obj_t* frac = label(r, std::to_string(t.done) + "/" + std::to_string(t.total), &fig_s14, th().text);
    lv_obj_center(frac);
    lv_obj_t* tt = col(head, 2);
    label(tt, "Tâches", &fig_s20, th().text);
    lv_obj_t* st = row(tt, 4);
    icon(st, ICON_FLAME_FILLED, &icons_16, color::orange());
    label(st, t.streak > 0 ? "Série de " + std::to_string(t.streak) + " jour" + (t.streak > 1 ? "s" : "") : "Pas encore de série", &fig_s14,
          th().dark ? lv_color_hex(0xFFB340) : lv_color_hex(0xC26A00));

    // Tâches restantes d'abord, puis celles déjà faites.
    std::vector<const TaskItem*> items;
    for (auto& i : t.items) if (!i.done) items.push_back(&i);
    for (auto& i : t.items) if (i.done) items.push_back(&i);
    lv_obj_t* list = col(c, 0);
    lv_obj_set_width(list, lv_pct(100));
    lv_obj_set_style_pad_top(list, 8, 0);
    for (size_t k = 0; k < items.size() && k < 3; k++) {
        const TaskItem& it = *items[k];
        lv_obj_t* r2 = row(list, 12);
        lv_obj_set_size(r2, lv_pct(100), 46);
        lv_obj_t* box2 = box(r2);
        lv_obj_set_size(box2, 24, 24);
        lv_obj_set_style_radius(box2, 12, 0);
        if (it.done) {
            setBg(box2, color::green());
            lv_obj_t* ck = icon(box2, ICON_CHECK, &icons_16, th().dark ? th().bg : color::white());
            lv_obj_center(ck);
        } else {
            lv_obj_set_style_border_width(box2, 2, 0);
            lv_obj_set_style_border_color(box2, th().ring, 0);
        }
        lv_obj_t* n = label(r2, it.name, &fig_m16, it.done ? th().text3 : th().text);
        lv_label_set_long_mode(n, LV_LABEL_LONG_DOT);
        lv_obj_set_flex_grow(n, 1);
        int id = it.id;
        onClick(r2, [id] { App::get().toggleHabit(id); });
    }
    spacer(c);
    lv_obj_t* b = button(c, "Voir les " + std::to_string(t.items.size()) + " tâches", th().card2, th().text, 46);
    lv_obj_set_width(b, lv_pct(100));
    lv_obj_set_style_radius(b, 15, 0);
    onClick(b, [] { App::get().navigate(Screen::Tasks); });
}

void robloxWidget(lv_obj_t* cell) {
    const Roblox& r = App::get().state().roblox;
    lv_obj_t* c = card(cell, 26, 20);
    lv_obj_set_size(c, lv_pct(100), lv_pct(100));
    lv_obj_t* head = row(c, 0);
    lv_obj_set_width(head, lv_pct(100));
    lv_obj_t* name = label(head, r.name.empty() ? "Roblox" : r.name, &fig_s18, th().text);
    fitLabel(name, r.valid ? 104 : 220);
    spacer(head);
    onClick(head, [] { App::get().navigate(Screen::Stats); });
    if (!r.valid) {
        lv_obj_t* l = label(c, "Ajoute l’ID de ton jeu dans la console pour suivre les joueurs connectés.", &fig_m16, th().text2);
        lv_label_set_long_mode(l, LV_LABEL_LONG_WRAP);
        lv_obj_set_width(l, lv_pct(100));
        lv_obj_set_style_pad_top(l, 12, 0);
        return;
    }
    lv_obj_t* live = pill(head, "EN DIRECT", mix(th().card, color::green(), 40), th().dark ? lv_color_hex(0x6EE08E) : lv_color_hex(0x1E7A36),
                          &fig_s14, 24);
    lv_obj_t* d = dot(live, 7, color::green());
    lv_obj_move_to_index(d, 0);
    lv_obj_t* big = label(c, thousands(r.playing), &fig_bd54, th().text);
    lv_obj_set_style_pad_top(big, 12, 0);
    label(c, "joueurs connectés", &fig_m16, th().text2);
    lv_obj_t* delta = row(c, 4);
    lv_obj_set_style_pad_top(delta, 4, 0);
    bool up = r.deltaPct >= 0;
    icon(delta, up ? ICON_TREND_UP : ICON_ARROW_UP, &icons_16, up ? color::green() : color::orange());
    label(delta, (up ? "+" : "") + std::to_string(r.deltaPct) + " %", &fig_s14, up ? color::green() : color::orange());
    label(delta, "vs hier", &fig_m14, th().text2);
    spacer(c);
    sparkline(c, r.history, 220, 54, color::blue(), 3);
    lv_obj_t* foot = row(c, 4);
    lv_obj_set_style_pad_top(foot, 6, 0);
    label(foot, "Pic 24 h ·", &fig_m14, th().text2);
    label(foot, thousands(r.peak24h), &fig_s14, th().text);
}

void cinemaWidget(lv_obj_t* cell) {
    const Cinema& cin = App::get().state().cinema;
    lv_obj_t* c = card(cell, 26, 20);
    lv_obj_set_size(c, lv_pct(100), lv_pct(100));
    label(c, "Cinéma", &fig_s18, th().text);
    onClick(c, [] { App::get().navigate(Screen::Cinema); });
    if (!cin.valid || cin.films.empty()) {
        label(c, "Aucune séance disponible.", &fig_m16, th().text2);
        return;
    }
    const Film* best = &cin.films[0];
    for (const Film& f : cin.films)
        if (!f.showsByDay.empty() && !f.showsByDay[0].empty() &&
            (best->showsByDay.empty() || best->showsByDay[0].empty() || f.showsByDay[0][0].time < best->showsByDay[0][0].time))
            best = &f;
    lv_obj_t* r = row(c, 14);
    lv_obj_set_style_pad_top(r, 12, 0);
    images::create(r, best->posterUrl, 88, 128, 10, th().card2);
    lv_obj_t* t = col(r, 4);
    lv_obj_set_flex_grow(t, 1);
    lv_obj_t* title = label(t, best->title, &fig_s18, th().text);
    lv_label_set_long_mode(title, LV_LABEL_LONG_WRAP);
    lv_obj_set_width(title, lv_pct(100));
    label(t, best->genre, &fig_m14, th().text2);
    if (!best->showsByDay.empty() && !best->showsByDay[0].empty())
        pill(t, "Prochaine : " + best->showsByDay[0][0].time, mix(th().card, color::teal(), 60), lv_color_hex(0x5EE0D4), &fig_s14, 30);
}

void streakWidget(lv_obj_t* cell) {
    const State& s = App::get().state();
    lv_obj_t* c = card(cell, 26, 20);
    lv_obj_set_size(c, lv_pct(100), lv_pct(100));
    lv_obj_t* head = row(c, 0);
    lv_obj_set_width(head, lv_pct(100));
    label(head, "Série", &fig_s20, th().text);
    spacer(head);
    iconTile(head, ICON_FLAME_FILLED, mix(th().card, color::orange(), 50), 40, &icons_20, 12);
    lv_obj_t* v = row(c, 8);
    lv_obj_set_flex_align(v, LV_FLEX_ALIGN_START, LV_FLEX_ALIGN_END, LV_FLEX_ALIGN_END);
    label(v, std::to_string(s.tasks.streak), &fig_bd54, th().text);
    label(v, "jours d’affilée", &fig_m16, th().text2);
    label(c, "Record : " + std::to_string(s.tasks.bestStreak) + " jours", &fig_m14, th().text2);
    spacer(c);
    lv_obj_t* bars = row(c, 8);
    lv_obj_set_size(bars, lv_pct(100), 90);
    lv_obj_set_flex_align(bars, LV_FLEX_ALIGN_SPACE_BETWEEN, LV_FLEX_ALIGN_END, LV_FLEX_ALIGN_END);
    size_t n = s.stats.daily.size();
    for (size_t i = n > 7 ? n - 7 : 0; i < n; i++) {
        const DailyStat& d = s.stats.daily[i];
        lv_obj_t* b = box(bars);
        int h = d.max > 0 ? 8 + 56 * d.value / d.max : 8;
        lv_obj_set_size(b, 22, h);
        lv_obj_set_style_radius(b, 6, 0);
        setBg(b, d.today ? mix(th().card, color::green(), 80) : d.validated ? color::green() : mix(th().card, color::green(), 120));
        if (d.today) {
            lv_obj_set_style_border_width(b, 2, 0);
            lv_obj_set_style_border_color(b, color::green(), 0);
        }
    }
}

}  // namespace

void buildHome(lv_obj_t* parent) {
    State& s = App::get().state();
    static int32_t cols[] = {LV_GRID_FR(1), LV_GRID_FR(1), LV_GRID_FR(1), LV_GRID_FR(1), LV_GRID_TEMPLATE_LAST};
    static int32_t rows[] = {290, LV_GRID_FR(1), LV_GRID_TEMPLATE_LAST};
    lv_obj_t* grid = box(parent);
    lv_obj_set_size(grid, lv_pct(100), lv_pct(100));
    lv_obj_set_layout(grid, LV_LAYOUT_GRID);
    lv_obj_set_grid_dsc_array(grid, cols, rows);
    lv_obj_set_style_pad_column(grid, 20, 0);
    lv_obj_set_style_pad_row(grid, 20, 0);

    std::vector<Widget> layout = s.layout;
    if (layout.empty()) layout = {{"clock", 2}, {"weather", 1}, {"music", 1}, {"agenda", 2}, {"tasks", 1}, {"roblox", 1}};
    int colIdx = 0, rowIdx = 0;
    for (const Widget& w : layout) {
        int span = std::clamp(w.span, 1, 2);
        if (colIdx + span > 4) {
            colIdx = 0;
            rowIdx++;
        }
        if (rowIdx > 1) break;
        lv_obj_t* cell = box(grid);
        lv_obj_set_grid_cell(cell, LV_GRID_ALIGN_STRETCH, colIdx, span, LV_GRID_ALIGN_STRETCH, rowIdx, 1);
        if (w.id == "clock") clockWidget(cell, span);
        else if (w.id == "weather") weatherWidget(cell);
        else if (w.id == "music") musicWidget(cell);
        else if (w.id == "agenda") agendaWidget(cell);
        else if (w.id == "tasks") tasksWidget(cell);
        else if (w.id == "roblox") robloxWidget(cell);
        else if (w.id == "cinema") cinemaWidget(cell);
        else if (w.id == "streak") streakWidget(cell);
        colIdx += span;
    }
}
