package com.vpnadmin.panel

import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

object AppealBadgeClient {

    fun fetchNewCount(panelUrl: String): Int? {
        val base = panelUrl.trimEnd('/')
        val cookie = PanelCookieHelper.sessionCookieHeader(base) ?: return null

        val conn =
            (URL("$base/api/support-appeals/badge").openConnection() as HttpURLConnection).apply {
                requestMethod = "GET"
                connectTimeout = 12_000
                readTimeout = 12_000
                setRequestProperty("Cookie", cookie)
                setRequestProperty("Accept", "application/json")
            }
        return try {
            val code = conn.responseCode
            if (code !in 200..299) return null
            val body = conn.inputStream.bufferedReader().use { it.readText() }
            val json = JSONObject(body)
            json.optInt("new_count", 0).coerceAtLeast(0)
        } catch (_: Exception) {
            null
        } finally {
            conn.disconnect()
        }
    }
}
