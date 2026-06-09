package com.vpnadmin.panel

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat

object AppealNotifier {

    private const val CHANNEL_ID = "support_appeals"
    private const val NOTIFICATION_ID = 41001

    fun ensureChannel(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val channel =
            NotificationChannel(
                CHANNEL_ID,
                context.getString(R.string.appeal_notify_channel),
                NotificationManager.IMPORTANCE_DEFAULT,
            ).apply {
                description = context.getString(R.string.appeal_notify_channel_desc)
            }
        val nm = context.getSystemService(NotificationManager::class.java)
        nm?.createNotificationChannel(channel)
    }

    fun showNewAppeals(context: Context, panelUrl: String, count: Int) {
        if (count <= 0) return
        val title = context.getString(R.string.appeal_notify_title)
        val text =
            if (count == 1) {
                context.getString(R.string.appeal_notify_one)
            } else {
                context.getString(R.string.appeal_notify_many, count)
            }
        showPush(context, "/support-appeals", title, text)
    }

    fun showPush(context: Context, openPath: String, title: String, body: String) {
        ensureChannel(context)

        val open =
            Intent(context, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
                putExtra(MainActivity.EXTRA_OPEN_PATH, openPath)
            }
        val pending =
            PendingIntent.getActivity(
                context,
                0,
                open,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )

        val notification =
            NotificationCompat.Builder(context, CHANNEL_ID)
                .setSmallIcon(R.drawable.ic_stat_appeal)
                .setContentTitle(title)
                .setContentText(body)
                .setStyle(NotificationCompat.BigTextStyle().bigText(body))
                .setContentIntent(pending)
                .setAutoCancel(true)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setCategory(NotificationCompat.CATEGORY_MESSAGE)
                .build()

        try {
            NotificationManagerCompat.from(context).notify(NOTIFICATION_ID, notification)
        } catch (_: SecurityException) {
            /* POST_NOTIFICATIONS not granted */
        }
    }
}
