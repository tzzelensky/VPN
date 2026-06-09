package com.vpnadmin.panel

import android.annotation.SuppressLint
import android.content.Intent
import android.graphics.Bitmap
import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.view.Menu
import android.view.MenuItem
import android.view.View
import android.webkit.CookieManager
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.ProgressBar
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import com.google.android.material.appbar.MaterialToolbar

class MainActivity : AppCompatActivity() {

    companion object {
        const val EXTRA_OPEN_PATH = "open_path"
    }

    private lateinit var webView: WebView
    private lateinit var progress: ProgressBar
    private var panelUrl: String = ""

    private val requestNotifications =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { _ ->
            registerPushToken()
            AppealPollWorker.runNow(this)
        }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        PanelEdgeToEdge.apply(this, darkTheme = true)

        val url = PanelUrlStore.get(this)
        if (url.isNullOrBlank()) {
            startActivity(Intent(this, SetupActivity::class.java))
            finish()
            return
        }
        panelUrl = url

        AppealNotifier.ensureChannel(this)
        AppealPollWorker.schedule(this)
        maybeRequestNotificationPermission()

        setContentView(R.layout.activity_main)
        val toolbar = findViewById<MaterialToolbar>(R.id.toolbar)
        setSupportActionBar(toolbar)
        PanelEdgeToEdge.bindToolbar(toolbar)

        webView = findViewById(R.id.webView)
        progress = findViewById(R.id.progress)
        PanelEdgeToEdge.bindContentBottom(webView)

        val cookies = CookieManager.getInstance()
        cookies.setAcceptCookie(true)
        cookies.setAcceptThirdPartyCookies(webView, true)
        PanelWebViewHelper.configure(webView)
        webView.addJavascriptInterface(PanelJsBridge(this), "VpnAdminAndroid")

        webView.webChromeClient = object : WebChromeClient() {
            override fun onProgressChanged(view: WebView?, newProgress: Int) {
                if (newProgress in 1..99) {
                    progress.visibility = View.VISIBLE
                    progress.progress = newProgress
                } else {
                    progress.visibility = View.GONE
                }
            }
        }

        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val host = request.url.host ?: return false
                val panelHost = runCatching { android.net.Uri.parse(panelUrl).host }.getOrNull()
                if (panelHost != null && host != panelHost) {
                    startActivity(Intent(Intent.ACTION_VIEW, request.url))
                    return true
                }
                return false
            }

            override fun onPageStarted(view: WebView?, url: String?, favicon: Bitmap?) {
                progress.visibility = View.VISIBLE
                PanelWebViewHelper.injectMobileShell(webView)
            }

            override fun onPageFinished(view: WebView?, url: String?) {
                progress.visibility = View.GONE
                PanelWebViewHelper.injectMobileShell(webView)
                CookieManager.getInstance().flush()
                if (PanelWebViewHelper.hasSessionCookie(panelUrl)) {
                    registerPushToken()
                }
                val path = url?.let { runCatching { android.net.Uri.parse(it).path }.getOrNull() } ?: ""
                if (path?.contains("support-appeals") == true) {
                    AppealPollWorker.ackCurrent(this@MainActivity)
                }
            }
        }

        onBackPressedDispatcher.addCallback(
            this,
            object : OnBackPressedCallback(true) {
                override fun handleOnBackPressed() {
                    if (webView.canGoBack()) webView.goBack() else finish()
                }
            },
        )

        if (savedInstanceState != null) {
            webView.restoreState(savedInstanceState)
        } else {
            webView.loadUrl(resolveStartUrl(intent))
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        if (::webView.isInitialized) {
            PanelUrlStore.get(this)?.let {
                panelUrl = it
                webView.loadUrl(resolveStartUrl(intent))
            }
        }
    }

    override fun onResume() {
        super.onResume()
        if (::webView.isInitialized) {
            webView.onResume()
            webView.resumeTimers()
        }
        CookieManager.getInstance().flush()
        if (PanelWebViewHelper.hasSessionCookie(panelUrl)) {
            registerPushToken()
            AppealPollWorker.runNow(this)
        }
    }

    private fun resolveStartUrl(intent: Intent?): String {
        val deepPath = intent?.getStringExtra(EXTRA_OPEN_PATH)?.trim().orEmpty()
        if (deepPath.isNotEmpty()) {
            return panelUrl.trimEnd('/') + if (deepPath.startsWith("/")) deepPath else "/$deepPath"
        }
        return if (PanelWebViewHelper.hasSessionCookie(panelUrl)) {
            "$panelUrl/servers"
        } else {
            panelUrl
        }
    }

    private fun maybeRequestNotificationPermission() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            registerPushToken()
            return
        }
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) ==
            PackageManager.PERMISSION_GRANTED
        ) {
            registerPushToken()
        } else {
            requestNotifications.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
    }

    override fun onPause() {
        if (::webView.isInitialized) {
            webView.onPause()
            webView.pauseTimers()
        }
        CookieManager.getInstance().flush()
        super.onPause()
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        if (::webView.isInitialized) webView.saveState(outState)
    }

    fun registerPushToken() {
        if (::webView.isInitialized) {
            FcmRegistrar.registerIfLoggedIn(this, webView)
        }
    }

    override fun onCreateOptionsMenu(menu: Menu): Boolean {
        menuInflater.inflate(R.menu.main, menu)
        return true
    }

    override fun onOptionsItemSelected(item: MenuItem): Boolean {
        if (item.itemId == R.id.action_change_url) {
            startActivity(Intent(this, SetupActivity::class.java))
            return true
        }
        return super.onOptionsItemSelected(item)
    }
}
