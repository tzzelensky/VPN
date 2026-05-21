package com.vpnadmin.panel

import android.content.Context
import android.net.Uri

object PanelUrlStore {
    private const val PREFS = "vpn_admin_panel"
    private const val KEY_URL = "panel_url"

    fun get(context: Context): String? {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val saved = prefs.getString(KEY_URL, null)?.trim()
        if (!saved.isNullOrEmpty()) return saved

        val baked = context.getString(R.string.panel_url).trim()
        if (baked.isNotEmpty() && !baked.contains("ВАШ_ДОМЕН") && baked.startsWith("http")) {
            return normalize(baked)
        }
        return null
    }

    fun save(context: Context, url: String) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .putString(KEY_URL, url)
            .apply()
    }

    fun normalize(raw: String): String? {
        var s = raw.trim()
        if (s.isEmpty()) return null
        if (!s.startsWith("http://") && !s.startsWith("https://")) {
            s = "https://$s"
        }
        return try {
            val uri = Uri.parse(s)
            if (uri.host.isNullOrBlank()) return null
            val builder = uri.buildUpon().clearQuery().fragment("")
            var out = builder.build().toString()
            out = out.trimEnd('/')
            out
        } catch (_: Exception) {
            null
        }
    }
}
