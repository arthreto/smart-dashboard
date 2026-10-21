#include "util.h"

#include <cstdio>
#include <cstring>

namespace util {

// ---------------------------------------------------------------- SHA-256 (FIPS 180-4)

namespace {

constexpr uint32_t K[64] = {
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be,
    0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa,
    0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85,
    0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3,
    0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f,
    0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2};

inline uint32_t rotr(uint32_t x, int n) { return (x >> n) | (x << (32 - n)); }

void block(uint32_t h[8], const uint8_t* p) {
    uint32_t w[64];
    for (int i = 0; i < 16; i++) w[i] = (uint32_t)p[i * 4] << 24 | (uint32_t)p[i * 4 + 1] << 16 | (uint32_t)p[i * 4 + 2] << 8 | p[i * 4 + 3];
    for (int i = 16; i < 64; i++) {
        uint32_t s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >> 3);
        uint32_t s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >> 10);
        w[i] = w[i - 16] + s0 + w[i - 7] + s1;
    }
    uint32_t a = h[0], b = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], hh = h[7];
    for (int i = 0; i < 64; i++) {
        uint32_t S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
        uint32_t ch = (e & f) ^ (~e & g);
        uint32_t t1 = hh + S1 + ch + K[i] + w[i];
        uint32_t S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
        uint32_t mj = (a & b) ^ (a & c) ^ (b & c);
        uint32_t t2 = S0 + mj;
        hh = g; g = f; f = e; e = d + t1; d = c; c = b; b = a; a = t1 + t2;
    }
    h[0] += a; h[1] += b; h[2] += c; h[3] += d; h[4] += e; h[5] += f; h[6] += g; h[7] += hh;
}

const char* const DAYS[7] = {"dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"};
const char* const MONTHS[12] = {"janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"};

}  // namespace

std::string sha256Hex(const std::string& data) {
    uint32_t h[8] = {0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19};
    std::string msg = data;
    uint64_t bits = static_cast<uint64_t>(data.size()) * 8;
    msg.push_back(static_cast<char>(0x80));
    while (msg.size() % 64 != 56) msg.push_back(0);
    for (int i = 7; i >= 0; i--) msg.push_back(static_cast<char>((bits >> (i * 8)) & 0xFF));
    for (size_t i = 0; i < msg.size(); i += 64) block(h, reinterpret_cast<const uint8_t*>(msg.data() + i));
    char out[65];
    for (int i = 0; i < 8; i++) snprintf(out + i * 8, 9, "%08lx", static_cast<unsigned long>(h[i]));
    return std::string(out, 64);
}

// ---------------------------------------------------------------- dates

struct tm localNow() {
    time_t now = time(nullptr);
    struct tm t;
    localtime_r(&now, &t);
    return t;
}

std::string hhmm(const struct tm& t) {
    char b[8];
    snprintf(b, sizeof b, "%02d:%02d", t.tm_hour, t.tm_min);
    return b;
}

std::string weekdayName(int wday, bool capitalize) {
    std::string s = DAYS[(wday % 7 + 7) % 7];
    if (capitalize && !s.empty()) s[0] = static_cast<char>(s[0] - 32);
    return s;
}

std::string monthName(int mon) { return MONTHS[(mon % 12 + 12) % 12]; }

std::string longDate(const struct tm& t) {
    return weekdayName(t.tm_wday, true) + " " + std::to_string(t.tm_mday) + " " + monthName(t.tm_mon);
}

int weekdayMon0(const struct tm& t) { return (t.tm_wday + 6) % 7; }

int minutesOf(const std::string& s) {
    int h = 0, m = 0;
    if (sscanf(s.c_str(), "%d:%d", &h, &m) != 2) return -1;
    return h * 60 + m;
}

bool inWindow(const struct tm& t, const std::string& start, const std::string& end) {
    int now = t.tm_hour * 60 + t.tm_min;
    int a = minutesOf(start), b = minutesOf(end);
    if (a < 0 || b < 0 || a == b) return false;
    return a < b ? (now >= a && now < b) : (now >= a || now < b);
}

std::string inDelay(int64_t seconds) {
    if (seconds < 60) return "dans moins d’une minute";
    int64_t minutes = seconds / 60;
    int64_t h = minutes / 60, m = minutes % 60;
    char b[48];
    if (h == 0) snprintf(b, sizeof b, "dans %lld min", (long long)m);
    else if (h < 10) snprintf(b, sizeof b, "dans %lld h %02lld", (long long)h, (long long)m);
    else snprintf(b, sizeof b, "dans %lld h %lld min", (long long)h, (long long)m);
    return b;
}

std::string relativeTime(int64_t epoch) {
    if (epoch <= 0) return "";
    time_t now = time(nullptr);
    int64_t diff = static_cast<int64_t>(now) - epoch;
    if (diff < 60) return "à l’instant";
    if (diff < 3600) return "il y a " + std::to_string(diff / 60) + " min";
    time_t e = static_cast<time_t>(epoch);
    struct tm t, n;
    localtime_r(&e, &t);
    localtime_r(&now, &n);
    // Différence en jours calendaires (midi pour éviter les changements d'heure).
    struct tm a = t, b = n;
    a.tm_hour = b.tm_hour = 12;
    a.tm_min = b.tm_min = a.tm_sec = b.tm_sec = 0;
    int days = static_cast<int>((mktime(&b) - mktime(&a) + 43200) / 86400);
    if (days <= 0) return hhmm(t);
    if (days == 1) return "Hier";
    if (days < 7) return weekdayName(t.tm_wday, true).substr(0, 3) + ".";
    char buf[16];
    snprintf(buf, sizeof buf, "%02d/%02d", t.tm_mday, t.tm_mon + 1);
    return buf;
}

std::string mmss(int ms) {
    if (ms < 0) ms = 0;
    int s = ms / 1000;
    char b[16];
    snprintf(b, sizeof b, "%d:%02d", s / 60, s % 60);
    return b;
}

std::string shortFrenchDate(const std::string& iso) {
    int y = 0, mo = 0, d = 0;
    if (sscanf(iso.c_str(), "%d-%d-%d", &y, &mo, &d) != 3) return iso;
    struct tm t{};
    t.tm_year = y - 1900;
    t.tm_mon = mo - 1;
    t.tm_mday = d;
    t.tm_hour = 12;
    mktime(&t);
    std::string wd = weekdayName(t.tm_wday, true).substr(0, 3);
    return wd + ". " + std::to_string(d) + " " + monthName(mo - 1);
}

bool parseIso(const std::string& iso, struct tm& out) {
    int y = 0, mo = 0, d = 0;
    if (sscanf(iso.c_str(), "%d-%d-%d", &y, &mo, &d) != 3) return false;
    out = {};
    out.tm_year = y - 1900;
    out.tm_mon = mo - 1;
    out.tm_mday = d;
    out.tm_hour = 12;
    out.tm_isdst = -1;
    mktime(&out);
    return true;
}

std::string isoDate(const struct tm& t) {
    char b[16];
    snprintf(b, sizeof b, "%04d-%02d-%02d", (t.tm_year + 1900) % 10000, (t.tm_mon + 1) % 100, t.tm_mday % 100);
    return b;
}

std::string addDaysIso(const std::string& iso, int n) {
    struct tm t;
    if (!parseIso(iso, t)) return iso;
    t.tm_mday += n;
    t.tm_isdst = -1;
    mktime(&t);
    return isoDate(t);
}

std::string relativeDay(const std::string& iso) {
    int y = 0, mo = 0, d = 0;
    if (sscanf(iso.c_str(), "%d-%d-%d", &y, &mo, &d) != 3) return "";
    struct tm t{};
    t.tm_year = y - 1900;
    t.tm_mon = mo - 1;
    t.tm_mday = d;
    t.tm_hour = 12;
    t.tm_isdst = -1;
    mktime(&t);
    struct tm now = localNow();
    now.tm_hour = 12;
    now.tm_min = now.tm_sec = 0;
    now.tm_isdst = -1;
    time_t a = mktime(&now), b = mktime(&t);
    long diff = static_cast<long>((b - a + 43200) / 86400);
    if (diff == 0) return "Aujourd’hui";
    if (diff == 1) return "Demain";
    return weekdayName(t.tm_wday, true).substr(0, 3) + ". " + std::to_string(d);
}

// ---------------------------------------------------------------- base64

namespace {
const char B64[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
}

std::string base64Encode(const std::string& data) {
    std::string out;
    out.reserve((data.size() + 2) / 3 * 4);
    size_t i = 0;
    for (; i + 2 < data.size(); i += 3) {
        uint32_t v = (static_cast<uint8_t>(data[i]) << 16) | (static_cast<uint8_t>(data[i + 1]) << 8) | static_cast<uint8_t>(data[i + 2]);
        out += B64[v >> 18];
        out += B64[(v >> 12) & 63];
        out += B64[(v >> 6) & 63];
        out += B64[v & 63];
    }
    if (i < data.size()) {
        uint32_t v = static_cast<uint8_t>(data[i]) << 16;
        if (i + 1 < data.size()) v |= static_cast<uint8_t>(data[i + 1]) << 8;
        out += B64[v >> 18];
        out += B64[(v >> 12) & 63];
        out += i + 1 < data.size() ? B64[(v >> 6) & 63] : '=';
        out += '=';
    }
    return out;
}

std::string base64Decode(const std::string& text) {
    std::string out;
    uint32_t acc = 0;
    int bits = 0;
    for (char c : text) {
        int v;
        if (c >= 'A' && c <= 'Z') v = c - 'A';
        else if (c >= 'a' && c <= 'z') v = c - 'a' + 26;
        else if (c >= '0' && c <= '9') v = c - '0' + 52;
        else if (c == '+') v = 62;
        else if (c == '/') v = 63;
        else if (c == '=') break;
        else if (c == '\n' || c == '\r' || c == ' ') continue;
        else return {};
        acc = (acc << 6) | static_cast<uint32_t>(v);
        bits += 6;
        if (bits >= 8) {
            bits -= 8;
            out += static_cast<char>((acc >> bits) & 0xFF);
        }
    }
    return out;
}

}  // namespace util
