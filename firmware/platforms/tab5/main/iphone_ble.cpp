#include "iphone_ble.h"

#include <esp_log.h>
#include <esp_random.h>
#include <esp_timer.h>

#include <algorithm>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <ctime>

#include "host/ble_hs.h"
#include "host/util/util.h"
#include "nimble/nimble_port.h"
#include "nimble/nimble_port_freertos.h"
#include "services/gap/ble_svc_gap.h"
#include "services/gatt/ble_svc_gatt.h"

extern "C" void ble_store_config_init(void);

namespace {

const char* TAG = "iphone";
const char* DEVICE_NAME = "Smart Dashboard";
constexpr uint16_t NO_CONN = BLE_HS_CONN_HANDLE_NONE;
constexpr int MAX_BONDS = MYNEWT_VAL(BLE_STORE_MAX_BONDS);

// ANCS : catégories, événements et commandes (spécification Apple).
constexpr uint8_t CAT_INCOMING_CALL = 1;
constexpr uint8_t CAT_MISSED_CALL = 2;
constexpr uint8_t EVT_REMOVED = 2;
constexpr uint8_t FLAG_PRE_EXISTING = 1 << 2;
constexpr uint8_t CMD_GET_NOTIF_ATTRS = 0;
constexpr uint8_t CMD_PERFORM_ACTION = 2;
// Attributs demandés, renvoyés par iOS dans cet ordre (longueur 0 s'il n'y en a pas) :
// AppIdentifier, Title (64), Message (200), Date, PositiveActionLabel, NegativeActionLabel.
constexpr uint8_t ATTR_APP = 0, ATTR_TITLE = 1, ATTR_MESSAGE = 3, ATTR_DATE = 5, ATTR_POS = 6, ATTR_NEG = 7;
constexpr uint8_t WANTED[] = {ATTR_APP, ATTR_TITLE, ATTR_MESSAGE, ATTR_DATE, ATTR_POS, ATTR_NEG};
constexpr size_t QUEUE_MAX = 40;

const char* HINT_SHARE =
    "L’iPhone ne partage pas ses notifications : sur l’iPhone, Réglages › Bluetooth › Smart Dashboard (i) › "
    "active « Partager les notifications système ».";
const char* HINT_FORGOTTEN =
    "L’iPhone ne reconnaît plus la tablette : touche « Associer un iPhone » et associe-le à nouveau.";
const char* HINT_IPHONE_KEYS =
    "Association à refaire : sur l’iPhone, Réglages › Bluetooth › Smart Dashboard (i) › Oublier cet appareil, "
    "puis touche « Associer un iPhone ».";

IphoneLink* g_link = nullptr;

ble_uuid128_t g_ancsSvc, g_ancsNs, g_ancsCp, g_ancsDs;
ble_uuid16_t g_uuidName, g_uuidBattery;

struct ble_npl_event g_evUpdate, g_evPair, g_evForget, g_evAction;
struct ble_npl_callout g_pairTimeout, g_fetchTimeout, g_rediscover, g_batteryTimer, g_retryFetch, g_secTimeout, g_advRetry;

/** UUID écrit « 7905F431-B5CE-… » → structure NimBLE (octets en ordre little-endian). */
ble_uuid128_t uuid128(const char* text) {
    ble_uuid128_t u{};
    u.u.type = BLE_UUID_TYPE_128;
    uint8_t be[16] = {};
    int n = 0;
    for (const char* p = text; *p && n < 32; p++) {
        char c = *p;
        int v = c >= '0' && c <= '9' ? c - '0' : c >= 'A' && c <= 'F' ? c - 'A' + 10 : c >= 'a' && c <= 'f' ? c - 'a' + 10 : -1;
        if (v < 0) continue;
        be[n / 2] = static_cast<uint8_t>((be[n / 2] << 4) | v);
        n++;
    }
    for (int i = 0; i < 16; i++) u.value[i] = be[15 - i];
    return u;
}

ble_uuid16_t uuid16(uint16_t v) {
    ble_uuid16_t u{};
    u.u.type = BLE_UUID_TYPE_16;
    u.value = v;
    return u;
}

uint32_t le32(const uint8_t* p) { return p[0] | (p[1] << 8) | (p[2] << 16) | (static_cast<uint32_t>(p[3]) << 24); }

uint32_t ticks(uint32_t ms) { return ble_npl_time_ms_to_ticks32(ms); }

bool hasBond() {
    int n = 0;
    ble_store_util_count(BLE_STORE_OBJ_TYPE_OUR_SEC, &n);
    return n > 0;
}

bool encrypted(uint16_t conn) {
    struct ble_gap_conn_desc d;
    return conn != NO_CONN && ble_gap_conn_find(conn, &d) == 0 && d.sec_state.encrypted;
}

/** Date ANCS « yyyyMMdd'T'HHmmSS » (heure locale de l'iPhone) → epoch. */
int64_t parseDate(const std::string& s) {
    struct tm t{};
    if (sscanf(s.c_str(), "%4d%2d%2dT%2d%2d%2d", &t.tm_year, &t.tm_mon, &t.tm_mday, &t.tm_hour, &t.tm_min, &t.tm_sec) != 6) return 0;
    t.tm_year -= 1900;
    t.tm_mon -= 1;
    t.tm_isdst = -1;
    return static_cast<int64_t>(mktime(&t));
}

/** Nom court de l'application à partir de son identifiant iOS. */
std::string appLabel(const std::string& bundle, uint8_t category) {
    static const struct {
        const char* id;
        const char* label;
    } known[] = {
        {"com.apple.MobileSMS", "MESSAGES"},      {"com.apple.mobilemail", "MAIL"},          {"com.apple.reminders", "RAPPELS"},
        {"com.apple.mobilecal", "CALENDRIER"},    {"com.apple.mobilephone", "TÉLÉPHONE"},     {"com.apple.facetime", "FACETIME"},
        {"com.apple.Health", "SANTÉ"},            {"com.apple.Fitness", "ACTIVITÉ"},          {"com.apple.news", "NEWS"},
        {"com.apple.Home", "MAISON"},             {"com.apple.findmy", "LOCALISER"},          {"com.apple.Passbook", "CARTES"},
        {"com.apple.mobileslideshow", "PHOTOS"},  {"com.apple.shortcuts", "RACCOURCIS"},      {"com.apple.weather", "MÉTÉO"},
        {"net.whatsapp.WhatsApp", "WHATSAPP"},    {"ph.telegra.Telegraph", "TELEGRAM"},       {"com.facebook.Messenger", "MESSENGER"},
        {"com.burbn.instagram", "INSTAGRAM"},     {"com.toyopagroup.picaboo", "SNAPCHAT"},    {"com.hammerandchisel.discord", "DISCORD"},
        {"com.atebits.Tweetie2", "X"},            {"com.google.Gmail", "GMAIL"},              {"com.microsoft.Office.Outlook", "OUTLOOK"},
        {"com.spotify.client", "SPOTIFY"},        {"com.roblox.robloxmobile", "ROBLOX"},      {"com.zhiliaoapp.musically", "TIKTOK"},
        {"com.google.ios.youtube", "YOUTUBE"},    {"com.linkedin.LinkedIn", "LINKEDIN"},      {"com.amazon.Amazon", "AMAZON"},
    };
    for (const auto& k : known)
        if (bundle == k.id) return k.label;
    if (!bundle.empty()) {  // dernier élément de l'identifiant, en majuscules
        std::string last = bundle.substr(bundle.rfind('.') + 1);
        for (char& c : last)
            if (c >= 'a' && c <= 'z') c = static_cast<char>(c - 32);
        if (last.size() > 14) last.resize(14);
        if (!last.empty()) return last;
    }
    static const char* byCategory[] = {"NOTIFICATION", "APPEL", "APPEL MANQUÉ", "MESSAGERIE",     "SOCIAL",   "AGENDA",
                                       "E-MAIL",       "ACTUALITÉS", "SANTÉ",      "FINANCES",       "LIEUX",    "DIVERTISSEMENT"};
    return category < 12 ? byCategory[category] : "NOTIFICATION";
}

// --- Fonctions de rappel NimBLE (tâche NimBLE) -------------------------------------

void hostTask(void*) {
    nimble_port_run();  // ne rend la main qu'à l'arrêt de la pile
    nimble_port_freertos_deinit();
}

int gapEventCb(struct ble_gap_event* e, void* arg) { return static_cast<IphoneLink*>(arg)->onGapEvent(e); }

/**
 * Quand le lien tombe, NimBLE termine les requêtes en cours avec ENOTCONN avant même
 * l'événement DISCONNECT. Il ne faut alors rien relancer : une requête lancée sur un
 * lien mort expirerait 30 s plus tard et couperait la connexion suivante.
 */
bool linkGone(uint16_t conn, const struct ble_gatt_error* err) {
    return err->status == BLE_HS_ENOTCONN || conn != g_link->conn_;
}

int onMtu(uint16_t, const struct ble_gatt_error* err, uint16_t mtu, void*) {
    if (err->status == 0) ESP_LOGI(TAG, "MTU %u", mtu);
    return 0;
}

int onSvc(uint16_t conn, const struct ble_gatt_error* err, const struct ble_gatt_svc* svc, void* arg) {
    auto* L = static_cast<IphoneLink*>(arg);
    if (linkGone(conn, err)) return 0;
    if (err->status == 0 && svc) {
        L->svcStart_ = svc->start_handle;
        L->svcEnd_ = svc->end_handle;
        return 0;
    }
    if (err->status == BLE_HS_EDONE && L->svcStart_) {
        L->chrList_.clear();
        L->chrKind_.clear();
        if (ble_gattc_disc_all_chrs(conn, L->svcStart_, L->svcEnd_, [](uint16_t c, const struct ble_gatt_error* e, const struct ble_gatt_chr* chr, void* a) {
                auto* L = static_cast<IphoneLink*>(a);
                if (linkGone(c, e)) return 0;
                if (e->status == 0 && chr) {
                    L->chrList_.push_back({chr->def_handle, chr->val_handle, 0, 0});
                    int kind = ble_uuid_cmp(&chr->uuid.u, &g_ancsNs.u) == 0   ? 1
                               : ble_uuid_cmp(&chr->uuid.u, &g_ancsCp.u) == 0 ? 2
                               : ble_uuid_cmp(&chr->uuid.u, &g_ancsDs.u) == 0 ? 3
                                                                              : 0;
                    L->chrKind_.push_back(kind);
                    return 0;
                }
                if (e->status != BLE_HS_EDONE) {
                    ESP_LOGW(TAG, "découverte des caractéristiques : erreur %d", e->status);
                    L->retryDiscovery(3000);
                    return 0;
                }
                for (size_t i = 0; i < L->chrList_.size(); i++) {
                    IphoneLink::Chr ch = L->chrList_[i];
                    ch.end = i + 1 < L->chrList_.size() ? L->chrList_[i + 1].def - 1 : L->svcEnd_;
                    if (L->chrKind_[i] == 1) L->ns_ = ch;
                    else if (L->chrKind_[i] == 2) L->cp_ = ch;
                    else if (L->chrKind_[i] == 3) L->ds_ = ch;
                }
                if (!L->ns_.val || !L->cp_.val || !L->ds_.val) {
                    L->setStatus(HINT_SHARE);
                    L->retryDiscovery(30000);
                    return 0;
                }
                L->discoverDescriptors(0);
                return 0;
            }, L) != 0)
            L->retryDiscovery(3000);
        return 0;
    }
    // Service introuvable : iOS ne l'expose qu'une fois l'accessoire associé et autorisé.
    if (L->discoveryRetries_++ < 3) {
        L->retryDiscovery(3000);
    } else {
        L->setStatus(HINT_SHARE);
        L->retryDiscovery(30000);  // il suffit d'activer le partage sur l'iPhone
    }
    return 0;
}

int onDsc(uint16_t conn, const struct ble_gatt_error* err, uint16_t, const struct ble_gatt_dsc* dsc, void* arg) {
    auto* L = static_cast<IphoneLink*>(arg);
    if (linkGone(conn, err)) return 0;
    IphoneLink::Chr& c = L->dscStep_ == 0 ? L->ds_ : L->ns_;
    if (err->status == 0 && dsc) {
        if (dsc->uuid.u.type == BLE_UUID_TYPE_16 && ble_uuid_u16(&dsc->uuid.u) == BLE_GATT_DSC_CLT_CFG_UUID16) c.cccd = dsc->handle;
        return 0;
    }
    if (!c.cccd) c.cccd = c.val + 1;  // emplacement habituel
    if (L->dscStep_ == 0) L->discoverDescriptors(1);
    else L->subscribe(0);
    return 0;
}

int onSubscribed(uint16_t conn, const struct ble_gatt_error* err, struct ble_gatt_attr*, void* arg) {
    auto* L = static_cast<IphoneLink*>(arg);
    if (linkGone(conn, err)) return 0;
    if (err->status != 0) {
        // Typiquement « autorisation insuffisante » : partage des notifications désactivé.
        ESP_LOGW(TAG, "abonnement refusé (%d)", err->status);
        L->setStatus(HINT_SHARE);
        L->retryDiscovery(30000);
        return 0;
    }
    if (L->dscStep_ == 0) L->subscribe(1);
    else L->onReady();
    return 0;
}

int onCpWrite(uint16_t conn, const struct ble_gatt_error* err, struct ble_gatt_attr*, void* arg) {
    IphoneLink* L = g_link;
    if (linkGone(conn, err)) return 0;
    L->cpWriting_ = false;
    bool forFetch = arg != nullptr;
    if (forFetch && err->status != 0) {
        // Notification déjà disparue (erreur ANCS 0xA2, paramètre invalide) : on passe à la suivante.
        ESP_LOGD(TAG, "Control Point : erreur %d", err->status);
        L->fetching_ = false;
        L->dsBuf_.clear();
        ble_npl_callout_stop(&g_fetchTimeout);
    }
    L->sendPendingAction();
    L->fetchNext();
    return 0;
}

std::string attrString(struct ble_gatt_attr* attr) {
    if (!attr || !attr->om) return "";
    uint16_t len = OS_MBUF_PKTLEN(attr->om);
    std::string s(len, '\0');
    ble_hs_mbuf_to_flat(attr->om, s.data(), len, nullptr);
    return s;
}

int onBattery(uint16_t conn, const struct ble_gatt_error* err, struct ble_gatt_attr* attr, void* arg) {
    auto* L = static_cast<IphoneLink*>(arg);
    if (linkGone(conn, err)) return 0;
    if (err->status == 0 && attr) {
        std::string v = attrString(attr);
        if (!v.empty()) {
            std::lock_guard<std::mutex> lock(L->mutex_);
            L->st_.battery = static_cast<uint8_t>(v[0]);
        }
        L->bump();
        return 0;
    }
    L->infoBusy_ = false;
    L->sendPendingAction();
    L->fetchNext();
    return 0;
}

int onName(uint16_t conn, const struct ble_gatt_error* err, struct ble_gatt_attr* attr, void* arg) {
    auto* L = static_cast<IphoneLink*>(arg);
    if (linkGone(conn, err)) return 0;
    if (err->status == 0 && attr) {
        std::string name = attrString(attr);
        if (!name.empty()) {
            std::lock_guard<std::mutex> lock(L->mutex_);
            L->st_.name = name;
        }
        L->bump();
        return 0;
    }
    // Fin (ou erreur) : on lit ensuite la batterie, si l'iPhone l'expose.
    if (ble_gattc_read_by_uuid(conn, 1, 0xFFFF, &g_uuidBattery.u, onBattery, L) != 0) {
        L->infoBusy_ = false;
        L->fetchNext();
    }
    return 0;
}

// --- Événements postés depuis l'interface, minuteries -----------------------------

void dropUnencryptedLink(IphoneLink* L) {
    // Un appareil connecté mais pas (encore) associé occupe l'unique place.
    if (L->conn_ != NO_CONN && !encrypted(L->conn_)) ble_gap_terminate(L->conn_, BLE_ERR_REM_USER_CONN_TERM);
}

void evUpdate(struct ble_npl_event*) {
    IphoneLink* L = g_link;
    if (!L->enabled_ && L->conn_ != NO_CONN) ble_gap_terminate(L->conn_, BLE_ERR_REM_USER_CONN_TERM);
    if (!L->pairing_) {
        ble_npl_callout_stop(&g_pairTimeout);
        L->justPaired_ = false;
        dropUnencryptedLink(L);  // association annulée en cours de route
    }
    L->updateAdvertising();
}

void evPair(struct ble_npl_event*) {
    IphoneLink* L = g_link;
    ble_npl_callout_reset(&g_pairTimeout, ticks(120000));
    // L'iPhone déjà connecté laisse la place à celui qu'on associe.
    if (L->conn_ != NO_CONN) ble_gap_terminate(L->conn_, BLE_ERR_REM_USER_CONN_TERM);
    L->updateAdvertising();
}

void evForget(struct ble_npl_event*) {
    IphoneLink* L = g_link;
    L->pairing_ = false;
    L->justPaired_ = false;
    ble_npl_callout_stop(&g_pairTimeout);
    ble_addr_t peers[MAX_BONDS];
    int count = 0;
    if (ble_store_util_bonded_peers(peers, &count, MAX_BONDS) == 0)
        for (int i = 0; i < count; i++) ble_gap_unpair(&peers[i]);  // coupe aussi la liaison
    if (L->conn_ != NO_CONN) ble_gap_terminate(L->conn_, BLE_ERR_REM_USER_CONN_TERM);
    ble_store_clear();
    {
        std::lock_guard<std::mutex> lock(L->mutex_);
        bool enabled = L->st_.enabled;
        L->st_ = hal::PhoneState{};
        L->st_.supported = true;
        L->st_.enabled = enabled;
    }
    L->bump();
    L->updateAdvertising();
}

void evAction(struct ble_npl_event*) { g_link->sendPendingAction(); }

void pairTimeout(struct ble_npl_event*) {
    IphoneLink* L = g_link;
    if (!L->pairing_) return;
    L->pairing_ = false;
    L->justPaired_ = false;
    {
        std::lock_guard<std::mutex> lock(L->mutex_);
        L->st_.pairing = false;
        L->st_.pairingCode.clear();
        if (!L->st_.paired) L->st_.status = "Délai dépassé : touche à nouveau « Associer un iPhone ».";
    }
    L->bump();
    dropUnencryptedLink(L);
    L->updateAdvertising();
}

void secTimeout(struct ble_npl_event*) { dropUnencryptedLink(g_link); }

void fetchTimeout(struct ble_npl_event*) {
    IphoneLink* L = g_link;
    if (!L->fetching_) return;
    ESP_LOGW(TAG, "détails de la notification %lu non reçus", static_cast<unsigned long>(L->fetchUid_));
    L->fetching_ = false;
    L->dsBuf_.clear();
    L->fetchNext();
}

void rediscover(struct ble_npl_event*) {
    IphoneLink* L = g_link;
    if (L->conn_ != NO_CONN && !L->ready_ && encrypted(L->conn_)) L->startDiscovery();
}

void batteryTick(struct ble_npl_event*) {
    IphoneLink* L = g_link;
    if (L->conn_ == NO_CONN) return;
    ble_npl_callout_reset(&g_batteryTimer, ticks(10 * 60 * 1000));
    if (!L->ready_ || L->fetching_ || L->cpWriting_ || L->infoBusy_) return;
    L->infoBusy_ = true;
    if (ble_gattc_read_by_uuid(L->conn_, 1, 0xFFFF, &g_uuidBattery.u, onBattery, L) != 0) L->infoBusy_ = false;
}

void retryFetch(struct ble_npl_event*) { g_link->fetchNext(); }

void advRetry(struct ble_npl_event*) { g_link->updateAdvertising(); }

}  // namespace

// ---------------------------------------------------------------- démarrage

void IphoneLink::begin(bool enabled) {
    g_link = this;
    enabled_ = enabled;
    startUs_ = esp_timer_get_time();
    {
        std::lock_guard<std::mutex> lock(mutex_);
        st_.supported = true;
        st_.enabled = enabled;
    }
    g_ancsSvc = uuid128("7905F431-B5CE-4E99-A40F-4B1E122D00D0");
    g_ancsNs = uuid128("9FBF120D-6301-42D9-8C58-25E699A21DBD");
    g_ancsCp = uuid128("69D1D8F3-45E1-49A8-9821-9BBDFDAAD9D9");
    g_ancsDs = uuid128("22EAC6E9-24D6-4BB5-BE44-B36ACE7C7BFB");
    g_uuidName = uuid16(0x2A00);
    g_uuidBattery = uuid16(0x2A19);

    esp_err_t err = nimble_port_init();  // le HCI passe par ESP-Hosted (SDIO) jusqu'à l'ESP32-C6
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "Bluetooth indisponible : %s", esp_err_to_name(err));
        std::lock_guard<std::mutex> lock(mutex_);
        st_.supported = false;
        st_.status = "Bluetooth indisponible";
        return;
    }
    ble_hs_cfg.reset_cb = [](int reason) { g_link->onReset(reason); };
    ble_hs_cfg.sync_cb = [] { g_link->onSync(); };
    ble_hs_cfg.store_status_cb = ble_store_util_status_rr;
    // La tablette affiche un code que l'on saisit sur l'iPhone (Secure Connections + MITM).
    ble_hs_cfg.sm_io_cap = BLE_SM_IO_CAP_DISP_ONLY;
    ble_hs_cfg.sm_bonding = 1;
    ble_hs_cfg.sm_mitm = 1;
    ble_hs_cfg.sm_sc = 1;
    ble_hs_cfg.sm_our_key_dist = BLE_SM_PAIR_KEY_DIST_ENC | BLE_SM_PAIR_KEY_DIST_ID;
    ble_hs_cfg.sm_their_key_dist = BLE_SM_PAIR_KEY_DIST_ENC | BLE_SM_PAIR_KEY_DIST_ID;

    ble_svc_gap_init();
    ble_svc_gatt_init();
    ble_svc_gap_device_name_set(DEVICE_NAME);
    ble_store_config_init();  // associations conservées dans la NVS

    struct ble_npl_eventq* q = nimble_port_get_dflt_eventq();
    ble_npl_event_init(&g_evUpdate, evUpdate, nullptr);
    ble_npl_event_init(&g_evPair, evPair, nullptr);
    ble_npl_event_init(&g_evForget, evForget, nullptr);
    ble_npl_event_init(&g_evAction, evAction, nullptr);
    ble_npl_callout_init(&g_pairTimeout, q, pairTimeout, nullptr);
    ble_npl_callout_init(&g_fetchTimeout, q, fetchTimeout, nullptr);
    ble_npl_callout_init(&g_rediscover, q, rediscover, nullptr);
    ble_npl_callout_init(&g_batteryTimer, q, batteryTick, nullptr);
    ble_npl_callout_init(&g_retryFetch, q, retryFetch, nullptr);
    ble_npl_callout_init(&g_secTimeout, q, secTimeout, nullptr);
    ble_npl_callout_init(&g_advRetry, q, advRetry, nullptr);

    nimble_port_freertos_init(hostTask);
}

void IphoneLink::onReset(int reason) {
    ESP_LOGW(TAG, "pile Bluetooth réinitialisée (%d)", reason);
    synced_ = false;
    resetLink();
}

void IphoneLink::onSync() {
    ble_hs_util_ensure_addr(0);
    ble_hs_id_infer_auto(0, &ownAddrType_);
    synced_ = true;
    {
        std::lock_guard<std::mutex> lock(mutex_);
        st_.supported = true;
        st_.paired = hasBond();
    }
    bump();
    ESP_LOGI(TAG, "Bluetooth prêt (%s)", hasBond() ? "iPhone associé" : "aucun iPhone associé");
    updateAdvertising();
}

void IphoneLink::setStatus(const std::string& s) {
    {
        std::lock_guard<std::mutex> lock(mutex_);
        st_.status = s;
    }
    bump();
}

// On ne se rend visible que si un iPhone est associé (pour qu'il se reconnecte) ou
// pendant l'association demandée depuis la tablette.
void IphoneLink::updateAdvertising() {
    if (!synced_) return;
    bool want = enabled_ && conn_ == NO_CONN && (pairing_ || hasBond());
    bool active = ble_gap_adv_active();
    if (!want) {
        if (active) ble_gap_adv_stop();
        return;
    }
    if (active) return;

    // Données d'annonce : drapeaux + « sollicitation » du service ANCS, qui fait apparaître
    // la tablette dans Réglages › Bluetooth de l'iPhone.
    uint8_t adv[31];
    int n = 0;
    adv[n++] = 2;
    adv[n++] = BLE_HS_ADV_TYPE_FLAGS;
    adv[n++] = BLE_HS_ADV_F_DISC_GEN | BLE_HS_ADV_F_BREDR_UNSUP;
    adv[n++] = 17;
    adv[n++] = 0x15;  // liste de sollicitations de services 128 bits
    memcpy(adv + n, g_ancsSvc.value, 16);
    n += 16;
    ble_gap_adv_set_data(adv, n);

    struct ble_hs_adv_fields rsp{};
    rsp.name = reinterpret_cast<const uint8_t*>(DEVICE_NAME);
    rsp.name_len = static_cast<uint8_t>(strlen(DEVICE_NAME));
    rsp.name_is_complete = 1;
    ble_gap_adv_rsp_set_fields(&rsp);

    struct ble_gap_adv_params p{};
    p.conn_mode = BLE_GAP_CONN_MODE_UND;
    p.disc_mode = BLE_GAP_DISC_MODE_GEN;
    p.itvl_min = pairing_ ? 0x00A0 : 0x0140;  // 100 ms pendant l'association, sinon 200 ms
    p.itvl_max = pairing_ ? 0x00F0 : 0x01E0;
    int rc = ble_gap_adv_start(ownAddrType_, nullptr, BLE_HS_FOREVER, &p, gapEventCb, this);
    if (rc != 0) {
        ESP_LOGW(TAG, "annonce impossible (%d), nouvel essai", rc);
        ble_npl_callout_reset(&g_advRetry, ticks(2000));
    }
}

// ---------------------------------------------------------------- événements GAP

int IphoneLink::onGapEvent(struct ble_gap_event* e) {
    switch (e->type) {
        case BLE_GAP_EVENT_CONNECT:
            if (e->connect.status == 0) {
                conn_ = e->connect.conn_handle;
                ESP_LOGI(TAG, "connexion Bluetooth");
                // Sans chiffrement dans le délai (iPhone inconnu, scanner…), on libère la place.
                ble_npl_callout_reset(&g_secTimeout, ticks(pairing_ ? 90000 : 20000));
                ble_gattc_exchange_mtu(conn_, onMtu, nullptr);
                ble_gap_security_initiate(conn_);  // chiffrement (associé) ou association (code)
            } else {
                conn_ = NO_CONN;
                updateAdvertising();
            }
            return 0;

        case BLE_GAP_EVENT_DISCONNECT:
            ESP_LOGI(TAG, "déconnexion (%d)", e->disconnect.reason);
            resetLink();
            updateAdvertising();
            return 0;

        case BLE_GAP_EVENT_ADV_COMPLETE:
            updateAdvertising();
            return 0;

        case BLE_GAP_EVENT_ENC_CHANGE: {
            uint16_t conn = e->enc_change.conn_handle;
            int status = e->enc_change.status;
            if (status == BLE_HS_ENOTCONN) return 0;  // le lien est déjà tombé
            if (status != 0) {
                ESP_LOGW(TAG, "chiffrement / association échoué (%d)", status);
                if (status == BLE_HS_ENOENT) {
                    // L'iPhone garde une ancienne association que la tablette n'a plus.
                    setStatus(HINT_IPHONE_KEYS);
                } else if (status == BLE_HS_HCI_ERR(BLE_ERR_PINKEY_MISSING)) {
                    // Clés refusées : l'association de la tablette ne sert plus à rien.
                    struct ble_gap_conn_desc d;
                    if (ble_gap_conn_find(conn, &d) == 0) ble_store_util_delete_peer(&d.peer_id_addr);
                    setStatus(HINT_IPHONE_KEYS);
                } else if (justPaired_) {
                    {
                        std::lock_guard<std::mutex> lock(mutex_);
                        st_.pairingCode.clear();
                        st_.status = "Association interrompue (code incorrect ou annulé sur l’iPhone). Réessaie depuis l’iPhone.";
                    }
                    bump();
                }
                // Autres cas (lien perdu, délai…) : on coupe sans toucher à l'association.
                justPaired_ = false;
                ble_gap_terminate(conn, BLE_ERR_REM_USER_CONN_TERM);
                return 0;
            }
            ble_npl_callout_stop(&g_secTimeout);
            if (pairing_ && !justPaired_) {
                // Un ancien iPhone associé s'est reconnecté pendant qu'on en associe un autre.
                ble_gap_terminate(conn, BLE_ERR_REM_USER_CONN_TERM);
                return 0;
            }
            if (justPaired_) {
                // Un seul iPhone à la fois : les anciennes associations sont oubliées.
                struct ble_gap_conn_desc d;
                ble_addr_t peers[MAX_BONDS];
                int count = 0;
                if (ble_gap_conn_find(conn, &d) == 0 && ble_store_util_bonded_peers(peers, &count, MAX_BONDS) == 0)
                    for (int i = 0; i < count; i++)
                        if (ble_addr_cmp(&peers[i], &d.peer_id_addr) != 0) ble_store_util_delete_peer(&peers[i]);
                justPaired_ = false;
                pairing_ = false;
                ble_npl_callout_stop(&g_pairTimeout);
                ESP_LOGI(TAG, "iPhone associé");
            }
            {
                std::lock_guard<std::mutex> lock(mutex_);
                st_.pairing = false;
                st_.pairingCode.clear();
                st_.paired = true;
                st_.linked = true;
                st_.status.clear();
            }
            bump();
            discoveryRetries_ = 0;
            startDiscovery();
            return 0;
        }

        case BLE_GAP_EVENT_PASSKEY_ACTION: {
            uint16_t conn = e->passkey.conn_handle;
            if (!pairing_) {
                setStatus("Touche « Associer un iPhone » sur la tablette avant d’associer l’iPhone.");
                ble_gap_terminate(conn, BLE_ERR_REM_USER_CONN_TERM);
                return 0;
            }
            struct ble_sm_io io{};
            char code[8];
            if (e->passkey.params.action == BLE_SM_IOACT_DISP) {
                io.action = BLE_SM_IOACT_DISP;
                io.passkey = esp_random() % 1000000;
                snprintf(code, sizeof code, "%06lu", static_cast<unsigned long>(io.passkey));
            } else if (e->passkey.params.action == BLE_SM_IOACT_NUMCMP) {
                io.action = BLE_SM_IOACT_NUMCMP;
                io.numcmp_accept = 1;
                snprintf(code, sizeof code, "%06lu", static_cast<unsigned long>(e->passkey.params.numcmp));
            } else {
                ble_gap_terminate(conn, BLE_ERR_REM_USER_CONN_TERM);
                return 0;
            }
            justPaired_ = true;
            {
                std::lock_guard<std::mutex> lock(mutex_);
                st_.pairingCode = code;
                st_.status.clear();
            }
            bump();
            ble_sm_inject_io(conn, &io);
            return 0;
        }

        case BLE_GAP_EVENT_REPEAT_PAIRING: {
            // L'iPhone a oublié la tablette et demande une nouvelle association.
            if (!pairing_) {
                setStatus(HINT_FORGOTTEN);
                ble_gap_terminate(e->repeat_pairing.conn_handle, BLE_ERR_REM_USER_CONN_TERM);
                return BLE_GAP_REPEAT_PAIRING_IGNORE;
            }
            struct ble_gap_conn_desc d;
            if (ble_gap_conn_find(e->repeat_pairing.conn_handle, &d) == 0) ble_store_util_delete_peer(&d.peer_id_addr);
            return BLE_GAP_REPEAT_PAIRING_RETRY;
        }

        case BLE_GAP_EVENT_NOTIFY_RX: {
            uint16_t len = OS_MBUF_PKTLEN(e->notify_rx.om);
            std::vector<uint8_t> buf(len);
            ble_hs_mbuf_to_flat(e->notify_rx.om, buf.data(), len, nullptr);
            if (e->notify_rx.attr_handle == ns_.val) onNotificationSource(buf.data(), len);
            else if (e->notify_rx.attr_handle == ds_.val) onDataSource(buf.data(), len);
            return 0;
        }

        default:
            return 0;
    }
}

// Les identifiants de notification ANCS ne valent que pour une connexion : tout ce qui
// en dépend est remis à zéro ici. L'historique des appels, lui, est conservé.
void IphoneLink::resetLink() {
    conn_ = NO_CONN;
    ready_ = false;
    justPaired_ = false;
    fetching_ = false;
    cpWriting_ = false;
    infoBusy_ = false;
    queue_.clear();
    dsBuf_.clear();
    categories_.clear();
    ns_ = cp_ = ds_ = Chr{};
    svcStart_ = svcEnd_ = 0;
    incomingAt_ = 0;
    ble_npl_callout_stop(&g_fetchTimeout);
    ble_npl_callout_stop(&g_batteryTimer);
    ble_npl_callout_stop(&g_rediscover);
    ble_npl_callout_stop(&g_secTimeout);
    ble_npl_callout_stop(&g_retryFetch);
    {
        std::lock_guard<std::mutex> lock(mutex_);
        st_.linked = false;
        st_.connected = false;
        st_.notifications.clear();
        st_.incomingUid = 0;
        st_.incomingName.clear();
        st_.pairingCode.clear();
        st_.paired = hasBond();
        actions_.clear();
        actedCalls_.clear();
    }
    bump();
}

// ---------------------------------------------------------------- découverte ANCS

void IphoneLink::startDiscovery() {
    svcStart_ = svcEnd_ = 0;
    ns_ = cp_ = ds_ = Chr{};
    dscStep_ = 0;
    if (ble_gattc_disc_svc_by_uuid(conn_, &g_ancsSvc.u, onSvc, this) != 0) retryDiscovery(3000);
}

void IphoneLink::retryDiscovery(uint32_t ms) {
    if (conn_ != NO_CONN) ble_npl_callout_reset(&g_rediscover, ticks(ms));
}

void IphoneLink::discoverDescriptors(int step) {
    dscStep_ = step;
    Chr& c = step == 0 ? ds_ : ns_;
    if (c.end <= c.val || ble_gattc_disc_all_dscs(conn_, c.val, c.end, onDsc, this) != 0) {
        if (!c.cccd) c.cccd = c.val + 1;
        if (step == 0) discoverDescriptors(1);
        else subscribe(0);
    }
}

// Abonnement : Data Source d'abord (réponses détaillées), puis Notification Source.
void IphoneLink::subscribe(int step) {
    dscStep_ = step;
    const Chr& c = step == 0 ? ds_ : ns_;
    static const uint8_t on[2] = {1, 0};
    if (ble_gattc_write_flat(conn_, c.cccd, on, sizeof on, onSubscribed, this) != 0) retryDiscovery(3000);
}

void IphoneLink::onReady() {
    ESP_LOGI(TAG, "notifications de l’iPhone actives");
    ready_ = true;
    {
        std::lock_guard<std::mutex> lock(mutex_);
        st_.connected = true;
        st_.status.clear();
    }
    bump();
    readDeviceInfo();
    ble_npl_callout_reset(&g_batteryTimer, ticks(10 * 60 * 1000));
}

void IphoneLink::readDeviceInfo() {
    infoBusy_ = true;
    if (ble_gattc_read_by_uuid(conn_, 1, 0xFFFF, &g_uuidName.u, onName, this) != 0) {
        infoBusy_ = false;
        fetchNext();
    }
}

// ---------------------------------------------------------------- notifications

void IphoneLink::onNotificationSource(const uint8_t* d, size_t n) {
    if (n < 8) return;
    uint8_t event = d[0], flags = d[1], category = d[2];
    uint32_t uid = le32(d + 4);
    queue_.erase(std::remove_if(queue_.begin(), queue_.end(), [uid](const std::pair<uint32_t, uint8_t>& q) { return q.first == uid; }),
                 queue_.end());
    if (event == EVT_REMOVED) {
        categories_.erase(uid);
        bool callEnded = false;
        {
            std::lock_guard<std::mutex> lock(mutex_);
            auto& v = st_.notifications;
            v.erase(std::remove_if(v.begin(), v.end(), [uid](const hal::PhoneNotification& x) { return x.uid == uid; }), v.end());
            callEnded = st_.incomingUid == uid;
        }
        if (callEnded) {
            // Fin de la sonnerie : l'appel est noté dans l'historique (remplacé par
            // « Appel manqué » si iOS envoie ensuite la notification correspondante).
            std::string name, detail;
            {
                std::lock_guard<std::mutex> lock(mutex_);
                auto acted = actedCalls_.find(uid);
                detail = acted == actedCalls_.end() ? "Appel entrant" : acted->second ? "Appel accepté" : "Appel refusé";
                name = st_.incomingName;
                st_.incomingUid = 0;
                st_.incomingName.clear();
                actedCalls_.erase(uid);
            }
            addCall(name, detail, incomingAt_ ? incomingAt_ : static_cast<int64_t>(time(nullptr)), false);
            incomingAt_ = 0;
        }
        bump();
        return;
    }
    categories_[uid] = category;
    // Priorité : appel entrant, puis nouvelles notifications, puis celles déjà présentes
    // sur l'iPhone à la connexion (pour qu'un nouveau message n'attende pas leur lecture).
    uint8_t prio = category == CAT_INCOMING_CALL ? 0 : (flags & FLAG_PRE_EXISTING) ? 2 : 1;
    auto pos = std::find_if(queue_.begin(), queue_.end(), [prio](const std::pair<uint32_t, uint8_t>& q) { return q.second > prio; });
    queue_.insert(pos, {uid, prio});
    if (queue_.size() > QUEUE_MAX) queue_.pop_back();  // la moins prioritaire
    fetchNext();
}

void IphoneLink::fetchNext() {
    if (!ready_ || fetching_ || cpWriting_ || infoBusy_ || queue_.empty() || conn_ == NO_CONN || !cp_.val) return;
    uint32_t uid = queue_.front().first;
    uint8_t prio = queue_.front().second;
    queue_.pop_front();
    uint8_t cmd[16];
    size_t n = 0;
    cmd[n++] = CMD_GET_NOTIF_ATTRS;
    for (int i = 0; i < 4; i++) cmd[n++] = static_cast<uint8_t>(uid >> (8 * i));
    cmd[n++] = ATTR_APP;
    cmd[n++] = ATTR_TITLE;
    cmd[n++] = 64;
    cmd[n++] = 0;
    cmd[n++] = ATTR_MESSAGE;
    cmd[n++] = 200;
    cmd[n++] = 0;
    cmd[n++] = ATTR_DATE;
    cmd[n++] = ATTR_POS;
    cmd[n++] = ATTR_NEG;
    fetching_ = true;
    cpWriting_ = true;
    fetchUid_ = uid;
    dsBuf_.clear();
    if (ble_gattc_write_flat(conn_, cp_.val, cmd, static_cast<uint16_t>(n), onCpWrite, this) != 0) {
        fetching_ = false;
        cpWriting_ = false;
        queue_.push_front({uid, prio});
        ble_npl_callout_reset(&g_retryFetch, ticks(500));
        return;
    }
    ble_npl_callout_reset(&g_fetchTimeout, ticks(4000));
}

void IphoneLink::onDataSource(const uint8_t* d, size_t n) {
    if (!fetching_) return;
    if (dsBuf_.empty() && (n < 5 || d[0] != CMD_GET_NOTIF_ATTRS || le32(d + 1) != fetchUid_)) return;  // reste d'une réponse abandonnée
    dsBuf_.insert(dsBuf_.end(), d, d + n);
    std::map<uint8_t, std::string> attrs;
    size_t pos = 5;
    for (size_t i = 0; i < sizeof WANTED; i++) {
        if (pos + 3 > dsBuf_.size()) return;  // la suite arrive dans le paquet suivant
        uint8_t id = dsBuf_[pos];
        size_t len = dsBuf_[pos + 1] | (dsBuf_[pos + 2] << 8);
        if (pos + 3 + len > dsBuf_.size()) return;
        attrs[id] = std::string(reinterpret_cast<const char*>(dsBuf_.data() + pos + 3), len);
        pos += 3 + len;
    }
    uint32_t uid = fetchUid_;
    fetching_ = false;
    dsBuf_.clear();
    ble_npl_callout_stop(&g_fetchTimeout);
    handleAttributes(uid, attrs);
    sendPendingAction();
    fetchNext();
}

void IphoneLink::addCall(const std::string& rawName, const std::string& detail, int64_t at, bool missed) {
    std::string name = rawName.empty() ? "Numéro inconnu" : rawName;
    {
        std::lock_guard<std::mutex> lock(mutex_);
        auto& v = st_.calls;
        // Déjà noté (iOS renvoie les appels manqués à chaque reconnexion) ?
        for (const hal::PhoneCall& c : v)
            if (c.name == name && c.at == at && c.missed == missed) return;
        if (missed) {
            // Remplace l'« Appel entrant » noté à la fin de la sonnerie du même appel.
            v.erase(std::remove_if(v.begin(), v.end(),
                                   [&](const hal::PhoneCall& c) {
                                       return !c.missed && c.name == name && c.detail == "Appel entrant" &&
                                              std::llabs(static_cast<long long>(c.at - at)) < 300;
                                   }),
                    v.end());
        }
        auto it = std::find_if(v.begin(), v.end(), [at](const hal::PhoneCall& c) { return c.at < at; });  // du plus récent au plus ancien
        v.insert(it, {name, detail, at, missed});
        if (v.size() > 10) v.resize(10);
    }
    bump();
}

void IphoneLink::handleAttributes(uint32_t uid, const std::map<uint8_t, std::string>& a) {
    auto get = [&a](uint8_t id) {
        auto it = a.find(id);
        return it == a.end() ? std::string() : it->second;
    };
    auto cat = categories_.find(uid);
    if (cat == categories_.end()) return;  // supprimée entre-temps
    uint8_t category = cat->second;
    std::string title = get(ATTR_TITLE);
    int64_t at = parseDate(get(ATTR_DATE));
    if (at == 0) at = static_cast<int64_t>(time(nullptr));

    if (category == CAT_INCOMING_CALL) {
        incomingAt_ = at;
        {
            std::lock_guard<std::mutex> lock(mutex_);
            st_.incomingUid = uid;
            st_.incomingName = title.empty() ? "Appel entrant" : title;
        }
        bump();
        return;
    }
    if (category == CAT_MISSED_CALL) {
        addCall(title, "Appel manqué", at, true);
        return;
    }
    hal::PhoneNotification n;
    n.uid = uid;
    n.app = appLabel(get(ATTR_APP), category);
    n.title = title.empty() ? n.app : title;
    n.body = get(ATTR_MESSAGE);
    n.at = at;
    n.positiveLabel = get(ATTR_POS);
    n.negativeLabel = get(ATTR_NEG);
    {
        std::lock_guard<std::mutex> lock(mutex_);
        auto& v = st_.notifications;
        v.erase(std::remove_if(v.begin(), v.end(), [uid](const hal::PhoneNotification& x) { return x.uid == uid; }), v.end());
        auto it = std::find_if(v.begin(), v.end(), [at](const hal::PhoneNotification& x) { return x.at < at; });
        v.insert(it, n);
        if (v.size() > 30) v.resize(30);
    }
    bump();
}

// ---------------------------------------------------------------- actions

void IphoneLink::sendPendingAction() {
    if (!ready_ || cpWriting_ || conn_ == NO_CONN || !cp_.val) return;
    std::pair<uint32_t, bool> act;
    {
        std::lock_guard<std::mutex> lock(mutex_);
        if (actions_.empty()) return;
        act = actions_.front();
        actions_.pop_front();
        if (act.first == st_.incomingUid) actedCalls_[act.first] = act.second;
    }
    uint8_t cmd[6] = {CMD_PERFORM_ACTION, 0, 0, 0, 0, static_cast<uint8_t>(act.second ? 0 : 1)};
    for (int i = 0; i < 4; i++) cmd[1 + i] = static_cast<uint8_t>(act.first >> (8 * i));
    cpWriting_ = true;
    if (ble_gattc_write_flat(conn_, cp_.val, cmd, sizeof cmd, onCpWrite, nullptr) != 0) cpWriting_ = false;
}

// ---------------------------------------------------------------- appels depuis l'interface

hal::PhoneState IphoneLink::state() {
    std::lock_guard<std::mutex> lock(mutex_);
    hal::PhoneState s = st_;
    s.enabled = enabled_;
    s.pairing = pairing_;
    if (!synced_ && s.supported && esp_timer_get_time() - startUs_ > 20LL * 1000000) {
        s.supported = false;
        s.status = "Le Bluetooth de l’ESP32-C6 ne répond pas.";
    }
    return s;
}

void IphoneLink::setEnabled(bool on) {
    enabled_ = on;
    if (!on) pairing_ = false;
    {
        std::lock_guard<std::mutex> lock(mutex_);
        st_.enabled = on;
    }
    bump();
    ble_npl_eventq_put(nimble_port_get_dflt_eventq(), &g_evUpdate);
}

void IphoneLink::startPairing() {
    enabled_ = true;
    pairing_ = true;
    {
        std::lock_guard<std::mutex> lock(mutex_);
        st_.enabled = true;
        st_.pairing = true;
        st_.pairingCode.clear();
        st_.status.clear();
    }
    bump();
    ble_npl_eventq_put(nimble_port_get_dflt_eventq(), &g_evPair);
}

void IphoneLink::cancelPairing() {
    pairing_ = false;
    {
        std::lock_guard<std::mutex> lock(mutex_);
        st_.pairing = false;
        st_.pairingCode.clear();
    }
    bump();
    ble_npl_eventq_put(nimble_port_get_dflt_eventq(), &g_evUpdate);
}

void IphoneLink::forget() { ble_npl_eventq_put(nimble_port_get_dflt_eventq(), &g_evForget); }

void IphoneLink::action(uint32_t uid, bool positive) {
    {
        std::lock_guard<std::mutex> lock(mutex_);
        actions_.push_back({uid, positive});
        if (actions_.size() > 10) actions_.pop_front();
        if (!positive) {  // effacer : retiré tout de suite de l'écran
            auto& v = st_.notifications;
            v.erase(std::remove_if(v.begin(), v.end(), [uid](const hal::PhoneNotification& x) { return x.uid == uid; }), v.end());
        }
    }
    bump();
    ble_npl_eventq_put(nimble_port_get_dflt_eventq(), &g_evAction);
}
