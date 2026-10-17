// Client HTTP asynchrone : les requêtes tournent dans un thread dédié et leurs
// réponses sont rendues au thread de l'interface (LVGL n'est pas thread-safe).
#pragma once

#include <functional>
#include <string>

#include "hal.h"

namespace api {

using Callback = std::function<void(const hal::HttpResponse&)>;

void start();
/** À appeler depuis le thread de l'interface : exécute les callbacks terminés. */
void pump();

void configure(const std::string& baseUrl, const std::string& token);
bool configured();
std::string baseUrl();
std::string resolve(const std::string& pathOrUrl);

/** Requête JSON authentifiée par le jeton de la tablette (si `auth`). */
void request(const std::string& method, const std::string& path, const std::string& jsonBody, Callback cb, bool auth = true,
             int timeoutMs = 15000);
/** Envoi binaire (capture d'écran). */
void upload(const std::string& path, std::string bytes, const hal::Headers& extraHeaders, Callback cb);

/** En-têtes d'authentification de la tablette (Bearer). */
hal::Headers authHeaders();

/** Exécute `work` dans le thread réseau, puis `done` dans le thread de l'interface. */
void runInWorker(std::function<void()> work, std::function<void()> done);

/** Échappe une chaîne pour l'insérer dans du JSON. */
std::string jsonEscape(const std::string& s);

}  // namespace api
