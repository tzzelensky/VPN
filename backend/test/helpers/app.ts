import type { Express } from "express";
import { initDb, resetStoreForTests } from "../../src/db.ts";
import { initSurveyDb } from "../../src/surveyDb.ts";
import { initPanelSettings } from "../../src/panelSettings.ts";
import { initDailyGiftStore } from "../../src/dailyGiftStore.ts";
import { initAutoCommunicationsStore } from "../../src/autoCommunicationsStore.ts";
import { initTriggerMailingsStore } from "../../src/triggerMailingsStore.ts";
import { initTriggerMailingsHistoryStore } from "../../src/triggerMailingsHistoryStore.ts";
import { createApp } from "../../src/createApp.ts";

let appSingleton: Express | null = null;

export function getTestApp(): Express {
  if (!appSingleton) {
    initDb();
    initSurveyDb();
    initPanelSettings();
    initDailyGiftStore();
    initAutoCommunicationsStore();
    initTriggerMailingsStore();
    initTriggerMailingsHistoryStore();
    appSingleton = createApp({ mountSwagger: false });
  }
  return appSingleton;
}

export function resetTestData(): void {
  resetStoreForTests();
  initDb();
  initSurveyDb();
  initPanelSettings();
  initDailyGiftStore();
  initAutoCommunicationsStore();
  initTriggerMailingsStore();
  initTriggerMailingsHistoryStore();
}
