#include "hal_tab5.h"

#include <bsp/m5stack_tab5.h>
#include <esp_crt_bundle.h>
#include <esp_http_client.h>
#include <esp_log.h>
#include <esp_netif_sntp.h>
#include <esp_system.h>
#include <esp_timer.h>
#include <esp_pthread.h>
#include <esp_random.h>
#include <esp_wifi.h>
#include <mbedtls/gcm.h>
#include <mbedtls/pk.h>
#include <mbedtls/rsa.h>
#include <nvs.h>
#include <nvs_flash.h>
#include <sys/time.h>

#include <algorithm>
#include <cstdlib>
#include <cstring>
#include <map>

namespace {

const char* TAG = "tab5";

constexpr EventBits_t WIFI_CONNECTED = BIT0;
constexpr EventBits_t WIFI_FAILED = BIT1;
constexpr const char* NVS_NAMESPACE = "sd";
constexpr const char* DEFAULT_TZ = "CET-1CEST,M3.5.0,M10.5.0/3";  // Europe/Paris
constexpr uint32_t CACHE_WRITE_INTERVAL_MS = 15u * 60u * 1000u;
constexpr uint8_t INA226_ADDR = 0x41;

Tab5Hal* g_self = nullptr;

std::string nvsKey(const std::string& key) { return key.size() > 15 ? key.substr(0, 15) : key; }

/** Pourcentage de charge d'une cellule Li-ion à partir de sa tension (au repos). */
int cellPercent(float v) {
    static const float volts[] = {3.30f, 3.40f, 3.50f, 3.60f, 3.70f, 3.80f, 3.90f, 4.00f, 4.10f, 4.20f};
    static const int pct[] = {0, 5, 10, 20, 35, 50, 65, 80, 90, 100};
    if (v <= volts[0]) return 0;
    for (int i = 1; i < 10; i++) {
        if (v <= volts[i]) return pct[i - 1] + static_cast<int>((v - volts[i - 1]) / (volts[i] - volts[i - 1]) * (pct[i] - pct[i - 1]));
    }
    return 100;
}

}  // namespace

// ---------------------------------------------------------------- démarrage

void Tab5Hal::begin() {
    g_self = this;

    esp_err_t err = nvs_flash_init();
    if (err == ESP_ERR_NVS_NO_FREE_PAGES || err == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        ESP_ERROR_CHECK(nvs_flash_erase());
        err = nvs_flash_init();
    }
    ESP_ERROR_CHECK(err);

    // Bus I2C interne, extenseurs d'E/S (alimentations, reset écran, Wi-Fi…), charge.
    ESP_ERROR_CHECK(bsp_i2c_init());
    i2c_master_bus_handle_t bus = bsp_i2c_get_handle();
    bsp_io_expander_pi4ioe_init(bus);
    bsp_set_charge_qc_en(true);
    vTaskDelay(pdMS_TO_TICKS(50));
    bsp_set_charge_en(true);

    // Son : ES8388 en 48 kHz stéréo, coupé tant que rien ne joue.
    vTaskDelay(pdMS_TO_TICKS(200));
    bsp_codec_init();
    bsp_codec_config_t* codec = bsp_get_codec_handle();
    codec->i2s_reconfig_clk_fn(48000, 16, I2S_SLOT_MODE_STEREO);
    codec->set_volume(85);
    codec->set_mute(true);
    xTaskCreate(audioTaskMain, "audio", 4096, this, 6, &audioTask_);

    // Mesure de la batterie (INA226) : moyenne sur 16 mesures, conversion continue.
    i2c_device_config_t ina = {};
    ina.dev_addr_length = I2C_ADDR_BIT_LEN_7;
    ina.device_address = INA226_ADDR;
    ina.scl_speed_hz = 400000;
    if (i2c_master_bus_add_device(bus, &ina, &ina226_) == ESP_OK) {
        uint8_t cfg[3] = {0x00, 0x45, 0x27};
        if (i2c_master_transmit(ina226_, cfg, sizeof cfg, 50) != ESP_OK) ESP_LOGW(TAG, "INA226 absent");
    } else {
        ina226_ = nullptr;
    }

    // Horloge : heure sauvegardée + motif du démarrage (minuteur de réveil ?).
    if (rtc_.begin(bus)) {
        wokeByRtc_ = rtc_.interruptFired();
        rtc_.clearInterrupts();
        time_t t = 0;
        if (rtc_.read(&t)) {
            struct timeval tv = {t, 0};
            settimeofday(&tv, nullptr);
            timeValid_ = true;
        }
    }
    std::string tz = loadRaw("tz");
    setenv("TZ", tz.empty() ? DEFAULT_TZ : tz.c_str(), 1);
    tzset();
    ESP_LOGI(TAG, "démarrage%s, heure %s", wokeByRtc_ ? " par l'alarme de réveil" : "", timeValid_ ? "valide" : "inconnue");

    initWifi();
    // Le Bluetooth passe par l'ESP32-C6, déjà relié au P4 pour le Wi-Fi.
    iphone_.begin(loadRaw("bt_on") != "0");
}

void Tab5Hal::phoneSetEnabled(bool on) {
    saveRaw("bt_on", on ? "1" : "0");
    iphone_.setEnabled(on);
}

lv_display_t* Tab5Hal::startDisplay() {
    bsp_display_cfg_t cfg = {};
    cfg.lvgl_port_cfg = ESP_LVGL_PORT_INIT_CONFIG();
    cfg.lvgl_port_cfg.task_stack = 16 * 1024;  // l'interface est reconstruite dans cette tâche
    cfg.buffer_size = BSP_LCD_H_RES * BSP_LCD_V_RES;
    cfg.double_buffer = true;
    // Tampons de dessin en PSRAM (grands : 1280×720), alignés sur la ligne de cache
    // (buff_dma) : la rotation logicielle par le PPA l'exige. La PSRAM étant « DMA capable »
    // sur l'ESP32-P4, ces deux drapeaux ensemble gardent le tampon en PSRAM, pas en RAM interne.
    cfg.flags.buff_dma = true;
    cfg.flags.buff_spiram = true;
    cfg.flags.sw_rotate = true;

    bsp_reset_tp();
    lv_display_t* disp = bsp_display_start_with_config(&cfg);
    if (!disp) {
        ESP_LOGE(TAG, "écran non initialisé");
        return nullptr;
    }
    bsp_display_lock(0);
    lv_display_set_rotation(disp, LV_DISPLAY_ROTATION_90);  // 720×1280 natif → 1280×720 paysage
    bsp_display_unlock();
    return disp;
}

// ---------------------------------------------------------------- Wi-Fi

namespace {

/** Configuration station : SSID (32 octets) et mot de passe (64) copiés en entier. */
wifi_config_t staConfig(const std::string& ssid, const std::string& pass) {
    wifi_config_t wc = {};
    std::memcpy(wc.sta.ssid, ssid.data(), std::min(ssid.size(), sizeof(wc.sta.ssid)));
    std::memcpy(wc.sta.password, pass.data(), std::min(pass.size(), sizeof(wc.sta.password)));
    wc.sta.threshold.authmode = pass.empty() ? WIFI_AUTH_OPEN : WIFI_AUTH_WPA_PSK;
    wc.sta.pmf_cfg.capable = true;
    return wc;
}

}  // namespace

void Tab5Hal::initWifi() {
    wifiEvents_ = xEventGroupCreate();
    ESP_ERROR_CHECK(esp_netif_init());
    ESP_ERROR_CHECK(esp_event_loop_create_default());
    sta_ = esp_netif_create_default_wifi_sta();

    wifi_init_config_t cfg = WIFI_INIT_CONFIG_DEFAULT();
    esp_err_t err = esp_wifi_init(&cfg);  // démarre aussi la liaison ESP-Hosted avec l'ESP32-C6
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "Wi-Fi indisponible : %s", esp_err_to_name(err));
        return;
    }
    esp_wifi_set_storage(WIFI_STORAGE_RAM);  // identifiants gérés par nous dans la NVS
    esp_event_handler_register(WIFI_EVENT, ESP_EVENT_ANY_ID, wifiEventHandler, this);
    esp_event_handler_register(IP_EVENT, IP_EVENT_STA_GOT_IP, wifiEventHandler, this);
    esp_wifi_set_mode(WIFI_MODE_STA);
    if (esp_wifi_start() != ESP_OK) {
        ESP_LOGE(TAG, "démarrage du Wi-Fi impossible");
        return;
    }
    wifiReady_ = true;
    connectSaved();
    xTaskCreate(keeperTaskMain, "wifi_keeper", 6144, this, 3, nullptr);
}

void Tab5Hal::connectSaved() {
    std::string ssid = loadRaw("wifi_ssid");
    if (ssid.empty()) return;
    wifi_config_t wc = staConfig(ssid, loadRaw("wifi_pass"));
    esp_wifi_set_config(WIFI_IF_STA, &wc);
    autoReconnect_ = true;
    retries_ = 0;
    startConnect();
}

void Tab5Hal::startConnect() {
    linkDown_ = false;
    lastAttemptUs_ = esp_timer_get_time();
    xEventGroupClearBits(wifiEvents_, WIFI_FAILED);
    esp_wifi_connect();
}

/** Coupe la liaison (ou l'essai en cours) et attend l'événement de déconnexion. */
void Tab5Hal::waitDisconnected() {
    bool active = !linkDown_ || networkUp();
    xEventGroupClearBits(wifiEvents_, WIFI_FAILED);
    esp_wifi_disconnect();
    if (active) xEventGroupWaitBits(wifiEvents_, WIFI_FAILED, pdTRUE, pdFALSE, pdMS_TO_TICKS(2000));
    vTaskDelay(pdMS_TO_TICKS(150));
    xEventGroupClearBits(wifiEvents_, WIFI_CONNECTED | WIFI_FAILED);
    linkDown_ = true;
}

void Tab5Hal::wifiEventHandler(void* arg, esp_event_base_t base, int32_t id, void* data) {
    auto* self = static_cast<Tab5Hal*>(arg);
    if (base == WIFI_EVENT && id == WIFI_EVENT_STA_DISCONNECTED) {
        auto* ev = static_cast<wifi_event_sta_disconnected_t*>(data);
        ESP_LOGW(TAG, "Wi-Fi déconnecté (raison %d)", ev ? ev->reason : -1);
        self->linkDown_ = true;
        xEventGroupClearBits(self->wifiEvents_, WIFI_CONNECTED);
        xEventGroupSetBits(self->wifiEvents_, WIFI_FAILED);
    } else if (base == IP_EVENT && id == IP_EVENT_STA_GOT_IP) {
        auto* ev = static_cast<ip_event_got_ip_t*>(data);
        ESP_LOGI(TAG, "connecté, IP " IPSTR, IP2STR(&ev->ip_info.ip));
        self->linkDown_ = false;
        self->retries_ = 0;
        xEventGroupClearBits(self->wifiEvents_, WIFI_FAILED);
        xEventGroupSetBits(self->wifiEvents_, WIFI_CONNECTED);
    }
}

void Tab5Hal::keeperTaskMain(void* arg) {
    auto* self = static_cast<Tab5Hal*>(arg);
    for (;;) {
        vTaskDelay(pdMS_TO_TICKS(5000));
        self->keepAlive();
    }
}

// Toutes les 5 s : infos de connexion (signal, IP), SNTP, écriture de l'heure dans
// l'horloge, et reconnexion au réseau enregistré avec un délai croissant (5 s → 1 min).
void Tab5Hal::keepAlive() {
    if (rtcWritePending_.exchange(false)) writeRtc(time(nullptr));

    if (networkUp()) {
        wifi_ap_record_t ap = {};
        if (esp_wifi_sta_get_ap_info(&ap) == ESP_OK) rssi_ = ap.rssi;
        esp_netif_ip_info_t info = {};
        if (sta_ && esp_netif_get_ip_info(sta_, &info) == ESP_OK) {
            char buf[16];
            snprintf(buf, sizeof buf, IPSTR, IP2STR(&info.ip));
            std::lock_guard<std::mutex> lock(infoMutex_);
            ip_ = buf;
        }
        if (!sntpStarted_) {
            sntpStarted_ = true;
            esp_sntp_config_t c = {};
            c.start = true;
            c.wait_for_sync = true;
            c.ip_event_to_renew = IP_EVENT_STA_GOT_IP;
            c.num_of_servers = 1;
            c.servers[0] = "pool.ntp.org";
            c.sync_cb = [](struct timeval*) {
                if (g_self) g_self->onTimeSynced();
            };
            esp_netif_sntp_init(&c);
        }
        return;
    }
    rssi_ = 0;
    if (!wifiReady_ || !autoReconnect_) return;
    int64_t now = esp_timer_get_time();
    // Un essai sans réponse depuis 30 s (DHCP bloqué…) est considéré comme perdu.
    bool stalled = !linkDown_ && now - lastAttemptUs_ > 30LL * 1000000;
    if (!linkDown_ && !stalled) return;  // essai en cours : on le laisse aboutir
    if (now < nextAttemptUs_) return;
    std::unique_lock<std::mutex> lock(wifiMutex_, std::try_to_lock);
    if (!lock.owns_lock()) return;  // un scan ou une connexion manuelle est en cours
    if (stalled) waitDisconnected();
    int n = ++retries_;
    nextAttemptUs_ = now + static_cast<int64_t>(std::min(60, 5 * n)) * 1000000;
    startConnect();
}

bool Tab5Hal::networkUp() { return wifiEvents_ && (xEventGroupGetBits(wifiEvents_) & WIFI_CONNECTED); }

std::vector<hal::WifiNetwork> Tab5Hal::wifiScan() {
    std::vector<hal::WifiNetwork> out;
    if (!wifiReady_) return out;
    std::lock_guard<std::mutex> lock(wifiMutex_);
    bool connected = networkUp();
    bool keep = autoReconnect_;
    if (!connected) {
        autoReconnect_ = false;
        waitDisconnected();  // un essai de connexion en cours bloquerait le scan
    }
    wifi_scan_config_t sc = {};
    if (esp_wifi_scan_start(&sc, true) == ESP_OK) {
        uint16_t n = 0;
        esp_wifi_scan_get_ap_num(&n);
        std::vector<wifi_ap_record_t> recs(std::min<uint16_t>(n, 40));
        uint16_t got = static_cast<uint16_t>(recs.size());
        if (got && esp_wifi_scan_get_ap_records(&got, recs.data()) == ESP_OK) {
            std::map<std::string, hal::WifiNetwork> best;
            for (uint16_t i = 0; i < got; i++) {
                const char* raw = reinterpret_cast<const char*>(recs[i].ssid);
                std::string ssid(raw, strnlen(raw, sizeof(recs[i].ssid)));
                if (ssid.empty()) continue;
                auto it = best.find(ssid);
                if (it == best.end() || recs[i].rssi > it->second.rssi)
                    best[ssid] = {ssid, recs[i].rssi, recs[i].authmode != WIFI_AUTH_OPEN};
            }
            for (auto& [k, v] : best) out.push_back(v);
            std::sort(out.begin(), out.end(), [](const hal::WifiNetwork& a, const hal::WifiNetwork& b) { return a.rssi > b.rssi; });
        } else {
            esp_wifi_clear_ap_list();
        }
    }
    autoReconnect_ = keep;
    if (!connected && keep) startConnect();
    return out;
}

bool Tab5Hal::wifiConnect(const std::string& ssid, const std::string& password) {
    if (!wifiReady_) return false;
    std::lock_guard<std::mutex> lock(wifiMutex_);
    autoReconnect_ = false;
    waitDisconnected();

    wifi_config_t wc = staConfig(ssid, password);
    esp_wifi_set_config(WIFI_IF_STA, &wc);

    bool ok = false;
    for (int attempt = 0; attempt < 2 && !ok; attempt++) {
        xEventGroupClearBits(wifiEvents_, WIFI_CONNECTED | WIFI_FAILED);
        startConnect();
        EventBits_t bits = xEventGroupWaitBits(wifiEvents_, WIFI_CONNECTED | WIFI_FAILED, pdFALSE, pdFALSE, pdMS_TO_TICKS(15000));
        ok = bits & WIFI_CONNECTED;
        if (!ok) {
            if (!(bits & WIFI_FAILED)) waitDisconnected();  // délai dépassé : on arrête l'essai
            vTaskDelay(pdMS_TO_TICKS(500));
        }
    }
    if (ok) {
        saveRaw("wifi_ssid", ssid);
        saveRaw("wifi_pass", password);
        autoReconnect_ = true;
        retries_ = 0;
        return true;
    }
    ESP_LOGW(TAG, "connexion à « %s » impossible", ssid.c_str());
    waitDisconnected();
    std::string prevSsid = loadRaw("wifi_ssid");
    if (!prevSsid.empty()) {  // on revient au réseau enregistré
        wifi_config_t prev = staConfig(prevSsid, loadRaw("wifi_pass"));
        esp_wifi_set_config(WIFI_IF_STA, &prev);
        autoReconnect_ = true;
        startConnect();
    }
    return false;
}

std::string Tab5Hal::wifiSsid() { return loadRaw("wifi_ssid"); }

// ---------------------------------------------------------------- HTTP(S)

hal::HttpResponse Tab5Hal::http(const std::string& method, const std::string& url, const std::string& body, const hal::Headers& headers,
                                int timeoutMs) {
    hal::HttpResponse res;
    if (!networkUp()) {
        res.error = "Wi-Fi non connecté";
        return res;
    }
    esp_http_client_config_t cfg = {};
    cfg.url = url.c_str();
    cfg.timeout_ms = timeoutMs;
    cfg.crt_bundle_attach = esp_crt_bundle_attach;
    cfg.buffer_size = 4096;
    cfg.buffer_size_tx = 2048;
    cfg.user_agent = "smart-dashboard-tab5/" SD_FIRMWARE_VERSION;
    esp_http_client_handle_t c = esp_http_client_init(&cfg);
    if (!c) {
        res.error = "client HTTP indisponible";
        return res;
    }
    esp_http_client_method_t m = HTTP_METHOD_GET;
    if (method == "POST") m = HTTP_METHOD_POST;
    else if (method == "PUT") m = HTTP_METHOD_PUT;
    else if (method == "DELETE") m = HTTP_METHOD_DELETE;
    else if (method == "PATCH") m = HTTP_METHOD_PATCH;
    else if (method == "HEAD") m = HTTP_METHOD_HEAD;
    esp_http_client_set_method(c, m);
    for (const auto& [k, v] : headers) esp_http_client_set_header(c, k.c_str(), v.c_str());
    int toSend = m == HTTP_METHOD_GET ? 0 : static_cast<int>(body.size());

    // Les redirections (ex. http:// → https:// posée par Certbot) sont suivies en gardant
    // la méthode et le corps de la requête.
    for (int hop = 0;; hop++) {
        esp_err_t err = esp_http_client_open(c, toSend);
        if (err != ESP_OK) {
            res.error = std::string("connexion impossible (") + esp_err_to_name(err) + ")";
            break;
        }
        // Gros corps (vidéos, captures) : esp_http_client_write peut n'en écrire qu'une partie.
        int sent = 0;
        while (sent < toSend) {
            int w = esp_http_client_write(c, body.data() + sent, std::min(toSend - sent, 16384));
            if (w <= 0) break;
            sent += w;
        }
        if (sent < toSend) {
            res.error = "envoi interrompu";
            esp_http_client_close(c);
            break;
        }
        esp_http_client_fetch_headers(c);
        int status = esp_http_client_get_status_code(c);
        bool redirect = status == 301 || status == 302 || status == 303 || status == 307 || status == 308;
        if (redirect && hop < 3 && esp_http_client_set_redirection(c) == ESP_OK) {
            esp_http_client_close(c);
            continue;
        }
        if (status <= 0) {
            res.error = "réponse invalide";
            esp_http_client_close(c);
            break;
        }
        char buf[2048];
        for (;;) {
            int n = esp_http_client_read(c, buf, sizeof buf);
            if (n < 0) {
                res.error = "lecture interrompue";
                status = 0;
                break;
            }
            if (n == 0) break;
            res.body.append(buf, static_cast<size_t>(n));
            if (res.body.size() > 6u * 1024u * 1024u) {
                res.error = "réponse trop volumineuse";
                status = 0;
                break;
            }
        }
        res.status = status;
        esp_http_client_close(c);
        break;
    }
    esp_http_client_cleanup(c);
    return res;
}

// ---------------------------------------------------------------- stockage (NVS)

std::string Tab5Hal::loadRaw(const std::string& key) {
    nvs_handle_t h;
    if (nvs_open(NVS_NAMESPACE, NVS_READONLY, &h) != ESP_OK) return "";
    std::string out;
    size_t len = 0;
    std::string k = nvsKey(key);
    if (nvs_get_blob(h, k.c_str(), nullptr, &len) == ESP_OK && len > 0) {
        out.resize(len);
        if (nvs_get_blob(h, k.c_str(), out.data(), &len) != ESP_OK) out.clear();
        else out.resize(len);
    }
    nvs_close(h);
    return out;
}

void Tab5Hal::saveRaw(const std::string& key, const std::string& value) {
    nvs_handle_t h;
    if (nvs_open(NVS_NAMESPACE, NVS_READWRITE, &h) != ESP_OK) return;
    std::string k = nvsKey(key);
    esp_err_t err = value.empty() ? nvs_erase_key(h, k.c_str()) : nvs_set_blob(h, k.c_str(), value.data(), value.size());
    if (err != ESP_OK && err != ESP_ERR_NVS_NOT_FOUND) ESP_LOGW(TAG, "écriture NVS « %s » : %s", k.c_str(), esp_err_to_name(err));
    nvs_commit(h);
    nvs_close(h);
}

std::string Tab5Hal::load(const std::string& key) {
    if (key == "state_cache") {
        std::lock_guard<std::mutex> lock(storageMutex_);
        if (cacheDirty_) return pendingCache_;
    }
    return loadRaw(key);
}

void Tab5Hal::save(const std::string& key, const std::string& value) {
    if (key != "state_cache") {
        saveRaw(key, value);
        return;
    }
    // L'état complet arrive à chaque synchronisation : on limite les écritures
    // en flash (usure) à une toutes les 15 minutes, et à l'extinction.
    std::lock_guard<std::mutex> lock(storageMutex_);
    pendingCache_ = value;
    cacheDirty_ = true;
    if (value.empty() || lastCacheWriteMs_ == 0 || millis() - lastCacheWriteMs_ > CACHE_WRITE_INTERVAL_MS) {
        saveRaw("state_cache", pendingCache_);
        cacheDirty_ = false;
        lastCacheWriteMs_ = std::max<uint32_t>(1, millis());
    }
}

void Tab5Hal::flushCache() {
    std::lock_guard<std::mutex> lock(storageMutex_);
    if (!cacheDirty_) return;
    saveRaw("state_cache", pendingCache_);
    cacheDirty_ = false;
    lastCacheWriteMs_ = std::max<uint32_t>(1, millis());
}

// ---------------------------------------------------------------- écran et énergie

void Tab5Hal::setBrightness(int percent) { bsp_display_brightness_set(std::clamp(percent, 0, 100)); }

int Tab5Hal::batteryPercent(bool* charging) {
    uint32_t now = millis();
    if (batteryReadMs_ == 0 || now - batteryReadMs_ > 10000) {
        batteryReadMs_ = std::max<uint32_t>(1, now);
        chargingCache_ = bsp_usb_c_detect();
        batteryCache_ = -1;
        uint8_t reg = 0x02;  // tension du bus, 1,25 mV par unité
        uint8_t raw[2];
        if (ina226_ && i2c_master_transmit_receive(ina226_, &reg, 1, raw, 2, 50) == ESP_OK) {
            float volts = static_cast<float>((raw[0] << 8) | raw[1]) * 1.25e-3f;
            if (volts > 3.0f) batteryCache_ = cellPercent(volts / 2.0f);  // batterie 2 cellules (7,4 V)
        }
    }
    *charging = chargingCache_;
    return batteryCache_;
}

hal::PowerStatus Tab5Hal::power() {
    hal::PowerStatus p;
    p.battery = batteryPercent(&p.charging);
    if (networkUp()) {  // valeurs relevées par la tâche wifi_keeper (pas d'appel au C6 ici)
        p.rssi = rssi_;
        std::lock_guard<std::mutex> lock(infoMutex_);
        p.ip = ip_;
    }
    return p;
}

void Tab5Hal::deepSleep(int64_t wakeAtEpoch) {
    flushCache();
    stopAudio();
    time_t now = time(nullptr);
    {
        std::lock_guard<std::mutex> lock(rtcMutex_);
        if (timeValid_) rtc_.write(now);
        if (wakeAtEpoch > 0 && timeValid_) rtc_.wakeAt(static_cast<time_t>(wakeAtEpoch), now);
    }
    ESP_LOGI(TAG, "extinction (veille profonde)");
    bsp_display_brightness_set(0);
    vTaskDelay(pdMS_TO_TICKS(100));
    bsp_generate_poweroff_signal();
    // Toujours allumée : la tablette est alimentée par l'USB et ne peut pas se couper.
    // On reste écran éteint ; l'application gère l'alarme et le réveil au toucher.
    vTaskDelay(pdMS_TO_TICKS(1500));
    {
        std::lock_guard<std::mutex> lock(rtcMutex_);
        rtc_.clearInterrupts();
    }
    ESP_LOGI(TAG, "alimentation USB : veille écran éteint à la place");
}

void Tab5Hal::reboot() {
    flushCache();
    esp_restart();
}

// ---------------------------------------------------------------- son

void Tab5Hal::audioTaskMain(void* arg) {
    auto* self = static_cast<Tab5Hal*>(arg);
    bsp_codec_config_t* codec = bsp_get_codec_handle();
    static int16_t mono[256];
    static int16_t stereo[512];
    for (;;) {
        ulTaskNotifyTake(pdTRUE, portMAX_DELAY);
        codec->set_mute(false);
        size_t written = 0;
        while (self->synth_.active()) {
            self->synth_.render(mono, 256);
            for (int i = 0; i < 256; i++) stereo[2 * i] = stereo[2 * i + 1] = mono[i];
            codec->i2s_write(stereo, sizeof stereo, &written, 200);
        }
        std::memset(stereo, 0, sizeof stereo);
        for (int i = 0; i < 8; i++) codec->i2s_write(stereo, sizeof stereo, &written, 200);  // vide la file DMA
        codec->set_mute(true);
    }
}

void Tab5Hal::playAlarm(const std::string& sound, int volumePercent) {
    synth_.start(sound, volumePercent);
    if (audioTask_) xTaskNotifyGive(audioTask_);
}

void Tab5Hal::playClick() {
    synth_.click();
    if (audioTask_) xTaskNotifyGive(audioTask_);
}

void Tab5Hal::stopAudio() { synth_.stop(); }

// ---------------------------------------------------------------- heure

void Tab5Hal::setTimeZone(const std::string& posix) {
    if (posix.empty()) return;
    const char* cur = getenv("TZ");
    if (cur && posix == cur) return;
    setenv("TZ", posix.c_str(), 1);
    tzset();
    saveRaw("tz", posix);
}

void Tab5Hal::syncTime(int64_t epoch) {
    if (epoch <= 0) return;
    time_t now = time(nullptr);
    // L'heure du serveur ne sert que si l'horloge est inconnue ou très décalée (le SNTP est plus précis).
    if (timeValid_ && std::llabs(static_cast<long long>(now - epoch)) < 120) return;
    struct timeval tv = {static_cast<time_t>(epoch), 0};
    settimeofday(&tv, nullptr);
    timeValid_ = true;
    writeRtc(static_cast<time_t>(epoch));
}

// Appelé par le SNTP (tâche réseau) : l'écriture dans l'horloge est faite par wifi_keeper.
void Tab5Hal::onTimeSynced() {
    timeValid_ = true;
    rtcWritePending_ = true;
    ESP_LOGI(TAG, "heure synchronisée (SNTP)");
}

void Tab5Hal::writeRtc(time_t utc) {
    std::lock_guard<std::mutex> lock(rtcMutex_);
    rtc_.write(utc);
}

uint32_t Tab5Hal::millis() { return static_cast<uint32_t>(esp_timer_get_time() / 1000); }

std::string Tab5Hal::firmwareVersion() { return SD_FIRMWARE_VERSION; }

// ---------------------------------------------------------------- chiffrement (galerie)

void Tab5Hal::randomBytes(uint8_t* out, size_t len) { esp_fill_random(out, len); }

std::string Tab5Hal::aesGcmEncrypt(const std::string& key, const std::string& iv, const std::string& aad, const std::string& plain) {
    if (key.size() != 32) return {};
    std::string out(plain.size() + 16, '\0');
    mbedtls_gcm_context gcm;
    mbedtls_gcm_init(&gcm);
    int rc = mbedtls_gcm_setkey(&gcm, MBEDTLS_CIPHER_ID_AES, reinterpret_cast<const unsigned char*>(key.data()), 256);
    if (rc == 0) {
        auto* o = reinterpret_cast<unsigned char*>(&out[0]);
        rc = mbedtls_gcm_crypt_and_tag(&gcm, MBEDTLS_GCM_ENCRYPT, plain.size(), reinterpret_cast<const unsigned char*>(iv.data()), iv.size(),
                                       reinterpret_cast<const unsigned char*>(aad.data()), aad.size(),
                                       reinterpret_cast<const unsigned char*>(plain.data()), o, 16, o + plain.size());
    }
    mbedtls_gcm_free(&gcm);
    if (rc != 0) {
        ESP_LOGE(TAG, "AES-GCM : erreur %d", rc);
        return {};
    }
    return out;
}

std::string Tab5Hal::rsaOaepEncrypt(const std::string& spkiDer, const std::string& plain) {
    mbedtls_pk_context pk;
    mbedtls_pk_init(&pk);
    std::string out;
    int rc = mbedtls_pk_parse_public_key(&pk, reinterpret_cast<const unsigned char*>(spkiDer.data()), spkiDer.size());
    if (rc == 0 && mbedtls_pk_get_type(&pk) == MBEDTLS_PK_RSA) {
        mbedtls_rsa_context* rsa = mbedtls_pk_rsa(pk);
        mbedtls_rsa_set_padding(rsa, MBEDTLS_RSA_PKCS_V21, MBEDTLS_MD_SHA256);
        out.assign(mbedtls_rsa_get_len(rsa), '\0');
        auto rng = [](void*, unsigned char* buf, size_t len) -> int {
            esp_fill_random(buf, len);
            return 0;
        };
        rc = mbedtls_rsa_rsaes_oaep_encrypt(rsa, rng, nullptr, nullptr, 0, plain.size(), reinterpret_cast<const unsigned char*>(plain.data()),
                                            reinterpret_cast<unsigned char*>(&out[0]));
    } else if (rc == 0) {
        rc = -1;
    }
    mbedtls_pk_free(&pk);
    if (rc != 0) {
        ESP_LOGE(TAG, "RSA-OAEP : erreur %d", rc);
        return {};
    }
    return out;
}

// ---------------------------------------------------------------- threads

void Tab5Hal::prepareThread(bool writesFlash) {
    // La configuration vaut pour les threads créés ensuite par le thread appelant.
    // 16 Ko : TLS + JSON. En PSRAM sauf si le thread écrit dans la NVS (Wi-Fi), car une
    // écriture en flash coupe le cache et rend la PSRAM inaccessible pendant ce temps.
    esp_pthread_cfg_t cfg = esp_pthread_get_default_config();
    cfg.stack_size = 16384;
    cfg.stack_alloc_caps = writesFlash ? (MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT) : (MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
    if (esp_pthread_set_cfg(&cfg) != ESP_OK) ESP_LOGW(TAG, "configuration des threads refusée");
}
