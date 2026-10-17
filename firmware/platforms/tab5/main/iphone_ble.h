// Liaison Bluetooth basse consommation avec l'iPhone (Tab5).
//
// Le Bluetooth du Tab5 est porté par l'ESP32-C6, comme le Wi-Fi : son firmware
// ESP-Hosted d'usine contient le contrôleur BLE et transmet le HCI par la même
// liaison SDIO. Le P4 fait tourner la pile hôte NimBLE.
//
// Côté iPhone, on utilise l'ANCS (Apple Notification Center Service) : la tablette
// s'annonce comme accessoire, l'iPhone s'y associe (Réglages › Bluetooth, code à
// 6 chiffres affiché par la tablette) puis lui transmet ses notifications, dont
// les appels entrants, qu'on peut accepter ou refuser.
// Spécification : https://developer.apple.com/library/archive/documentation/CoreBluetooth/Reference/AppleNotificationCenterServiceSpecification/
#pragma once

#include <atomic>
#include <cstdint>
#include <deque>
#include <map>
#include <mutex>
#include <string>
#include <utility>
#include <vector>

#include "hal.h"

class IphoneLink {
public:
    /** Démarre la pile NimBLE (après le Wi-Fi, qui initialise la liaison avec le C6). */
    void begin(bool enabled);

    // Appelables depuis n'importe quelle tâche.
    hal::PhoneState state();
    uint32_t revision() const { return rev_.load(); }
    void setEnabled(bool on);
    void startPairing();
    void cancelPairing();
    void forget();
    void action(uint32_t uid, bool positive);

    // Le reste est interne (appelé dans la tâche NimBLE).
    struct Chr {
        uint16_t def = 0, val = 0, end = 0, cccd = 0;
    };
    void onSync();
    void onReset(int reason);
    int onGapEvent(struct ble_gap_event* event);
    void updateAdvertising();
    void startDiscovery();
    void retryDiscovery(uint32_t ms);
    void discoverDescriptors(int step);
    void subscribe(int step);
    void onReady();
    void readDeviceInfo();
    void fetchNext();
    void onNotificationSource(const uint8_t* d, size_t n);
    void onDataSource(const uint8_t* d, size_t n);
    void handleAttributes(uint32_t uid, const std::map<uint8_t, std::string>& a);
    void addCall(const std::string& name, const std::string& detail, int64_t at, bool missed);
    void resetLink();
    void sendPendingAction();
    void setStatus(const std::string& s);
    void bump() { rev_++; }

    // État de la connexion (tâche NimBLE uniquement).
    uint16_t conn_ = 0xFFFF;
    uint8_t ownAddrType_ = 0;
    std::atomic<bool> synced_{false};
    bool ready_ = false;       // abonné aux notifications de l'iPhone
    bool justPaired_ = false;  // association (code) en cours sur ce lien
    uint16_t svcStart_ = 0, svcEnd_ = 0;
    std::vector<Chr> chrList_;
    std::vector<int> chrKind_;  // 0 inconnu, 1 Notification Source, 2 Control Point, 3 Data Source
    Chr ns_, cp_, ds_;
    int discoveryRetries_ = 0;
    int dscStep_ = 0;
    // Notifications dont on attend les détails : (uid, priorité) — 0 appel entrant,
    // 1 nouvelle notification, 2 notification déjà présente à la connexion.
    std::deque<std::pair<uint32_t, uint8_t>> queue_;
    bool fetching_ = false;
    uint32_t fetchUid_ = 0;
    std::vector<uint8_t> dsBuf_;
    std::map<uint32_t, uint8_t> categories_;
    bool cpWriting_ = false;  // écriture en cours sur le Control Point
    bool infoBusy_ = false;   // lecture du nom / de la batterie en cours
    int64_t incomingAt_ = 0;  // début de la sonnerie de l'appel en cours

    // Partagé avec l'interface (protégé par mutex_).
    std::mutex mutex_;
    hal::PhoneState st_;
    std::deque<std::pair<uint32_t, bool>> actions_;  // actions à envoyer à l'iPhone
    std::map<uint32_t, bool> actedCalls_;            // appels acceptés (true) / refusés (false) depuis la tablette
    std::atomic<uint32_t> rev_{1};
    std::atomic<bool> enabled_{true};
    std::atomic<bool> pairing_{false};
    int64_t startUs_ = 0;
};
