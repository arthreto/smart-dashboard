#include "tones.h"

#include <algorithm>
#include <cmath>

namespace {
constexpr float TWO_PI = 6.28318530718f;

inline void advance(float& phase, float freq, int rate) {
    phase += freq / static_cast<float>(rate);
    if (phase >= 1.f) phase -= 1.f;
}
}  // namespace

void ToneSynth::start(const std::string& sound, int volumePercent) {
    std::lock_guard<std::mutex> lock(mutex_);
    sound_ = sound == "carillon" ? Sound::Carillon : sound == "pulsation" ? Sound::Pulsation : sound == "douce" ? Sound::Douce : Sound::Aube;
    alarmOn_ = true;
    n_ = 0;
    phase_ = lfoPhase_ = 0.f;
    volume_ = static_cast<float>(std::clamp(volumePercent, 0, 100)) / 100.f;
}

void ToneSynth::stop() {
    std::lock_guard<std::mutex> lock(mutex_);
    alarmOn_ = false;
}

void ToneSynth::click() {
    std::lock_guard<std::mutex> lock(mutex_);
    clickSamples_ = rate_ / 80;
}

bool ToneSynth::active() {
    std::lock_guard<std::mutex> lock(mutex_);
    return alarmOn_ || clickSamples_ > 0;
}

void ToneSynth::render(int16_t* out, int frames) {
    std::lock_guard<std::mutex> lock(mutex_);
    const float rate = static_cast<float>(rate_);
    for (int i = 0; i < frames; i++) {
        float v = 0.f;
        if (alarmOn_) {
            // Volume progressif sur 30 s (calculé sur des secondes entières + fraction, sans perte de précision).
            float sec = static_cast<float>(n_ / static_cast<uint32_t>(rate_)) + static_cast<float>(n_ % static_cast<uint32_t>(rate_)) / rate;
            float ramp = std::min(1.f, 0.15f + sec / 30.f);
            float freq = 0.f, env = 0.f;
            switch (sound_) {
                case Sound::Carillon: {  // quatre notes descendantes, 0,6 s chacune
                    static const float notes[] = {659.25f, 523.25f, 587.33f, 392.0f};
                    uint32_t noteLen = static_cast<uint32_t>(rate_) * 6 / 10;
                    uint32_t pos = n_ % (noteLen * 4);
                    uint32_t k = pos / noteLen;
                    freq = notes[k];
                    env = std::exp(-static_cast<float>(pos - k * noteLen) / rate * 4.f) * 0.6f;
                    break;
                }
                case Sound::Pulsation: {  // bips de 0,12 s toutes les 0,5 s
                    uint32_t pos = n_ % (static_cast<uint32_t>(rate_) / 2);
                    freq = 880.f;
                    env = pos < static_cast<uint32_t>(rate_) * 12 / 100 ? 0.5f : 0.f;
                    break;
                }
                case Sound::Douce: {  // 440 Hz qui ondule lentement
                    advance(lfoPhase_, 0.5f, rate_);
                    freq = 440.f;
                    env = (0.5f + 0.5f * std::sin(TWO_PI * lfoPhase_)) * 0.35f;
                    break;
                }
                case Sound::Aube: {  // arpège montant, 0,5 s par note
                    static const float notes[] = {523.25f, 659.25f, 783.99f, 1046.5f};
                    uint32_t noteLen = static_cast<uint32_t>(rate_) / 2;
                    uint32_t pos = n_ % (noteLen * 4);
                    uint32_t k = pos / noteLen;
                    freq = notes[k];
                    env = std::exp(-static_cast<float>(pos - k * noteLen) / rate * 3.f) * 0.5f;
                    break;
                }
            }
            advance(phase_, freq, rate_);
            v = std::sin(TWO_PI * phase_) * env * ramp * volume_;
            n_++;
        }
        if (clickSamples_ > 0) {
            advance(clickPhase_, 1800.f, rate_);
            v += std::sin(TWO_PI * clickPhase_) * 0.15f * (static_cast<float>(clickSamples_) / (rate / 80.f));
            clickSamples_--;
        }
        out[i] = static_cast<int16_t>(std::clamp(v, -1.f, 1.f) * 30000.f);
    }
}
