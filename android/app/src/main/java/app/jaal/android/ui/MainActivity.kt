package app.jaal.android.ui

import android.content.ClipboardManager
import android.content.Intent
import android.os.Bundle
import android.text.format.DateUtils
import android.view.View
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import app.jaal.android.R
import app.jaal.android.core.Extract
import app.jaal.android.data.PrefixStore
import app.jaal.android.data.Prefs
import app.jaal.android.data.RecentStore
import app.jaal.android.data.Verdict
import app.jaal.android.engine.Checker
import app.jaal.android.guardian.Guardian
import app.jaal.android.service.JaalNotificationListener
import kotlinx.coroutines.Job
import kotlinx.coroutines.MainScope
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

/** Home: status, manual check, clipboard (foreground only), recent checks, guardian, settings, demo. */
class MainActivity : BaseActivity() {
    private val scope = MainScope()
    private var guardianLoop: Job? = null
    private var pendingClip: String? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val prefs = Prefs(this)
        if (!prefs.onboarded) {
            startActivity(Intent(this, OnboardingActivity::class.java))
            finish()
            return
        }
        setContentView(R.layout.activity_main)

        findViewById<Button>(R.id.btn_settings).setOnClickListener { startActivity(Intent(this, SettingsActivity::class.java)) }
        findViewById<Button>(R.id.btn_guardian).setOnClickListener {
            startActivity(Intent(this, SettingsActivity::class.java).putExtra(SettingsActivity.EXTRA_GUARDIAN, true))
        }
        findViewById<Button>(R.id.fix_listener).setOnClickListener { launch(Perms.listenerSettings()) }
        findViewById<Button>(R.id.fix_overlay).setOnClickListener { launch(Perms.overlaySettings(this)) }
        findViewById<Button>(R.id.fix_call).setOnClickListener { startActivity(Intent(this, OnboardingActivity::class.java)) }

        val input = findViewById<EditText>(R.id.input)
        findViewById<Button>(R.id.btn_check).setOnClickListener { check(input.text.toString(), "manual") }
        findViewById<Button>(R.id.btn_clipboard).setOnClickListener {
            val clip = readClipboard()
            if (clip.isNullOrBlank()) status(getString(R.string.clipboard_empty)) else check(clip, "clipboard")
        }
        findViewById<Button>(R.id.clip_check).setOnClickListener {
            findViewById<View>(R.id.clip_banner).visibility = View.GONE
            pendingClip?.let { check(it, "clipboard") }
        }
        findViewById<Button>(R.id.btn_demo).setOnClickListener { demo() }
    }

    override fun onStart() {
        super.onStart()
        if (!Prefs(this).onboarded) return
        refreshStatus()
        renderRecent()
        scope.launch { PrefixStore.syncIfStale(applicationContext); refreshStatus() }
        if (Prefs(this).isGuardian) {
            guardianLoop = scope.launch {
                while (isActive) {
                    Guardian.poll(applicationContext)
                    delay(Guardian.POLL_MS)
                }
            }
        }
    }

    override fun onStop() {
        guardianLoop?.cancel()
        super.onStop()
    }

    override fun onDestroy() {
        scope.cancel()
        super.onDestroy()
    }

    /** Android 10+: clipboard is readable only while JAAL has input focus. Offer, never auto-send. */
    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (!hasFocus || !Prefs(this).onboarded) return
        val clip = readClipboard() ?: return
        val prefs = Prefs(this)
        val h = Extract.sha256Hex(clip).take(16)
        if (h == prefs.lastClipboardHash) return
        prefs.lastClipboardHash = h
        val tri = Extract.triage(clip)
        if (tri.identifiers.isEmpty()) return
        pendingClip = clip
        findViewById<TextView>(R.id.clip_text).text = getString(R.string.clipboard_banner, tri.identifiers.size)
        findViewById<View>(R.id.clip_banner).visibility = View.VISIBLE
    }

    private fun readClipboard(): String? = try {
        getSystemService(ClipboardManager::class.java)?.primaryClip?.takeIf { it.itemCount > 0 }
            ?.getItemAt(0)?.coerceToText(this)?.toString()?.takeIf { it.isNotBlank() }
    } catch (_: Exception) { null }

    private fun refreshStatus() {
        val listener = Perms.listenerEnabled(this)
        findViewById<TextView>(R.id.status_listener).text = getString(if (listener) R.string.status_on else R.string.status_off)
        findViewById<View>(R.id.fix_listener).visibility = if (listener) View.GONE else View.VISIBLE
        findViewById<View>(R.id.row_overlay).visibility = if (Perms.overlay(this)) View.GONE else View.VISIBLE
        val call = Perms.callRoleHeld(this)
        findViewById<TextView>(R.id.status_call).text = getString(if (call) R.string.status_call_on else R.string.status_call_off)
        findViewById<View>(R.id.fix_call).visibility = if (call || !Perms.callScreeningSupported()) View.GONE else View.VISIBLE
        findViewById<TextView>(R.id.status_meta).text =
            "${Prefs(this).apiBase} · ${PrefixStore.size(this)} prefixes" + (if (PrefixStore.version.isNotEmpty()) " v${PrefixStore.version}" else "")
    }

    private fun status(msg: String?) {
        val t = findViewById<TextView>(R.id.manual_status)
        t.text = msg
        t.visibility = if (msg.isNullOrBlank()) View.GONE else View.VISIBLE
    }

    private fun check(text: String, surface: String) {
        if (text.isBlank()) return
        status(getString(R.string.checking))
        scope.launch {
            when (val o = Checker.process(applicationContext, Checker.Input(text, surface, appLabel = getString(R.string.app_name), interactive = true))) {
                is Checker.Outcome.Checked -> {
                    status(null)
                    startActivity(VerdictActivity.intent(this@MainActivity, o.verdict, getString(R.string.app_name), personal = CardBinder.personalLine(this@MainActivity, o.personal)))
                    renderRecent()
                }
                is Checker.Outcome.Failed -> status(getString(R.string.server_unreachable, Prefs(this@MainActivity).apiBase))
                else -> status(getString(R.string.nothing_to_check))
            }
        }
    }

    /** Debug demo: post a realistic scam notification from JAAL itself (flagged) so the overlay can be filmed. */
    private fun demo() {
        if (JaalNotificationListener.connected && Perms.postNotifications(this)) {
            Notifier.postDemo(this)
            moveTaskToBack(true) // show the overlay over the launcher, as it would appear over WhatsApp
        } else {
            // No listener: run the same ambient pipeline directly.
            scope.launch {
                val o = Checker.process(
                    applicationContext,
                    Checker.Input(Notifier.DEMO_TEXT, "notification", app = "app.jaal.android.demo", appLabel = getString(R.string.source_demo))
                )
                if (o is Checker.Outcome.Failed) status(getString(R.string.server_unreachable, Prefs(this@MainActivity).apiBase))
                renderRecent()
            }
        }
    }

    private fun renderRecent() {
        val box = findViewById<LinearLayout>(R.id.recent)
        box.removeAllViews()
        val items = RecentStore.all(this)
        if (items.isEmpty()) {
            box.addView(TextView(this).apply {
                setTextAppearance(R.style.T_Caption)
                text = getString(R.string.recent_empty)
            })
            return
        }
        for (e in items) {
            val row = layoutInflater.inflate(android.R.layout.simple_list_item_2, box, false)
            row.minimumHeight = dpi(56f)
            row.setPadding(0, dpi(8f), 0, dpi(8f))
            val t1 = row.findViewById<TextView>(android.R.id.text1)
            val t2 = row.findViewById<TextView>(android.R.id.text2)
            t1.setTextAppearance(R.style.T_Body)
            t2.setTextAppearance(R.style.T_Caption)
            val chip = getString(
                when (e.state) {
                    Verdict.STATE_CONFIRMED -> R.string.state_confirmed
                    Verdict.STATE_REPORTED -> R.string.state_reported
                    else -> R.string.state_clear
                }
            )
            val icon = when (e.state) { Verdict.STATE_CONFIRMED -> "■"; Verdict.STATE_REPORTED -> "▲"; else -> "○" }
            t1.text = "$icon $chip · ${e.headline}"
            t1.setTextColor(getColor(
                when (e.state) {
                    Verdict.STATE_CONFIRMED -> R.color.state_confirmed
                    Verdict.STATE_REPORTED -> R.color.state_caution
                    else -> R.color.text_hi
                }
            ))
            t2.text = "${e.primary} · ${e.source} · ${DateUtils.getRelativeTimeSpanString(e.at)}"
            row.isClickable = true
            row.setBackgroundResource(android.R.drawable.list_selector_background)
            row.setOnClickListener {
                try { startActivity(VerdictActivity.intent(this, Verdict.parse(e.verdictJson), e.source)) } catch (_: Exception) { }
            }
            box.addView(row)
        }
    }
}
