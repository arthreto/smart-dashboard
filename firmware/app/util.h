// Petits utilitaires : SHA-256 (vérification locale du code PIN) et dates en français.
#pragma once

#include <cstdint>
#include <ctime>
#include <string>

namespace util {

std::string sha256Hex(const std::string& data);

std::string base64Encode(const std::string& data);
/** Décode du base64 standard ; chaîne vide si invalide. */
std::string base64Decode(const std::string& text);

struct tm localNow();
std::string hhmm(const struct tm& t);
/** « Samedi 17 octobre » */
std::string longDate(const struct tm& t);
/** « samedi », « lundi »… */
std::string weekdayName(int wday, bool capitalize = false);
std::string monthName(int mon);
/** 0 = lundi … 6 = dimanche */
int weekdayMon0(const struct tm& t);
/** Minutes depuis minuit pour « HH:MM » (-1 si invalide). */
int minutesOf(const std::string& hhmm);
/** Vrai si l'heure locale est dans la plage [start, end) (gère le passage de minuit). */
bool inWindow(const struct tm& t, const std::string& start, const std::string& end);
/** « dans 1 h 48 », « dans 25 h 18 min » */
std::string inDelay(int64_t seconds);
/** « à l'instant », « il y a 5 min », « 07:10 », « Hier », « Jeu. », « 12/10 » (0 → ""). */
std::string relativeTime(int64_t epoch);
/** « 3:58 » */
std::string mmss(int ms);
/** Date « 2026-10-17 » → « mer. 21 octobre » */
std::string shortFrenchDate(const std::string& isoDate);
/** « Aujourd’hui », « Demain » ou « Lun. 20 » pour une date AAAA-MM-JJ. */
std::string relativeDay(const std::string& isoDate);
/** Date AAAA-MM-JJ décalée de n jours (n négatif possible). */
std::string addDaysIso(const std::string& isoDate, int n);
/** Date AAAA-MM-JJ d'un struct tm. */
std::string isoDate(const struct tm& t);
/** struct tm (à midi) d'une date AAAA-MM-JJ ; false si invalide. */
bool parseIso(const std::string& isoDate, struct tm& out);

}  // namespace util
