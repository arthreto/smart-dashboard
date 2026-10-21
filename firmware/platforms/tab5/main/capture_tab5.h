// Caméra et micro de la Tab5 pour les enregistrements de la galerie.
//   - caméra SC2356 (pilote « sc202cs ») en MIPI-CSI 1280×720 à 30 i/s, convertie en YUV420
//     par l'ISP, puis compressée en H.264 par l'encodeur matériel de l'ESP32-P4
//     (périphériques V4L2 d'esp_video : /dev/video0 et /dev/video11) ;
//   - micros ES7210 (48 kHz), moyenne des deux micros avant, compressés en AAC-LC mono.
#pragma once

#include <freertos/FreeRTOS.h>
#include <freertos/semphr.h>
#include <freertos/task.h>

#include <atomic>
#include <mutex>
#include <string>

#include "hal.h"

class Tab5Capture {
public:
    /**
     * Met de côté, au démarrage (RAM interne encore intacte), le bloc contigu dont l'encodeur
     * H.264 a besoin pour sa trame de référence. Il est rendu juste avant un enregistrement,
     * puis repris à la fin : sans ça, la RAM interne, suffisante mais morcelée, ne fournit plus
     * de bloc assez grand.
     */
    void reserveInternal();

    bool start(hal::MediaSink* sink, hal::CaptureInfo* info, std::string* error);
    void stop();
    bool running() const { return running_; }

private:
    bool initCamera(std::string* error);
    bool openPipeline(std::string* error);
    void closePipeline();
    static void videoTaskMain(void* arg);
    static void audioTaskMain(void* arg);
    void videoLoop();
    void audioLoop();

    std::mutex mutex_;
    hal::MediaSink* sink_ = nullptr;
    std::atomic<bool> running_{false};
    bool videoInit_ = false;
    int camFd_ = -1;
    int encFd_ = -1;
    uint8_t* camBuf_[3] = {};
    uint32_t camBufLen_[3] = {};
    uint8_t* encBuf_ = nullptr;
    uint32_t encBufLen_ = 0;
    int width_ = 0, height_ = 0;
    int64_t t0_ = 0;
    SemaphoreHandle_t videoDone_ = nullptr;
    SemaphoreHandle_t audioDone_ = nullptr;
    bool audioOn_ = false;
    void* reserve_ = nullptr;  // bloc de RAM interne gardé pour l'encodeur (voir reserveInternal)
};
