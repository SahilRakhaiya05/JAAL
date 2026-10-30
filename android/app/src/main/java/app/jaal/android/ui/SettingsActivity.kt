package app.jaal.android.ui

import android.os.Bundle
import android.view.View
import android.widget.Button
import android.widget.EditText
import android.widget.RadioGroup
import android.widget.ScrollView
import android.widget.TextView
import app.jaal.android.R
import app.jaal.android.data.ApiClient
import app.jaal.android.data.PrefixStore
import app.jaal.android.data.Prefs
import app.jaal.android.guardian.Guardian
import kotlinx.coroutines.MainScope
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

/** Server URL, language, guardian pairing. */
class SettingsActivity : BaseActivity() {
    private val scope = MainScope()
    private lateinit var prefs: Prefs

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_settings)
        prefs = Prefs(this)

        // ---- server ----
        val api = findViewById<EditText>(R.id.api)
        val apiStatus = findViewById<TextView>(R.id.api_status)
        api.setText(prefs.apiBase)
        findViewById<Button>(R.id.api_save).setOnClickListener {
            prefs.apiBase = api.text.toString()
            apiStatus.text = getString(R.string.saved)
            scope.launch { PrefixStore.syncIfStale(applicationContext, force = true) }
        }
        findViewById<Button>(R.id.api_test).setOnClickListener {
            prefs.apiBase = api.text.toString()
            apiStatus.text = getString(R.string.checking)
            scope.launch {
                apiStatus.text = try {
                    val h = ApiClient(prefs.apiBase).health()
                    val synced = PrefixStore.syncIfStale(applicationContext, force = true)
                    getString(R.string.connection_ok, h.optString("engine", h.optString("status", "ok"))) +
                        if (synced) " · ${PrefixStore.size(applicationContext)} prefixes" else ""
                } catch (e: Exception) {
                    getString(R.string.server_unreachable, prefs.apiBase)
                }
            }
        }

        // ---- language ----
        val group = findViewById<RadioGroup>(R.id.lang)
        group.check(when (prefs.lang) { "hi" -> R.id.lang_hi; "gu" -> R.id.lang_gu; else -> R.id.lang_en })
        group.setOnCheckedChangeListener { _, id ->
            val l = when (id) { R.id.lang_hi -> "hi"; R.id.lang_gu -> "gu"; else -> "en" }
            if (l != prefs.lang) {
                prefs.lang = l
                Notifier.createChannels(applicationContext)
                recreate()
            }
        }

        // ---- guardian: protected phone ----
        val codeView = findViewById<TextView>(R.id.pair_code)
        prefs.pairingCode?.let { codeView.visibility = View.VISIBLE; codeView.text = getString(R.string.guardian_code, it) }
        findViewById<Button>(R.id.pair).setOnClickListener {
            scope.launch {
                try {
                    val code = ApiClient(prefs.apiBase).guardianPair(prefs.deviceHash)
                    prefs.pairingCode = code
                    codeView.visibility = View.VISIBLE
                    codeView.text = getString(R.string.guardian_code, code)
                } catch (e: Exception) {
                    toast(getString(R.string.guardian_failed))
                }
            }
        }

        // ---- guardian: guardian phone ----
        val linkStatus = findViewById<TextView>(R.id.link_status)
        val number = findViewById<EditText>(R.id.guarded_number)
        number.setText(prefs.guardedNumber)
        if (prefs.isGuardian) linkStatus.text = getString(R.string.guardian_linked)
        findViewById<Button>(R.id.link).setOnClickListener {
            prefs.guardedNumber = number.text.toString()
            val code = findViewById<EditText>(R.id.link_code).text.toString().trim()
            if (code.length != 6) { linkStatus.text = getString(R.string.guardian_code_hint); return@setOnClickListener }
            scope.launch {
                try {
                    val ok = ApiClient(prefs.apiBase).guardianLink(code, prefs.guardianHash)
                    if (ok) prefs.isGuardian = true
                    linkStatus.text = getString(if (ok) R.string.guardian_linked else R.string.guardian_failed)
                } catch (e: Exception) {
                    linkStatus.text = getString(R.string.guardian_failed)
                }
            }
        }
        findViewById<Button>(R.id.poll).setOnClickListener {
            prefs.guardedNumber = number.text.toString()
            scope.launch {
                val n = Guardian.poll(applicationContext)
                linkStatus.text = when {
                    n < 0 -> getString(R.string.guardian_failed)
                    n == 0 -> getString(R.string.guardian_no_alerts)
                    else -> "$n"
                }
            }
        }

        if (intent.getBooleanExtra(EXTRA_GUARDIAN, false)) {
            val sv = findViewById<ScrollView>(R.id.scroll)
            sv.post { sv.smoothScrollTo(0, findViewById<View>(R.id.guardian_anchor).top) }
        }
    }

    override fun onPause() {
        prefs.guardedNumber = findViewById<EditText>(R.id.guarded_number).text.toString()
        super.onPause()
    }

    override fun onDestroy() {
        scope.cancel()
        super.onDestroy()
    }

    companion object {
        const val EXTRA_GUARDIAN = "guardian"
    }
}
