package com.vpnadmin.panel

import android.webkit.JavascriptInterface
import androidx.appcompat.app.AppCompatActivity

/** Связь WebView ↔ нативный код (регистрация FCM после входа). */
class PanelJsBridge(private val activity: MainActivity) {

    @JavascriptInterface
    fun onPanelLoggedIn() {
        activity.runOnUiThread {
            activity.registerPushToken()
        }
    }
}
