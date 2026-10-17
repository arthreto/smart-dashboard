// Musique : lecteur Spotify (lecture en cours, commandes, volume, file d'attente).
#include <algorithm>

#include "../app.h"
#include "../hal.h"
#include "../images.h"
#include "../ui.h"
#include "../util.h"

using namespace ui;

namespace {

lv_color_t artColor(const std::string& seed, int which) { return images::artworkColor(seed, which); }

lv_obj_t* art(lv_obj_t* parent, const Track& t, int size, int radius) {
    lv_obj_t* a = images::artwork(parent, t.imageUrl, t.album + t.title, size, size, radius, th().card2);
    if (t.imageUrl.empty() && size > 120) {
        lv_obj_t* ringA = box(a);
        lv_obj_set_size(ringA, size * 5 / 7, size * 5 / 7);
        lv_obj_set_style_radius(ringA, LV_RADIUS_CIRCLE, 0);
        lv_obj_set_style_border_width(ringA, 2, 0);
        lv_obj_set_style_border_color(ringA, color::white(), 0);
        lv_obj_set_style_border_opa(ringA, 55, 0);
        lv_obj_center(ringA);
        lv_obj_t* name = label(a, t.album, &fig_s16, color::white());
        lv_obj_align(name, LV_ALIGN_BOTTOM_LEFT, 26, -22);
    }
    return a;
}

}  // namespace

void buildMusic(lv_obj_t* parent) {
    Music& m = App::get().state().music;
    lv_obj_set_flex_flow(parent, LV_FLEX_FLOW_ROW);
    lv_obj_set_flex_align(parent, LV_FLEX_ALIGN_START, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER);
    lv_obj_set_style_pad_hor(parent, 40, 0);
    lv_obj_set_style_pad_column(parent, 44, 0);

    if (!m.valid) {
        lv_obj_t* c = col(parent, 14);
        lv_obj_set_flex_grow(c, 1);
        lv_obj_set_flex_align(c, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER);
        iconTile(c, ICON_MUSIC, color::pink(), 96, &icons_40, 28);
        label(c, "Spotify n’est pas connecté", &fig_b32, th().text);
        lv_obj_t* l = label(c, "Dans la console web : Intégrations › Spotify › « Connecter le compte Spotify ». Un compte Premium est nécessaire pour les commandes.",
                            &fig_m16, th().text2);
        lv_label_set_long_mode(l, LV_LABEL_LONG_WRAP);
        lv_obj_set_width(l, 640);
        lv_obj_set_style_text_align(l, LV_TEXT_ALIGN_CENTER, 0);
        return;
    }

    Track empty;
    empty.title = m.message.empty() ? "Rien en lecture" : m.message;
    empty.artist = "Lance la musique sur un appareil Spotify";
    const Track& t = m.hasTrack ? m.track : empty;
    lv_obj_t* cover = art(parent, t, 420, 30);
    // Halo coloré sous la pochette (une ombre noire serait invisible sur le fond sombre).
    // En thème clair, une ombre neutre et discrète (un halo coloré y paraît grisâtre).
    lv_obj_set_style_shadow_width(cover, th().dark ? 80 : 44, 0);
    lv_obj_set_style_shadow_color(cover, th().dark ? artColor(t.album + t.title, 0) : lv_color_hex(0x000000), 0);
    lv_obj_set_style_shadow_opa(cover, th().dark ? 70 : 40, 0);
    lv_obj_set_style_shadow_offset_y(cover, th().dark ? 24 : 14, 0);

    lv_obj_t* right = col(parent, 0);
    lv_obj_set_flex_grow(right, 1);

    lv_obj_t* src = row(right, 12);
    label(src, "SPOTIFY", &fig_s14, th().text2);
    if (!m.deviceName.empty()) {
        lv_obj_t* dev = pill(src, m.deviceName, th().chip, th().text, &fig_s14, 40);
        lv_obj_t* sp = icon(dev, ICON_SPEAKER, &icons_16, lv_color_hex(0x6EE08E));
        lv_obj_move_to_index(sp, 0);
    }

    lv_obj_t* head = row(right, 16);
    lv_obj_set_width(head, lv_pct(100));
    lv_obj_set_style_pad_top(head, 18, 0);
    lv_obj_set_flex_align(head, LV_FLEX_ALIGN_START, LV_FLEX_ALIGN_START, LV_FLEX_ALIGN_START);
    lv_obj_t* titles = col(head, 6);
    lv_obj_set_flex_grow(titles, 1);
    lv_obj_t* tt = label(titles, t.title, &fig_b44, th().text);
    lv_label_set_long_mode(tt, LV_LABEL_LONG_DOT);
    lv_obj_set_width(tt, lv_pct(100));
    label(titles, t.artist, &fig_s22, th().dark ? lv_color_hex(0xC7C7CC) : th().text2);
    if (!t.album.empty()) label(titles, t.album, &fig_m16, th().text2);
    if (m.hasTrack) {
        lv_obj_t* like = iconButton(head, m.liked ? ICON_HEART_FILLED : ICON_HEART, 52, th().chip, m.liked ? color::pink() : th().text2, &icons_24);
        onClick(like, [] { App::get().music("like"); });
    }

    // Progression (avance localement entre deux synchronisations).
    lv_obj_t* bar = progressBar(right, 0, 8, 0, th().text, th().track);
    lv_obj_set_width(bar, lv_pct(100));
    lv_obj_set_style_margin_top(bar, 26, 0);
    lv_obj_t* fill = lv_obj_get_child(bar, 0);
    lv_obj_t* times = row(right, 0);
    lv_obj_set_width(times, lv_pct(100));
    lv_obj_set_style_pad_top(times, 8, 0);
    lv_obj_t* el = label(times, "0:00", &fig_m14, th().text2);
    spacer(times);
    label(times, util::mmss(t.durationMs), &fig_m14, th().text2);
    auto refresh = [fill, el]() {
        Music& mm = App::get().state().music;
        if (!mm.hasTrack) return;
        int pos = mm.track.progressMs + (mm.isPlaying ? static_cast<int>(hal::get().millis() - mm.receivedAtMs) : 0);
        pos = std::min(pos, mm.track.durationMs);
        int pct = mm.track.durationMs ? pos * 100 / mm.track.durationMs : 0;
        lv_obj_clear_flag(fill, LV_OBJ_FLAG_HIDDEN);
        lv_obj_set_width(fill, lv_pct(std::max(1, pct)));
        lv_label_set_text(el, util::mmss(pos).c_str());
    };
    refresh();
    App::get().onSecond(refresh);

    // Commandes sur toute la largeur de la colonne : lecture/pause pile au centre,
    // aligné avec la barre de progression.
    lv_obj_t* ctrl = row(right, 0);
    lv_obj_set_size(ctrl, lv_pct(100), 110);
    lv_obj_set_style_pad_top(ctrl, 10, 0);
    lv_obj_set_flex_align(ctrl, LV_FLEX_ALIGN_SPACE_BETWEEN, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER);
    iconButton(ctrl, ICON_SHUFFLE, 52, th().bg, th().text2, &icons_24);
    onClick(iconButton(ctrl, ICON_PREV_FILLED, 76, th().bg, th().text, &icons_40), [] { App::get().music("previous"); });
    lv_obj_t* play = iconButton(ctrl, m.isPlaying ? ICON_PAUSE_FILLED : ICON_PLAY_FILLED, 100, th().text, th().bg, &icons_40);
    onClick(play, [] { App::get().music(App::get().state().music.isPlaying ? "pause" : "play"); });
    onClick(iconButton(ctrl, ICON_NEXT_FILLED, 76, th().bg, th().text, &icons_40), [] { App::get().music("next"); });
    iconButton(ctrl, ICON_REPEAT, 52, th().bg, th().text2, &icons_24);

    lv_obj_t* vol = row(right, 14);
    lv_obj_set_size(vol, lv_pct(100), 44);
    icon(vol, ICON_VOLUME_LOW, &icons_20, th().text2);
    lv_obj_t* slider = lv_slider_create(vol);
    lv_obj_remove_style_all(slider);
    lv_obj_set_height(slider, 6);
    lv_obj_set_flex_grow(slider, 1);
    lv_slider_set_range(slider, 0, 100);
    lv_slider_set_value(slider, m.volume, LV_ANIM_OFF);
    setBg(slider, th().track);
    lv_obj_set_style_radius(slider, 3, 0);
    lv_obj_set_style_bg_color(slider, th().dark ? lv_color_hex(0xC7C7CC) : th().text2, LV_PART_INDICATOR);
    lv_obj_set_style_bg_opa(slider, LV_OPA_COVER, LV_PART_INDICATOR);
    lv_obj_set_style_radius(slider, 3, LV_PART_INDICATOR);
    lv_obj_set_style_bg_color(slider, color::white(), LV_PART_KNOB);
    lv_obj_set_style_bg_opa(slider, LV_OPA_COVER, LV_PART_KNOB);
    lv_obj_set_style_radius(slider, LV_RADIUS_CIRCLE, LV_PART_KNOB);
    lv_obj_set_style_pad_all(slider, 9, LV_PART_KNOB);
    lv_obj_set_ext_click_area(slider, 18);
    onEvent(slider, LV_EVENT_RELEASED, [slider](lv_event_t*) { App::get().music("volume", lv_slider_get_value(slider)); });
    icon(vol, ICON_VOLUME, &icons_24, th().text2);

    lv_obj_t* q = card(right, 22, 0);
    lv_obj_set_width(q, lv_pct(100));
    lv_obj_set_style_pad_hor(q, 18, 0);
    lv_obj_set_style_pad_ver(q, 14, 0);
    lv_obj_set_style_margin_top(q, 18, 0);
    lv_obj_t* qh = row(q, 0);
    lv_obj_set_width(qh, lv_pct(100));
    label(qh, "À suivre", &fig_s16, th().text);
    if (m.queue.empty()) {
        lv_obj_t* l = label(q, "La file d’attente est vide.", &fig_m14, th().text2);
        lv_obj_set_style_pad_top(l, 8, 0);
    }
    for (size_t i = 0; i < m.queue.size() && i < 2; i++) {
        const Track& n = m.queue[i];
        lv_obj_t* r = row(q, 14);
        lv_obj_set_size(r, lv_pct(100), 52);
        art(r, n, 40, 9);
        lv_obj_t* c = col(r, 0);
        lv_obj_set_flex_grow(c, 1);
        label(c, n.title, &fig_s16, th().text);
        label(c, n.artist, &fig_m14, th().text2);
        label(r, util::mmss(n.durationMs), &fig_m14, th().text2);
    }
}
