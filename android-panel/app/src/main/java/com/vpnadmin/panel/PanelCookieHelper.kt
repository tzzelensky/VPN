package com.vpnadmin.panel

import android.net.Uri
import android.webkit.CookieManager

object PanelCookieHelper {

    fun sessionCookieHeader(panelUrl: String): String? {
        CookieManager.getInstance().flush()
        val uri = Uri.parse(panelUrl.trimEnd('/'))
        val hostBase = "${uri.scheme}://${uri.host}"
        val candidates = listOf(hostBase, "$hostBase/", panelUrl.trimEnd('/'), "$panelUrl/")
        for (url in candidates) {
            val raw = CookieManager.getInstance().getCookie(url)?.trim().orEmpty()
            if (raw.contains("tzadmin.sid=")) return raw
        }
        return null
    }

    fun hasSession(panelUrl: String): Boolean = sessionCookieHeader(panelUrl) != null
}
