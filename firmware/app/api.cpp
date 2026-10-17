#include "api.h"

#include <condition_variable>
#include <cstdio>
#include <memory>
#include <deque>
#include <mutex>
#include <thread>

namespace api {

namespace {

struct Job {
    std::function<void()> work;
    std::function<void()> done;
};

// État partagé avec le thread réseau. Alloué une fois et jamais détruit : le thread
// est détaché et peut encore attendre sur la variable de condition quand le
// programme se termine (la détruire à ce moment-là bloquerait la sortie).
struct Shared {
    std::mutex mutex;
    std::condition_variable cv;
    std::deque<Job> jobs;
    std::deque<std::function<void()>> done;
    std::string base;
    std::string token;
    bool started = false;
};

Shared& S() {
    static Shared* s = new Shared();
    return *s;
}

void worker() {
    for (;;) {
        Job job;
        {
            std::unique_lock<std::mutex> lock(S().mutex);
            S().cv.wait(lock, [] { return !S().jobs.empty(); });
            job = std::move(S().jobs.front());
            S().jobs.pop_front();
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
    std::thread(worker).detach();
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

void runInWorker(std::function<void()> work, std::function<void()> done) {
    {
        std::lock_guard<std::mutex> lock(S().mutex);
        S().jobs.push_back({std::move(work), std::move(done)});
    }
    S().cv.notify_one();
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
