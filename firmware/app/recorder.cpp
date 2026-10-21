#include "recorder.h"

#include <algorithm>
#include <atomic>
#include <chrono>
#include <condition_variable>
#include <cstdio>
#include <cstring>
#include <deque>
#include <memory>
#include <mutex>
#include <thread>
#include <vector>

#include "api.h"
#include "hal.h"
#include "util.h"

namespace recorder {

namespace {

constexpr size_t SEAL_BYTES = 384 * 1024;        // un morceau dès 384 Ko…
constexpr uint32_t SEAL_MS = 3000;               // … ou toutes les 3 s
constexpr size_t MAX_CHUNK = 2 * 1024 * 1024;    // jamais plus de 2 Mo par morceau (serveur : 4 Mo)
constexpr size_t MAX_BACKLOG = 12 * 1024 * 1024; // ~45 s de retard : au-delà, le réseau ne suit pas, on arrête
constexpr int64_t MAX_DURATION_US = 60LL * 60 * 1000000;  // une heure au plus

void putU32(std::string& s, uint32_t v) {
    for (int i = 0; i < 4; i++) s += static_cast<char>((v >> (8 * i)) & 0xFF);
}
void putI64(std::string& s, int64_t v) {
    for (int i = 0; i < 8; i++) s += static_cast<char>((static_cast<uint64_t>(v) >> (8 * i)) & 0xFF);
}
std::string hex(const std::string& b) {
    static const char* d = "0123456789abcdef";
    std::string out;
    for (unsigned char c : b) {
        out += d[c >> 4];
        out += d[c & 15];
    }
    return out;
}

/**
 * Flux en attente d'envoi, en blocs de 256 Ko : jamais de grosse réallocation (un seul
 * tampon de plusieurs Mo devrait être recopié en grandissant, ce que la PSRAM ne permet pas).
 */
class Backlog {
public:
    static constexpr size_t BLOCK = 256 * 1024;
    void append(const char* p, size_t n) {
        while (n > 0) {
            if (blocks_.empty() || blocks_.back().size() >= BLOCK) {
                blocks_.emplace_back();
                blocks_.back().reserve(BLOCK);
            }
            std::string& b = blocks_.back();
            size_t k = std::min(n, BLOCK - b.size());
            b.append(p, k);
            p += k;
            n -= k;
            size_ += k;
        }
    }
    void append(const std::string& s) { append(s.data(), s.size()); }
    size_t size() const { return size_; }
    bool empty() const { return size_ == 0; }
    /** Retire et renvoie les `n` premiers octets. */
    std::string take(size_t n) {
        n = std::min(n, size_);
        std::string out;
        out.reserve(n);
        while (out.size() < n) {
            std::string& b = blocks_.front();
            size_t k = std::min(n - out.size(), b.size() - offset_);
            out.append(b, offset_, k);
            offset_ += k;
            if (offset_ == b.size()) {
                blocks_.pop_front();
                offset_ = 0;
            }
        }
        size_ -= n;
        return out;
    }

private:
    std::deque<std::string> blocks_;
    size_t offset_ = 0;  // octets déjà retirés du premier bloc
    size_t size_ = 0;
};

class Session : public hal::MediaSink {
public:
    Session(std::string id, std::string spki) : id_(std::move(id)), spki_(std::move(spki)) {}

    void onPacket(hal::MediaPacket&& p) override {
        std::lock_guard<std::mutex> lock(m_);
        if (!headerWritten_) {
            early_.push_back(std::move(p));
            return;
        }
        append(p);
        if (buf_.size() >= SEAL_BYTES) cv_.notify_one();
    }

    void requestStop() {
        stopRequested_ = true;
        cv_.notify_one();
    }

    Status status() {
        Status s;
        s.active = true;
        s.stopping = stopRequested_;
        s.seconds = static_cast<int>(lastPts_ / 1000000);
        {
            std::lock_guard<std::mutex> lock(m_);
            s.backlogKb = static_cast<int>(buf_.size() / 1024);
        }
        s.offline = offline_;
        return s;
    }

    /** Thread de travail : capture, chiffrement, envoi. Renvoie le message de fin. */
    std::string run(bool* isError);

private:
    void append(const hal::MediaPacket& p) {
        std::string head;
        head += static_cast<char>(p.video ? 1 : 2);
        head += static_cast<char>(p.key ? 1 : 0);
        putI64(head, p.ptsUs);
        putU32(head, static_cast<uint32_t>(p.data.size()));
        buf_.append(head);
        buf_.append(p.data);
        if (p.ptsUs > lastPts_) lastPts_ = p.ptsUs;
    }

    /** POST authentifié ; renvoie la réponse (status 0 = réseau). */
    hal::HttpResponse post(const std::string& path, const std::string& body, hal::Headers extra, const char* type) {
        hal::Headers h = api::authHeaders();
        h.push_back({"Content-Type", type});
        h.push_back({"Accept", "application/json"});
        for (auto& e : extra) h.push_back(std::move(e));
        return hal::get().http("POST", api::resolve(path), body, h, 30000);
    }

    /** Chiffre et envoie le morceau n ; réessaie tant que c'est utile. Faux = abandon. */
    bool sendChunk(const std::string& plain, bool final, std::string* error);

    std::string id_;
    std::string spki_;
    std::string key_;     // 32 octets
    std::string prefix_;  // 8 octets
    uint32_t next_ = 0;

    std::mutex m_;
    std::condition_variable cv_;
    Backlog buf_;
    std::vector<hal::MediaPacket> early_;
    bool headerWritten_ = false;
    std::atomic<int64_t> lastPts_{0};
    std::atomic<bool> stopRequested_{false};
    std::atomic<bool> offline_{false};
    bool serverEnded_ = false;
};

bool Session::sendChunk(const std::string& plain, bool final, std::string* error) {
    std::string iv = prefix_;
    for (int i = 3; i >= 0; i--) iv += static_cast<char>((next_ >> (8 * i)) & 0xFF);
    std::string aad = "sdv1:" + id_ + ":" + std::to_string(next_) + ":" + (final ? "1" : "0");
    std::string sealed = hal::get().aesGcmEncrypt(key_, iv, aad, plain);
    if (sealed.empty()) {
        *error = "Chiffrement impossible";
        return false;
    }
    hal::Headers extra;
    if (final) {
        extra.push_back({"X-Final", "1"});
        extra.push_back({"X-Duration-Ms", std::to_string(lastPts_ / 1000)});
    }
    std::string path = "/api/v1/gallery/" + id_ + "/chunks/" + std::to_string(next_);
    int delayMs = 1000;
    for (int attempt = 0;; attempt++) {
        hal::HttpResponse r = post(path, sealed, extra, "application/octet-stream");
        if (r.status == 200) {
            offline_ = false;
            next_++;
            if (r.body.find("\"stop\":true") != std::string::npos) stopRequested_ = true;
            return true;
        }
        if (r.status == 409 || r.status == 404 || r.status == 400 || r.status == 401 || r.status == 403) {
            // Vidéo terminée ou supprimée côté serveur (galerie pleine, arrêt, suppression…).
            serverEnded_ = true;
            *error = r.status == 409 ? "Enregistrement arrêté par le serveur" : "Envoi refusé par le serveur (" + std::to_string(r.status) + ")";
            std::fprintf(stderr, "[galerie] morceau %u refusé (%d) : %s\n", static_cast<unsigned>(next_), r.status, r.body.c_str());
            return false;
        }
        offline_ = true;
        // Coupure réseau ou serveur indisponible : on réessaie, la capture continue en mémoire.
        size_t backlog;
        {
            std::lock_guard<std::mutex> lock(m_);
            backlog = buf_.size();
        }
        if (backlog > MAX_BACKLOG) {
            *error = "Connexion trop lente : enregistrement arrêté";
            return false;
        }
        // Après l'arrêt, on insiste encore ~2 minutes pour la fin de la vidéo, puis on abandonne.
        if (stopRequested_ && attempt > 12) {
            *error = "Serveur injoignable : la fin de la vidéo est perdue";
            return false;
        }
        std::this_thread::sleep_for(std::chrono::milliseconds(delayMs));
        delayMs = std::min(delayMs * 2, 10000);
    }
}

std::string Session::run(bool* isError) {
    hal::Hal& h = hal::get();
    *isError = true;

    // Clé de la vidéo, chiffrée pour le compte (seul son navigateur pourra la lire).
    std::string spkiDer = util::base64Decode(spki_);
    key_.assign(32, '\0');
    prefix_.assign(8, '\0');
    h.randomBytes(reinterpret_cast<uint8_t*>(&key_[0]), key_.size());
    h.randomBytes(reinterpret_cast<uint8_t*>(&prefix_[0]), prefix_.size());
    std::string wrapped = spkiDer.empty() ? "" : h.rsaOaepEncrypt(spkiDer, key_ + prefix_);
    auto fail = [&](const std::string& msg) {
        post("/api/v1/gallery/" + id_ + "/fail", "{\"message\":\"" + api::jsonEscape(msg) + "\"}", {}, "application/json");
        return msg;
    };
    if (wrapped.empty()) return fail("Clé de la galerie invalide");

    hal::CaptureInfo info;
    std::string err;
    if (!h.startCapture(this, &info, &err)) return fail(err.empty() ? "Caméra indisponible" : err);

    // En-tête du flux (dans le premier morceau, donc chiffré lui aussi).
    {
        std::lock_guard<std::mutex> lock(m_);
        char json[256];
        std::snprintf(json, sizeof json, R"({"v":1,"w":%d,"h":%d,"fps":%d,"rate":%d,"ch":%d,"asc":"%s"})", info.width, info.height, info.fps,
                      info.audioRate, info.audioChannels, hex(info.audioConfig).c_str());
        std::string head = "SDV1";
        putU32(head, static_cast<uint32_t>(std::strlen(json)));
        head += json;
        buf_.append(head);  // rien n'est encore dans buf_ : les premiers paquets attendent dans early_
        for (auto& p : early_) append(p);
        early_.clear();
        headerWritten_ = true;
    }

    hal::HttpResponse r;
    for (int attempt = 0; attempt < 4; attempt++) {
        r = post("/api/v1/gallery/" + id_ + "/start",
                 "{\"wrappedKey\":\"" + util::base64Encode(wrapped) + "\",\"noncePrefix\":\"" + util::base64Encode(prefix_) + "\"}", {},
                 "application/json");
        if (r.status != 0 && r.status < 500) break;
        std::this_thread::sleep_for(std::chrono::seconds(2));
    }
    if (r.status != 200) {
        h.stopCapture();
        if (r.status == 409) {
            *isError = false;
            return "Enregistrement annulé depuis la console";
        }
        return fail(r.status == 0 ? "Serveur injoignable" : "Démarrage refusé par le serveur");
    }
    std::fprintf(stderr, "[galerie] enregistrement %s démarré (%dx%d, son %d Hz)\n", id_.c_str(), info.width, info.height, info.audioRate);

    // Boucle d'envoi : un morceau toutes les 3 s (ou 384 Ko), jusqu'à l'arrêt.
    std::string error;
    auto lastSeal = std::chrono::steady_clock::now();
    bool ok = true;
    while (!stopRequested_) {
        std::string plain;
        {
            std::unique_lock<std::mutex> lock(m_);
            cv_.wait_until(lock, lastSeal + std::chrono::milliseconds(SEAL_MS),
                           [this] { return stopRequested_ || buf_.size() >= SEAL_BYTES; });
            if (stopRequested_) break;
            if (buf_.empty()) {
                lastSeal = std::chrono::steady_clock::now();
                continue;
            }
            plain = buf_.take(MAX_CHUNK);
        }
        lastSeal = std::chrono::steady_clock::now();
        if (!sendChunk(plain, false, &error)) {
            ok = false;
            break;
        }
        if (lastPts_ >= MAX_DURATION_US) {
            error = "Durée maximale atteinte (1 h)";
            stopRequested_ = true;
        }
    }

    h.stopCapture();
    if (!ok && serverEnded_) return error;

    // Fin : le reste du flux, en morceaux de 2 Mo au plus, le dernier marqué « final ».
    for (;;) {
        std::string plain;
        bool last;
        {
            std::lock_guard<std::mutex> lock(m_);
            plain = buf_.take(MAX_CHUNK);
            last = buf_.empty();
        }
        std::string e2;
        if (!sendChunk(plain, last, &e2)) {
            if (error.empty()) error = e2;
            ok = false;
            break;
        }
        if (last) break;
    }
    std::fprintf(stderr, "[galerie] enregistrement %s terminé : %u morceaux, %lld s\n", id_.c_str(), static_cast<unsigned>(next_),
                 static_cast<long long>(lastPts_ / 1000000));
    if (!ok) {
        post("/api/v1/gallery/" + id_ + "/fail", "{\"message\":\"" + api::jsonEscape(error) + "\"}", {}, "application/json");
        return error;
    }
    *isError = !error.empty();
    if (!error.empty()) return error;
    return "Vidéo enregistrée dans la galerie";
}

std::mutex g_mutex;
std::shared_ptr<Session> g_session;
std::string g_notice;
bool g_noticeError = false;

}  // namespace

bool start(const std::string& videoId, const std::string& publicKeyB64) {
    std::shared_ptr<Session> s;
    {
        std::lock_guard<std::mutex> lock(g_mutex);
        if (g_session) return false;
        s = std::make_shared<Session>(videoId, publicKeyB64);
        g_session = s;
    }
    std::thread([s]() {
        bool isError = false;
        std::string msg = s->run(&isError);
        std::lock_guard<std::mutex> lock(g_mutex);
        g_notice = msg;
        g_noticeError = isError;
        if (g_session == s) g_session.reset();
    }).detach();
    return true;
}

void stop() {
    std::lock_guard<std::mutex> lock(g_mutex);
    if (g_session) g_session->requestStop();
}

Status status() {
    std::shared_ptr<Session> s;
    {
        std::lock_guard<std::mutex> lock(g_mutex);
        s = g_session;
    }
    return s ? s->status() : Status{};
}

std::string takeNotice(bool* isError) {
    std::lock_guard<std::mutex> lock(g_mutex);
    std::string n;
    n.swap(g_notice);
    if (isError) *isError = g_noticeError;
    return n;
}

}  // namespace recorder
