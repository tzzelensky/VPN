package com.vpnadmin.panel

import android.graphics.Color
import android.view.View
import android.view.ViewGroup
import androidx.activity.SystemBarStyle
import androidx.activity.enableEdgeToEdge
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.updateLayoutParams
import androidx.core.view.updatePadding
import com.google.android.material.appbar.MaterialToolbar

object PanelEdgeToEdge {

    fun apply(activity: AppCompatActivity, darkTheme: Boolean = true) {
        val scrim = if (darkTheme) Color.parseColor("#0c0f14") else Color.parseColor("#f8fafc")
        val style = SystemBarStyle.auto(scrim, scrim)
        activity.enableEdgeToEdge(statusBarStyle = style, navigationBarStyle = style)
    }

    /** Toolbar: отступ под статус-бар и вырез камеры (Pixel 9). */
    fun bindToolbar(toolbar: MaterialToolbar) {
        ViewCompat.setOnApplyWindowInsetsListener(toolbar) { v, insets ->
            val bars = insets.getInsets(
                WindowInsetsCompat.Type.statusBars() or WindowInsetsCompat.Type.displayCutout(),
            )
            v.updatePadding(left = bars.left, top = bars.top, right = bars.right)
            insets
        }
    }

    /** Контент под toolbar: нижний inset под жестовую навигацию. */
    fun bindContentBottom(view: View) {
        ViewCompat.setOnApplyWindowInsetsListener(view) { v, insets ->
            val nav = insets.getInsets(WindowInsetsCompat.Type.navigationBars())
            val ime = insets.getInsets(WindowInsetsCompat.Type.ime())
            val bottom = maxOf(nav.bottom, ime.bottom)
            v.updatePadding(bottom = bottom)
            insets
        }
    }

    /** Экран настройки: все системные отступы + IME. */
    fun bindSetupRoot(root: View, scrollContent: View) {
        ViewCompat.setOnApplyWindowInsetsListener(root) { v, insets ->
            val system = insets.getInsets(
                WindowInsetsCompat.Type.systemBars() or
                    WindowInsetsCompat.Type.displayCutout() or
                    WindowInsetsCompat.Type.ime(),
            )
            v.updatePadding(
                left = system.left,
                top = system.top,
                right = system.right,
                bottom = system.bottom,
            )
            insets
        }
        ViewCompat.setOnApplyWindowInsetsListener(scrollContent) { v, insets ->
            val ime = insets.getInsets(WindowInsetsCompat.Type.ime())
            if (ime.bottom > 0) {
                v.updateLayoutParams<ViewGroup.MarginLayoutParams> {
                    bottomMargin = ime.bottom / 4
                }
            } else {
                v.updateLayoutParams<ViewGroup.MarginLayoutParams> { bottomMargin = 0 }
            }
            insets
        }
    }
}
