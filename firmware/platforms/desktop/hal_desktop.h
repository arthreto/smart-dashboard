// Implémentation PC du HAL : libcurl pour le réseau, SDL pour le son,
// fichiers dans ~/.smart-dashboard-sim pour le stockage.
#pragma once

#include <string>

#include "hal.h"
#include "tones.h"

class DesktopHal : public hal::Hal {
public:
    static constexpr int RATE = 22050;  // fréquence d'échantillonnage du son

    DesktopHal();
    ~DesktopHal() override;

    hal::HttpResponse http(const std::string& method, const std::string& url, const std::string& body, const hal::Headers& headers,
                           int timeoutMs) override;
    bool networkUp() override { return true; }

    std::string load(const std::string& key) override;
    void save(const std::string& key, const std::string& value) override;

    void setBrightness(int percent) override;
    hal::PowerStatus power() override;
    void deepSleep(int64_t wakeAtEpoch) override;
    void reboot() override;

    void playAlarm(const std::string& sound, int volumePercent) override;
    void playClick() override;
    void stopAudio() override;

    void setTimeZone(const std::string& posix) override;
    void syncTime(int64_t epoch) override { (void)epoch; }
    uint32_t millis() override;

    hal::PhoneState phone() override;

    std::string firmwareVersion() override;
    std::string platformName() override { return "Émulateur PC"; }

    int brightness() const { return brightness_; }
    void setStorageDir(const std::string& dir) { dir_ = dir; }
    void setMuted(bool muted) { muted_ = muted; }

    // Synthèse audio (appelée par le callback SDL).
    void render(int16_t* out, int samples);

private:
    std::string path(const std::string& key) const;
    void ensureAudio();

    std::string dir_;
    int brightness_ = 60;
    bool muted_ = false;
    uint32_t audioDev_ = 0;
    ToneSynth synth_;
};
