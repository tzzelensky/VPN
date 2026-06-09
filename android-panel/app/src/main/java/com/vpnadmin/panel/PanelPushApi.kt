package com.vpnadmin.panel

import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

object PanelPushApi {

    fun registerToken(panelUrl: String, fcmToken: String): Boolean {
        val base = panelUrl.trimEnd('/')
        val cookie = PanelCookieHelper.sessionCookieHeader(base) ?: return false

        val conn =
            (URL("$base/api/push/register").openConnection() as HttpURLConnection).apply {
                requestMethod = "POST"
                connectTimeout = 15_000
                readTimeout = 15_000
                doOutput = true
                setRequestProperty("Cookie", cookie)
                setRequestProperty("Content-Type", "application/json; charset=utf-8")
                setRequestProperty("Accept", "application/json")
            }
        return try {
            conn.outputStream.use { os ->
                os.write(JSONObject().put("token", fcmToken).toString().toByteArray(Charsets.UTF_8))
            }
            val code = conn.responseCode
            code in 200..299
        } catch (_: Exception) {
            false
        } finally {
            conn.disconnect()
        }
    }
}
