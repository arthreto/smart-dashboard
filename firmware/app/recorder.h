// Enregistrements de la galerie, chiffrés de bout en bout.
//
// Demandé depuis la console (commande « record_start » avec la clé publique du compte) :
//   1. clé AES-256 propre à la vidéo + préfixe de nonce (8 octets), tirés au hasard ;
//      les deux sont chiffrés avec la clé publique RSA-OAEP du compte et envoyés au serveur,
//      qui ne peut pas les lire ;
//   2. la caméra et le micro produisent des paquets H.264 / AAC, rangés dans un flux simple
//      (« SDV1 », voir ci-dessous) ;
//   3. toutes les ~3 s, le flux accumulé est chiffré en AES-256-GCM (nonce = préfixe +
//      numéro du morceau, données associées = « sdv1:<vidéo>:<n>:<dernier> ») et envoyé.
//      Les coupures réseau sont rattrapées (le flux attend en mémoire, 12 Mo au plus).
//
// Format SDV1 (après déchiffrement et concaténation des morceaux) :
//   "SDV1" | u32 LE longueur | JSON {"w","h","fps","rate","ch","asc"}
//   puis des paquets : u8 type (1 vidéo, 2 son) | u8 drapeaux (1 = image clé)
//                      | i64 LE horodatage (µs) | u32 LE longueur | données
// La vidéo est en H.264 Annex B, le son en AAC-LC brut : le navigateur en fait un MP4.
#pragma once

#include <string>

namespace recorder {

struct Status {
    bool active = false;     // capture ou envoi en cours
    bool stopping = false;   // arrêt demandé, derniers morceaux en cours d'envoi
    int seconds = 0;         // durée enregistrée
    int backlogKb = 0;       // données en attente d'envoi
    bool offline = false;    // le dernier envoi a échoué (nouvel essai en cours)
};

/** Démarre un enregistrement (thread de l'interface). Faux si un autre est en cours. */
bool start(const std::string& videoId, const std::string& publicKeyB64);
/** Arrêt demandé sur la tablette. */
void stop();
Status status();
/** Message à afficher une fois (fin, erreur) ; vide sinon. Thread de l'interface. */
std::string takeNotice(bool* isError);

}  // namespace recorder
