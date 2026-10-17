# Firmware de la M5Stack Tab5 (ESP32-P4). Compilation : voir docs/FIRMWARE.md
#   . $IDF_PATH/export.sh
#   idf.py set-target esp32p4      (une seule fois)
#   idf.py build flash monitor
cmake_minimum_required(VERSION 3.16)

set(PROJECT_VER "0.1.0")
include($ENV{IDF_PATH}/tools/cmake/project.cmake)
project(smart_dashboard)
