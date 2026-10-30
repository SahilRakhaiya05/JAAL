package app.jaal.android.ui

import android.content.ClipboardManager
import android.content.Intent
import android.os.Bundle
import android.view.View
import android.widget.TextView
import app.jaal.android.R
import app.jaal.android.data.Prefs
import app.jaal.android.engine.Checker
import kotlinx.coroutines.MainScope
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

/**
 * Small translucent window for explicit checks:
 *  - "Share to JAAL" (ACTION_SEND text/plain from any app's share sheet)
 *  - the Quick Settings "Check clipboard" tile (reads the clipboard once this window has input focus,
 *    which is the only way Android 10+ allows it).
 */
class CheckActivity : BaseActivity() {
    private val scope = MainScope()
    private var started = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_check)
        findViewById<View>(R.id.close).setOnClickListener { finish() }
        if (intent?.action == Intent.ACTION_SEND) {
            val text = listOfNotNull(
                intent.getStringExtra(Intent.EXTRA_SUBJECT),
                intent.getCharSequenceExtra(Intent.EXTRA_TEXT)?.toString()
            ).joinToString("\n")
            started = true
            run(text, "manual")
        }
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (!hasFocus || started || intent?.getStringExtra(EXTRA_MODE) != MODE_CLIPBOARD) return
        started = true
        val clip = try {
            getSystemService(ClipboardManager::class.java)?.primaryClip?.takeIf { it.itemCount > 0 }
                ?.getItemAt(0)?.coerceToText(this)?.toString()
        } catch (_: Exception) { null }
        if (clip.isNullOrBlank()) done(getString(R.string.clipboard_empty)) else run(clip, "clipboard")
    }

    override fun onDestroy() {
        scope.cancel()
        super.onDestroy()
    }

    private fun run(text: String, surface: String) {
        if (text.isBlank()) { done(getString(R.string.nothing_to_check)); return }
        scope.launch {
            when (val o = Checker.process(applicationContext, Checker.Input(text, surface, appLabel = getString(R.string.share_target_label), interactive = true))) {
                is Checker.Outcome.Checked -> {
                    startActivity(VerdictActivity.intent(this@CheckActivity, o.verdict, getString(R.string.share_target_label),
                        personal = CardBinder.personalLine(this@CheckActivity, o.personal)))
                    finish()
                }
                is Checker.Outcome.Failed -> done(getString(R.string.server_unreachable, Prefs(this@CheckActivity).apiBase))
                else -> done(getString(R.string.nothing_to_check))
            }
        }
    }

    private fun done(msg: String) {
        findViewById<View>(R.id.progress).visibility = View.GONE
        findViewById<TextView>(R.id.message).text = msg
    }

    companion object {
        const val EXTRA_MODE = "mode"
        const val MODE_CLIPBOARD = "clipboard"
    }
}
