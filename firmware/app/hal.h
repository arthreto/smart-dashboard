// Couche d'abstraction matérielle : tout ce qui diffère entre l'émulateur PC
// (platforms/desktop) et la vraie tablette M5Stack Tab5 (platforms/tab5).
#pragma once

#include <cstdint>
#include <string>
#include <utility>
#include <vector>

namespace hal {

struct HttpResponse {
    int status = 0;          // 0 = erreur réseau
    std::string body;
    std::string error;       // message en cas d'échec réseau
};

using Headers = std::vector<std::pair<std::string, std::string>>;

struct PowerStatus {
    int battery = -1;        // %, -1 si inconnu
    bool charging = false;
    int rssi = 0;            // dBm Wi-Fi, 0 si inconnu
    std::string ip;
};

struct WifiNetwork {
    std::string ssid;
    int rssi = 0;
    bool secure = true;
};

struct PhoneNotification {
    std::string app;         // "MESSAGES", "MAIL"…
    std::string title;
    std::string body;
    std::string time;        // "il y a 5 min", "07:10"
};

struct PhoneCall {
    std::string name;
    std::string detail;      // "Appel manqué", "Entrant · 3 min"
    std::string when;
    bool missed = false;
};

struct PhoneState {
    bool supported = false;  // pile Bluetooth disponible sur cette plateforme
    bool connected = false;
    std::string name;        // "iPhone de …"
    int battery = -1;
    std::vector<PhoneNotification> notifications;
    std::vector<PhoneCall> calls;
};

class Hal {
public:
    virtual ~Hal() = default;

    // --- Réseau (appelé depuis le thread réseau, bloquant) ---
    virtual HttpResponse http(const std::string& method, const std::string& url, const std::string& body,
                              const Headers& headers, int timeoutMs) = 0;
    virtual bool networkUp() = 0;

    // --- Wi-Fi (uniquement sur la tablette) ---
    virtual bool hasWifiSetup() { return false; }
    virtual std::vector<WifiNetwork> wifiScan() { return {}; }
    virtual bool wifiConnect(const std::string& ssid, const std::string& password) { (void)ssid; (void)password; return true; }
    virtual std::string wifiSsid() { return ""; }

    // --- Stockage persistant clé/valeur (NVS sur la tablette, fichier sur PC) ---
    virtual std::string load(const std::string& key) = 0;
    virtual void save(const std::string& key, const std::string& value) = 0;

    // --- Écran et énergie ---
    virtual void setBrightness(int percent) = 0;     // 0 = rétroéclairage coupé
    virtual PowerStatus power() = 0;
    /** Veille profonde jusqu'à `wakeAtEpoch` (0 = pas de réveil programmé) ou appui sur le bouton. */
    virtual void deepSleep(int64_t wakeAtEpoch) = 0;
    virtual void reboot() = 0;
    /** Vrai si l'appareil sort d'une veille profonde provoquée par le minuteur (réveil d'alarme). */
    virtual bool wokeByTimer() { return false; }

    // --- Son ---
    virtual void playAlarm(const std::string& sound, int volumePercent) = 0;   // en boucle jusqu'à stopAudio()
    virtual void playClick() {}
    virtual void stopAudio() = 0;

    // --- Heure ---
    virtual void setTimeZone(const std::string& posix) = 0;
    /** Corrige l'horloge locale à partir de l'heure du serveur si elle n'est pas fiable. */
    virtual void syncTime(int64_t epoch) = 0;
    virtual uint32_t millis() = 0;

    // --- Téléphone (Bluetooth ANCS sur la tablette, données d'exemple sur PC) ---
    virtual PhoneState phone() { return {}; }

    // --- Divers ---
    virtual std::string firmwareVersion() = 0;
    virtual std::string platformName() = 0;
};

Hal& get();
void install(Hal* impl);

}  // namespace hal
