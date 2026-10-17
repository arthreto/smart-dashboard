// Émulateur PC : fenêtre 1280×720 identique à l'écran du Tab5.
//
//   ./smart_dashboard_sim                 → assistant d'appairage (ou dernier serveur utilisé)
//   ./smart_dashboard_sim --demo          → données d'exemple, sans serveur
//   ./smart_dashboard_sim --server https://mon-domaine.fr --token sdb_…
//   ./smart_dashboard_sim --reset         → oublie l'appairage
//   ./smart_dashboard_sim --screenshots out/  → captures de tous les écrans (données d'exemple) puis quitte
//   ./smart_dashboard_sim --live --screenshots out/  → idem avec les données du serveur appairé
//
// Raccourcis clavier : B = bouton du boîtier, R = tester une alarme, L = verrouiller,
//                      S = capture d'écran (fichier .ppm), Échap = fermer les superpositions,
//                      N = notification de l'iPhone simulé, P = appel entrant simulé.
#include <SDL2/SDL.h>

#include <atomic>
#include <cstdio>
#include <cstring>
#include <filesystem>
#include <string>
#include <thread>

#include "app.h"
#include "hal_desktop.h"
#include "lvgl.h"

namespace {

std::atomic<int> g_key{0};

int SDLCALL keyWatch(void*, SDL_Event* e) {
    if (e->type == SDL_KEYDOWN && !e->key.repeat) {
        SDL_Keycode k = e->key.keysym.sym;
        if (k == SDLK_b || k == SDLK_r || k == SDLK_l || k == SDLK_s || k == SDLK_n || k == SDLK_p || k == SDLK_ESCAPE)
            g_key = static_cast<int>(k);
    }
    return 1;
}

/** Écrit l'image affichée (tampon RGB565 de LVGL) dans un fichier PPM. */
bool writeFrame(lv_display_t* disp, const std::string& file) {
    lv_refr_now(disp);
    lv_draw_buf_t* buf = lv_display_get_buf_active(disp);
    if (!buf) return false;
    int w = buf->header.w, h = buf->header.h;
    FILE* f = std::fopen(file.c_str(), "wb");
    if (!f) return false;
    std::fprintf(f, "P6\n%d %d\n255\n", w, h);
    for (int y = 0; y < h; y++) {
        const uint16_t* row = reinterpret_cast<const uint16_t*>(buf->data + static_cast<size_t>(y) * buf->header.stride);
        for (int x = 0; x < w; x++) {
            uint16_t v = row[x];
            unsigned char px[3] = {static_cast<unsigned char>(((v >> 11) & 0x1F) * 255 / 31),
                                   static_cast<unsigned char>(((v >> 5) & 0x3F) * 255 / 63),
                                   static_cast<unsigned char>((v & 0x1F) * 255 / 31)};
            std::fwrite(px, 1, 3, f);
        }
    }
    std::fclose(f);
    return true;
}

void spin(int ms) {
    uint32_t until = SDL_GetTicks() + ms;
    while (SDL_GetTicks() < until) {
        lv_timer_handler();
        SDL_Delay(5);
    }
}

}  // namespace

int main(int argc, char** argv) {
    std::string server, token, shotsDir;
    bool demo = false, reset = false, mute = false, live = false;
    for (int i = 1; i < argc; i++) {
        std::string a = argv[i];
        if (a == "--demo") demo = true;
        else if (a == "--reset") reset = true;
        else if (a == "--mute") mute = true;
        else if (a == "--live") live = true;
        else if (a == "--server" && i + 1 < argc) server = argv[++i];
        else if (a == "--token" && i + 1 < argc) token = argv[++i];
        else if (a == "--screenshots" && i + 1 < argc) shotsDir = argv[++i];
        else if (a == "--help" || a == "-h") {
            std::printf("Usage : smart_dashboard_sim [--demo] [--server URL --token JETON] [--reset] [--mute] [--screenshots DOSSIER [--live]]\n");
            return 0;
        }
    }

    static DesktopHal platform;
    platform.setMuted(mute || !shotsDir.empty());
    hal::install(&platform);
    if (reset) {
        platform.save("token", "");
        platform.save("demo", "0");
        platform.save("state_cache", "");
    }
    if (!server.empty()) platform.save("api_url", server);
    if (!token.empty()) {
        platform.save("token", token);
        platform.save("demo", "0");
    }
    if (demo || (!shotsDir.empty() && !live)) platform.save("demo", "1");

    lv_init();
    lv_display_t* disp = lv_sdl_window_create(1280, 720);
    lv_sdl_window_set_title(disp, "Smart Dashboard — émulateur Tab5 (B bouton · R alarme · L verrou · N notification · P appel)");
    lv_indev_t* mouse = lv_sdl_mouse_create();
    lv_indev_t* kb = lv_sdl_keyboard_create();
    (void)mouse;
    lv_group_t* g = lv_group_create();
    lv_group_set_default(g);
    lv_indev_set_group(kb, g);
    SDL_AddEventWatch(keyWatch, nullptr);

    App::get().init();

    if (!shotsDir.empty()) {
        std::filesystem::create_directories(shotsDir);
        struct Shot {
            Screen s;
            const char* name;
        } shots[] = {{Screen::Home, "01-accueil"},    {Screen::Tasks, "03-taches"},   {Screen::Calendar, "04-calendrier"},
                     {Screen::Alarm, "05-reveil"},    {Screen::Phone, "06-iphone"},   {Screen::Stats, "07-statistiques"},
                     {Screen::Settings, "08-reglages"}, {Screen::Music, "09-musique"}, {Screen::Cinema, "10-cinema"}};
        App::get().debugCloseOverlays();
        if (live) spin(4000);  // première synchronisation avec le serveur
        platform.simulatePaired();
        for (const Shot& s : shots) {
            App::get().navigate(s.s);
            spin(400);
            writeFrame(disp, shotsDir + "/" + s.name + ".ppm");
        }
        App::get().navigate(Screen::Home);
        spin(200);
        App::get().lock();
        spin(300);
        writeFrame(disp, shotsDir + "/02-verrouillage.ppm");
        App::get().debugCloseOverlays();
        App::get().debugRing();
        spin(300);
        writeFrame(disp, shotsDir + "/05b-alarme.ppm");
        App::get().debugCloseOverlays();
        App::get().openSetup();
        spin(300);
        writeFrame(disp, shotsDir + "/00-appairage.ppm");
        App::get().debugCloseOverlays();
        // Thème clair
        App::get().state().settings.theme = "light";
        App::get().updateSettings("{}");
        struct Shot lightShots[] = {{Screen::Home, "11-accueil-clair"}, {Screen::Tasks, "12-taches-clair"}, {Screen::Music, "13-musique-clair"}};
        for (const Shot& s : lightShots) {
            App::get().navigate(s.s);
            spin(400);
            writeFrame(disp, shotsDir + "/" + s.name + ".ppm");
        }
        App::get().state().settings.theme = "dark";
        App::get().updateSettings("{}");
        // iPhone : bandeau de notification, appel entrant, association
        App::get().navigate(Screen::Home);
        spin(300);
        platform.simulateNotification();
        spin(500);
        writeFrame(disp, shotsDir + "/14-bandeau-iphone.ppm");
        platform.simulateIncomingCall();
        spin(500);
        writeFrame(disp, shotsDir + "/15-appel-entrant.ppm");
        App::get().debugCloseOverlays();
        platform.phoneForget();
        App::get().navigate(Screen::Phone);
        spin(400);
        writeFrame(disp, shotsDir + "/16-iphone-associer.ppm");
        App::get().ui.phonePairingSinceMs = platform.millis();
        platform.phoneStartPairing();
        spin(3600);
        writeFrame(disp, shotsDir + "/17-iphone-code.ppm");
        platform.simulatePaired();
        std::printf("Captures écrites dans %s\n", shotsDir.c_str());
        return 0;
    }

    int shot = 0;
    for (;;) {
        uint32_t wait = lv_timer_handler();
        int key = g_key.exchange(0);
        if (key == SDLK_b) App::get().onButton();
        else if (key == SDLK_r) App::get().debugRing();
        else if (key == SDLK_l) App::get().lock();
        else if (key == SDLK_ESCAPE) App::get().debugCloseOverlays();
        else if (key == SDLK_n) platform.simulateNotification();
        else if (key == SDLK_p) platform.simulateIncomingCall();
        else if (key == SDLK_s) {
            std::string f = "capture-" + std::to_string(++shot) + ".ppm";
            if (writeFrame(disp, f)) std::printf("Capture enregistrée : %s\n", f.c_str());
        }
        SDL_Delay(wait < 5 ? wait : 5);
    }
}
