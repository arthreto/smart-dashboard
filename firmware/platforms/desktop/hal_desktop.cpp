#include "hal_desktop.h"

#include <SDL2/SDL.h>
#include <curl/curl.h>

#include <algorithm>
#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <ctime>
#include <filesystem>
#include <fstream>
#include <sstream>

namespace fs = std::filesystem;

namespace {

size_t writeCb(char* ptr, size_t size, size_t nmemb, void* userdata) {
    auto* out = static_cast<std::string*>(userdata);
    out->append(ptr, size * nmemb);
    return size * nmemb;
}

void audioCallback(void* userdata, Uint8* stream, int len) {
    static_cast<DesktopHal*>(userdata)->render(reinterpret_cast<int16_t*>(stream), len / 2);
}


std::string defaultDir() {
    // SD_SIM_DIR : un dossier de réglages par émulateur, pour simuler plusieurs écrans.
    if (const char* dir = std::getenv("SD_SIM_DIR"); dir && *dir) return dir;
    const char* home = std::getenv("HOME");
#ifdef _WIN32
    if (!home) home = std::getenv("USERPROFILE");
#endif
    return std::string(home ? home : ".") + "/.smart-dashboard-sim";
}

}  // namespace

DesktopHal::DesktopHal() : dir_(defaultDir()), synth_(RATE) { curl_global_init(CURL_GLOBAL_DEFAULT); }

DesktopHal::~DesktopHal() {
    if (audioDev_) SDL_CloseAudioDevice(audioDev_);
    curl_global_cleanup();
}

hal::HttpResponse DesktopHal::http(const std::string& method, const std::string& url, const std::string& body, const hal::Headers& headers,
                                   int timeoutMs) {
    hal::HttpResponse res;
    // Un client par thread réseau, réutilisé : la connexion HTTPS reste ouverte entre deux
    // requêtes (pas de nouvelle poignée de main TLS à chaque image ou synchro).
    thread_local CURL* c = curl_easy_init();
    if (!c) {
        res.error = "curl indisponible";
        return res;
    }
    curl_easy_reset(c);
    struct curl_slist* list = nullptr;
    for (const auto& [k, v] : headers) list = curl_slist_append(list, (k + ": " + v).c_str());
    curl_easy_setopt(c, CURLOPT_URL, url.c_str());
    curl_easy_setopt(c, CURLOPT_CUSTOMREQUEST, method.c_str());
    curl_easy_setopt(c, CURLOPT_HTTPHEADER, list);
    curl_easy_setopt(c, CURLOPT_TIMEOUT_MS, static_cast<long>(timeoutMs));
    curl_easy_setopt(c, CURLOPT_CONNECTTIMEOUT_MS, 8000L);
    curl_easy_setopt(c, CURLOPT_NOSIGNAL, 1L);
    curl_easy_setopt(c, CURLOPT_USERAGENT, "smart-dashboard-sim/0.1");
    // Suit les redirections (http:// → https://) en gardant la méthode et le corps.
    curl_easy_setopt(c, CURLOPT_FOLLOWLOCATION, 1L);
    curl_easy_setopt(c, CURLOPT_MAXREDIRS, 3L);
    curl_easy_setopt(c, CURLOPT_POSTREDIR, static_cast<long>(CURL_REDIR_POST_ALL));
    curl_easy_setopt(c, CURLOPT_WRITEFUNCTION, writeCb);
    curl_easy_setopt(c, CURLOPT_WRITEDATA, &res.body);
    if (method != "GET") {
        curl_easy_setopt(c, CURLOPT_POSTFIELDS, body.data());
        curl_easy_setopt(c, CURLOPT_POSTFIELDSIZE, static_cast<long>(body.size()));
    }
    CURLcode rc = curl_easy_perform(c);
    if (rc == CURLE_OK) {
        long code = 0;
        curl_easy_getinfo(c, CURLINFO_RESPONSE_CODE, &code);
        res.status = static_cast<int>(code);
    } else {
        res.error = curl_easy_strerror(rc);
    }
    curl_slist_free_all(list);
    return res;
}

std::string DesktopHal::path(const std::string& key) const { return dir_ + "/" + key + ".txt"; }

std::string DesktopHal::load(const std::string& key) {
    std::ifstream in(path(key), std::ios::binary);
    if (!in) return "";
    std::stringstream ss;
    ss << in.rdbuf();
    return ss.str();
}

void DesktopHal::save(const std::string& key, const std::string& value) {
    std::error_code ec;
    fs::create_directories(dir_, ec);
    std::ofstream out(path(key), std::ios::binary | std::ios::trunc);
    out << value;
}

void DesktopHal::setBrightness(int percent) { brightness_ = percent; }

hal::PowerStatus DesktopHal::power() {
    hal::PowerStatus p;
    p.battery = 78;
    p.charging = false;
    p.rssi = -54;
    p.ip = "127.0.0.1";
    return p;
}

void DesktopHal::deepSleep(int64_t wakeAtEpoch) {
    // Sur PC on reste allumé : on se contente d'indiquer ce que ferait la tablette.
    if (wakeAtEpoch > 0) {
        time_t t = static_cast<time_t>(wakeAtEpoch);
        char buf[32];
        strftime(buf, sizeof buf, "%d/%m %H:%M", localtime(&t));
        std::printf("[veille profonde simulée] réveil programmé le %s\n", buf);
    } else {
        std::printf("[veille profonde simulée] aucun réveil programmé\n");
    }
}

void DesktopHal::reboot() {
    std::printf("[redémarrage demandé] l'émulateur se ferme, relance-le.\n");
    std::exit(0);
}

void DesktopHal::ensureAudio() {
    if (audioDev_ || muted_) return;
    if (!(SDL_WasInit(SDL_INIT_AUDIO) & SDL_INIT_AUDIO) && SDL_InitSubSystem(SDL_INIT_AUDIO) != 0) return;
    SDL_AudioSpec want{}, have{};
    want.freq = RATE;
    want.format = AUDIO_S16SYS;
    want.channels = 1;
    want.samples = 1024;
    want.callback = audioCallback;
    want.userdata = this;
    audioDev_ = SDL_OpenAudioDevice(nullptr, 0, &want, &have, 0);
    if (audioDev_) SDL_PauseAudioDevice(audioDev_, 0);
}

void DesktopHal::playAlarm(const std::string& sound, int volumePercent) {
    ensureAudio();
    synth_.start(sound, volumePercent);
}

void DesktopHal::playClick() {
    ensureAudio();
    synth_.click();
}

void DesktopHal::stopAudio() { synth_.stop(); }

void DesktopHal::render(int16_t* out, int samples) { synth_.render(out, samples); }

void DesktopHal::setTimeZone(const std::string& posix) {
    // Sur PC, on garde le fuseau du système sauf si SD_FORCE_TZ=1.
    if (!std::getenv("SD_FORCE_TZ") || posix.empty()) return;
#ifdef _WIN32
    _putenv_s("TZ", posix.c_str());
    _tzset();
#else
    setenv("TZ", posix.c_str(), 1);
    tzset();
#endif
}

uint32_t DesktopHal::millis() {
    using namespace std::chrono;
    static const auto start = steady_clock::now();
    return static_cast<uint32_t>(duration_cast<milliseconds>(steady_clock::now() - start).count());
}

// ---------------------------------------------------------------- iPhone simulé

namespace {
int64_t nowEpoch() { return static_cast<int64_t>(time(nullptr)); }
int64_t todayAt(int h, int m, int daysAgo = 0) {
    time_t now = time(nullptr);
    struct tm t;
    localtime_r(&now, &t);
    t.tm_mday -= daysAgo;
    t.tm_hour = h;
    t.tm_min = m;
    t.tm_sec = 0;
    int64_t e = static_cast<int64_t>(mktime(&t));
    return e > nowEpoch() ? e - 86400 : e;
}
}  // namespace

void DesktopHal::phoneInit() {
    if (phoneReady_) return;
    phoneReady_ = true;
    phone_.supported = true;
    phone_.enabled = load("sim_bt") != "0";
    phone_.paired = load("sim_iphone") == "1";
    if (phone_.paired) phoneSample();
}

void DesktopHal::phoneSample() {
    phone_.connected = phone_.enabled;
    phone_.name = "iPhone (simulé)";
    phone_.battery = 64;
    phone_.notifications = {
        {1, "MESSAGES", "Léa", "Je réserve pour 12 h 30, ça te va ?", nowEpoch() - 5 * 60, "Répondre", "Effacer"},
        {2, "MAIL", "Hébergeur VPS", "Votre facture d’octobre est disponible.", todayAt(7, 10), "", "Effacer"},
        {3, "RAPPELS", "Récupérer le colis", "Point relais · avant 19:00", todayAt(7, 0), "", "Effacer"},
        {4, "ACTIVITÉ", "Objectif de pas atteint", "8 412 pas · 6,1 km", todayAt(20, 15, 1), "", "Effacer"},
    };
    phone_.calls = {
        {"Maman", "Appel manqué", todayAt(7, 12), true},
        {"Léa", "Appel entrant", todayAt(18, 40, 1), false},
        {"Numéro masqué", "Appel manqué", todayAt(11, 5, 1), true},
        {"Bureau", "Appel entrant", todayAt(9, 30, 2), false},
    };
}

void DesktopHal::phoneTick() {
    phoneInit();
    uint32_t now = millis();
    if (phone_.pairing) {
        uint32_t elapsed = now - pairingStartMs_;
        if (elapsed > 3000 && phone_.pairingCode.empty()) {
            phone_.pairingCode = "482913";  // l'iPhone « demande » le code
            phoneRev_++;
        }
        if (elapsed > 12000) {
            phone_.pairing = false;
            phone_.pairingCode.clear();
            phone_.paired = true;
            save("sim_iphone", "1");
            phoneSample();
            phoneRev_++;
        }
    }
    if (phone_.incomingUid && now - callStartMs_ > 25000) {  // sans réponse : appel manqué
        phone_.calls.insert(phone_.calls.begin(), {phone_.incomingName, "Appel manqué", nowEpoch(), true});
        phone_.incomingUid = 0;
        phone_.incomingName.clear();
        phoneRev_++;
    }
}

hal::PhoneState DesktopHal::phone() {
    std::lock_guard<std::mutex> lock(phoneMutex_);
    phoneTick();
    hal::PhoneState s = phone_;
    s.linked = s.connected;
    return s;
}

uint32_t DesktopHal::phoneRevision() {
    std::lock_guard<std::mutex> lock(phoneMutex_);
    phoneTick();
    return phoneRev_;
}

void DesktopHal::phoneSetEnabled(bool on) {
    std::lock_guard<std::mutex> lock(phoneMutex_);
    phoneInit();
    phone_.enabled = on;
    phone_.connected = on && phone_.paired;
    if (!on) {
        phone_.pairing = false;
        phone_.incomingUid = 0;
    }
    save("sim_bt", on ? "1" : "0");
    phoneRev_++;
}

void DesktopHal::phoneStartPairing() {
    std::lock_guard<std::mutex> lock(phoneMutex_);
    phoneInit();
    phone_.enabled = true;
    phone_.pairing = true;
    phone_.pairingCode.clear();
    pairingStartMs_ = millis();
    phoneRev_++;
}

void DesktopHal::phoneCancelPairing() {
    std::lock_guard<std::mutex> lock(phoneMutex_);
    phone_.pairing = false;
    phone_.pairingCode.clear();
    phoneRev_++;
}

void DesktopHal::phoneForget() {
    std::lock_guard<std::mutex> lock(phoneMutex_);
    phoneInit();
    bool enabled = phone_.enabled;
    phone_ = hal::PhoneState{};
    phone_.supported = true;
    phone_.enabled = enabled;
    save("sim_iphone", "0");
    phoneRev_++;
}

void DesktopHal::phoneAction(uint32_t uid, bool positive) {
    std::lock_guard<std::mutex> lock(phoneMutex_);
    if (uid && uid == phone_.incomingUid) {
        phone_.calls.insert(phone_.calls.begin(), {phone_.incomingName, positive ? "Appel accepté" : "Appel refusé", nowEpoch(), false});
        phone_.incomingUid = 0;
        phone_.incomingName.clear();
    } else {
        auto& v = phone_.notifications;
        v.erase(std::remove_if(v.begin(), v.end(), [uid](const hal::PhoneNotification& n) { return n.uid == uid; }), v.end());
    }
    phoneRev_++;
}

void DesktopHal::simulateNotification() {
    std::lock_guard<std::mutex> lock(phoneMutex_);
    phoneInit();
    if (!phone_.connected) {
        std::printf("[iPhone simulé] associe d'abord l'iPhone (page iPhone › Associer)\n");
        return;
    }
    static const hal::PhoneNotification samples[] = {
        {0, "WHATSAPP", "Maman", "Tu passes dîner ce soir ?", 0, "Répondre", "Effacer"},
        {0, "MESSAGES", "Léa", "J’arrive dans 10 minutes", 0, "Répondre", "Effacer"},
        {0, "CALENDRIER", "Révision projet VPS", "Dans 15 minutes · Bureau", 0, "", "Effacer"},
        {0, "MAIL", "Spotify", "Ta playlist de la semaine est prête", 0, "", "Effacer"},
    };
    hal::PhoneNotification n = samples[nextSample_++ % 4];
    n.uid = nextUid_++;
    n.at = nowEpoch();
    phone_.notifications.insert(phone_.notifications.begin(), n);
    if (phone_.notifications.size() > 20) phone_.notifications.resize(20);
    phoneRev_++;
}

void DesktopHal::simulateIncomingCall() {
    std::lock_guard<std::mutex> lock(phoneMutex_);
    phoneInit();
    if (!phone_.connected) {
        std::printf("[iPhone simulé] associe d'abord l'iPhone (page iPhone › Associer)\n");
        return;
    }
    phone_.incomingUid = nextUid_++;
    phone_.incomingName = "Maman";
    callStartMs_ = millis();
    phoneRev_++;
}

void DesktopHal::simulatePaired() {
    std::lock_guard<std::mutex> lock(phoneMutex_);
    phoneInit();
    phone_.enabled = true;
    phone_.paired = true;
    phone_.pairing = false;
    phoneSample();
    phoneRev_++;
}

std::string DesktopHal::firmwareVersion() {
#ifdef SD_FIRMWARE_VERSION
    return SD_FIRMWARE_VERSION;
#else
    return "0.1.0-sim";
#endif
}
