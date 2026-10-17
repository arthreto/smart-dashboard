#include "ui.h"

#include <cstring>

#include <algorithm>
#include <cstdarg>
#include <cstdio>
#include <cstdlib>
#include <memory>

namespace ui {

namespace {

Theme makeDark() {
    Theme t;
    t.dark = true;
    t.bg = lv_color_hex(0x0B0B0E);
    t.rail = lv_color_hex(0x131316);
    t.card = lv_color_hex(0x18181C);
    t.card2 = lv_color_hex(0x222227);
    t.chip = lv_color_hex(0x26262C);
    t.text = lv_color_hex(0xF5F5F7);
    t.text2 = lv_color_hex(0xA1A1AA);
    t.text3 = lv_color_hex(0x8B8B94);
    t.track = lv_color_hex(0x2A2A30);
    t.hairline = lv_color_hex(0x232328);
    t.ring = lv_color_hex(0x3A3A41);
    return t;
}

Theme makeLight() {
    Theme t;
    t.dark = false;
    t.bg = lv_color_hex(0xF2F2F7);
    t.rail = lv_color_hex(0xFFFFFF);
    t.card = lv_color_hex(0xFFFFFF);
    t.card2 = lv_color_hex(0xF2F2F7);
    t.chip = lv_color_hex(0xE9E9EE);
    t.text = lv_color_hex(0x1C1C1E);
    t.text2 = lv_color_hex(0x6C6C72);
    t.text3 = lv_color_hex(0x8E8E93);
    t.track = lv_color_hex(0xE5E5EA);
    t.hairline = lv_color_hex(0xEDEDF0);
    t.ring = lv_color_hex(0xC7C7CC);
    return t;
}

Theme g_theme = makeDark();

struct Callback {
    std::function<void(lv_event_t*)> fn;
};

void dispatch(lv_event_t* e) {
    auto* cb = static_cast<Callback*>(lv_event_get_user_data(e));
    if (cb && cb->fn) cb->fn(e);
}

void freeCallback(lv_event_t* e) {
    delete static_cast<Callback*>(lv_event_get_user_data(e));
}

}  // namespace

const Theme& th() { return g_theme; }

void setDarkTheme(bool dark) { g_theme = dark ? makeDark() : makeLight(); }

lv_color_t hex(const std::string& css, lv_color_t fallback) {
    if (css.size() < 7 || css[0] != '#') return fallback;
    char* end = nullptr;
    unsigned long v = std::strtoul(css.substr(1, 6).c_str(), &end, 16);
    if (!end || *end) return fallback;
    return lv_color_hex(static_cast<uint32_t>(v));
}

lv_obj_t* box(lv_obj_t* parent) {
    lv_obj_t* o = lv_obj_create(parent);
    lv_obj_remove_style_all(o);
    lv_obj_clear_flag(o, LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_clear_flag(o, LV_OBJ_FLAG_CLICKABLE);
    lv_obj_set_size(o, LV_SIZE_CONTENT, LV_SIZE_CONTENT);
    return o;
}

lv_obj_t* row(lv_obj_t* parent, int gap) {
    lv_obj_t* o = box(parent);
    lv_obj_set_flex_flow(o, LV_FLEX_FLOW_ROW);
    lv_obj_set_flex_align(o, LV_FLEX_ALIGN_START, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER);
    lv_obj_set_style_pad_column(o, gap, 0);
    return o;
}

lv_obj_t* col(lv_obj_t* parent, int gap) {
    lv_obj_t* o = box(parent);
    lv_obj_set_flex_flow(o, LV_FLEX_FLOW_COLUMN);
    lv_obj_set_flex_align(o, LV_FLEX_ALIGN_START, LV_FLEX_ALIGN_START, LV_FLEX_ALIGN_START);
    lv_obj_set_style_pad_row(o, gap, 0);
    return o;
}

lv_obj_t* card(lv_obj_t* parent, int radius, int pad) {
    lv_obj_t* o = col(parent, 0);
    setBg(o, th().card);
    lv_obj_set_style_radius(o, radius, 0);
    lv_obj_set_style_pad_all(o, pad, 0);
    if (!th().dark) {
        lv_obj_set_style_shadow_width(o, 24, 0);
        lv_obj_set_style_shadow_opa(o, 12, 0);
        lv_obj_set_style_shadow_color(o, lv_color_hex(0x000000), 0);
        lv_obj_set_style_shadow_offset_y(o, 6, 0);
    }
    return o;
}

lv_obj_t* spacer(lv_obj_t* parent) {
    lv_obj_t* o = box(parent);
    lv_obj_set_size(o, 1, 1);
    lv_obj_set_flex_grow(o, 1);
    return o;
}

lv_obj_t* label(lv_obj_t* parent, const std::string& text, const lv_font_t* font, lv_color_t color) {
    lv_obj_t* l = lv_label_create(parent);
    lv_obj_remove_style_all(l);
    lv_label_set_text(l, text.c_str());
    lv_obj_set_style_text_font(l, font, 0);
    lv_obj_set_style_text_color(l, color, 0);
    return l;
}

void fitLabel(lv_obj_t* l, int maxW) {
    const char* txt = lv_label_get_text(l);
    const lv_font_t* f = lv_obj_get_style_text_font(l, 0);
    int32_t w = lv_text_get_width(txt, static_cast<uint32_t>(strlen(txt)), f, lv_obj_get_style_text_letter_space(l, 0));
    lv_label_set_long_mode(l, LV_LABEL_LONG_DOT);
    lv_obj_set_width(l, w + 1 < maxW ? w + 1 : maxW);
    lv_obj_set_height(l, lv_font_get_line_height(f));
}

lv_obj_t* icon(lv_obj_t* parent, const char* glyph, const lv_font_t* font, lv_color_t color) {
    return label(parent, glyph, font, color);
}

lv_obj_t* iconTile(lv_obj_t* parent, const char* glyph, lv_color_t bg, int size, const lv_font_t* font, int radius) {
    lv_obj_t* t = box(parent);
    lv_obj_set_size(t, size, size);
    setBg(t, bg);
    lv_obj_set_style_radius(t, radius < 0 ? size * 0.29 : radius, 0);
    lv_obj_t* i = icon(t, glyph, font, color::white());
    lv_obj_center(i);
    return t;
}

lv_obj_t* pill(lv_obj_t* parent, const std::string& text, lv_color_t bg, lv_color_t fg, const lv_font_t* font, int h) {
    lv_obj_t* p = row(parent, 6);
    lv_obj_set_height(p, h);
    setBg(p, bg);
    lv_obj_set_style_radius(p, h / 2, 0);
    lv_obj_set_style_pad_hor(p, 12, 0);
    label(p, text, font, fg);
    return p;
}

lv_obj_t* dot(lv_obj_t* parent, int size, lv_color_t c) {
    lv_obj_t* d = box(parent);
    lv_obj_set_size(d, size, size);
    setBg(d, c);
    lv_obj_set_style_radius(d, LV_RADIUS_CIRCLE, 0);
    return d;
}

lv_obj_t* progressBar(lv_obj_t* parent, int w, int h, int percent, lv_color_t fill, lv_color_t track) {
    lv_obj_t* t = box(parent);
    lv_obj_set_size(t, w, h);
    setBg(t, track);
    lv_obj_set_style_radius(t, h / 2, 0);
    lv_obj_set_style_clip_corner(t, true, 0);
    lv_obj_t* f = box(t);
    int p = percent < 0 ? 0 : percent > 100 ? 100 : percent;
    lv_obj_set_size(f, lv_pct(p), h);
    setBg(f, fill);
    lv_obj_set_style_radius(f, h / 2, 0);
    if (p == 0) lv_obj_add_flag(f, LV_OBJ_FLAG_HIDDEN);
    return t;
}

lv_obj_t* hairline(lv_obj_t* parent) {
    lv_obj_t* h = box(parent);
    lv_obj_set_size(h, lv_pct(100), 1);
    setBg(h, th().hairline);
    return h;
}

lv_obj_t* button(lv_obj_t* parent, const std::string& text, lv_color_t bg, lv_color_t fg, int h, int w, const lv_font_t* font) {
    lv_obj_t* b = row(parent, 8);
    lv_obj_set_flex_align(b, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER);
    lv_obj_set_height(b, h);
    if (w > 0) lv_obj_set_width(b, w);
    lv_obj_set_style_pad_hor(b, 18, 0);
    setBg(b, bg);
    lv_obj_set_style_radius(b, h / 2, 0);
    label(b, text, font, fg);
    clickable(b);
    return b;
}

lv_obj_t* iconButton(lv_obj_t* parent, const char* glyph, int size, lv_color_t bg, lv_color_t fg, const lv_font_t* font) {
    lv_obj_t* b = box(parent);
    lv_obj_set_size(b, size, size);
    lv_obj_set_style_radius(b, LV_RADIUS_CIRCLE, 0);
    setBg(b, bg, bg.red == 0 && bg.green == 0 && bg.blue == 0 ? LV_OPA_TRANSP : LV_OPA_COVER);
    lv_obj_t* i = icon(b, glyph, font, fg);
    lv_obj_center(i);
    clickable(b);
    return b;
}

lv_obj_t* toggle(lv_obj_t* parent, bool on, std::function<void(bool)> onChange) {
    lv_obj_t* track = box(parent);
    lv_obj_set_size(track, 64, 38);
    lv_obj_set_style_radius(track, 19, 0);
    lv_obj_set_style_pad_all(track, 3, 0);
    setBg(track, on ? color::green() : th().ring);
    lv_obj_t* knob = box(track);
    lv_obj_set_size(knob, 32, 32);
    lv_obj_set_style_radius(knob, 16, 0);
    setBg(knob, color::white());
    lv_obj_set_style_shadow_width(knob, 6, 0);
    lv_obj_set_style_shadow_opa(knob, 60, 0);
    lv_obj_align(knob, on ? LV_ALIGN_RIGHT_MID : LV_ALIGN_LEFT_MID, 0, 0);
    clickable(track);
    lv_obj_set_ext_click_area(track, 8);
    auto state = std::make_shared<bool>(on);
    onClick(track, [track, knob, state, onChange]() {
        *state = !*state;
        setBg(track, *state ? color::green() : th().ring);
        lv_obj_align(knob, *state ? LV_ALIGN_RIGHT_MID : LV_ALIGN_LEFT_MID, 0, 0);
        if (onChange) onChange(*state);
    });
    return track;
}

void setWidth(lv_obj_t* o, int w) { lv_obj_set_width(o, w); }
void setFlexGrow(lv_obj_t* o, int grow) { lv_obj_set_flex_grow(o, grow); }

void setBg(lv_obj_t* o, lv_color_t c, lv_opa_t opa) {
    lv_obj_set_style_bg_color(o, c, 0);
    lv_obj_set_style_bg_opa(o, opa, 0);
}

void setRadius(lv_obj_t* o, int r) { lv_obj_set_style_radius(o, r, 0); }
void setPad(lv_obj_t* o, int all) { lv_obj_set_style_pad_all(o, all, 0); }
void setPad(lv_obj_t* o, int ver, int hor) {
    lv_obj_set_style_pad_ver(o, ver, 0);
    lv_obj_set_style_pad_hor(o, hor, 0);
}

void clickable(lv_obj_t* o) {
    lv_obj_add_flag(o, LV_OBJ_FLAG_CLICKABLE);
    lv_obj_set_style_opa(o, LV_OPA_70, LV_STATE_PRESSED);
}

void onEvent(lv_obj_t* o, lv_event_code_t code, std::function<void(lv_event_t*)> fn) {
    auto* cb = new Callback{std::move(fn)};
    lv_obj_add_event_cb(o, dispatch, code, cb);
    lv_obj_add_event_cb(o, freeCallback, LV_EVENT_DELETE, cb);
}

void onClick(lv_obj_t* o, std::function<void()> fn) {
    clickable(o);
    onEvent(o, LV_EVENT_CLICKED, [fn](lv_event_t*) { fn(); });
}

lv_obj_t* sparkline(lv_obj_t* parent, const std::vector<int>& values, int w, int h, lv_color_t c, int width) {
    lv_obj_t* line = lv_line_create(parent);
    lv_obj_remove_style_all(line);
    lv_obj_set_size(line, w, h);
    auto* pts = new std::vector<lv_point_precise_t>();
    if (values.size() >= 2) {
        int lo = *std::min_element(values.begin(), values.end());
        int hi = *std::max_element(values.begin(), values.end());
        if (hi == lo) hi = lo + 1;
        int pad = width;
        for (size_t i = 0; i < values.size(); i++) {
            lv_point_precise_t p;
            p.x = static_cast<lv_value_precise_t>(pad + (w - 2 * pad) * static_cast<int>(i) / static_cast<int>(values.size() - 1));
            p.y = static_cast<lv_value_precise_t>(pad + (h - 2 * pad) - (h - 2 * pad) * (values[i] - lo) / (hi - lo));
            pts->push_back(p);
        }
    }
    lv_line_set_points(line, pts->data(), static_cast<uint32_t>(pts->size()));
    lv_obj_set_style_line_width(line, width, 0);
    lv_obj_set_style_line_color(line, c, 0);
    lv_obj_set_style_line_rounded(line, true, 0);
    lv_obj_add_event_cb(
        line, [](lv_event_t* e) { delete static_cast<std::vector<lv_point_precise_t>*>(lv_event_get_user_data(e)); }, LV_EVENT_DELETE, pts);
    return line;
}

lv_obj_t* ring(lv_obj_t* parent, int size, int thickness, int percent, lv_color_t c, lv_color_t trackColor) {
    lv_obj_t* arc = lv_arc_create(parent);
    lv_obj_remove_style_all(arc);
    lv_obj_set_size(arc, size, size);
    lv_arc_set_bg_angles(arc, 0, 360);
    lv_arc_set_rotation(arc, 270);
    lv_arc_set_range(arc, 0, 100);
    lv_arc_set_value(arc, percent < 0 ? 0 : percent > 100 ? 100 : percent);
    lv_obj_set_style_arc_width(arc, thickness, LV_PART_MAIN);
    lv_obj_set_style_arc_color(arc, trackColor, LV_PART_MAIN);
    lv_obj_set_style_arc_opa(arc, LV_OPA_COVER, LV_PART_MAIN);
    lv_obj_set_style_arc_width(arc, thickness, LV_PART_INDICATOR);
    lv_obj_set_style_arc_color(arc, c, LV_PART_INDICATOR);
    lv_obj_set_style_arc_opa(arc, LV_OPA_COVER, LV_PART_INDICATOR);
    lv_obj_set_style_arc_rounded(arc, true, LV_PART_INDICATOR);
    lv_obj_clear_flag(arc, LV_OBJ_FLAG_CLICKABLE);
    return arc;
}

lv_obj_t* weatherIcon(lv_obj_t* parent, const std::string& kind, int size) {
    const lv_font_t* f = size >= 36 ? &icons_40 : size >= 26 ? &icons_28 : size >= 22 ? &icons_24 : &icons_20;
    lv_obj_t* b = box(parent);
    lv_obj_set_size(b, size + size / 4, size);
    auto put = [&](const char* g, lv_color_t c, lv_align_t al, int dx, int dy) {
        lv_obj_t* i = icon(b, g, f, c);
        lv_obj_align(i, al, dx, dy);
    };
    lv_color_t cloud = th().dark ? lv_color_hex(0xE8EEF7) : lv_color_hex(0xA9B6C8);
    if (kind == "sun") put(ICON_SUN_FILLED, color::yellow(), LV_ALIGN_CENTER, 0, 0);
    else if (kind == "moon") put(ICON_MOON_FILLED, lv_color_hex(0xFFE7A0), LV_ALIGN_CENTER, 0, 0);
    else if (kind == "partly") {
        put(ICON_SUN_FILLED, color::yellow(), LV_ALIGN_TOP_LEFT, 0, -size / 8);
        put(ICON_CLOUD_FILLED, cloud, LV_ALIGN_BOTTOM_RIGHT, 0, size / 8);
    } else if (kind == "rain") put(ICON_CLOUD_RAIN, cloud, LV_ALIGN_CENTER, 0, 0);
    else if (kind == "snow") put(ICON_CLOUD_SNOW, cloud, LV_ALIGN_CENTER, 0, 0);
    else if (kind == "fog") put(ICON_CLOUD_FOG, cloud, LV_ALIGN_CENTER, 0, 0);
    else if (kind == "storm") put(ICON_CLOUD_STORM, cloud, LV_ALIGN_CENTER, 0, 0);
    else put(ICON_CLOUD_FILLED, cloud, LV_ALIGN_CENTER, 0, 0);
    return b;
}

lv_color_t mix(lv_color_t a, lv_color_t b, uint8_t ratio) { return lv_color_mix(b, a, ratio); }

const char* habitIcon(const std::string& n) {
    if (n == "bed") return ICON_BED;
    if (n == "drop") return ICON_DROP;
    if (n == "moon") return ICON_MOON;
    if (n == "chat") return ICON_CHAT;
    if (n == "briefcase") return ICON_BRIEFCASE;
    if (n == "dumbbell") return ICON_DUMBBELL;
    if (n == "book") return ICON_BOOK;
    if (n == "sparkles") return ICON_SPARKLES;
    if (n == "run") return ICON_RUN;
    if (n == "heart") return ICON_HEART;
    if (n == "leaf") return ICON_LEAF;
    if (n == "music") return ICON_MUSIC;
    if (n == "code") return ICON_CODE;
    if (n == "pill") return ICON_PILL;
    if (n == "sun") return ICON_SUN;
    return ICON_CHECK;
}

std::string thousands(int64_t n) {
    bool neg = n < 0;
    std::string s = std::to_string(neg ? -n : n);
    std::string out;
    int c = 0;
    for (int i = static_cast<int>(s.size()) - 1; i >= 0; i--) {
        out.insert(out.begin(), s[i]);
        if (++c % 3 == 0 && i > 0) out.insert(out.begin(), ' ');
    }
    return neg ? "-" + out : out;
}

std::string fmt(const char* format, ...) {
    char buf[512];
    va_list ap;
    va_start(ap, format);
    vsnprintf(buf, sizeof buf, format, ap);
    va_end(ap);
    return buf;
}

}  // namespace ui
