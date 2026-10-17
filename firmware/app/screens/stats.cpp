// Statistiques : indicateurs du mois, tâches par jour, sport, joueurs Roblox.
#include <algorithm>
#include <ctime>

#include "../app.h"
#include "../ui.h"
#include "../util.h"

using namespace ui;

namespace {

lv_obj_t* kpi(lv_obj_t* parent, const std::string& title, const std::string& value, const std::string& foot, int delta, bool showDelta) {
    lv_obj_t* c = card(parent, 22, 18);
    lv_obj_set_height(c, lv_pct(100));
    lv_obj_set_flex_grow(c, 1);
    lv_obj_set_flex_align(c, LV_FLEX_ALIGN_SPACE_BETWEEN, LV_FLEX_ALIGN_START, LV_FLEX_ALIGN_START);
    label(c, title, &fig_m14, th().text2);
    label(c, value, &fig_b32, th().text);
    lv_obj_t* r = row(c, 6);
    if (showDelta) {
        bool up = delta >= 0;
        icon(r, up ? ICON_TREND_UP : ICON_ARROW_UP, &icons_16, up ? color::green() : color::orange());
        label(r, (up ? "+" : "") + std::to_string(delta) + (title.find("Taux") != std::string::npos ? " pts" : " %"), &fig_s14,
              up ? lv_color_hex(0x6EE08E) : lv_color_hex(0xFFB340));
    }
    label(r, foot, &fig_m14, th().text2);
    return c;
}

}  // namespace

void buildStats(lv_obj_t* parent) {
    State& s = App::get().state();
    const Stats& st = s.stats;
    std::string sub = App::get().demoMode() ? "Mode démo · données d’exemple"
                      : App::get().online()  ? "VPS · synchronisé"
                                             : "Hors ligne · dernières données connues";
    pageHeader(parent, "Statistiques", sub);

    lv_obj_t* kpis = row(parent, 20);
    lv_obj_set_size(kpis, lv_pct(100), 128);
    struct tm now = util::localNow();
    kpi(kpis, "Tâches terminées · " + util::monthName(now.tm_mon), std::to_string(st.monthTasks), "vs mois dernier", st.monthDeltaPct, true);
    lv_obj_t* sport = kpi(kpis, "Séances de sport · " + util::monthName(now.tm_mon), std::to_string(st.sportSessions) + " / " + std::to_string(st.sportGoal),
                          "", 0, false);
    lv_obj_t* sb = progressBar(sport, 0, 6, st.sportGoal ? st.sportSessions * 100 / st.sportGoal : 0, color::orange(), th().track);
    lv_obj_set_width(sb, lv_pct(100));
    lv_obj_delete(lv_obj_get_child(sport, 2));
    kpi(kpis, "Série actuelle", std::to_string(s.tasks.streak) + " j", "Record personnel : " + std::to_string(s.tasks.bestStreak) + " j", 0, false);
    kpi(kpis, "Taux de réussite", std::to_string(st.successRate) + " %", "cette semaine", st.successDeltaPts, true);

    lv_obj_t* body = row(parent, 20);
    lv_obj_set_size(body, lv_pct(100), 0);
    lv_obj_set_flex_grow(body, 1);
    lv_obj_set_flex_align(body, LV_FLEX_ALIGN_START, LV_FLEX_ALIGN_START, LV_FLEX_ALIGN_START);

    // Barres : tâches par jour sur 14 jours.
    lv_obj_t* chart = card(body, 24, 0);
    lv_obj_set_height(chart, lv_pct(100));
    lv_obj_set_flex_grow(chart, 1);
    lv_obj_set_style_pad_hor(chart, 24, 0);
    lv_obj_set_style_pad_ver(chart, 20, 0);
    lv_obj_t* ch = row(chart, 14);
    lv_obj_set_width(ch, lv_pct(100));
    lv_obj_set_flex_align(ch, LV_FLEX_ALIGN_START, LV_FLEX_ALIGN_START, LV_FLEX_ALIGN_START);
    lv_obj_t* ct = col(ch, 2);
    label(ct, "Tâches terminées par jour", &fig_s18, th().text);
    label(ct, "14 derniers jours · objectif " + std::to_string(st.threshold), &fig_m14, th().text2);
    spacer(ch);
    auto legend = [&](lv_color_t c, const char* text, bool outline) {
        lv_obj_t* r = row(ch, 6);
        lv_obj_t* sw = box(r);
        lv_obj_set_size(sw, 10, 10);
        lv_obj_set_style_radius(sw, 3, 0);
        if (outline) {
            lv_obj_set_style_border_width(sw, 2, 0);
            lv_obj_set_style_border_color(sw, c, 0);
        } else {
            setBg(sw, c);
        }
        label(r, text, &fig_m14, th().text2);
    };
    lv_color_t dim = lv_color_hex(0x1F7A3A);
    legend(color::green(), "Journée parfaite", false);
    legend(dim, "Objectif atteint", false);
    legend(color::green(), "En cours", true);

    constexpr int PLOT_H = 296;
    lv_obj_t* plot = row(chart, 10);
    lv_obj_set_size(plot, lv_pct(100), PLOT_H);
    lv_obj_set_style_margin_top(plot, 18, 0);
    lv_obj_set_flex_align(plot, LV_FLEX_ALIGN_SPACE_BETWEEN, LV_FLEX_ALIGN_END, LV_FLEX_ALIGN_END);
    lv_obj_set_style_border_side(plot, LV_BORDER_SIDE_BOTTOM, 0);
    lv_obj_set_style_border_width(plot, 1, 0);
    lv_obj_set_style_border_color(plot, th().ring, 0);
    int maxV = 1;
    for (const DailyStat& d : st.daily) maxV = std::max({maxV, d.max, d.value});
    lv_obj_t* labels = row(chart, 10);
    lv_obj_set_width(labels, lv_pct(100));
    lv_obj_set_style_pad_top(labels, 8, 0);
    lv_obj_set_flex_align(labels, LV_FLEX_ALIGN_SPACE_BETWEEN, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER);
    for (const DailyStat& d : st.daily) {
        lv_obj_t* b = box(plot);
        lv_obj_set_size(b, 28, std::max(4, d.value * (PLOT_H - 10) / maxV));
        lv_obj_set_style_radius(b, 6, 0);
        bool perfect = d.max > 0 && d.value >= d.max;
        if (d.today) {
            setBg(b, mix(th().card, color::green(), 36));
            lv_obj_set_style_border_width(b, 2, 0);
            lv_obj_set_style_border_color(b, color::green(), 0);
        } else {
            setBg(b, perfect ? color::green() : d.validated ? dim : mix(th().card, color::green(), 60));
        }
        lv_obj_t* l = label(labels, std::to_string(d.day), d.today ? &fig_s14 : &fig_m14, d.today ? th().text : th().text3);
        lv_obj_set_width(l, 28);
        lv_obj_set_style_text_align(l, LV_TEXT_ALIGN_CENTER, 0);
    }
    if (st.daily.empty()) label(plot, "Pas encore d’historique.", &fig_m16, th().text2);

    lv_obj_t* right = col(body, 14);
    lv_obj_set_size(right, 360, lv_pct(100));

    lv_obj_t* sp = card(right, 24, 18);
    lv_obj_set_width(sp, lv_pct(100));
    label(sp, "Sport · minutes par semaine", &fig_s16, th().text);
    int last = st.sportWeekly.empty() ? 0 : st.sportWeekly.back();
    int prev = st.sportWeekly.size() > 1 ? st.sportWeekly[st.sportWeekly.size() - 2] : 0;
    lv_obj_t* sv = row(sp, 10);
    lv_obj_set_style_pad_top(sv, 4, 0);
    label(sv, std::to_string(last) + " min", &fig_b32, th().text);
    if (prev > 0) {
        int pct = (last - prev) * 100 / prev;
        pill(sv, (pct >= 0 ? "+" : "") + std::to_string(pct) + " %", mix(th().card, pct >= 0 ? color::green() : color::orange(), 40),
             pct >= 0 ? lv_color_hex(0x6EE08E) : lv_color_hex(0xFFB340), &fig_s14, 26);
    }
    lv_obj_t* line = sparkline(sp, st.sportWeekly, 320, 90, color::orange(), 3);
    lv_obj_set_style_margin_top(line, 10, 0);
    lv_obj_t* wk = row(sp, 0);
    lv_obj_set_width(wk, lv_pct(100));
    label(wk, "Il y a 8 semaines", &fig_m14, th().text3);
    spacer(wk);
    label(wk, "Cette semaine", &fig_m14, th().text3);

    lv_obj_t* rb = card(right, 24, 16);
    lv_obj_set_width(rb, lv_pct(100));
    lv_obj_set_flex_grow(rb, 1);
    lv_obj_set_style_pad_hor(rb, 20, 0);
    lv_obj_t* rh = row(rb, 0);
    lv_obj_set_width(rh, lv_pct(100));
    const Roblox& r = s.roblox;
    fitLabel(label(rh, r.name.empty() ? "Mon jeu Roblox" : r.name, &fig_s16, th().text), 190);
    spacer(rh);
    if (!r.valid) {
        lv_obj_t* l = label(rb, "Ajoute l’ID de ton expérience Roblox dans la console.", &fig_m16, th().text2);
        lv_label_set_long_mode(l, LV_LABEL_LONG_WRAP);
        lv_obj_set_width(l, lv_pct(100));
        lv_obj_set_style_pad_top(l, 10, 0);
        return;
    }
    lv_obj_t* live = pill(rh, "EN DIRECT", mix(th().card, color::green(), 40), lv_color_hex(0x6EE08E), &fig_s14, 24);
    lv_obj_t* dd = dot(live, 7, color::green());
    lv_obj_move_to_index(dd, 0);
    lv_obj_t* big = row(rb, 10);
    lv_obj_set_flex_align(big, LV_FLEX_ALIGN_START, LV_FLEX_ALIGN_END, LV_FLEX_ALIGN_END);
    label(big, thousands(r.playing), &fig_b32, th().text);
    label(big, "joueurs connectés", &fig_m14, th().text2);
    sparkline(rb, r.history, 320, 40, color::blue(), 2);
    lv_obj_t* figs = row(rb, 0);
    lv_obj_set_width(figs, lv_pct(100));
    lv_obj_set_style_pad_top(figs, 8, 0);
    lv_obj_set_flex_align(figs, LV_FLEX_ALIGN_SPACE_BETWEEN, LV_FLEX_ALIGN_START, LV_FLEX_ALIGN_START);
    auto fig = [&](const char* k, const std::string& v) {
        lv_obj_t* c = col(figs, 0);
        label(c, k, &fig_m14, th().text2);
        label(c, v, &fig_s16, th().text);
    };
    auto compact = [](int64_t v) {
        std::string s = v >= 1000000 ? fmt("%.1f M", v / 1e6) : v >= 10000 ? fmt("%.1f k", v / 1e3) : thousands(v);
        for (char& ch : s)
            if (ch == '.') ch = ',';  // séparateur décimal français
        return s;
    };
    fig("Pic 24 h", thousands(r.peak24h));
    fig("Visites", compact(r.visits));
    fig("Favoris", compact(r.favorites));
}
