// Implémentation du HAL pour la M5Stack Tab5 (ESP32-P4 + ESP32-C6 pour le Wi-Fi).
//   - écran MIPI-DSI 720×1280 tourné à 90° → 1280×720, tactile (BSP M5Stack)
//   - Wi-Fi par ESP-Hosted (esp_wifi_remote), HTTPS avec les certificats intégrés
//   - stockage dans la NVS, heure par SNTP + horloge RX8130 sauvegardée
//   - batterie mesurée par l'INA226, son par le codec ES8388
//   - « veille profonde » = extinction complète, rallumage par l'alarme de la RX8130
//
// Tâches : l'interface (tâche LVGL) appelle la plupart des méthodes ; le thread réseau
// de l'app appelle http(), wifiScan(), wifiConnect() ; la tâche « wifi_keeper » gère la
// reconnexion, le SNTP et lit le signal Wi-Fi ; la tâche « audio » joue les sons.
#pragma once

#include <driver/i2c_master.h>
#include <esp_event.h>
#include <esp_netif.h>
#include <freertos/FreeRTOS.h>
#include <freertos/event_groups.h>
#include <freertos/task.h>

#include <atomic>
#include <mutex>
#include <string>

#include "hal.h"
#include "iphone_ble.h"
#include "lvgl.h"
#include "rx8130.h"
#include "tones.h"

class Tab5Hal : public hal::Hal {
public:
    /** Initialise le matériel (NVS, I2C, alimentation, son, horloge, Wi-Fi). */
    void begin();
    /** Démarre l'écran, le tactile et la tâche LVGL ; renvoie l'affichage paysage. */
    lv_display_t* startDisplay();

    // --- hal::Hal ---
    hal::HttpResponse http(const std::string& method, const std::string& url, const std::string& body, const hal::Headers& headers,
                           int timeoutMs) override;
    bool networkUp() override;

    bool hasWifiSetup() override { return true; }
    std::vector<hal::WifiNetwork> wifiScan() override;
    bool wifiConnect(const std::string& ssid, const std::string& password) override;
    std::string wifiSsid() override;

    std::string load(const std::string& key) override;
    void save(const std::string& key, const std::string& value) override;

    void setBrightness(int percent) override;
    hal::PowerStatus power() override;
    void deepSleep(int64_t wakeAtEpoch) override;
    void reboot() override;
    bool wokeByTimer() override { return wokeByRtc_; }

    void playAlarm(const std::string& sound, int volumePercent) override;
    void playClick() override;
    void stopAudio() override;

    void setTimeZone(const std::string& posix) override;
    void syncTime(int64_t epoch) override;
    uint32_t millis() override;

    // iPhone (Bluetooth basse consommation, notifications et appels via ANCS)
    hal::PhoneState phone() override { return iphone_.state(); }
    uint32_t phoneRevision() override { return iphone_.revision(); }
    void phoneSetEnabled(bool on) override;
    void phoneStartPairing() override { iphone_.startPairing(); }
    void phoneCancelPairing() override { iphone_.cancelPairing(); }
    void phoneForget() override { iphone_.forget(); }
    void phoneAction(uint32_t uid, bool positive) override { iphone_.action(uid, positive); }

    std::string firmwareVersion() override;
    std::string platformName() override { return "M5Stack Tab5"; }

private:
    void initWifi();
    void connectSaved();
    void startConnect();
    void waitDisconnected();
    void keepAlive();
    void onTimeSynced();
    void writeRtc(time_t utc);
    void flushCache();
    std::string loadRaw(const std::string& key);
    void saveRaw(const std::string& key, const std::string& value);
    int batteryPercent(bool* charging);

    static void wifiEventHandler(void* arg, esp_event_base_t base, int32_t id, void* data);
    static void audioTaskMain(void* arg);
    static void keeperTaskMain(void* arg);

    // Horloge (accès protégé : tâche LVGL et tâche wifi_keeper)
    Rx8130 rtc_;
    std::mutex rtcMutex_;
    std::atomic<bool> rtcWritePending_{false};
    std::atomic<bool> timeValid_{false};
    bool wokeByRtc_ = false;

    i2c_master_dev_handle_t ina226_ = nullptr;
    IphoneLink iphone_;

    // Wi-Fi
    esp_netif_t* sta_ = nullptr;
    EventGroupHandle_t wifiEvents_ = nullptr;
    std::mutex wifiMutex_;             // scan / connexion manuelle / reconnexion automatique
    bool wifiReady_ = false;
    std::atomic<bool> autoReconnect_{false};
    std::atomic<bool> linkDown_{true};  // vrai après une déconnexion, faux pendant un essai
    std::atomic<int> retries_{0};
    int64_t lastAttemptUs_ = 0;
    int64_t nextAttemptUs_ = 0;
    bool sntpStarted_ = false;
    std::atomic<int> rssi_{0};
    std::mutex infoMutex_;
    std::string ip_;

    // Stockage : l'état reçu du serveur n'est écrit en flash que toutes les 15 min.
    std::mutex storageMutex_;
    std::string pendingCache_;
    bool cacheDirty_ = false;
    uint32_t lastCacheWriteMs_ = 0;

    // Batterie (lecture mise en cache quelques secondes ; tâche LVGL uniquement)
    uint32_t batteryReadMs_ = 0;
    int batteryCache_ = -1;
    bool chargingCache_ = false;

    // Son
    ToneSynth synth_{48000};
    TaskHandle_t audioTask_ = nullptr;
};
