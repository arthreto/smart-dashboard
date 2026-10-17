// Cœur de l'application : état, navigation, synchronisation, veille, réveil.
#pragma once

#include <cstdint>
#include <functional>
#include <string>
#include <vector>

#include "lvgl.h"
#include "state.h"

enum class Screen { Home, Tasks, Calendar, Alarm, Music, Cinema, Phone, Stats, Settings };

enum class ClockFormat { HHMM, LongDate };

class App {
public:
    static App& get();

    /** À appeler une fois LVGL et l'écran initialisés. */
    void init();

    State& state() { return state_; }
    Screen screen() const { return screen_; }
    void navigate(Screen s);
    /** Reconstruit l'écran courant au prochain passage de la boucle. */
    void invalidate() { dirty_ = true; }

    /** Les libellés enregistrés sont mis à jour chaque seconde. */
    void registerClock(lv_obj_t* label, ClockFormat fmt);
    /** Fonction appelée chaque seconde tant que l'écran courant est affiché. */
    void onSecond(std::function<void()> fn);

    // --- Actions déclenchées par l'interface ---
    void toggleHabit(int id);
    void setAlarmEnabled(int id, bool enabled);
    void music(const std::string& action, int value = -1);
    void setCinemaNotify(const std::string& filmId, bool notify);
    void updateSettings(const std::string& jsonPatch);
    void syncNow();

    // --- Superpositions ---
    void toast(const std::string& text, bool error = false);
    void lock();
    void wake();
    void startDemo();
    void openSetup();
    void factoryReset();

    // État local de l'interface (conservé entre deux reconstructions).
    struct UiState {
        int cinemaFilm = 0;
        int cinemaDay = 0;
        int calendarView = 1;   // 0 jour, 1 semaine, 2 mois
        int statsRange = 1;     // 0 = 7 j, 1 = 14 j, 2 = 30 j
        int tasksTab = 0;
        int settingsSection = 0;
        int setupStep = 0;
        std::string setupUrl;
        std::string setupCode;
        std::string setupSsid;
        std::string setupError;
        bool pairing = false;
        std::string pin;
    } ui;

    bool demoMode() const { return demo_; }
    bool online() const { return online_; }
    int64_t lastSyncEpoch() const { return lastSync_; }
    std::string lastError() const { return lastError_; }
    bool locked() const { return locked_; }

    // Appelés par les plateformes.
    void onButton();   // bouton physique (haut du boîtier)
    void debugRing();  // émulateur : déclenche une alarme de test
    void debugCloseOverlays();
    std::function<void(const std::string&)> onScreenshotDone;

private:
    App() = default;
    void loop();
    void rebuild();
    void buildRail(lv_obj_t* parent);
    void poll();
    void applyState(const std::string& json, bool fromCache);
    void processCommands();
    void heartbeat();
    void checkAlarms();
    void checkPower();
    void applyBrightness();
    void startRinging(const Alarm& a);
    void stopRinging(bool snooze);
    void showMessage(const std::string& text);
    void takeScreenshot();
    void loadConfig();

    State state_;
    Screen screen_ = Screen::Home;
    bool dirty_ = true;
    bool demo_ = false;
    bool online_ = false;
    bool polling_ = false;
    bool locked_ = false;
    bool screenOff_ = false;
    bool ringing_ = false;
    int64_t lastSync_ = 0;
    uint32_t lastPollMs_ = 0;
    uint32_t screenOffSinceMs_ = 0;
    std::string lastError_;
    std::vector<int> ackCommands_;
    std::vector<std::pair<lv_obj_t*, ClockFormat>> clocks_;
    std::vector<std::function<void()>> secondHooks_;
    std::vector<int> processedCommands_;
    bool preLight_ = false;
    bool deepSlept_ = false;
    uint32_t lastSecondMs_ = 0;
    lv_obj_t* messageLayer_ = nullptr;

    // Réveil
    int lastAlarmMinute_ = -1;
    Alarm ringingAlarm_;
    int64_t snoozeUntil_ = 0;
    Alarm snoozedAlarm_;
    uint32_t ringStartMs_ = 0;

    lv_obj_t* root_ = nullptr;
    lv_obj_t* content_ = nullptr;
    lv_obj_t* lockLayer_ = nullptr;
    lv_obj_t* ringLayer_ = nullptr;
    lv_obj_t* sleepLayer_ = nullptr;
    lv_obj_t* tintLayer_ = nullptr;
    lv_obj_t* toast_ = nullptr;
    lv_obj_t* setupLayer_ = nullptr;
    lv_timer_t* toastTimer_ = nullptr;

    friend void buildLockScreen(lv_obj_t*);
    friend void buildRinging(lv_obj_t*, const Alarm&);
    friend void buildSetup(lv_obj_t*);
    friend struct AppAccess;
};

// Constructeurs d'écrans (screens/*.cpp).
void buildHome(lv_obj_t* parent);
void buildTasks(lv_obj_t* parent);
void buildCalendar(lv_obj_t* parent);
void buildAlarm(lv_obj_t* parent);
void buildMusic(lv_obj_t* parent);
void buildCinema(lv_obj_t* parent);
void buildPhone(lv_obj_t* parent);
void buildStats(lv_obj_t* parent);
void buildSettings(lv_obj_t* parent);
void buildLockScreen(lv_obj_t* layer);
void buildRinging(lv_obj_t* layer, const Alarm& alarm);
void buildSetup(lv_obj_t* layer);

/** En-tête de page commun (titre + sous-titre + zone d'actions à droite). Renvoie la zone d'actions. */
lv_obj_t* pageHeader(lv_obj_t* parent, const std::string& title, const std::string& subtitle);

/** État de démonstration (mode hors ligne de l'émulateur). */
extern const char* const DEMO_STATE_JSON;

// Hooks internes partagés avec les écrans de superposition.
struct AppAccess {
    static void unlock();
    static void dismissRinging(bool snooze);
    static void closeSetup();
    static void finishPairing(const std::string& url, const std::string& token);
};
