// Tâches & habitudes : liste à cocher, série, taux de réussite, badges.
#include <algorithm>

#include "../app.h"
#include "../ui.h"
#include "../util.h"

using namespace ui;

void buildTasks(lv_obj_t* parent) {
    Tasks& t = App::get().state().tasks;
    struct tm now = util::localNow();
    lv_obj_t* actions = pageHeader(parent, "Tâches & habitudes", util::longDate(now) + " · remise à zéro à minuit");
    lv_obj_t* hint = pill(actions, "Ajoute ou modifie tes habitudes depuis la console", th().card2, th().text2, &fig_m14, 40);
    (void)hint;

    lv_obj_t* body = row(parent, 20);
    lv_obj_set_size(body, lv_pct(100), 0);
    lv_obj_set_flex_grow(body, 1);
    lv_obj_set_flex_align(body, LV_FLEX_ALIGN_START, LV_FLEX_ALIGN_START, LV_FLEX_ALIGN_START);

    // --- Colonne gauche : progression + liste
    lv_obj_t* left = col(body, 12);
    lv_obj_set_height(left, lv_pct(100));
    lv_obj_set_flex_grow(left, 1);

    lv_obj_t* prog = card(left, 22, 0);
    lv_obj_set_width(prog, lv_pct(100));
    lv_obj_set_style_pad_hor(prog, 22, 0);
    lv_obj_set_style_pad_ver(prog, 16, 0);
    lv_obj_set_style_pad_row(prog, 10, 0);
    int pct = t.total ? t.done * 100 / t.total : 0;
    lv_obj_t* pr = row(prog, 0);
    lv_obj_set_width(pr, lv_pct(100));
    label(pr, std::to_string(t.done) + " sur " + std::to_string(t.total) + " terminées", &fig_s20, th().text);
    spacer(pr);
    label(pr, std::to_string(pct) + " %", &fig_s20, color::green());
    lv_obj_t* bar = progressBar(prog, 0, 12, pct, color::green(), th().track);
    lv_obj_set_width(bar, lv_pct(100));
    int left_ = t.total - t.done;
    auto days = [](int n) { return std::to_string(n) + (n > 1 ? " jours" : " jour"); };
    std::string progressText;
    if (t.total == 0) progressText = "Rien de prévu aujourd’hui : profites-en !";
    else if (left_ <= 0) progressText = "Journée parfaite. Ta série passe à " + days(t.streak) + " !";
    else if (t.streak > 0) progressText = "Encore " + std::to_string(left_) + " pour prolonger ta série de " + days(t.streak);
    else progressText = "Termine tes " + std::to_string(t.total) + " tâches pour lancer une série";
    label(prog, progressText, &fig_m14, th().text2);

    lv_obj_t* list = col(left, 6);
    lv_obj_set_width(list, lv_pct(100));
    lv_obj_set_flex_grow(list, 1);
    lv_obj_add_flag(list, LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_set_scroll_dir(list, LV_DIR_VER);
    lv_obj_set_scrollbar_mode(list, LV_SCROLLBAR_MODE_OFF);
    if (t.items.empty()) {
        label(list, "Aucune tâche prévue aujourd’hui.", &fig_m16, th().text2);
    }
    for (const TaskItem& it : t.items) {
        lv_obj_t* r = row(list, 14);
        lv_obj_set_size(r, lv_pct(100), 52);
        lv_obj_set_style_pad_left(r, 12, 0);
        lv_obj_set_style_pad_right(r, 16, 0);
        setBg(r, th().card);
        lv_obj_set_style_radius(r, 16, 0);
        lv_obj_t* cb = box(r);
        lv_obj_set_size(cb, 28, 28);
        lv_obj_set_style_radius(cb, 14, 0);
        if (it.done) {
            setBg(cb, color::green());
            lv_obj_t* ck = icon(cb, ICON_CHECK, &icons_20, th().dark ? th().bg : color::white());
            lv_obj_center(ck);
        } else {
            lv_obj_set_style_border_width(cb, 2, 0);
            lv_obj_set_style_border_color(cb, th().ring, 0);
        }
        iconTile(r, habitIcon(it.icon), hex(it.color), 34, &icons_20, 10);
        lv_obj_t* names = row(r, 10);
        lv_obj_set_flex_grow(names, 1);
        label(names, it.name, &fig_s18, it.done ? th().text3 : th().text);
        label(names, it.meta, &fig_m14, th().text2);
        lv_obj_t* st = pill(r, std::to_string(it.streak) + " j", mix(th().card, color::orange(), 36), th().dark ? lv_color_hex(0xFFB340) : lv_color_hex(0xC26A00),
                            &fig_s14, 30);
        lv_obj_t* fl = icon(st, ICON_FLAME_FILLED, &icons_16, th().dark ? lv_color_hex(0xFFB340) : lv_color_hex(0xC26A00));
        lv_obj_move_to_index(fl, 0);
        int id = it.id;
        onClick(r, [id] { App::get().toggleHabit(id); });
    }

    // --- Colonne droite
    lv_obj_t* right = col(body, 14);
    lv_obj_set_size(right, 380, lv_pct(100));

    lv_obj_t* sc = card(right, 22, 20);
    lv_obj_set_width(sc, lv_pct(100));
    lv_obj_t* sh = row(sc, 14);
    iconTile(sh, ICON_FLAME_FILLED, mix(th().card, color::orange(), 46), 52, &icons_28, 16);
    lv_obj_t* st = col(sh, 2);
    label(st, days(t.streak), &fig_b32, th().text);
    int toBeat = t.bestStreak - t.streak;
    std::string sub = t.streak == 0 ? (t.bestStreak > 0 ? "Record " + std::to_string(t.bestStreak) + " j · une nouvelle série commence"
                                                        : "Ta première série commence aujourd’hui")
                      : toBeat > 0 ? "Record " + std::to_string(t.bestStreak) + " j · encore " + std::to_string(toBeat) + " pour le battre"
                                   : "Nouveau record personnel !";
    label(st, sub, &fig_m14, th().text2);
    lv_obj_t* week = row(sc, 0);
    lv_obj_set_width(week, lv_pct(100));
    lv_obj_set_style_pad_top(week, 16, 0);
    lv_obj_set_flex_align(week, LV_FLEX_ALIGN_SPACE_BETWEEN, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER);
    for (const WeekDay& d : t.week) {
        lv_obj_t* c = col(week, 6);
        lv_obj_set_flex_align(c, LV_FLEX_ALIGN_START, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER);
        label(c, d.label, &fig_s14, d.state == "today" ? th().text : th().text2);
        lv_obj_t* b = box(c);
        lv_obj_set_size(b, 34, 34);
        lv_obj_set_style_radius(b, 17, 0);
        if (d.state == "done") {
            setBg(b, color::green());
            lv_obj_t* ck = icon(b, ICON_CHECK, &icons_16, th().dark ? th().bg : color::white());
            lv_obj_center(ck);
        } else if (d.state == "today") {
            lv_obj_set_style_border_width(b, 3, 0);
            lv_obj_set_style_border_color(b, color::green(), 0);
        } else if (d.state == "missed") {
            setBg(b, mix(th().card, color::red(), 70));
        } else {
            setBg(b, th().chip);
        }
    }

    lv_obj_t* rates = card(right, 22, 18);
    lv_obj_set_width(rates, lv_pct(100));
    lv_obj_set_flex_flow(rates, LV_FLEX_FLOW_ROW);
    lv_obj_set_style_pad_column(rates, 20, 0);
    auto rate = [&](const char* title, int v) {
        lv_obj_t* c = col(rates, 4);
        lv_obj_set_flex_grow(c, 1);
        label(c, title, &fig_m14, th().text2);
        label(c, std::to_string(v) + " %", &fig_b32, th().text);
        lv_obj_t* b = progressBar(c, 0, 8, v, color::blue(), th().track);
        lv_obj_set_width(b, lv_pct(100));
    };
    rate("Cette semaine", t.weekRate);
    rate("Ce mois-ci", t.monthRate);

    lv_obj_t* bc = card(right, 22, 18);
    lv_obj_set_width(bc, lv_pct(100));
    lv_obj_set_flex_grow(bc, 1);
    lv_obj_t* bh = row(bc, 0);
    lv_obj_set_width(bh, lv_pct(100));
    label(bh, "Badges", &fig_s18, th().text);
    spacer(bh);
    int unlocked = static_cast<int>(std::count_if(t.badges.begin(), t.badges.end(), [](const BadgeInfo& b) { return b.unlocked; }));
    label(bh, std::to_string(unlocked) + " débloqué" + (unlocked > 1 ? "s" : ""), &fig_m14, th().text2);
    lv_obj_t* grid = row(bc, 0);
    lv_obj_set_width(grid, lv_pct(100));
    lv_obj_set_flex_grow(grid, 1);
    lv_obj_set_flex_align(grid, LV_FLEX_ALIGN_SPACE_AROUND, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER);
    // Les trois badges les plus parlants : deux débloqués + le prochain à obtenir.
    std::vector<const BadgeInfo*> shown;
    for (auto& b : t.badges) if (b.unlocked && shown.size() < 2) shown.push_back(&b);
    for (auto& b : t.badges) if (!b.unlocked && shown.size() < 3) shown.push_back(&b);
    const lv_color_t badgeColors[] = {color::orange(), color::green(), color::blue()};
    for (size_t i = 0; i < shown.size(); i++) {
        const BadgeInfo& b = *shown[i];
        lv_obj_t* c = col(grid, 8);
        lv_obj_set_width(c, 104);
        lv_obj_set_flex_align(c, LV_FLEX_ALIGN_START, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER);
        lv_obj_t* medal = box(c);
        lv_obj_set_size(medal, 66, 66);
        lv_obj_set_style_radius(medal, 33, 0);
        if (b.unlocked) {
            setBg(medal, badgeColors[i % 3]);
            lv_obj_set_style_outline_width(medal, 4, 0);
            lv_obj_set_style_outline_color(medal, mix(th().card, badgeColors[i % 3], 70), 0);
        } else {
            setBg(medal, th().chip);
            lv_obj_set_style_border_width(medal, 2, 0);
            lv_obj_set_style_border_color(medal, th().ring, 0);
        }
        lv_obj_t* ic = icon(medal, b.label.find("séance") != std::string::npos ? ICON_DUMBBELL : b.label.find("Série") != std::string::npos ? ICON_FLAME_FILLED : ICON_AWARD,
                            &icons_28, b.unlocked ? color::white() : th().text3);
        lv_obj_center(ic);
        lv_obj_t* name = label(c, b.label, &fig_s14, b.unlocked ? th().text : th().text2);
        lv_label_set_long_mode(name, LV_LABEL_LONG_WRAP);
        lv_obj_set_width(name, lv_pct(100));
        lv_obj_set_style_text_align(name, LV_TEXT_ALIGN_CENTER, 0);
        if (b.unlocked) label(c, "Obtenu", &fig_m14, th().dark ? lv_color_hex(0x6EE08E) : lv_color_hex(0x1E7A36));
        else label(c, std::to_string(b.progress) + " / " + std::to_string(b.target), &fig_m14, th().text3);
    }
}
