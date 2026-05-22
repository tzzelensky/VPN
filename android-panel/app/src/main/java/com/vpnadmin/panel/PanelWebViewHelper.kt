package com.vpnadmin.panel

import android.annotation.SuppressLint
import android.webkit.WebSettings
import android.webkit.WebView

object PanelWebViewHelper {

    const val USER_AGENT_SUFFIX = " VpnAdminPanel/1.0"

    @SuppressLint("SetJavaScriptEnabled")
    fun configure(webView: WebView) {
        val settings = webView.settings
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        settings.useWideViewPort = true
        settings.loadWithOverviewMode = true
        settings.builtInZoomControls = false
        settings.displayZoomControls = false
        settings.textZoom = 100
        settings.cacheMode = WebSettings.LOAD_DEFAULT
        settings.mixedContentMode = WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE
        val ua = settings.userAgentString
        if (ua != null && !ua.contains("VpnAdminPanel")) {
            settings.userAgentString = ua + USER_AGENT_SUFFIX
        }
        webView.setLayerType(WebView.LAYER_TYPE_HARDWARE, null)
        webView.overScrollMode = WebView.OVER_SCROLL_IF_CONTENT_SCROLLS
    }

    fun injectMobileShell(webView: WebView) {
        val js = """
            (function() {
              var root = document.documentElement;
              root.classList.add('admin-mobile-app');
              var m = document.querySelector('meta[name="viewport"]');
              if (!m) {
                m = document.createElement('meta');
                m.setAttribute('name', 'viewport');
                document.head.appendChild(m);
              }
              m.setAttribute('content',
                'width=device-width, initial-scale=1, maximum-scale=5, viewport-fit=cover');
              root.style.setProperty('-webkit-tap-highlight-color', 'transparent');
            })();
        """.trimIndent()
        webView.evaluateJavascript(js, null)
    }

    fun hasSessionCookie(panelUrl: String): Boolean {
        val cookies = android.webkit.CookieManager.getInstance().getCookie(panelUrl) ?: return false
        return cookies.contains("tzadmin.sid=")
    }
}
