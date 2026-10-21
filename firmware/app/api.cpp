#include "api.h"

#include <condition_variable>
#include <cstdio>
#include <memory>
#include <deque>
#include <mutex>
#include <thread>
#include <chrono>

namespace api {

namespace {

struct Job {
    std::function<void()> work;
    std::function<void()> done;
};

constexpr int LANES = 2;
constexpr int IMAGE_THREADS = 2;

// État partagé avec les threads réseau. Alloué une fois et jamais détruit : les threads
// sont détachés et peuvent encore attendre sur une variable de condition quand le
// programme se termine (la détruire à ce moment-là bloquerait la sortie).
struct Shared {
    std::mutex mutex;
    std::condition_variable cv[LANES];
    std::deque<Job> jobs[LANES];
    std::deque<std::function<void()>> done;
    std::string base;
    std::string token;
    bool started = false;
};

Shared& S() {
    static Shared* s = new Shared();
    return *s;
}

void worker(int lane) {
    for (;;) {
        Job job;
        {
            std::unique_lock<std::mutex> lock(S().mutex);
            S().cv[lane].wait(lock, [lane] { return !S().jobs[lane].empty(); });
            job = std::move(S().jobs[lane].front());
            S().jobs[lane].pop_front();
        }
        if (job.work) job.work();
        if (job.done) {
            std::lock_guard<std::mutex> lock(S().mutex);
            S().done.push_back(std::move(job.done));
        }
    }
}

}  // namespace

void start() {
    if (S().started) return;
    S().started = true;
    std::thread(worker, static_cast<int>(Lane::Api)).detach();
    for (int i = 0; i < IMAGE_THREADS; i++) std::thread(worker, static_cast<int>(Lane::Images)).detach();
}

void pump() {
    std::deque<std::function<void()>> ready;
    {
        std::lock_guard<std::mutex> lock(S().mutex);
        ready.swap(S().done);
    }
    for (auto& fn : ready) fn();
}

void configure(const std::string& baseUrl, const std::string& token) {
    std::lock_guard<std::mutex> lock(S().mutex);
    S().base = baseUrl;
    while (!S().base.empty() && S().base.back() == '/') S().base.pop_back();
    S().token = token;
}

bool configured() {
    std::lock_guard<std::mutex> lock(S().mutex);
    return !S().base.empty() && !S().token.empty();
}

std::string baseUrl() {
    std::lock_guard<std::mutex> lock(S().mutex);
    return S().base;
}

std::string resolve(const std::string& p) {
    if (p.rfind("http://", 0) == 0 || p.rfind("https://", 0) == 0) return p;
    return baseUrl() + p;
}

hal::Headers authHeaders() {
    std::lock_guard<std::mutex> lock(S().mutex);
    hal::Headers h;
    if (!S().token.empty()) h.push_back({"Authorization", "Bearer " + S().token});
    return h;
}

void runInWorker(std::function<void()> work, std::function<void()> done, Lane lane) {
    int i = static_cast<int>(lane);
    {
        std::lock_guard<std::mutex> lock(S().mutex);
        S().jobs[i].push_back({std::move(work), std::move(done)});
    }
    S().cv[i].notify_one();
}

void postToUi(std::function<void()> fn) {
    std::lock_guard<std::mutex> lock(S().mutex);
    S().done.push_back(std::move(fn));
}

void startWakeListener(std::function<void()> onWake) {
    static bool started = false;
    if (started) return;
    started = true;
    std::thread([onWake]() {
        for (;;) {
            std::string url, token;
            {
                std::lock_guard<std::mutex> lock(S().mutex);
                if (!S().base.empty()) url = S().base + "/api/v1/wait?timeout=25";
                token = S().token;
            }
            if (url.empty() || token.empty() || !hal::get().networkUp()) {
                std::this_thread::sleep_for(std::chrono::seconds(5));
                continue;
            }
            hal::HttpResponse r = hal::get().http("GET", url, "", {{"Accept", "application/json"}, {"Authorization", "Bearer " + token}}, 40000);
            if (r.status == 200) {
                if (r.body.find("\"wake\":true") != std::string::npos) {
                    postToUi(onWake);
                    // Laisse à l'écran le temps de lire son état et d'acquitter les commandes.
                    std::this_thread::sleep_for(std::chrono::seconds(2));
                }
                continue;
            }
            // Ancien serveur sans attente longue (404) : on se contente des synchros habituelles.
            std::this_thread::sleep_for(std::chrono::seconds(r.status == 404 ? 300 : 10));
        }
    }).detach();
}

void request(const std::string& method, const std::string& path, const std::string& jsonBody, Callback cb, bool auth, int timeoutMs) {
    std::string url = resolve(path);
    std::string token;
    {
        std::lock_guard<std::mutex> lock(S().mutex);
        token = S().token;
    }
    auto res = std::make_shared<hal::HttpResponse>();
    runInWorker(
        [=]() {
            hal::Headers h{{"Accept", "application/json"}};
            if (!jsonBody.empty() || method != "GET") h.push_back({"Content-Type", "application/json"});
            if (auth && !token.empty()) h.push_back({"Authorization", "Bearer " + token});
            *res = hal::get().http(method, url, jsonBody.empty() && method != "GET" ? "{}" : jsonBody, h, timeoutMs);
        },
        [res, cb]() {
            if (cb) cb(*res);
        });
}

void upload(const std::string& path, std::string bytes, const hal::Headers& extraHeaders, Callback cb) {
    std::string url = resolve(path);
    std::string token;
    {
        std::lock_guard<std::mutex> lock(S().mutex);
        token = S().token;
    }
    auto res = std::make_shared<hal::HttpResponse>();
    auto body = std::make_shared<std::string>(std::move(bytes));
    runInWorker(
        [=]() {
            hal::Headers h = extraHeaders;
            h.push_back({"Content-Type", "application/octet-stream"});
            h.push_back({"Authorization", "Bearer " + token});
            *res = hal::get().http("POST", url, *body, h, 30000);
        },
        [res, cb]() {
            if (cb) cb(*res);
        });
}

std::string jsonEscape(const std::string& s) {
    std::string out;
    out.reserve(s.size() + 8);
    for (unsigned char c : s) {
        switch (c) {
            case '"': out += "\\\""; break;
            case '\\': out += "\\\\"; break;
            case '\n': out += "\\n"; break;
            case '\r': out += "\\r"; break;
            case '\t': out += "\\t"; break;
            default:
                if (c < 0x20) {
                    char buf[8];
                    snprintf(buf, sizeof buf, "\\u%04x", c);
                    out += buf;
                } else {
                    out += static_cast<char>(c);
                }
        }
    }
    return out;
}

}  // namespace api
