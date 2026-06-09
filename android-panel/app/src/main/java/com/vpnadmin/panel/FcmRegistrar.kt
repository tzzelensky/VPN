package com.vpnadmin.panel

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.webkit.WebView
import com.google.firebase.messaging.FirebaseMessaging
import org.json.JSONObject

object FcmRegistrar {

    private const val TAG = "VpnAdminFcm"
    private val handler = Handler(Looper.getMainLooper())

    fun registerIfLoggedIn(context: Context, webView: WebView? = null) {
        scheduleAttempt(context, webView, 0)
    }

    private fun scheduleAttempt(context: Context, webView: WebView?, attempt: Int) {
        val delays = longArrayOf(0, 2_000, 5_000, 12_000, 30_000)
        if (attempt >= delays.size) return
        handler.postDelayed({ tryRegister(context, webView, attempt) }, delays[attempt])
    }

    private fun tryRegister(context: Context, webView: WebView?, attempt: Int) {
        val panelUrl = PanelUrlStore.get(context)
        if (panelUrl.isNullOrBlank()) {
            scheduleAttempt(context, webView, attempt + 1)
            return
        }
        if (!PanelCookieHelper.hasSession(panelUrl)) {
            if (attempt < 4) scheduleAttempt(context, webView, attempt + 1)
            return
        }

        FirebaseMessaging.getInstance().token.addOnCompleteListener { task ->
            if (!task.isSuccessful) {
                Log.w(TAG, "FCM token failed: ${task.exception?.message}")
                scheduleAttempt(context, webView, attempt + 1)
                return@addOnCompleteListener
            }
            val token = task.result?.trim().orEmpty()
            if (token.length < 20) return@addOnCompleteListener

            val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            val prev = prefs.getString(KEY_TOKEN, "")
            if (prev == token && prefs.getBoolean(KEY_SERVER_OK, false)) return@addOnCompleteListener

            if (webView != null) {
                registerViaWebView(webView, token) { ok ->
                    Log.i(TAG, "register via WebView ok=$ok attempt=$attempt")
                    onRegisterResult(context, token, ok, webView, attempt)
                }
            } else {
                val ok = PanelPushApi.registerToken(panelUrl, token)
                Log.i(TAG, "register via HTTP ok=$ok attempt=$attempt")
                onRegisterResult(context, token, ok, webView, attempt)
            }
        }
    }

    private fun onRegisterResult(
        context: Context,
        token: String,
        ok: Boolean,
        webView: WebView?,
        attempt: Int,
    ) {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        if (ok) {
            prefs.edit().putString(KEY_TOKEN, token).putBoolean(KEY_SERVER_OK, true).apply()
            AppealPollWorker.schedule(context)
        } else {
            prefs.edit().putBoolean(KEY_SERVER_OK, false).apply()
            if (attempt < 4) scheduleAttempt(context, webView, attempt + 1)
        }
    }

    /** Cookie сессии надёжно уходит только из fetch внутри WebView. */
    private fun registerViaWebView(webView: WebView, token: String, callback: (Boolean) -> Unit) {
        val body = JSONObject.quote(token)
        val js =
            """
            (function(){
              return fetch('/api/push/register', {
                method: 'POST',
                credentials: 'include',
                headers: {'Content-Type':'application/json'},
                body: JSON.stringify({token:$body})
              })
              .then(function(r){ return r.ok; })
              .catch(function(){ return false; });
            })()
            """.trimIndent()
        webView.evaluateJavascript(js) { raw ->
            val ok = raw == "true"
            callback(ok)
        }
    }

    private const val PREFS = "vpn_admin_fcm"
    private const val KEY_TOKEN = "registered_token"
    private const val KEY_SERVER_OK = "server_ok"
}
