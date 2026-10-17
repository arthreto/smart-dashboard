#include "state.h"

#include "hal.h"
#include "third_party/cjson/cJSON.h"

namespace {

std::string str(const cJSON* o, const char* key, const char* def = "") {
    const cJSON* v = cJSON_GetObjectItemCaseSensitive(o, key);
    return cJSON_IsString(v) && v->valuestring ? std::string(v->valuestring) : std::string(def);
}

int num(const cJSON* o, const char* key, int def = 0) {
    const cJSON* v = cJSON_GetObjectItemCaseSensitive(o, key);
    return cJSON_IsNumber(v) ? static_cast<int>(v->valuedouble) : def;
}

int64_t num64(const cJSON* o, const char* key, int64_t def = 0) {
    const cJSON* v = cJSON_GetObjectItemCaseSensitive(o, key);
    return cJSON_IsNumber(v) ? static_cast<int64_t>(v->valuedouble) : def;
}

bool flag(const cJSON* o, const char* key, bool def = false) {
    const cJSON* v = cJSON_GetObjectItemCaseSensitive(o, key);
    if (cJSON_IsBool(v)) return cJSON_IsTrue(v);
    return def;
}

const cJSON* obj(const cJSON* o, const char* key) {
    const cJSON* v = cJSON_GetObjectItemCaseSensitive(o, key);
    return cJSON_IsObject(v) ? v : nullptr;
}

const cJSON* arr(const cJSON* o, const char* key) {
    const cJSON* v = cJSON_GetObjectItemCaseSensitive(o, key);
    return cJSON_IsArray(v) ? v : nullptr;
}

void parseSettings(const cJSON* o, Settings& s) {
    if (!o) return;
    s.brightness = num(o, "brightness", s.brightness);
    s.theme = str(o, "theme", s.theme.c_str());
    if (const cJSON* nm = obj(o, "nightMode")) {
        s.nightEnabled = flag(nm, "enabled", s.nightEnabled);
        s.nightStart = str(nm, "start", s.nightStart.c_str());
        s.nightEnd = str(nm, "end", s.nightEnd.c_str());
        s.nightBrightness = num(nm, "brightness", s.nightBrightness);
    }
    s.warmTint = flag(o, "warmTint", s.warmTint);
    s.screenSleepSeconds = num(o, "screenSleepSeconds", s.screenSleepSeconds);
    s.deepSleepMinutes = num(o, "deepSleepMinutes", s.deepSleepMinutes);
    s.touchWake = flag(o, "touchWake", s.touchWake);
    s.lockOnWake = flag(o, "lockOnWake", s.lockOnWake);
    s.lockAfterMinutes = num(o, "lockAfterMinutes", s.lockAfterMinutes);
    s.pollSeconds = num(o, "pollSeconds", s.pollSeconds);
    s.pinSalt = str(o, "pinSalt");
    s.pinHash = str(o, "pinHash");
}

Event parseEvent(const cJSON* e) {
    Event ev;
    ev.id = str(e, "id");
    ev.date = str(e, "date");
    ev.start = str(e, "start");
    ev.end = str(e, "end");
    ev.title = str(e, "title");
    ev.location = str(e, "location");
    ev.calendar = str(e, "calendar");
    ev.color = str(e, "color", "#0A84FF");
    ev.allDay = flag(e, "allDay");
    ev.important = flag(e, "important");
    ev.reminderMinutes = num(e, "reminderMinutes", -1);
    return ev;
}

void parseTasksObj(const cJSON* t, Tasks& out) {
    out = Tasks{};
    out.date = str(t, "date");
    out.done = num(t, "done");
    out.total = num(t, "total");
    out.streak = num(t, "streak");
    out.bestStreak = num(t, "bestStreak");
    out.weekRate = num(t, "weekRate");
    out.monthRate = num(t, "monthRate");
    const cJSON* it;
    cJSON_ArrayForEach(it, arr(t, "items")) {
        TaskItem i;
        i.id = num(it, "id");
        i.name = str(it, "name");
        i.meta = str(it, "meta");
        i.icon = str(it, "icon", "check");
        i.color = str(it, "color", "#30D158");
        i.done = flag(it, "done");
        i.streak = num(it, "streak");
        out.items.push_back(i);
    }
    cJSON_ArrayForEach(it, arr(t, "week")) out.week.push_back({str(it, "label"), str(it, "state")});
    cJSON_ArrayForEach(it, arr(t, "badges")) {
        out.badges.push_back({str(it, "label"), flag(it, "unlocked"), num(it, "progress"), num(it, "target", 1)});
    }
}

Track parseTrack(const cJSON* t) {
    Track tr;
    tr.id = str(t, "id");
    tr.title = str(t, "title");
    tr.artist = str(t, "artist");
    tr.album = str(t, "album");
    tr.imageUrl = str(t, "imageUrl");
    tr.durationMs = num(t, "durationMs");
    tr.progressMs = num(t, "progressMs");
    return tr;
}

void parseMusicObj(const cJSON* m, Music& out) {
    out = Music{};
    if (!m) return;
    out.valid = true;
    out.available = flag(m, "available");
    out.isPlaying = flag(m, "isPlaying");
    out.liked = flag(m, "liked");
    out.deviceName = str(m, "deviceName");
    out.message = str(m, "message");
    out.volume = num(m, "volume", 50);
    if (const cJSON* t = obj(m, "track")) {
        out.hasTrack = true;
        out.track = parseTrack(t);
    }
    const cJSON* it;
    cJSON_ArrayForEach(it, arr(m, "queue")) out.queue.push_back(parseTrack(it));
    out.receivedAtMs = hal::get().millis();
}

void parseAlarmObj(const cJSON* a, Alarm& al) {
    al.id = num(a, "id");
    al.time = str(a, "time", "07:00");
    al.label = str(a, "label");
    al.sound = str(a, "sound", "aube");
    al.enabled = flag(a, "enabled", true);
    al.snoozeMinutes = num(a, "snoozeMinutes", 9);
    const cJSON* d = arr(a, "days");
    for (int i = 0; i < 7; i++) {
        const cJSON* v = d ? cJSON_GetArrayItem(d, i) : nullptr;
        al.days[i] = v && cJSON_IsTrue(v);
    }
}

}  // namespace

bool parseState(const std::string& json, State& out, std::string& error) {
    cJSON* root = cJSON_Parse(json.c_str());
    if (!root) {
        error = "Réponse illisible du serveur";
        return false;
    }
    State s;
    s.loaded = true;
    s.serverTime = num64(root, "serverTime");
    s.tz = str(root, "tz", "Europe/Paris");
    s.tzPosix = str(root, "tzPosix", "CET-1CEST,M3.5.0,M10.5.0/3");
    parseSettings(obj(root, "settings"), s.settings);

    const cJSON* it;
    cJSON_ArrayForEach(it, arr(root, "layout")) s.layout.push_back({str(it, "id"), num(it, "span", 1)});

    if (const cJSON* w = obj(root, "weather")) {
        s.weather.valid = true;
        s.weather.label = str(w, "label", "Domicile");
        s.weather.text = str(w, "text");
        s.weather.icon = str(w, "icon", "cloud");
        s.weather.temp = num(w, "temp");
        s.weather.max = num(w, "max");
        s.weather.min = num(w, "min");
        cJSON_ArrayForEach(it, arr(w, "hourly")) s.weather.hourly.push_back({str(it, "hour"), num(it, "temp"), str(it, "icon", "cloud")});
    }

    if (const cJSON* a = obj(root, "agenda")) {
        s.agenda.valid = true;
        cJSON_ArrayForEach(it, arr(a, "today")) s.agenda.today.push_back(parseEvent(it));
        cJSON_ArrayForEach(it, arr(a, "upcoming")) s.agenda.upcoming.push_back(parseEvent(it));
        cJSON_ArrayForEach(it, arr(a, "week")) {
            DayEvents d;
            d.date = str(it, "date");
            const cJSON* e;
            cJSON_ArrayForEach(e, arr(it, "events")) d.events.push_back(parseEvent(e));
            s.agenda.week.push_back(d);
        }
        cJSON_ArrayForEach(it, arr(a, "monthDays")) if (cJSON_IsNumber(it)) s.agenda.monthDays.push_back(it->valueint);
    }

    if (const cJSON* t = obj(root, "tasks")) parseTasksObj(t, s.tasks);

    cJSON_ArrayForEach(it, arr(root, "alarms")) {
        Alarm al;
        parseAlarmObj(it, al);
        s.alarms.push_back(al);
    }
    if (const cJSON* n = obj(root, "nextAlarm")) {
        s.nextAlarm.valid = true;
        s.nextAlarm.at = num64(n, "at");
        s.nextAlarm.label = str(n, "label");
        s.nextAlarm.time = str(n, "time");
    }
    if (const cJSON* r = obj(root, "routine")) {
        s.routine.enabled = flag(r, "enabled", true);
        s.routine.preLightMinutes = num(r, "preLightMinutes", 10);
        s.routine.showBriefing = flag(r, "showBriefing", true);
        s.routine.waterReminder = flag(r, "waterReminder", true);
    }

    parseMusicObj(obj(root, "music"), s.music);

    if (const cJSON* r = obj(root, "roblox")) {
        s.roblox.valid = true;
        s.roblox.name = str(r, "name");
        s.roblox.playing = num(r, "playing");
        s.roblox.visits = num64(r, "visits");
        s.roblox.favorites = num(r, "favorites");
        s.roblox.peak24h = num(r, "peak24h");
        s.roblox.deltaPct = num(r, "deltaPct");
        cJSON_ArrayForEach(it, arr(r, "history")) if (cJSON_IsNumber(it)) s.roblox.history.push_back(it->valueint);
    }

    if (const cJSON* c = obj(root, "cinema")) {
        s.cinema.valid = true;
        s.cinema.cinemaName = str(c, "cinemaName");
        cJSON_ArrayForEach(it, arr(c, "days")) s.cinema.days.push_back({str(it, "date"), str(it, "label")});
        cJSON_ArrayForEach(it, arr(c, "films")) {
            Film f;
            f.id = str(it, "id");
            f.title = str(it, "title");
            f.genre = str(it, "genre");
            f.duration = str(it, "duration");
            f.rating = str(it, "rating");
            f.posterUrl = str(it, "posterUrl");
            f.isNew = flag(it, "isNew");
            const cJSON* day;
            cJSON_ArrayForEach(day, arr(it, "showsByDay")) {
                std::vector<Show> shows;
                const cJSON* sh;
                cJSON_ArrayForEach(sh, day) shows.push_back({str(sh, "time"), str(sh, "tag")});
                f.showsByDay.push_back(shows);
            }
            if (f.showsByDay.empty()) {
                std::vector<Show> shows;
                const cJSON* sh;
                cJSON_ArrayForEach(sh, arr(it, "shows")) shows.push_back({str(sh, "time"), str(sh, "tag")});
                f.showsByDay.push_back(shows);
            }
            s.cinema.films.push_back(f);
        }
        cJSON_ArrayForEach(it, arr(c, "upcoming")) {
            s.cinema.upcoming.push_back({str(it, "id"), str(it, "title"), str(it, "date"), str(it, "genre"), str(it, "posterUrl"), flag(it, "notify")});
        }
    }

    if (const cJSON* st = obj(root, "stats")) {
        s.stats.monthTasks = num(st, "monthTasks");
        s.stats.monthDeltaPct = num(st, "monthDeltaPct");
        s.stats.sportSessions = num(st, "sportSessions");
        s.stats.sportGoal = num(st, "sportGoal", 12);
        s.stats.successRate = num(st, "successRate");
        s.stats.successDeltaPts = num(st, "successDeltaPts");
        s.stats.weekRate = num(st, "weekRate");
        s.stats.threshold = num(st, "threshold", 7);
        cJSON_ArrayForEach(it, arr(st, "daily")) {
            s.stats.daily.push_back({num(it, "day"), num(it, "value"), num(it, "max"), flag(it, "validated"), flag(it, "today")});
        }
        cJSON_ArrayForEach(it, arr(st, "sportWeekly")) if (cJSON_IsNumber(it)) s.stats.sportWeekly.push_back(it->valueint);
    }

    cJSON_ArrayForEach(it, arr(root, "commands")) s.commands.push_back({num(it, "id"), str(it, "type"), str(it, "text")});

    cJSON_Delete(root);
    out = std::move(s);
    return true;
}

bool parseTasks(const std::string& json, Tasks& out) {
    cJSON* root = cJSON_Parse(json.c_str());
    if (!root) return false;
    parseTasksObj(root, out);
    cJSON_Delete(root);
    return true;
}

bool parseMusic(const std::string& json, Music& out) {
    cJSON* root = cJSON_Parse(json.c_str());
    if (!root) return false;
    parseMusicObj(root, out);
    cJSON_Delete(root);
    return true;
}

bool parseAlarm(const std::string& json, Alarm& out) {
    cJSON* root = cJSON_Parse(json.c_str());
    if (!root) return false;
    parseAlarmObj(root, out);
    cJSON_Delete(root);
    return true;
}

std::string parseErrorMessage(const std::string& json) {
    cJSON* root = cJSON_Parse(json.c_str());
    if (!root) return "";
    std::string m = str(root, "message");
    cJSON_Delete(root);
    return m;
}
