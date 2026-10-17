// Horloge temps réel Epson RX8130 du Tab5 (I2C 0x32).
// Sa sortie d'interruption rallume la tablette : on s'en sert pour le réveil
// après une extinction complète (« veille profonde »), avec l'alarme de l'horloge
// (même mécanisme que la démo officielle de M5Stack).
// Datasheet : https://download.epsondevice.com/td/pdf/app/RX8130CE_en.pdf
#pragma once

#include <driver/i2c_master.h>

#include <cstdint>
#include <ctime>

class Rx8130 {
public:
    bool begin(i2c_master_bus_handle_t bus, uint8_t addr = 0x32);

    /** Lit l'heure (UTC) ; faux si l'horloge a perdu l'alimentation (heure invalide). */
    bool read(time_t* utc);
    void write(time_t utc);

    /**
     * Programme l'alarme (= rallumage) à `target` (UTC, à la minute près, jamais après
     * `target`). Comparaison heure + minute, et jour du mois si c'est dans plus de 24 h.
     */
    void wakeAt(time_t target, time_t now);
    /** Vrai si l'alarme ou le minuteur a sonné (la tablette a été rallumée par l'horloge). */
    bool interruptFired();
    /** Efface et désactive les interruptions (à faire au démarrage). */
    void clearInterrupts();

private:
    uint8_t read8(uint8_t reg);
    void write8(uint8_t reg, uint8_t value);
    bool readBlock(uint8_t reg, uint8_t* buf, size_t len);
    bool writeBlock(uint8_t reg, const uint8_t* buf, size_t len);

    i2c_master_dev_handle_t dev_ = nullptr;
};
