// Réveil : prochaine alarme, routine matinale, liste des alarmes, écran de sonnerie.
#include <algorithm>
#include <ctime>

#include "../app.h"
#include "../hal.h"
#include "../ui.h"
#include "../util.h"

using namespace ui;

namespace {

const char* soundName(const std::string& s) {
    if (s == "carillon") return "Carillon";
    if (s == "pulsation") return "Pulsation";
    if (s == "douce") return "Douce";
    return "Aube douce";
}

void routineStep(lv_obj_t* parent, const std::string& when, const char* glyph, lv_color_t c, const std::string& text) {
    lv_obj_t* r = row(parent, 14);
    lv_obj_set_size(r, lv_pct(100), 54);
    lv_obj_t* w = label(r, when, &fig_s14, th().text2);
    lv_obj_set_width(w, 60);
    lv_obj_t* t = iconTile(r, glyph, mix(th().card, c, 46), 34, &icons_20, 10);
    lv_obj_t* ic = lv_obj_get_child(t, 0);
    lv_obj_set_style_text_color(ic, c, 0);
    label(r, text, &fig_m16, th().text);
}

}  // namespace

void buildAlarm(lv_obj_t* parent) {
    State& s = App::get().state();
    int active = static_cast<int>(std::count_if(s.alarms.begin(), s.alarms.end(), [](const Alarm& a) { return a.enabled; }));
    lv_obj_t* actions = pageHeader(parent, "Réveil",
                                   std::to_string(s.alarms.size()) + " alarme" + (s.alarms.size() > 1 ? "s" : "") + " · " +
                                       std::to_string(active) + " active" + (active > 1 ? "s" : ""));
    lv_obj_t* test = button(actions, "Tester la sonnerie", th().card2, th().text, 52);
    lv_obj_t* ti = icon(test, ICON_VOLUME, &icons_20, th().text);
    lv_obj_move_to_index(ti, 0);
    onClick(test, [] { App::get().debugRing(); });
    lv_obj_t* add = button(actions, "Gérer dans la console", color::orange(), lv_color_hex(0x1F1300), 52);
    onClick(add, [] { App::get().toast("Ajoute ou modifie tes alarmes depuis la console web"); });

    lv_obj_t* body = row(parent, 20);
    lv_obj_set_size(body, lv_pct(100), 0);
    lv_obj_set_flex_grow(body, 1);
    lv_obj_set_flex_align(body, LV_FLEX_ALIGN_START, LV_FLEX_ALIGN_START, LV_FLEX_ALIGN_START);

    lv_obj_t* left = col(body, 14);
    lv_obj_set_size(left, 420, lv_pct(100));

    lv_obj_t* hero = card(left, 24, 22);
    lv_obj_set_width(hero, lv_pct(100));
    lv_obj_t* hh = row(hero, 8);
    icon(hh, ICON_ALARM, &icons_20, lv_color_hex(0xFFB340));
    label(hh, "PROCHAINE ALARME", &fig_s14, lv_color_hex(0xFFB340));
    if (s.nextAlarm.valid) {
        label(hero, s.nextAlarm.time, &fig_l96, th().text);
        time_t at = static_cast<time_t>(s.nextAlarm.at);
        struct tm t;
        localtime_r(&at, &t);
        struct tm now = util::localNow();
        int diff = t.tm_yday - now.tm_yday + (t.tm_year - now.tm_year) * 365;
        std::string day = diff == 0 ? "Aujourd’hui" : diff == 1 ? "Demain, " + util::weekdayName(t.tm_wday) : util::weekdayName(t.tm_wday, true);
        lv_obj_t* r = row(hero, 6);
        label(r, day, &fig_s16, th().text);
        lv_obj_t* delay = label(r, "· " + util::inDelay(s.nextAlarm.at - time(nullptr)), &fig_m16, th().text2);
        int64_t target = s.nextAlarm.at;
        App::get().onSecond([delay, target] { lv_label_set_text(delay, ("· " + util::inDelay(target - time(nullptr))).c_str()); });
        const Alarm* next = nullptr;
        for (const Alarm& a : s.alarms) if (a.time == s.nextAlarm.time && a.enabled) next = &a;
        lv_obj_t* chips = row(hero, 8);
        lv_obj_set_style_pad_top(chips, 14, 0);
        pill(chips, next ? soundName(next->sound) : "Aube douce", th().chip, th().text, &fig_m14, 32);
        pill(chips, "Répétition " + std::to_string(next ? next->snoozeMinutes : 9) + " min", th().chip, th().text, &fig_m14, 32);
        pill(chips, "Volume progressif", th().chip, th().text, &fig_m14, 32);
    } else {
        label(hero, "--:--", &fig_l96, th().text3);
        label(hero, "Aucune alarme active", &fig_m16, th().text2);
    }

    lv_obj_t* rc = card(left, 24, 18);
    lv_obj_set_width(rc, lv_pct(100));
    lv_obj_set_flex_grow(rc, 1);
    lv_obj_t* rh = row(rc, 0);
    lv_obj_set_width(rh, lv_pct(100));
    lv_obj_t* rt = col(rh, 2);
    label(rt, "Routine matinale", &fig_s18, th().text);
    label(rt, "Avant et après chaque alarme", &fig_m14, th().text2);
    spacer(rh);
    lv_obj_t* steps = col(rc, 0);
    lv_obj_set_width(steps, lv_pct(100));
    lv_obj_set_style_pad_top(steps, 8, 0);
    if (!s.routine.enabled) lv_obj_set_style_opa(steps, LV_OPA_40, 0);
    if (s.routine.preLightMinutes > 0)
        routineStep(steps, "–" + std::to_string(s.routine.preLightMinutes) + " min", ICON_SUN, color::yellow(), "L’écran s’éclaire progressivement");
    routineStep(steps, "Alarme", ICON_VOLUME, color::orange(), "Sonnerie, volume qui monte en 30 s");
    if (s.routine.showBriefing) routineStep(steps, "Arrêt", ICON_CALENDAR, color::blue(), "Météo et agenda du jour à l’écran");
    if (s.routine.waterReminder) routineStep(steps, "+5 min", ICON_DROP, color::green(), "Habitude : boire un verre d’eau");

    // --- Liste des alarmes
    lv_obj_t* list = card(body, 24, 0);
    lv_obj_set_height(list, lv_pct(100));
    lv_obj_set_flex_grow(list, 1);
    lv_obj_set_style_pad_hor(list, 26, 0);
    lv_obj_set_style_pad_ver(list, 8, 0);
    if (s.alarms.empty()) {
        lv_obj_t* l = label(list, "Aucune alarme. Crée-en une depuis la console web.", &fig_m16, th().text2);
        lv_obj_set_style_pad_top(l, 20, 0);
    }
    const char* letters[7] = {"L", "M", "M", "J", "V", "S", "D"};
    for (size_t i = 0; i < s.alarms.size() && i < 5; i++) {
        const Alarm& a = s.alarms[i];
        lv_obj_t* r = row(list, 20);
        lv_obj_set_size(r, lv_pct(100), 112);
        lv_obj_set_style_border_side(r, LV_BORDER_SIDE_BOTTOM, 0);
        lv_obj_set_style_border_width(r, 1, 0);
        lv_obj_set_style_border_color(r, th().hairline, 0);
        lv_obj_t* info = col(r, 8);
        lv_obj_set_flex_grow(info, 1);
        if (!a.enabled) lv_obj_set_style_opa(info, LV_OPA_50, 0);
        lv_obj_t* top = row(info, 14);
        lv_obj_set_flex_align(top, LV_FLEX_ALIGN_START, LV_FLEX_ALIGN_END, LV_FLEX_ALIGN_END);
        label(top, a.time, &fig_l54, th().text);
        lv_obj_t* lb = label(top, a.label.empty() ? "Alarme" : a.label, &fig_s16, th().text);
        lv_obj_set_style_pad_bottom(lb, 8, 0);
        lv_obj_t* snd = label(top, soundName(a.sound), &fig_m14, th().text2);
        lv_obj_set_style_pad_bottom(snd, 9, 0);
        lv_obj_t* days = row(info, 6);
        for (int d = 0; d < 7; d++) {
            lv_obj_t* c = box(days);
            lv_obj_set_size(c, 30, 30);
            lv_obj_set_style_radius(c, 15, 0);
            setBg(c, a.days[d] ? mix(th().card, color::orange(), 50) : th().chip);
            lv_obj_t* l = label(c, letters[d], &fig_s14, a.days[d] ? lv_color_hex(0xFFB340) : th().text3);
            lv_obj_center(l);
        }
        int id = a.id;
        toggle(r, a.enabled, [id](bool on) { App::get().setAlarmEnabled(id, on); });
    }
    spacer(list);
    lv_obj_t* foot = row(list, 10);
    lv_obj_set_style_pad_ver(foot, 12, 0);
    icon(foot, ICON_MOON, &icons_20, th().text2);
    label(foot, "Fonctionne même en veille profonde : l’appareil se réveille 2 min avant l’alarme.", &fig_m14, th().text2);
}

void buildRinging(lv_obj_t* layer, const Alarm& alarm) {
    setBg(layer, lv_color_hex(0x110A05));
    lv_obj_set_style_bg_grad_color(layer, lv_color_hex(0x5A2A0C), 0);
    lv_obj_set_style_bg_grad_dir(layer, LV_GRAD_DIR_VER, 0);
    lv_obj_set_style_bg_main_stop(layer, 120, 0);

    lv_obj_t* c = col(layer, 0);
    lv_obj_set_size(c, lv_pct(100), lv_pct(100));
    lv_obj_set_flex_align(c, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER);
    lv_color_t ink = lv_color_hex(0xFFF6EC);

    lv_obj_t* halo = box(c);
    lv_obj_set_size(halo, 136, 136);
    lv_obj_set_style_radius(halo, 68, 0);
    lv_obj_set_style_border_width(halo, 2, 0);
    lv_obj_set_style_border_color(halo, color::orange(), 0);
    lv_obj_set_style_border_opa(halo, 60, 0);
    lv_obj_t* bell = iconTile(halo, ICON_ALARM, color::orange(), 76, &icons_40, 38);
    lv_obj_center(bell);
    lv_obj_set_style_text_color(lv_obj_get_child(bell, 0), lv_color_hex(0x1F1300), 0);
    // Pulsation douce du halo.
    lv_anim_t an;
    lv_anim_init(&an);
    lv_anim_set_var(&an, halo);
    lv_anim_set_values(&an, 40, 255);
    lv_anim_set_duration(&an, 900);
    lv_anim_set_playback_duration(&an, 900);
    lv_anim_set_repeat_count(&an, LV_ANIM_REPEAT_INFINITE);
    lv_anim_set_exec_cb(&an, [](void* o, int32_t v) { lv_obj_set_style_border_opa(static_cast<lv_obj_t*>(o), static_cast<lv_opa_t>(v), 0); });
    lv_anim_start(&an);

    lv_obj_t* lb = label(c, (alarm.label.empty() ? std::string("Alarme") : alarm.label) + " · Bonjour", &fig_s22, ink);
    lv_obj_set_style_pad_top(lb, 18, 0);
    App::get().registerClock(label(c, "", &fig_l176, ink), ClockFormat::HHMM);

    const State& s = App::get().state();
    std::string info = util::longDate(util::localNow());
    if (s.weather.valid) info += "  ·  " + std::to_string(s.weather.temp) + "° " + s.weather.text;
    if (s.agenda.valid && !s.agenda.today.empty()) info += "  ·  1er rendez-vous à " + s.agenda.today.front().start;
    label(c, info, &fig_m18, mix(ink, lv_color_hex(0x110A05), 50));

    lv_obj_t* btns = row(c, 22);
    lv_obj_set_style_pad_top(btns, 44, 0);
    lv_obj_t* snooze = button(btns, "Répéter · " + std::to_string(alarm.snoozeMinutes) + " min", lv_color_hex(0x3A2A1E), ink, 96, 360, &fig_b24);
    lv_obj_t* zz = icon(snooze, ICON_MOON, &icons_28, ink);
    lv_obj_move_to_index(zz, 0);
    onClick(snooze, [] { AppAccess::dismissRinging(true); });
    lv_obj_t* stop = button(btns, "Arrêter", color::orange(), lv_color_hex(0x1F1300), 96, 360, &fig_b24);
    onClick(stop, [] { AppAccess::dismissRinging(false); });
    lv_obj_t* hint = label(c, "Ou appuie sur le bouton du dessus pour répéter", &fig_m16, mix(ink, lv_color_hex(0x110A05), 70));
    lv_obj_set_style_pad_top(hint, 22, 0);
}
