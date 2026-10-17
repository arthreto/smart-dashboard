#include "app.h"

#include <algorithm>
#include <cstdio>
#include <ctime>

#include "api.h"
#include "hal.h"
#include "images.h"
#include "ui.h"
#include "util.h"

using namespace ui;

namespace {

constexpr int OFFLINE_POLL_SECONDS = 300;  // écran éteint : synchro toutes les 5 min

lv_obj_t* fullLayer(lv_obj_t* parent) {
    lv_obj_t* l = box(parent);
    lv_obj_set_size(l, SCREEN_W, SCREEN_H);
    lv_obj_set_pos(l, 0, 0);
    lv_obj_add_flag(l, LV_OBJ_FLAG_CLICKABLE);
    return l;
}

}  // namespace

App& App::get() {
    static App app;
    return app;
}

// ---------------------------------------------------------------- démarrage

void App::loadConfig() {
    hal::Hal& h = hal::get();
    std::string url = h.load("api_url");
    std::string token = h.load("token");
    demo_ = h.load("demo") == "1";
    api::configure(url, token);
}

void App::init() {
    api::start();
    loadConfig();

    std::string cached = hal::get().load("state_cache");
    if (demo_) applyState(DEMO_STATE_JSON, true);
    else if (!cached.empty()) applyState(cached, true);

    lv_obj_t* scr = lv_screen_active();
    lv_obj_remove_style_all(scr);
    lv_obj_clear_flag(scr, LV_OBJ_FLAG_SCROLLABLE);

    root_ = row(scr, 0);
    lv_obj_set_size(root_, SCREEN_W, SCREEN_H);
    lv_obj_set_flex_align(root_, LV_FLEX_ALIGN_START, LV_FLEX_ALIGN_START, LV_FLEX_ALIGN_START);

    tintLayer_ = box(lv_layer_top());
    lv_obj_set_size(tintLayer_, SCREEN_W, SCREEN_H);
    setBg(tintLayer_, lv_color_hex(0xFF8A00), 26);
    lv_obj_add_flag(tintLayer_, LV_OBJ_FLAG_HIDDEN);
    lv_obj_clear_flag(tintLayer_, LV_OBJ_FLAG_CLICKABLE);

    lv_timer_create([](lv_timer_t*) { App::get().loop(); }, 100, nullptr);

    if (!demo_ && !api::configured()) openSetup();
    else if (state_.settings.lockOnWake && !state_.settings.pinHash.empty()) lock();

    applyBrightness();
    rebuild();
    if (!demo_ && api::configured()) poll();
}

// ---------------------------------------------------------------- boucle

void App::loop() {
    api::pump();
    uint32_t now = hal::get().millis();
    if (now - lastSecondMs_ >= 1000) {
        lastSecondMs_ = now;
        struct tm t = util::localNow();
        for (auto& [lbl, fmt] : clocks_) {
            lv_label_set_text(lbl, fmt == ClockFormat::HHMM ? util::hhmm(t).c_str() : util::longDate(t).c_str());
        }
        for (auto& fn : secondHooks_) fn();
        checkAlarms();
        checkPower();
        if (t.tm_sec == 0) {
            applyBrightness();
            if (t.tm_hour == 0 && t.tm_min == 0) invalidate();  // nouvelle journée
        }
        static int trimCounter = 0;
        if (++trimCounter % 60 == 0) images::trim();
    }
    if (!demo_ && api::configured() && !polling_) {
        int interval = screenOff_ ? OFFLINE_POLL_SECONDS : std::max(15, state_.settings.pollSeconds);
        if (lastPollMs_ == 0 || now - lastPollMs_ >= static_cast<uint32_t>(interval) * 1000u) poll();
    }
    if (dirty_) rebuild();
}

void App::registerClock(lv_obj_t* label, ClockFormat fmt) {
    clocks_.push_back({label, fmt});
    struct tm t = util::localNow();
    lv_label_set_text(label, fmt == ClockFormat::HHMM ? util::hhmm(t).c_str() : util::longDate(t).c_str());
}

void App::onSecond(std::function<void()> fn) { secondHooks_.push_back(std::move(fn)); }

void App::navigate(Screen s) {
    if (s == screen_) return;
    screen_ = s;
    hal::get().playClick();
    rebuild();
}

void App::rebuild() {
    dirty_ = false;
    clocks_.clear();
    secondHooks_.clear();
    struct tm t = util::localNow();
    bool night = state_.settings.nightEnabled && util::inWindow(t, state_.settings.nightStart, state_.settings.nightEnd);
    setDarkTheme(state_.settings.theme != "light" && !(state_.settings.theme == "auto" && !night));

    lv_obj_clean(root_);
    setBg(lv_screen_active(), th().bg);
    setBg(root_, th().bg);
    buildRail(root_);

    content_ = col(root_, 20);
    lv_obj_set_size(content_, SCREEN_W - RAIL_W, SCREEN_H);
    lv_obj_set_style_pad_all(content_, 28, 0);
    switch (screen_) {
        case Screen::Home: buildHome(content_); break;
        case Screen::Tasks: buildTasks(content_); break;
        case Screen::Calendar: buildCalendar(content_); break;
        case Screen::Alarm: buildAlarm(content_); break;
        case Screen::Music: buildMusic(content_); break;
        case Screen::Cinema: buildCinema(content_); break;
        case Screen::Phone: buildPhone(content_); break;
        case Screen::Stats: buildStats(content_); break;
        case Screen::Settings: buildSettings(content_); break;
    }
}

// ---------------------------------------------------------------- barre de navigation

void App::buildRail(lv_obj_t* parent) {
    lv_obj_t* rail = col(parent, 10);
    lv_obj_set_size(rail, RAIL_W, SCREEN_H);
    lv_obj_set_style_pad_ver(rail, 16, 0);
    lv_obj_set_flex_align(rail, LV_FLEX_ALIGN_START, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER);
    setBg(rail, th().rail);
    lv_obj_set_style_border_side(rail, LV_BORDER_SIDE_RIGHT, 0);
    lv_obj_set_style_border_width(rail, 1, 0);
    lv_obj_set_style_border_color(rail, th().hairline, 0);

    lv_obj_t* top = col(rail, 6);
    lv_obj_set_flex_align(top, LV_FLEX_ALIGN_START, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER);
    lv_obj_set_style_pad_bottom(top, 8, 0);
    registerClock(label(top, "", &fig_s22, th().text), ClockFormat::HHMM);
    lv_obj_t* status = row(top, 8);
    hal::PowerStatus p = hal::get().power();
    icon(status, online_ || demo_ ? ICON_WIFI : ICON_WIFI_OFF, &icons_16, online_ || demo_ ? th().text : color::orange());
    // Batterie dessinée : contour + niveau.
    lv_obj_t* bat = box(status);
    lv_obj_set_size(bat, 24, 12);
    lv_obj_set_style_border_width(bat, 2, 0);
    lv_obj_set_style_border_color(bat, th().text2, 0);
    lv_obj_set_style_radius(bat, 3, 0);
    lv_obj_set_style_pad_all(bat, 2, 0);
    int level = p.battery < 0 ? 78 : p.battery;
    lv_obj_t* fill = box(bat);
    lv_obj_set_size(fill, std::max(2, 16 * level / 100), 4);
    setBg(fill, level <= 15 ? color::red() : p.charging ? color::green() : th().text);
    lv_obj_set_style_radius(fill, 1, 0);

    struct Tile {
        Screen s;
        const char* glyph;
        lv_color_t color;
        const char* name;
    };
    const Tile tiles[] = {
        {Screen::Home, ICON_HOME, color::blue(), "Accueil"},
        {Screen::Tasks, ICON_TASKS, color::green(), "Tâches"},
        {Screen::Calendar, ICON_CALENDAR, color::red(), "Calendrier"},
        {Screen::Alarm, ICON_ALARM, color::orange(), "Réveil"},
        {Screen::Music, ICON_MUSIC, color::pink(), "Musique"},
        {Screen::Cinema, ICON_MOVIE, color::teal(), "Cinéma"},
        {Screen::Phone, ICON_PHONE_DEVICE, color::indigo(), "iPhone"},
        {Screen::Stats, ICON_CHART, color::purple(), "Statistiques"},
    };
    auto addTile = [&](const Tile& tl) {
        lv_obj_t* t = iconTile(rail, tl.glyph, tl.color, 56, &icons_28, 16);
        if (tl.s == screen_) {
            lv_obj_set_style_outline_width(t, 3, 0);
            lv_obj_set_style_outline_color(t, th().text, 0);
            lv_obj_set_style_outline_pad(t, 3, 0);
        }
        Screen target = tl.s;
        onClick(t, [this, target]() { navigate(target); });
    };
    for (const auto& tl : tiles) addTile(tl);
    spacer(rail);
    addTile({Screen::Settings, ICON_SETTINGS, th().dark ? color::gray() : lv_color_hex(0x8E8E93), "Réglages"});
}

lv_obj_t* pageHeader(lv_obj_t* parent, const std::string& title, const std::string& subtitle) {
    lv_obj_t* h = row(parent, 16);
    lv_obj_set_width(h, lv_pct(100));
    lv_obj_set_height(h, 64);
    lv_obj_t* left = col(h, 4);
    label(left, title, &fig_b32, th().text);
    if (!subtitle.empty()) label(left, subtitle, &fig_m16, th().text2);
    spacer(h);
    lv_obj_t* actions = row(h, 12);
    return actions;
}

// ---------------------------------------------------------------- synchronisation

void App::poll() {
    if (demo_ || !api::configured() || polling_) return;
    polling_ = true;
    lastPollMs_ = hal::get().millis();
    api::request("GET", "/api/v1/state", "", [this](const hal::HttpResponse& r) {
        polling_ = false;
        if (r.status == 200) {
            online_ = true;
            lastError_.clear();
            lastSync_ = time(nullptr);
            applyState(r.body, false);
            heartbeat();
        } else if (r.status == 401) {
            online_ = false;
            lastError_ = "Appairage requis : le jeton a été révoqué.";
            openSetup();
        } else {
            bool wasOnline = online_;
            online_ = false;
            lastError_ = r.status == 0 ? (r.error.empty() ? "Serveur injoignable" : r.error) : "Erreur serveur " + std::to_string(r.status);
            if (wasOnline) invalidate();
        }
    });
}

void App::syncNow() {
    if (demo_) {
        toast("Mode démo : rien à synchroniser");
        return;
    }
    lastPollMs_ = 0;
    poll();
}

void App::applyState(const std::string& json, bool fromCache) {
    State s;
    std::string err;
    if (!parseState(json, s, err)) {
        lastError_ = err;
        return;
    }
    if (!s.tzPosix.empty()) hal::get().setTimeZone(s.tzPosix);
    if (!fromCache && s.serverTime > 0) hal::get().syncTime(s.serverTime);
    state_ = std::move(s);
    if (!fromCache) hal::get().save("state_cache", json);
    applyBrightness();
    invalidate();
    processCommands();
}

void App::heartbeat() {
    if (demo_ || !api::configured()) return;
    hal::PowerStatus p = hal::get().power();
    std::string acks;
    for (size_t i = 0; i < ackCommands_.size(); i++) acks += (i ? "," : "") + std::to_string(ackCommands_[i]);
    std::string body = fmt(R"({"battery":%d,"charging":%s,"firmware":"%s","rssi":%d,"ip":"%s","screen":"%s","ackCommands":[%s]})",
                           p.battery, p.charging ? "true" : "false", api::jsonEscape(hal::get().firmwareVersion()).c_str(), p.rssi,
                           api::jsonEscape(p.ip).c_str(), screenOff_ ? "off" : "on", acks.c_str());
    std::vector<int> sent = ackCommands_;
    api::request("POST", "/api/v1/heartbeat", body, [this, sent](const hal::HttpResponse& r) {
        if (r.status != 200) return;
        ackCommands_.erase(std::remove_if(ackCommands_.begin(), ackCommands_.end(),
                                          [&](int id) { return std::find(sent.begin(), sent.end(), id) != sent.end(); }),
                           ackCommands_.end());
    });
}

void App::processCommands() {
    bool any = false;
    for (const Command& c : state_.commands) {
        if (std::find(processedCommands_.begin(), processedCommands_.end(), c.id) != processedCommands_.end()) continue;
        processedCommands_.push_back(c.id);
        ackCommands_.push_back(c.id);
        any = true;
        if (c.type == "wake") wake();
        else if (c.type == "lock") lock();
        else if (c.type == "message") showMessage(c.text);
        else if (c.type == "reload") lastPollMs_ = hal::get().millis() - 1000000u;
        else if (c.type == "screenshot") takeScreenshot();
        else if (c.type == "reboot") {
            toast("Redémarrage demandé depuis la console…");
            lv_timer_t* t = lv_timer_create([](lv_timer_t*) { hal::get().reboot(); }, 2500, nullptr);
            lv_timer_set_repeat_count(t, 1);
        }
    }
    if (processedCommands_.size() > 64) processedCommands_.erase(processedCommands_.begin(), processedCommands_.begin() + 32);
    if (any) heartbeat();
}

void App::takeScreenshot() {
    lv_obj_t* scr = lv_screen_active();
    lv_draw_buf_t* buf = lv_snapshot_take(scr, LV_COLOR_FORMAT_RGB565);
    if (!buf) return;
    int w = buf->header.w, h = buf->header.h;
    std::string bytes;
    bytes.resize(static_cast<size_t>(w) * h * 2);
    for (int y = 0; y < h; y++) {
        const uint8_t* src = buf->data + static_cast<size_t>(y) * buf->header.stride;
        std::copy(src, src + w * 2, bytes.begin() + static_cast<size_t>(y) * w * 2);
    }
    lv_draw_buf_destroy(buf);
    if (onScreenshotDone) onScreenshotDone(bytes);
    if (demo_ || !api::configured()) return;
    api::upload("/api/v1/screenshot", std::move(bytes), {{"X-Width", std::to_string(w)}, {"X-Height", std::to_string(h)}},
                [](const hal::HttpResponse&) {});
}

// ---------------------------------------------------------------- actions

void App::toggleHabit(int id) {
    auto it = std::find_if(state_.tasks.items.begin(), state_.tasks.items.end(), [id](const TaskItem& t) { return t.id == id; });
    if (it == state_.tasks.items.end()) return;
    bool target = !it->done;
    it->done = target;
    state_.tasks.done += target ? 1 : -1;
    it->streak += target ? 1 : -1;
    if (target) hal::get().playClick();
    invalidate();
    if (demo_) return;
    api::request("POST", "/api/v1/habits/" + std::to_string(id) + "/toggle", fmt(R"({"done":%s})", target ? "true" : "false"),
                 [this, id, target](const hal::HttpResponse& r) {
                     if (r.status == 200) {
                         Tasks t;
                         if (parseTasks(r.body, t)) state_.tasks = t;
                     } else {
                         for (auto& item : state_.tasks.items)
                             if (item.id == id) item.done = !target;
                         toast("Tâche non synchronisée : " + (r.status ? parseErrorMessage(r.body) : r.error), true);
                     }
                     invalidate();
                 });
}

void App::setAlarmEnabled(int id, bool enabled) {
    for (auto& a : state_.alarms)
        if (a.id == id) a.enabled = enabled;
    invalidate();
    if (demo_) return;
    api::request("PATCH", "/api/v1/alarms/" + std::to_string(id), fmt(R"({"enabled":%s})", enabled ? "true" : "false"),
                 [this](const hal::HttpResponse& r) {
                     if (r.status != 200) toast("Réveil non synchronisé", true);
                 });
}

void App::music(const std::string& action, int value) {
    Music& m = state_.music;
    if (action == "play") m.isPlaying = true;
    else if (action == "pause") m.isPlaying = false;
    else if (action == "like") m.liked = !m.liked;
    else if (action == "volume") m.volume = value;
    if (action == "play" || action == "pause") {
        // La progression repart de la position actuelle.
        int elapsed = static_cast<int>(hal::get().millis() - m.receivedAtMs);
        if (action == "pause" && m.hasTrack) m.track.progressMs = std::min(m.track.durationMs, m.track.progressMs + elapsed);
        m.receivedAtMs = hal::get().millis();
    }
    invalidate();
    if (demo_) {
        if (action == "next" || action == "previous") {
            if (!m.queue.empty()) {
                Track next = m.queue.front();
                m.queue.erase(m.queue.begin());
                m.queue.push_back(m.track);
                m.track = next;
                m.track.progressMs = 0;
                m.receivedAtMs = hal::get().millis();
                m.isPlaying = true;
                m.liked = false;
            }
        }
        return;
    }
    std::string body = value >= 0 ? fmt(R"({"value":%d})", value) : std::string("{}");
    api::request("POST", "/api/v1/music/" + action, body, [this](const hal::HttpResponse& r) {
        if (r.status == 200) {
            parseMusic(r.body, state_.music);
        } else {
            std::string msg = r.status ? parseErrorMessage(r.body) : r.error;
            toast(msg.empty() ? "Commande Spotify impossible" : msg, true);
        }
        invalidate();
    }, true, 20000);
}

void App::setCinemaNotify(const std::string& filmId, bool notify) {
    for (auto& u : state_.cinema.upcoming)
        if (u.id == filmId) u.notify = notify;
    invalidate();
    if (notify) toast("Tu seras prévenu à la sortie");
    if (demo_) return;
    api::request("POST", "/api/v1/cinema/notify/" + filmId, fmt(R"({"notify":%s})", notify ? "true" : "false"),
                 [this](const hal::HttpResponse& r) {
                     if (r.status != 200) toast("Alerte non enregistrée", true);
                 });
}

void App::updateSettings(const std::string& jsonPatch) {
    applyBrightness();
    invalidate();
    if (demo_) return;
    api::request("PUT", "/api/v1/settings", jsonPatch, [this](const hal::HttpResponse& r) {
        if (r.status != 200) toast("Réglage non synchronisé", true);
    });
}

// ---------------------------------------------------------------- énergie, verrouillage

void App::applyBrightness() {
    hal::Hal& h = hal::get();
    if (screenOff_) {
        h.setBrightness(0);
        return;
    }
    struct tm t = util::localNow();
    const Settings& s = state_.settings;
    bool night = s.nightEnabled && util::inWindow(t, s.nightStart, s.nightEnd);
    int level = night ? s.nightBrightness : s.brightness;
    if (ringing_) level = std::max(level, 70);
    h.setBrightness(std::clamp(level, 3, 100));
    bool tint = s.warmTint && night && !ringing_;
    if (tintLayer_) {
        if (tint) lv_obj_clear_flag(tintLayer_, LV_OBJ_FLAG_HIDDEN);
        else lv_obj_add_flag(tintLayer_, LV_OBJ_FLAG_HIDDEN);
    }
}

void App::checkPower() {
    if (ringing_ || setupLayer_) return;
    hal::Hal& h = hal::get();
    uint32_t inactive = lv_display_get_inactive_time(nullptr);
    const Settings& s = state_.settings;
    bool hasPin = !s.pinHash.empty();

    if (!screenOff_) {
        if (hasPin && s.lockAfterMinutes > 0 && !locked_ && inactive > static_cast<uint32_t>(s.lockAfterMinutes) * 60000u) lock();
        if (s.screenSleepSeconds > 0 && inactive > static_cast<uint32_t>(s.screenSleepSeconds) * 1000u) {
            screenOff_ = true;
            screenOffSinceMs_ = h.millis();
            if (hasPin && s.lockOnWake) lock();
            sleepLayer_ = fullLayer(lv_layer_top());
            setBg(sleepLayer_, color::black());
            onClick(sleepLayer_, [this]() {
                if (state_.settings.touchWake) wake();
            });
            applyBrightness();
            heartbeat();
        }
        return;
    }
    // Écran éteint depuis longtemps : veille profonde (la tablette redémarre au réveil).
    // Pas pendant une répétition d'alarme : elle n'existe qu'en mémoire et serait perdue.
    if (!deepSlept_ && !snoozeUntil_ && s.deepSleepMinutes > 0 && h.millis() - screenOffSinceMs_ > static_cast<uint32_t>(s.deepSleepMinutes) * 60000u) {
        deepSlept_ = true;
        int64_t wakeAt = 0;
        time_t now = time(nullptr);
        for (const Alarm& a : state_.alarms) {
            if (!a.enabled) continue;
            int mins = util::minutesOf(a.time);
            for (int d = 0; d < 8; d++) {
                time_t day = now + d * 86400;
                struct tm t;
                localtime_r(&day, &t);
                t.tm_hour = mins / 60;
                t.tm_min = mins % 60;
                t.tm_sec = 0;
                time_t at = mktime(&t);
                bool anyDay = std::any_of(std::begin(a.days), std::end(a.days), [](bool b) { return b; });
                if (at <= now || (anyDay && !a.days[util::weekdayMon0(t)])) continue;
                int64_t early = at - (state_.routine.enabled ? state_.routine.preLightMinutes * 60 : 0) - 120;
                if (wakeAt == 0 || early < wakeAt) wakeAt = early;
                break;
            }
        }
        if (snoozeUntil_ && (wakeAt == 0 || snoozeUntil_ - 60 < wakeAt)) wakeAt = snoozeUntil_ - 60;
        h.deepSleep(wakeAt);
    }
}

void App::wake() {
    deepSlept_ = false;
    if (sleepLayer_) {
        lv_obj_delete(sleepLayer_);
        sleepLayer_ = nullptr;
    }
    lv_display_trigger_activity(nullptr);
    if (screenOff_) {
        screenOff_ = false;
        applyBrightness();
        if (lastSync_ == 0 || time(nullptr) - lastSync_ > 60) syncNow();
        heartbeat();
    }
}

void App::onButton() {
    if (ringing_) {
        stopRinging(true);
        return;
    }
    if (screenOff_) {
        wake();
        return;
    }
    // Appui sur le bouton écran allumé : éteint l'écran.
    sleepLayer_ = fullLayer(lv_layer_top());
    setBg(sleepLayer_, color::black());
    onClick(sleepLayer_, [this]() {
        if (state_.settings.touchWake) wake();
    });
    screenOff_ = true;
    screenOffSinceMs_ = hal::get().millis();
    if (!state_.settings.pinHash.empty() && state_.settings.lockOnWake) lock();
    applyBrightness();
}

void App::lock() {
    if (locked_ || state_.settings.pinHash.empty()) return;
    locked_ = true;
    ui.pin.clear();
    lockLayer_ = fullLayer(lv_layer_top());
    buildLockScreen(lockLayer_);
    if (ringLayer_) lv_obj_move_foreground(ringLayer_);
    if (sleepLayer_) lv_obj_move_foreground(sleepLayer_);
    if (tintLayer_) lv_obj_move_foreground(tintLayer_);
}

void AppAccess::unlock() {
    App& a = App::get();
    a.locked_ = false;
    a.ui.pin.clear();
    if (a.lockLayer_) {
        lv_obj_delete_async(a.lockLayer_);
        a.lockLayer_ = nullptr;
    }
    lv_display_trigger_activity(nullptr);
}

// ---------------------------------------------------------------- réveil

void App::checkAlarms() {
    struct tm t = util::localNow();
    time_t now = time(nullptr);

    if (ringing_) {
        // Arrêt automatique après 10 minutes de sonnerie.
        if (hal::get().millis() - ringStartMs_ > 10u * 60u * 1000u) stopRinging(false);
        return;
    }
    if (snoozeUntil_ && now >= snoozeUntil_) {
        snoozeUntil_ = 0;
        startRinging(snoozedAlarm_);
        return;
    }

    int minuteKey = t.tm_yday * 1440 + t.tm_hour * 60 + t.tm_min;
    int nowMin = t.tm_hour * 60 + t.tm_min;
    int wd = util::weekdayMon0(t);
    bool pre = false;
    for (const Alarm& a : state_.alarms) {
        if (!a.enabled) continue;
        bool anyDay = std::any_of(std::begin(a.days), std::end(a.days), [](bool b) { return b; });
        bool today = !anyDay || a.days[wd];
        int am = util::minutesOf(a.time);
        if (today && am == nowMin && lastAlarmMinute_ != minuteKey) {
            lastAlarmMinute_ = minuteKey;
            startRinging(a);
            if (!anyDay) setAlarmEnabled(a.id, false);  // alarme ponctuelle
            return;
        }
        // Pré-éclairage progressif avant l'alarme (routine matinale).
        if (today && state_.routine.enabled && state_.routine.preLightMinutes > 0) {
            int delta = am - nowMin;
            if (delta > 0 && delta <= state_.routine.preLightMinutes) pre = true;
        }
    }
    if (pre && !preLight_) {
        preLight_ = true;
        if (screenOff_) {
            screenOff_ = false;
            if (sleepLayer_) {
                lv_obj_delete(sleepLayer_);
                sleepLayer_ = nullptr;
            }
        }
    }
    if (!pre) preLight_ = false;
    if (preLight_) hal::get().setBrightness(std::max(5, state_.settings.brightness / 2));
}

void App::startRinging(const Alarm& a) {
    ringing_ = true;
    ringingAlarm_ = a;
    ringStartMs_ = hal::get().millis();
    wake();
    hal::get().playAlarm(a.sound, 80);
    if (ringLayer_) lv_obj_delete(ringLayer_);
    ringLayer_ = fullLayer(lv_layer_top());
    buildRinging(ringLayer_, a);
    applyBrightness();
}

void App::stopRinging(bool snooze) {
    hal::get().stopAudio();
    ringing_ = false;
    if (ringLayer_) {
        lv_obj_delete_async(ringLayer_);
        ringLayer_ = nullptr;
    }
    if (snooze) {
        snoozedAlarm_ = ringingAlarm_;
        snoozeUntil_ = time(nullptr) + ringingAlarm_.snoozeMinutes * 60;
        toast(fmt("Nouvelle sonnerie dans %d min", ringingAlarm_.snoozeMinutes));
    } else {
        snoozeUntil_ = 0;
        if (state_.routine.showBriefing) {
            screen_ = Screen::Home;
            invalidate();
        }
        if (state_.routine.waterReminder) toast("Bonjour ! Commence par un verre d’eau.");
        syncNow();
    }
    applyBrightness();
}

void AppAccess::dismissRinging(bool snooze) { App::get().stopRinging(snooze); }

// ---------------------------------------------------------------- superpositions

void App::toast(const std::string& text, bool error) {
    if (toast_) lv_obj_delete(toast_);
    toast_ = row(lv_layer_top(), 10);
    lv_obj_set_height(toast_, 52);
    lv_obj_set_style_pad_hor(toast_, 22, 0);
    lv_obj_set_style_radius(toast_, 26, 0);
    setBg(toast_, th().dark ? lv_color_hex(0x2C2C33) : lv_color_hex(0x1C1C1E));
    lv_obj_set_style_shadow_width(toast_, 30, 0);
    lv_obj_set_style_shadow_opa(toast_, 90, 0);
    icon(toast_, error ? ICON_CLOUD_OFF : ICON_CHECK, &icons_20, error ? color::orange() : color::green());
    label(toast_, text, &fig_s16, color::white());
    lv_obj_align(toast_, LV_ALIGN_TOP_MID, RAIL_W / 2, 18);
    if (toastTimer_) lv_timer_delete(toastTimer_);
    toastTimer_ = lv_timer_create(
        [](lv_timer_t*) {
            App& a = App::get();
            if (a.toast_) lv_obj_delete(a.toast_);
            a.toast_ = nullptr;
            a.toastTimer_ = nullptr;
        },
        error ? 4000 : 2600, nullptr);
    lv_timer_set_repeat_count(toastTimer_, 1);
}

void App::showMessage(const std::string& text) {
    wake();
    hal::get().playClick();
    if (messageLayer_) lv_obj_delete(messageLayer_);
    messageLayer_ = fullLayer(lv_layer_top());
    setBg(messageLayer_, color::black(), 150);
    lv_obj_t* c = card(messageLayer_, 28, 32);
    lv_obj_set_width(c, 560);
    lv_obj_center(c);
    lv_obj_set_style_pad_row(c, 18, 0);
    lv_obj_set_flex_align(c, LV_FLEX_ALIGN_START, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER);
    iconTile(c, ICON_CHAT, color::blue(), 64, &icons_28, 20);
    label(c, "Message de la console", &fig_m16, th().text2);
    lv_obj_t* l = label(c, text, &fig_b24, th().text);
    lv_label_set_long_mode(l, LV_LABEL_LONG_WRAP);
    lv_obj_set_width(l, 480);
    lv_obj_set_style_text_align(l, LV_TEXT_ALIGN_CENTER, 0);
    lv_obj_t* ok = button(c, "OK", color::blue(), color::white(), 52, 200);
    onClick(ok, [this]() {
        lv_obj_delete_async(messageLayer_);
        messageLayer_ = nullptr;
    });
}

void App::openSetup() {
    if (setupLayer_) return;
    setupLayer_ = fullLayer(lv_layer_top());
    buildSetup(setupLayer_);
}

void AppAccess::closeSetup() {
    App& a = App::get();
    if (a.setupLayer_) {
        lv_obj_delete_async(a.setupLayer_);
        a.setupLayer_ = nullptr;
    }
}

void AppAccess::finishPairing(const std::string& url, const std::string& token) {
    App& a = App::get();
    hal::get().save("api_url", url);
    hal::get().save("token", token);
    hal::get().save("demo", "0");
    a.demo_ = false;
    api::configure(url, token);
    closeSetup();
    a.toast("Tablette associée !");
    a.lastPollMs_ = 0;
    a.poll();
}

void App::startDemo() {
    demo_ = true;
    hal::get().save("demo", "1");
    applyState(DEMO_STATE_JSON, true);
    AppAccess::closeSetup();
    toast("Mode démo : données d’exemple");
}

void App::factoryReset() {
    hal::Hal& h = hal::get();
    h.save("token", "");
    h.save("demo", "0");
    h.save("state_cache", "");
    demo_ = false;
    api::configure(h.load("api_url"), "");
    state_ = State{};
    invalidate();
    openSetup();
}

void App::debugRing() {
    Alarm a;
    if (!state_.alarms.empty()) a = state_.alarms.front();
    else {
        a.label = "Test";
        a.time = util::hhmm(util::localNow());
    }
    startRinging(a);
}

void App::debugCloseOverlays() {
    if (ringing_) {
        hal::get().stopAudio();
        ringing_ = false;
        if (ringLayer_) lv_obj_delete(ringLayer_);
        ringLayer_ = nullptr;
    }
    if (lockLayer_) lv_obj_delete(lockLayer_);
    lockLayer_ = nullptr;
    locked_ = false;
    if (setupLayer_) lv_obj_delete(setupLayer_);
    setupLayer_ = nullptr;
    if (messageLayer_) lv_obj_delete(messageLayer_);
    messageLayer_ = nullptr;
    if (toast_) lv_obj_delete(toast_);
    toast_ = nullptr;
    if (toastTimer_) lv_timer_delete(toastTimer_);
    toastTimer_ = nullptr;
}
