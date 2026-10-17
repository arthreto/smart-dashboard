import type { DB } from './db.js';
import { createAlarm } from './alarms.js';
import { createHabit } from './habits.js';

const ALL = [true, true, true, true, true, true, true];
const WEEKDAYS = [true, true, true, true, true, false, false];

/** Données de départ (modifiables ensuite dans la console) : seulement si la base est vide. */
export function seedDefaults(db: DB): void {
  const hasHabits = (db.prepare('SELECT COUNT(*) AS n FROM habits').get() as { n: number }).n > 0;
  if (!hasHabits) {
    const habits = [
      { name: 'Faire son lit', icon: 'bed', color: '#0FA5C8', days: ALL, goal: 'Matin', remindTimes: ['08:00'] },
      { name: 'Boire 2 L d’eau', icon: 'drop', color: '#0A84FF', days: ALL, goal: '', remindTimes: ['10:00', '15:00'] },
      { name: 'Méditation', icon: 'moon', color: '#BF5AF2', days: ALL, goal: '10 min', remindTimes: ['07:30'] },
      { name: 'Anglais', icon: 'chat', color: '#FF9F0A', days: WEEKDAYS, goal: '15 min', remindTimes: ['19:00'] },
      { name: 'Bloc de travail', icon: 'briefcase', color: '#2F6FE0', days: WEEKDAYS, goal: '2 h', remindTimes: ['09:00'] },
      { name: 'Séance de sport', icon: 'dumbbell', color: '#28A745', days: [true, false, true, false, true, true, false], goal: '45 min', remindTimes: ['09:00'] },
      { name: 'Lecture', icon: 'book', color: '#E5484D', days: ALL, goal: '20 pages', remindTimes: ['21:30'] },
      { name: 'Ranger le bureau', icon: 'sparkles', color: '#5E5CE6', days: ALL, goal: '10 min', remindTimes: ['18:00'] },
    ];
    for (const h of habits) createHabit(db, { ...h, showOnDevice: true });
  }
  const hasAlarms = (db.prepare('SELECT COUNT(*) AS n FROM alarms').get() as { n: number }).n > 0;
  if (!hasAlarms) {
    createAlarm(db, { time: '06:45', label: 'Semaine', days: WEEKDAYS, sound: 'aube', enabled: true });
    createAlarm(db, { time: '09:00', label: 'Dimanche', days: [false, false, false, false, false, false, true], sound: 'carillon', enabled: true });
    createAlarm(db, { time: '07:15', label: 'Sport du matin', days: [false, true, false, true, false, false, false], sound: 'pulsation', enabled: false });
    createAlarm(db, { time: '22:45', label: 'Rappel coucher', days: ALL, sound: 'douce', enabled: false });
  }
}
