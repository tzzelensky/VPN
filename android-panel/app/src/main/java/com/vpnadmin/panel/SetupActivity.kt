package com.vpnadmin.panel

import android.content.Intent
import android.os.Bundle
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import com.google.android.material.button.MaterialButton
import com.google.android.material.textfield.TextInputEditText

class SetupActivity : AppCompatActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        PanelEdgeToEdge.apply(this, darkTheme = true)
        setContentView(R.layout.activity_setup)

        val root = findViewById<android.view.View>(R.id.setupRoot)
        val scroll = findViewById<android.view.View>(R.id.setupScrollContent)
        PanelEdgeToEdge.bindSetupRoot(root, scroll)

        val input = findViewById<TextInputEditText>(R.id.urlInput)
        val save = findViewById<MaterialButton>(R.id.saveButton)

        val defaultUrl = getString(R.string.panel_url).trim()
        if (!defaultUrl.contains("ВАШ_ДОМЕН") && defaultUrl.startsWith("http")) {
            input.setText(defaultUrl)
        } else {
            val saved = PanelUrlStore.get(this)
            if (!saved.isNullOrBlank()) input.setText(saved)
        }

        save.setOnClickListener {
            val raw = input.text?.toString()?.trim().orEmpty()
            if (raw.isEmpty()) {
                Toast.makeText(this, R.string.url_required, Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }
            val normalized = PanelUrlStore.normalize(raw)
            if (normalized == null) {
                Toast.makeText(this, R.string.url_invalid, Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }
            PanelUrlStore.save(this, normalized)
            startActivity(
                Intent(this, MainActivity::class.java).apply {
                    addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
                },
            )
            finish()
        }
    }
}
