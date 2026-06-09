package com.vpnadmin.panel

import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

class PanelFirebaseMessagingService : FirebaseMessagingService() {

    override fun onNewToken(token: String) {
        FcmRegistrar.registerIfLoggedIn(this)
    }

    override fun onMessageReceived(message: RemoteMessage) {
        val path = message.data["path"] ?: "/support-appeals"
        val title = message.notification?.title ?: message.data["title"] ?: "Новое обращение"
        val body =
            message.notification?.body
                ?: message.data["body"]
                ?: "Поступило обращение в поддержку"

        AppealNotifier.showPush(this, path, title, body)
        AppealPollWorker.ackCurrent(applicationContext)
    }
}
