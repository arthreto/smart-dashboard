// Implémentation PC du HAL : libcurl pour le réseau, SDL pour le son,
// fichiers dans ~/.smart-dashboard-sim pour le stockage.
#pragma once

#include <atomic>
#include <mutex>
#include <string>
#include <thread>

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

    // iPhone simulé : association en ~10 s, touches N (notification) et P (appel).
    hal::PhoneState phone() override;
    uint32_t phoneRevision() override;
    void phoneSetEnabled(bool on) override;
    void phoneStartPairing() override;
    void phoneCancelPairing() override;
    void phoneForget() override;
    void phoneAction(uint32_t uid, bool positive) override;
    void simulateNotification();
    void simulateIncomingCall();
    void simulatePaired();

    // Caméra simulée par ffmpeg : webcam (/dev/video0) si présente, sinon mire de test ;
    // son : bip de test. SD_CAMERA=mire force la mire, SD_CAMERA=/dev/videoN choisit la webcam.
    bool cameraSupported() override;
    bool startCapture(hal::MediaSink* sink, hal::CaptureInfo* info, std::string* error) override;
    void stopCapture() override;
    void randomBytes(uint8_t* out, size_t len) override;
    std::string aesGcmEncrypt(const std::string& key, const std::string& iv, const std::string& aad, const std::string& plain) override;
    std::string rsaOaepEncrypt(const std::string& spkiDer, const std::string& plain) override;

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
    void phoneInit();
    void phoneTick();
    void phoneSample();

    void videoReader(int fd);
    void audioReader(int fd);

    std::mutex captureMutex_;
    hal::MediaSink* sink_ = nullptr;
    std::atomic<bool> capturing_{false};
    int videoPid_ = -1, audioPid_ = -1;
    std::thread videoThread_, audioThread_;

    std::string dir_;
    int brightness_ = 60;
    bool muted_ = false;
    uint32_t audioDev_ = 0;
    ToneSynth synth_;

    std::mutex phoneMutex_;
    hal::PhoneState phone_;
    bool phoneReady_ = false;
    uint32_t phoneRev_ = 1;
    uint32_t pairingStartMs_ = 0;
    uint32_t callStartMs_ = 0;
    uint32_t nextUid_ = 100;
    int nextSample_ = 0;
};
