// Images distantes (affiches de films, pochettes) : téléchargées en JPEG via le
// serveur, décodées en RGB565 dans le thread réseau, puis gardées en cache.
#pragma once

#include <string>

#include "lvgl.h"

namespace images {

/**
 * Crée un cadre de w×h qui affichera l'image dès qu'elle est disponible.
 * `url` est une URL relative au serveur (/api/v1/image?…) ou absolue.
 */
lv_obj_t* create(lv_obj_t* parent, const std::string& url, int w, int h, int radius, lv_color_t placeholder);

/** Couleur de dégradé (which = 0 haut, 1 bas) dérivée de `seed`, pour les pochettes absentes. */
lv_color_t artworkColor(const std::string& seed, int which);

/**
 * Pochette ou affiche : l'image `url` si elle est renseignée, sinon un dégradé
 * déterminé par `seed` (titre de l'album, du film…), pour ne jamais laisser un trou.
 */
lv_obj_t* artwork(lv_obj_t* parent, const std::string& url, const std::string& seed, int w, int h, int radius,
                  lv_color_t placeholder);

/** Libère les images inutilisées (appelé périodiquement). */
void trim();

}  // namespace images
