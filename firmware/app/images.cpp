#include "images.h"

#include <algorithm>
#include <atomic>
#include <cstring>
#include <functional>
#include <list>
#include <map>
#include <memory>
#include <vector>

#include "api.h"
#include "hal.h"
#include "src/libs/tjpgd/tjpgd.h"

namespace images {

namespace {

constexpr size_t MAX_ENTRIES = 48;
constexpr size_t WORKBUF = 4096;
constexpr uint32_t RETRY_MS = 20000;  // une image en échec est redemandée après ce délai

struct Entry {
    lv_image_dsc_t dsc{};
    std::vector<uint8_t> pixels;  // RGB565
    bool ready = false;
    bool failed = false;
    bool loading = false;
    uint32_t failedAt = 0;
    int users = 0;
    uint32_t lastUse = 0;
    std::list<lv_obj_t*> waiters;
    // Encore attendue par un écran ? (lu par le thread réseau : inutile de télécharger
    // les affiches d'une page qu'on vient de quitter).
    std::shared_ptr<std::atomic<bool>> wanted = std::make_shared<std::atomic<bool>>(true);
};

std::map<std::string, std::unique_ptr<Entry>> g_cache;

struct Decoder {
    const uint8_t* data;
    size_t size;
    size_t pos;
    std::vector<uint8_t>* out;
    int width;
};

size_t inFunc(JDEC* jd, uint8_t* buf, size_t n) {
    auto* d = static_cast<Decoder*>(jd->device);
    size_t left = d->size - d->pos;
    if (n > left) n = left;
    if (buf) std::memcpy(buf, d->data + d->pos, n);
    d->pos += n;
    return n;
}

int outFunc(JDEC* jd, void* bitmap, JRECT* rect) {
    auto* d = static_cast<Decoder*>(jd->device);
    const uint8_t* src = static_cast<const uint8_t*>(bitmap);  // RGB888
    for (int y = rect->top; y <= rect->bottom; y++) {
        for (int x = rect->left; x <= rect->right; x++) {
            uint8_t r = *src++, g = *src++, b = *src++;
            uint16_t v = static_cast<uint16_t>(((r & 0xF8) << 8) | ((g & 0xFC) << 3) | (b >> 3));
            size_t i = (static_cast<size_t>(y) * d->width + x) * 2;
            (*d->out)[i] = static_cast<uint8_t>(v & 0xFF);
            (*d->out)[i + 1] = static_cast<uint8_t>(v >> 8);
        }
    }
    return 1;
}

/** Décode un JPEG baseline en RGB565 little-endian (format natif de LVGL). */
bool decodeJpeg(const std::string& jpg, int& w, int& h, std::vector<uint8_t>& out) {
    std::vector<uint8_t> work(WORKBUF);
    JDEC jd;
    Decoder dec{reinterpret_cast<const uint8_t*>(jpg.data()), jpg.size(), 0, &out, 0};
    if (jd_prepare(&jd, inFunc, work.data(), work.size(), &dec) != JDR_OK) return false;
    w = jd.width;
    h = jd.height;
    if (w <= 0 || h <= 0 || w > 1280 || h > 1280) return false;
    dec.width = w;
    out.assign(static_cast<size_t>(w) * h * 2, 0);
    return jd_decomp(&jd, outFunc, 0) == JDR_OK;
}

void attach(lv_obj_t* frame, Entry* e) {
    lv_obj_t* img = lv_image_create(frame);
    lv_image_set_src(img, &e->dsc);
    // L'image remplit tout le cadre (comme « cover ») même si sa taille diffère : sinon une
    // pochette de 420 px dans un cadre de 72 px n'en montrerait que le centre.
    int fw = lv_obj_get_style_width(frame, LV_PART_MAIN), fh = lv_obj_get_style_height(frame, LV_PART_MAIN);
    int iw = e->dsc.header.w, ih = e->dsc.header.h;
    if (fw > 0 && fh > 0 && iw > 0 && ih > 0 && (iw != fw || ih != fh)) {
        int scale = std::max(fw * 256 / iw, fh * 256 / ih) + 1;
        lv_image_set_pivot(img, iw / 2, ih / 2);
        lv_image_set_scale(img, static_cast<uint32_t>(scale));
    }
    lv_obj_center(img);
    e->users++;
    e->lastUse = hal::get().millis();
    lv_obj_add_event_cb(
        img,
        [](lv_event_t* ev) {
            auto* entry = static_cast<Entry*>(lv_event_get_user_data(ev));
            if (entry->users > 0) entry->users--;
        },
        LV_EVENT_DELETE, e);
}

void load(const std::string& url, Entry* e) {
    e->loading = true;
    auto jpg = std::make_shared<hal::HttpResponse>();
    auto pixels = std::make_shared<std::vector<uint8_t>>();
    auto size = std::make_shared<std::pair<int, int>>(0, 0);
    auto ok = std::make_shared<bool>(false);
    auto skipped = std::make_shared<bool>(false);
    auto wanted = e->wanted;
    std::string full = api::resolve(url);
    hal::Headers headers = api::authHeaders();
    api::runInWorker(
        [=]() {
            if (!wanted->load()) {
                *skipped = true;
                return;
            }
            // Deux essais : une première demande peut expirer pendant que le serveur
            // télécharge et redimensionne l'image d'origine (ensuite elle est en cache).
            for (int attempt = 0; attempt < 2 && !*ok; attempt++) {
                *jpg = hal::get().http("GET", full, "", headers, 25000);
                if (jpg->status == 200 && !jpg->body.empty()) *ok = decodeJpeg(jpg->body, size->first, size->second, *pixels);
                if (jpg->status == 404 || jpg->status == 400) break;  // inutile d'insister
            }
        },
        [=]() {
            e->loading = false;
            if (*skipped) {
                // Abandonnée faute de spectateur… sauf si un écran l'a redemandée entre-temps.
                if (!e->waiters.empty()) load(url, e);
                return;
            }
            if (!*ok) {
                e->failed = true;
                e->failedAt = hal::get().millis();
                e->waiters.clear();
                return;
            }
            e->pixels = std::move(*pixels);
            std::memset(&e->dsc, 0, sizeof e->dsc);
            e->dsc.header.magic = LV_IMAGE_HEADER_MAGIC;
            e->dsc.header.cf = LV_COLOR_FORMAT_RGB565;
            e->dsc.header.w = size->first;
            e->dsc.header.h = size->second;
            e->dsc.header.stride = size->first * 2;
            e->dsc.data = e->pixels.data();
            e->dsc.data_size = static_cast<uint32_t>(e->pixels.size());
            e->ready = true;
            for (lv_obj_t* frame : e->waiters) attach(frame, e);
            e->waiters.clear();
        },
        api::Lane::Images);
}

/**
 * Images passant par le serveur (/api/v1/image?…&w=…&h=…) : on demande directement la
 * taille du cadre, recadrée par le serveur. Image nette, légère, sans mise à l'échelle.
 */
std::string sizedUrl(const std::string& url, int w, int h) {
    if (url.find("/api/v1/image?") == std::string::npos) return url;
    auto setParam = [](std::string u, const std::string& key, int value) {
        std::string k = "&" + key + "=";
        size_t p = u.find(k);
        if (p == std::string::npos) return u + k + std::to_string(value);
        size_t end = u.find('&', p + k.size());
        return u.substr(0, p + k.size()) + std::to_string(value) + (end == std::string::npos ? "" : u.substr(end));
    };
    return setParam(setParam(url, "w", std::min(w, 640)), "h", std::min(h, 640));
}

}  // namespace

lv_obj_t* create(lv_obj_t* parent, const std::string& rawUrl, int w, int h, int radius, lv_color_t placeholder) {
    const std::string url = sizedUrl(rawUrl, w, h);
    lv_obj_t* frame = lv_obj_create(parent);
    lv_obj_remove_style_all(frame);
    lv_obj_clear_flag(frame, LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_clear_flag(frame, LV_OBJ_FLAG_CLICKABLE);
    lv_obj_set_size(frame, w, h);
    lv_obj_set_style_radius(frame, radius, 0);
    lv_obj_set_style_clip_corner(frame, true, 0);
    lv_obj_set_style_bg_color(frame, placeholder, 0);
    lv_obj_set_style_bg_opa(frame, LV_OPA_COVER, 0);
    if (url.empty()) return frame;

    auto& slot = g_cache[url];
    if (!slot) slot = std::make_unique<Entry>();
    Entry* e = slot.get();
    if (e->failed && hal::get().millis() - e->failedAt > RETRY_MS) e->failed = false;  // nouvel essai
    if (e->ready) {
        attach(frame, e);
    } else if (!e->failed) {
        e->waiters.push_back(frame);
        e->wanted->store(true);
        lv_obj_add_event_cb(
            frame,
            [](lv_event_t* ev) {
                auto* entry = static_cast<Entry*>(lv_event_get_user_data(ev));
                entry->waiters.remove(static_cast<lv_obj_t*>(lv_event_get_target(ev)));
                if (entry->waiters.empty() && !entry->ready) entry->wanted->store(false);
            },
            LV_EVENT_DELETE, e);
        if (!e->loading) load(url, e);
    }
    return frame;
}

void trim() {
    if (g_cache.size() <= MAX_ENTRIES) return;
    // Supprime les plus anciennes images non affichées.
    std::vector<std::pair<uint32_t, std::string>> idle;
    for (auto& [url, e] : g_cache) {
        if (e->users == 0 && !e->loading && e->waiters.empty()) idle.push_back({e->lastUse, url});
    }
    std::sort(idle.begin(), idle.end());
    size_t excess = g_cache.size() - MAX_ENTRIES;
    for (size_t i = 0; i < idle.size() && i < excess; i++) {
        Entry* e = g_cache[idle[i].second].get();
        if (e->ready) lv_image_cache_drop(&e->dsc);
        g_cache.erase(idle[i].second);
    }
}

lv_color_t artworkColor(const std::string& seed, int which) {
    static const uint32_t pairs[][2] = {{0xFF6B6B, 0x5B2A86}, {0x2A9DB5, 0x123A6B}, {0x4FB06A, 0x1F5A44}, {0xC04BD8, 0x3B1E73}};
    size_t h = std::hash<std::string>{}(seed) % 4;
    return lv_color_hex(pairs[h][which ? 1 : 0]);
}

lv_obj_t* artwork(lv_obj_t* parent, const std::string& url, const std::string& seed, int w, int h, int radius,
                  lv_color_t placeholder) {
    if (!url.empty()) return create(parent, url, w, h, radius, placeholder);
    lv_obj_t* a = lv_obj_create(parent);
    lv_obj_remove_style_all(a);
    lv_obj_clear_flag(a, LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_clear_flag(a, LV_OBJ_FLAG_CLICKABLE);
    lv_obj_set_size(a, w, h);
    lv_obj_set_style_radius(a, radius, 0);
    lv_obj_set_style_clip_corner(a, true, 0);
    lv_obj_set_style_bg_opa(a, LV_OPA_COVER, 0);
    lv_obj_set_style_bg_color(a, artworkColor(seed, 0), 0);
    lv_obj_set_style_bg_grad_color(a, artworkColor(seed, 1), 0);
    lv_obj_set_style_bg_grad_dir(a, LV_GRAD_DIR_VER, 0);
    return a;
}

}  // namespace images
