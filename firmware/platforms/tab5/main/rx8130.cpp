#include "rx8130.h"

#include <esp_log.h>

namespace {

const char* TAG = "rx8130";

constexpr uint8_t REG_SEC = 0x10;
constexpr uint8_t REG_ALMIN = 0x17;  // puis ALHOUR (0x18) et ALWDAY / ALDAY (0x19)
constexpr uint8_t REG_EXT = 0x1C;
constexpr uint8_t REG_FLAG = 0x1D;
constexpr uint8_t REG_CTRL0 = 0x1E;
constexpr uint8_t REG_CTRL1 = 0x1F;

constexpr uint8_t EXT_TE = 1 << 4;       // minuteur actif
constexpr uint8_t EXT_WADA = 1 << 3;     // alarme sur le jour du mois (au lieu du jour de la semaine)
constexpr uint8_t AL_AE = 1 << 7;        // champ d'alarme ignoré
constexpr uint8_t FLAG_VLF = 1 << 1;     // perte d'alimentation : heure invalide
constexpr uint8_t FLAG_AF = 1 << 3;
constexpr uint8_t FLAG_TF = 1 << 4;
constexpr uint8_t CTRL0_AIE = 1 << 3;
constexpr uint8_t CTRL0_TIE = 1 << 4;
constexpr uint8_t CTRL0_UIE = 1 << 5;
constexpr uint8_t CTRL0_STOP = 1 << 6;

uint8_t bcd(int v) { return static_cast<uint8_t>(((v / 10) << 4) | (v % 10)); }
int dec(uint8_t v) { return (v >> 4) * 10 + (v & 0x0F); }

// Nombre de jours depuis le 1er janvier 1970 (calendrier grégorien), sans fuseau.
int64_t daysFromCivil(int y, unsigned m, unsigned d) {
    y -= m <= 2;
    const int era = (y >= 0 ? y : y - 399) / 400;
    const unsigned yoe = static_cast<unsigned>(y - era * 400);
    const unsigned doy = (153 * (m + (m > 2 ? -3 : 9)) + 2) / 5 + d - 1;
    const unsigned doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    return static_cast<int64_t>(era) * 146097 + static_cast<int64_t>(doe) - 719468;
}

}  // namespace

bool Rx8130::begin(i2c_master_bus_handle_t bus, uint8_t addr) {
    i2c_device_config_t cfg = {};
    cfg.dev_addr_length = I2C_ADDR_BIT_LEN_7;
    cfg.device_address = addr;
    cfg.scl_speed_hz = 400000;
    if (i2c_master_bus_add_device(bus, &cfg, &dev_) != ESP_OK) {
        dev_ = nullptr;
        ESP_LOGE(TAG, "horloge introuvable");
        return false;
    }
    // Charge de la pile de sauvegarde (mêmes bits que la démo M5Stack).
    write8(REG_CTRL1, read8(REG_CTRL1) | (1 << 4) | (1 << 5));
    return true;
}

bool Rx8130::read(time_t* utc) {
    if (!dev_) return false;
    uint8_t r[7];
    if (!readBlock(REG_SEC, r, sizeof r)) return false;
    if (read8(REG_FLAG) & FLAG_VLF) return false;
    int year = 2000 + dec(r[6]);
    int month = dec(r[5] & 0x1F);
    int day = dec(r[4] & 0x3F);
    if (year < 2024 || month < 1 || month > 12 || day < 1 || day > 31) return false;
    int64_t days = daysFromCivil(year, static_cast<unsigned>(month), static_cast<unsigned>(day));
    *utc = static_cast<time_t>(days * 86400 + dec(r[2] & 0x3F) * 3600 + dec(r[1] & 0x7F) * 60 + dec(r[0] & 0x7F));
    return true;
}

void Rx8130::write(time_t utc) {
    if (!dev_) return;
    struct tm t;
    gmtime_r(&utc, &t);
    write8(REG_CTRL0, read8(REG_CTRL0) | CTRL0_STOP);
    uint8_t r[7] = {bcd(t.tm_sec), bcd(t.tm_min), bcd(t.tm_hour), static_cast<uint8_t>(1 << t.tm_wday),
                    bcd(t.tm_mday), bcd(t.tm_mon + 1), bcd(t.tm_year % 100)};
    writeBlock(REG_SEC, r, sizeof r);
    write8(REG_CTRL0, read8(REG_CTRL0) & ~CTRL0_STOP);
    write8(REG_FLAG, read8(REG_FLAG) & ~FLAG_VLF);
}

void Rx8130::wakeAt(time_t target, time_t now) {
    if (!dev_) return;
    if (target < now + 90) target = now + 90;  // au moins la minute suivante
    struct tm t;
    gmtime_r(&target, &t);
    bool withinDay = target - now < 86400 - 120;

    write8(REG_CTRL0, read8(REG_CTRL0) & ~(CTRL0_AIE | CTRL0_TIE | CTRL0_UIE));
    uint8_t ext = read8(REG_EXT) & ~EXT_TE;
    ext = withinDay ? (ext & ~EXT_WADA) : (ext | EXT_WADA);
    write8(REG_EXT, ext);
    uint8_t al[3] = {bcd(t.tm_min), bcd(t.tm_hour), withinDay ? AL_AE : bcd(t.tm_mday)};
    writeBlock(REG_ALMIN, al, sizeof al);
    write8(REG_FLAG, read8(REG_FLAG) & ~(FLAG_AF | FLAG_TF));
    write8(REG_CTRL0, read8(REG_CTRL0) | CTRL0_AIE);
    ESP_LOGI(TAG, "réveil programmé à %02d:%02d UTC (dans %ld min)", t.tm_hour, t.tm_min, static_cast<long>((target - now) / 60));
}

bool Rx8130::interruptFired() { return dev_ && (read8(REG_FLAG) & (FLAG_TF | FLAG_AF)); }

void Rx8130::clearInterrupts() {
    if (!dev_) return;
    write8(REG_EXT, read8(REG_EXT) & ~EXT_TE);
    write8(REG_CTRL0, read8(REG_CTRL0) & ~(CTRL0_TIE | CTRL0_AIE | CTRL0_UIE));
    write8(REG_FLAG, read8(REG_FLAG) & FLAG_VLF);  // garde seulement l'indicateur de perte d'alimentation
}

uint8_t Rx8130::read8(uint8_t reg) {
    uint8_t v = 0;
    readBlock(reg, &v, 1);
    return v;
}

void Rx8130::write8(uint8_t reg, uint8_t value) { writeBlock(reg, &value, 1); }

bool Rx8130::readBlock(uint8_t reg, uint8_t* buf, size_t len) {
    return dev_ && i2c_master_transmit_receive(dev_, &reg, 1, buf, len, 100) == ESP_OK;
}

bool Rx8130::writeBlock(uint8_t reg, const uint8_t* buf, size_t len) {
    if (!dev_ || len > 8) return false;
    uint8_t tmp[9];
    tmp[0] = reg;
    for (size_t i = 0; i < len; i++) tmp[i + 1] = buf[i];
    return i2c_master_transmit(dev_, tmp, len + 1, 100) == ESP_OK;
}
