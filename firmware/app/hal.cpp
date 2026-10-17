#include "hal.h"

#include <cstdlib>

namespace hal {

namespace {
Hal* g_impl = nullptr;
}

Hal& get() {
    if (!g_impl) std::abort();  // la plateforme doit appeler hal::install() au démarrage
    return *g_impl;
}

void install(Hal* impl) { g_impl = impl; }

}  // namespace hal
