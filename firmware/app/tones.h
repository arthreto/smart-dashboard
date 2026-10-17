// Synthèse des sonneries (aube, carillon, pulsation, douce) et du clic des
// boutons, partagée entre l'émulateur (SDL) et la tablette (codec ES8388).
// Calculs en float avec des accumulateurs de phase : l'ESP32-P4 n'a qu'une unité
// de calcul flottant simple précision.
#pragma once

#include <cstdint>
#include <mutex>
#include <string>

class ToneSynth {
public:
    explicit ToneSynth(int sampleRate) : rate_(sampleRate) {}

    /** Démarre une sonnerie en boucle (volume progressif sur 30 s). */
    void start(const std::string& sound, int volumePercent);
    void stop();
    void click();
    /** Vrai tant qu'il reste quelque chose à jouer (sonnerie ou clic). */
    bool active();

    /** Remplit `frames` échantillons mono 16 bits. Thread-safe. */
    void render(int16_t* out, int frames);

private:
    enum class Sound { Aube, Carillon, Pulsation, Douce };

    int rate_;
    std::mutex mutex_;
    Sound sound_ = Sound::Aube;
    bool alarmOn_ = false;
    int clickSamples_ = 0;
    uint32_t n_ = 0;          // échantillons depuis le début de la sonnerie
    float phase_ = 0.f;       // oscillateur de la sonnerie (0..1)
    float lfoPhase_ = 0.f;    // modulation lente (« douce »)
    float clickPhase_ = 0.f;
    float volume_ = 0.8f;
};
