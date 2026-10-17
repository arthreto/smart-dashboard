# L'interface (dossier firmware/app) est commune à l'émulateur PC et à la tablette :
# on compile ici les mêmes sources, plus la couche matérielle propre au Tab5.
set(APP_DIR ${CMAKE_CURRENT_LIST_DIR}/../../../app)

file(GLOB APP_SOURCES
  ${APP_DIR}/*.cpp
  ${APP_DIR}/screens/*.cpp
  ${APP_DIR}/fonts/*.c)

# Pas de REQUIRES : le composant « main » dépend alors de tous les composants du
# projet (BSP, LVGL, Wi-Fi distant via l'ESP32-C6, client HTTP…).
idf_component_register(
  SRCS
    "main.cpp"
    "hal_tab5.cpp"
    "rx8130.cpp"
    "iphone_ble.cpp"
    ${APP_SOURCES}
    ${APP_DIR}/third_party/cjson/cJSON.c
  INCLUDE_DIRS "." ${APP_DIR})

target_compile_definitions(${COMPONENT_LIB} PRIVATE SD_FIRMWARE_VERSION="${PROJECT_VER}")
target_compile_options(${COMPONENT_LIB} PRIVATE -Wno-missing-field-initializers -Wno-unused-parameter)
