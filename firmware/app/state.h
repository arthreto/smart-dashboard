// Modèle de données de la tablette : miroir de GET /api/v1/state (voir docs/API.md).
#pragma once

#include <cstdint>
#include <string>
#include <vector>

struct Settings {
    int brightness = 60;
    std::string theme = "dark";  // dark | light | auto
    bool nightEnabled = true;
    std::string nightStart = "22:00";
    std::string nightEnd = "07:00";
    int nightBrightness = 10;
    bool warmTint = true;
    int screenSleepSeconds = 30;
    int deepSleepMinutes = 10;
    bool touchWake = true;
    bool lockOnWake = true;
    int lockAfterMinutes = 5;
    int pollSeconds = 30;
    std::string pinSalt;
    std::string pinHash;
};

struct Widget {
    std::string id;
    int span = 1;
};

struct HourWeather {
    std::string hour;
    int temp = 0;
    std::string icon;
};

struct Weather {
    bool valid = false;
    std::string label, text, icon;
    int temp = 0, max = 0, min = 0;
    std::vector<HourWeather> hourly;
};

struct Event {
    std::string id, date, start, end, title, location, calendar, color;
    bool allDay = false;
    bool important = false;
    int reminderMinutes = -1;
};

struct DayEvents {
    std::string date;
    std::vector<Event> events;
};

struct Agenda {
    bool valid = false;
    std::vector<Event> today;
    std::vector<Event> upcoming;
    std::vector<DayEvents> week;
    std::vector<int> monthDays;
};

struct TaskItem {
    int id = 0;
    std::string name, meta, icon, color;
    bool done = false;
    int streak = 0;
};

struct WeekDay {
    std::string label, state;  // done | today | missed | future | rest
};

struct BadgeInfo {
    std::string label;
    bool unlocked = false;
    int progress = 0, target = 1;
};

struct Tasks {
    std::string date;
    int done = 0, total = 0, streak = 0, bestStreak = 0, weekRate = 0, monthRate = 0;
    std::vector<TaskItem> items;
    std::vector<WeekDay> week;
    std::vector<BadgeInfo> badges;
};

struct Alarm {
    int id = 0;
    std::string time = "07:00";
    std::string label;
    std::string sound = "aube";
    bool days[7] = {false, false, false, false, false, false, false};
    bool enabled = true;
    int snoozeMinutes = 9;
};

struct NextAlarm {
    bool valid = false;
    int64_t at = 0;
    std::string label, time;
};

struct Routine {
    bool enabled = true;
    int preLightMinutes = 10;
    bool showBriefing = true;
    bool waterReminder = true;
};

struct Track {
    std::string id, title, artist, album, imageUrl;
    int durationMs = 0;
    int progressMs = 0;
};

struct Music {
    bool valid = false;
    bool available = false;
    bool isPlaying = false;
    bool liked = false;
    bool hasTrack = false;
    std::string deviceName, message;
    int volume = 50;
    Track track;
    std::vector<Track> queue;
    uint32_t receivedAtMs = 0;  // pour faire avancer la barre de progression localement
};

struct Roblox {
    bool valid = false;
    std::string name;
    int playing = 0;
    int64_t visits = 0;
    int favorites = 0, peak24h = 0, deltaPct = 0;
    std::vector<int> history;
};

struct Show {
    std::string time, tag;
};

struct Film {
    std::string id, title, genre, duration, rating, posterUrl;
    bool isNew = false;
    std::vector<std::vector<Show>> showsByDay;
};

struct Upcoming {
    std::string id, title, date, genre, posterUrl;
    bool notify = false;
};

struct CinemaDay {
    std::string date, label;
};

struct Cinema {
    bool valid = false;
    std::string cinemaName;
    std::vector<CinemaDay> days;
    std::vector<Film> films;
    std::vector<Upcoming> upcoming;
};

struct DailyStat {
    int day = 0, value = 0, max = 0;
    bool validated = false, today = false;
};

struct Stats {
    int monthTasks = 0, monthDeltaPct = 0, sportSessions = 0, sportGoal = 12;
    int successRate = 0, successDeltaPts = 0, weekRate = 0, threshold = 7;
    std::vector<DailyStat> daily;
    std::vector<int> sportWeekly;
};

struct Command {
    int id = 0;
    std::string type, text;
};

struct State {
    bool loaded = false;
    int64_t serverTime = 0;
    std::string tz, tzPosix;
    Settings settings;
    std::vector<Widget> layout;
    Weather weather;
    Agenda agenda;
    Tasks tasks;
    std::vector<Alarm> alarms;
    NextAlarm nextAlarm;
    Routine routine;
    Music music;
    Roblox roblox;
    Cinema cinema;
    Stats stats;
    std::vector<Command> commands;
    std::string stateHash;  // empreinte envoyée par le serveur (synchro « rien n'a changé »)
};

bool parseState(const std::string& json, State& out, std::string& error);
/** Réponse « rien n'a changé » du serveur ({ unchanged: true, serverTime }). */
bool isUnchanged(const std::string& json, int64_t& serverTime);
bool parseTasks(const std::string& json, Tasks& out);
bool parseMusic(const std::string& json, Music& out);
bool parseAlarm(const std::string& json, Alarm& out);
/** Message d'erreur lisible depuis un corps { "message": … } du serveur. */
std::string parseErrorMessage(const std::string& json);
