# Émulateur PC de l'écran (SDL2 + LVGL 9). La tablette, elle, se compile avec
# ESP-IDF depuis platforms/tab5 (voir docs/FIRMWARE.md).
cmake_minimum_required(VERSION 3.16)
project(smart_dashboard_sim C CXX)

set(CMAKE_C_STANDARD 11)
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
if(NOT CMAKE_BUILD_TYPE)
  set(CMAKE_BUILD_TYPE Release)
endif()

include(FetchContent)
set(LV_CONF_BUILD_DISABLE_EXAMPLES ON CACHE BOOL "" FORCE)
set(LV_CONF_BUILD_DISABLE_DEMOS ON CACHE BOOL "" FORCE)
set(LV_CONF_BUILD_DISABLE_THORVG_INTERNAL ON CACHE BOOL "" FORCE)
FetchContent_Declare(lvgl
  GIT_REPOSITORY https://github.com/lvgl/lvgl.git
  GIT_TAG v9.2.2
  GIT_SHALLOW TRUE)
FetchContent_MakeAvailable(lvgl)
target_compile_definitions(lvgl PUBLIC LV_CONF_INCLUDE_SIMPLE)
target_include_directories(lvgl PUBLIC ${CMAKE_CURRENT_SOURCE_DIR})

find_package(PkgConfig REQUIRED)
pkg_check_modules(SDL2 REQUIRED sdl2)
find_package(CURL REQUIRED)
find_package(Threads REQUIRED)
find_package(OpenSSL REQUIRED)  # chiffrement des vidéos de la galerie
target_include_directories(lvgl PUBLIC ${SDL2_INCLUDE_DIRS})

file(GLOB APP_SOURCES
  ${CMAKE_CURRENT_SOURCE_DIR}/app/*.cpp
  ${CMAKE_CURRENT_SOURCE_DIR}/app/screens/*.cpp)
file(GLOB FONT_SOURCES ${CMAKE_CURRENT_SOURCE_DIR}/app/fonts/*.c)

add_executable(smart_dashboard_sim
  ${APP_SOURCES}
  ${FONT_SOURCES}
  ${CMAKE_CURRENT_SOURCE_DIR}/app/third_party/cjson/cJSON.c
  ${CMAKE_CURRENT_SOURCE_DIR}/platforms/desktop/main.cpp
  ${CMAKE_CURRENT_SOURCE_DIR}/platforms/desktop/hal_desktop.cpp)

target_include_directories(smart_dashboard_sim PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/app)
target_compile_definitions(smart_dashboard_sim PRIVATE LV_LVGL_H_INCLUDE_SIMPLE SD_FIRMWARE_VERSION="0.1.0-sim")
target_link_libraries(smart_dashboard_sim PRIVATE lvgl ${SDL2_LIBRARIES} CURL::libcurl OpenSSL::Crypto Threads::Threads m)
target_link_directories(smart_dashboard_sim PRIVATE ${SDL2_LIBRARY_DIRS})
