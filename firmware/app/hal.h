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
    uint32_t uid = 0;        // identifiant ANCS de la notification
    std::string app;         // "MESSAGES", "MAIL"…
    std::string title;
    std::string body;
    int64_t at = 0;          // date de la notification (epoch), 0 si inconnue
    std::string positiveLabel;  // action proposée par iOS (ex. « Répondre »), vide sinon
    std::string negativeLabel;  // ex. « Effacer »
};

struct PhoneCall {
    std::string name;
    std::string detail;      // "Appel manqué", "Appel entrant"
    int64_t at = 0;
    bool missed = false;
};

struct PhoneState {
    bool supported = false;  // Bluetooth disponible sur cette plateforme
    bool enabled = true;     // Bluetooth activé par l'utilisateur
    bool paired = false;     // un iPhone est associé
    bool linked = false;     // liaison Bluetooth établie avec l'iPhone associé
    bool connected = false;  // … et notifications partagées (reçues par la tablette)
    bool pairing = false;    // mode association en cours
    std::string pairingCode; // code à saisir sur l'iPhone (vide tant qu'iOS ne l'a pas demandé)
    std::string status;      // message d'état lisible (erreur, conseil…)
    std::string name;        // "iPhone de …"
    int battery = -1;
    std::vector<PhoneNotification> notifications;  // les plus récentes d'abord
    std::vector<PhoneCall> calls;                  // les plus récents d'abord
    uint32_t incomingUid = 0;                      // appel entrant en cours (0 = aucun)
    std::string incomingName;
};

/** Paquet compressé produit par la caméra (H.264, Annex B) ou le micro (AAC brut). */
struct MediaPacket {
    bool video = true;
    bool key = false;        // image clé (IDR) pour la vidéo
    int64_t ptsUs = 0;       // depuis le début de la capture
    std::string data;
};

/** Description du flux : écrite (chiffrée) en tête de chaque vidéo. */
struct CaptureInfo {
    int width = 0, height = 0, fps = 0;
    int audioRate = 0;       // 0 = pas de son
    int audioChannels = 0;
    std::string audioConfig; // AudioSpecificConfig AAC (2 octets)
};

/** Reçoit les paquets depuis les tâches de capture de la plateforme (thread quelconque). */
class MediaSink {
public:
    virtual ~MediaSink() = default;
    virtual void onPacket(MediaPacket&& packet) = 0;
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

    // --- Téléphone (Bluetooth ANCS sur la tablette, simulation sur PC) ---
    virtual PhoneState phone() { return {}; }
    /** Change à chaque évolution de l'état du téléphone (pour rafraîchir l'écran). */
    virtual uint32_t phoneRevision() { return 0; }
    virtual void phoneSetEnabled(bool on) { (void)on; }
    /** Ouvre l'association d'un iPhone pendant 2 minutes. */
    virtual void phoneStartPairing() {}
    virtual void phoneCancelPairing() {}
    /** Oublie l'iPhone associé (il faudra aussi l'oublier dans Réglages › Bluetooth). */
    virtual void phoneForget() {}
    /** Action sur une notification : positive (répondre, accepter) ou négative (effacer, refuser). */
    virtual void phoneAction(uint32_t uid, bool positive) { (void)uid; (void)positive; }

    // --- Caméra + micro (enregistrements de la galerie) ---
    virtual bool cameraSupported() { return false; }
    /**
     * Démarre la capture : les paquets arrivent dans `sink` jusqu'à stopCapture(). Bloquant
     * (initialisation de la caméra) : à appeler depuis un thread de travail.
     */
    virtual bool startCapture(MediaSink* sink, CaptureInfo* info, std::string* error) {
        (void)sink; (void)info;
        if (error) *error = "Pas de caméra sur cet appareil";
        return false;
    }
    /** Arrête la capture ; au retour, plus aucun paquet n'est envoyé au sink. */
    virtual void stopCapture() {}

    // --- Chiffrement (galerie) ---
    virtual void randomBytes(uint8_t* out, size_t len) = 0;
    /** AES-256-GCM : renvoie chiffré + étiquette de 16 octets ; vide en cas d'échec. */
    virtual std::string aesGcmEncrypt(const std::string& key, const std::string& iv, const std::string& aad,
                                      const std::string& plain) = 0;
    /** RSA-OAEP (SHA-256) avec une clé publique SubjectPublicKeyInfo (DER) ; vide en cas d'échec. */
    virtual std::string rsaOaepEncrypt(const std::string& spkiDer, const std::string& plain) = 0;

    // --- Threads ---
    /**
     * À appeler juste avant de créer un std::thread. Sur la tablette, la pile du thread va
     * en PSRAM (pour garder la RAM interne, rare, à l'encodeur vidéo), sauf si le thread
     * écrit dans la flash (`writesFlash`) : une pile en PSRAM y est interdite.
     */
    virtual void prepareThread(bool writesFlash) { (void)writesFlash; }

    // --- Divers ---
    virtual std::string firmwareVersion() = 0;
    virtual std::string platformName() = 0;
};

Hal& get();
void install(Hal* impl);

}  // namespace hal
