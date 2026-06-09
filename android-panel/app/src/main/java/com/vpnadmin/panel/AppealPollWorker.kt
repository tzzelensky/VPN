package com.vpnadmin.panel

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import java.util.concurrent.TimeUnit

class AppealPollWorker(
    appContext: Context,
    params: WorkerParameters,
) : CoroutineWorker(appContext, params) {

    override suspend fun doWork(): Result {
        val panelUrl = PanelUrlStore.get(applicationContext) ?: return Result.success()
        val count = AppealBadgeClient.fetchNewCount(panelUrl) ?: return Result.success()

        val prefs = applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val prev = prefs.getInt(KEY_LAST_COUNT, 0)
        if (count > prev) {
            AppealNotifier.showNewAppeals(applicationContext, panelUrl, count - prev)
        }
        prefs.edit().putInt(KEY_LAST_COUNT, count).apply()
        return Result.success()
    }

    companion object {
        private const val PREFS = "vpn_admin_appeal_poll"
        private const val KEY_LAST_COUNT = "last_new_count"
        private const val WORK_NAME = "appeal_poll"

        fun schedule(context: Context) {
            val req =
                PeriodicWorkRequestBuilder<AppealPollWorker>(3, TimeUnit.MINUTES)
                    .build()
            WorkManager.getInstance(context).enqueueUniquePeriodicWork(
                WORK_NAME,
                ExistingPeriodicWorkPolicy.KEEP,
                req,
            )
        }

        fun runNow(context: Context) {
            WorkManager.getInstance(context).enqueue(
                androidx.work.OneTimeWorkRequestBuilder<AppealPollWorker>().build(),
            )
        }

        /** После открытия раздела «Обращения» — не дублировать уведомления по уже известным. */
        fun ackCurrent(context: Context) {
            val panelUrl = PanelUrlStore.get(context) ?: return
            val count = AppealBadgeClient.fetchNewCount(panelUrl) ?: return
            context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .edit()
                .putInt(KEY_LAST_COUNT, count)
                .apply()
        }
    }
}
