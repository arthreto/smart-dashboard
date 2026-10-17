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
    CURL* c = curl_easy_init();
    if (!c) {
        res.error = "curl indisponible";
        return res;
    }
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
    curl_easy_cleanup(c);
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

hal::PhoneState DesktopHal::phone() {
    // Données d'exemple : sur la tablette, elles viendront de l'iPhone via Bluetooth (ANCS).
    hal::PhoneState p;
    p.supported = true;
    p.connected = true;
    p.name = "iPhone (simulé)";
    p.battery = 64;
    p.notifications = {
        {"MESSAGES", "Léa", "Je réserve pour 12 h 30, ça te va ?", "il y a 5 min"},
        {"MAIL", "Hébergeur VPS", "Votre facture d’octobre est disponible.", "07:10"},
        {"RAPPELS", "Récupérer le colis", "Point relais · avant 19:00", "07:00"},
        {"ACTIVITÉ", "Objectif de pas atteint", "8 412 pas · 6,1 km", "Hier"},
    };
    p.calls = {
        {"Maman", "Appel manqué", "07:12", true},
        {"Léa", "Entrant · 3 min", "Hier", false},
        {"Numéro masqué", "Appel manqué", "Hier", true},
        {"Bureau", "Sortant · 12 min", "Jeu.", false},
    };
    return p;
}

std::string DesktopHal::firmwareVersion() {
#ifdef SD_FIRMWARE_VERSION
    return SD_FIRMWARE_VERSION;
#else
    return "0.1.0-sim";
#endif
}
