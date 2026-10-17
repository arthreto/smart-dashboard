// Apparence des applications de l'iPhone (icône + couleur), partagée entre la page
// iPhone, le bandeau de notification et l'écran d'appel.
#pragma once

#include <string>

#include "ui.h"

namespace phone_style {

inline lv_color_t appColor(const std::string& app) {
    if (app == "MESSAGES" || app == "FACETIME" || app == "TÉLÉPHONE") return ui::color::green();
    if (app == "WHATSAPP") return lv_color_hex(0x25D366);
    if (app == "MAIL" || app == "GMAIL") return ui::color::blue();
    if (app == "RAPPELS") return ui::color::orange();
    if (app == "CALENDRIER") return ui::color::red();
    if (app == "ACTIVITÉ" || app == "SANTÉ") return lv_color_hex(0xFF375F);
    if (app == "SPOTIFY") return lv_color_hex(0x1DB954);
    return ui::color::indigo();
}

inline const char* appIcon(const std::string& app) {
    if (app == "MESSAGES" || app == "MESSENGER" || app == "TELEGRAM" || app == "DISCORD" || app == "SNAPCHAT") return ICON_CHAT;
    if (app == "WHATSAPP") return ICON_WHATSAPP;
    if (app == "MAIL" || app == "GMAIL" || app == "OUTLOOK") return ICON_MAIL;
    if (app == "RAPPELS") return ICON_LIST;
    if (app == "CALENDRIER") return ICON_CALENDAR;
    if (app == "TÉLÉPHONE" || app == "FACETIME") return ICON_PHONE;
    if (app == "ACTIVITÉ" || app == "SANTÉ") return ICON_HEART_FILLED;
    if (app == "SPOTIFY") return ICON_MUSIC;
    return ICON_BELL;
}

/** Initiales d'un contact (« Maman » → « M », « Léa Martin » → « LM »). */
inline std::string initials(const std::string& name) {
    std::string out;
    int count = 0;
    bool start = true;
    for (size_t i = 0; i < name.size() && count < 2; i++) {
        unsigned char c = static_cast<unsigned char>(name[i]);
        if (c == ' ') {
            start = true;
            continue;
        }
        if (!start) continue;
        start = false;
        if ((c >= '0' && c <= '9') || c == '+') return "";  // numéro : pas d'initiales
        size_t len = c < 0x80 ? 1 : (c >> 5) == 6 ? 2 : (c >> 4) == 14 ? 3 : 4;  // caractère UTF-8 entier
        std::string ch = name.substr(i, len);
        if (len == 1 && c >= 'a' && c <= 'z') ch[0] = static_cast<char>(c - 32);
        out += ch;
        count++;
    }
    return out;
}

}  // namespace phone_style
