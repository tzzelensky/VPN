package com.vpnadmin.panel

import android.annotation.SuppressLint
import android.webkit.WebSettings
import android.webkit.WebView

object PanelWebViewHelper {

    @SuppressLint("SetJavaScriptEnabled")
    fun configure(webView: WebView) {
        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            useWideViewPort = true
            loadWithOverviewMode = true
            builtInZoomControls = true
            displayZoomControls = false
            textZoom = 100
            @Suppress("DEPRECATION")
            layoutAlgorithm = WebSettings.LayoutAlgorithm.TEXT_AUTOSIZING
            mixedContentMode = WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE
        }
        webView.setLayerType(WebView.LAYER_TYPE_HARDWARE, null)
        webView.overScrollMode = WebView.OVER_SCROLL_IF_CONTENT_SCROLLS
    }

    /** Подгонка веб-панели под узкий экран Pixel 9 (~412 dp). */
    fun injectMobileViewport(webView: WebView) {
        val js = """
            (function() {
              var m = document.querySelector('meta[name="viewport"]');
              if (!m) {
                m = document.createElement('meta');
                m.setAttribute('name', 'viewport');
                document.head.appendChild(m);
              }
              m.setAttribute('content',
                'width=device-width, initial-scale=1, maximum-scale=5, viewport-fit=cover');
              document.documentElement.style.setProperty('-webkit-tap-highlight-color', 'transparent');
            })();
        """.trimIndent()
        webView.evaluateJavascript(js, null)
    }
}
