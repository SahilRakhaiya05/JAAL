package app.jaal.android.ui

import android.app.AlertDialog
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.view.View
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import app.jaal.android.R
import app.jaal.android.data.ApiClient
import app.jaal.android.data.Prefs
import app.jaal.android.data.Verdict
import app.jaal.android.engine.PersonalBaseline
import kotlinx.coroutines.MainScope
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

/** Full verdict: ring, numbers, identifiers, and the actions (Chakshu draft, 1930 dial, family share, dispute). */
class VerdictActivity : BaseActivity() {
    private val scope = MainScope()
    private lateinit var v: Verdict
    private lateinit var source: String

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_verdict)
        v = try { Verdict.parse(intent.getStringExtra(EXTRA_VERDICT) ?: "{}") } catch (e: Exception) { Verdict.parse("{}") }
        source = intent.getStringExtra(EXTRA_SOURCE) ?: getString(R.string.app_name)
        bind()
        if (intent.getBooleanExtra(EXTRA_DISPUTE, false)) dispute()
    }

    override fun onDestroy() {
        scope.cancel()
        super.onDestroy()
    }

    private fun bind() {
        CardBinder.bindChip(findViewById(R.id.chip), v.state)
        findViewById<TextView>(R.id.source).text = source
        findViewById<View>(R.id.close).setOnClickListener { finish() }
        findViewById<TextView>(R.id.headline).text = if (v.isClear && v.headline.isBlank()) getString(R.string.clear_headline) else v.headline
        findViewById<TextView>(R.id.reason).text = if (v.isClear && v.reason.isBlank()) getString(R.string.clear_reason) else v.reason

        intent.getStringExtra(EXTRA_PERSONAL)?.takeIf { it.isNotBlank() }?.let {
            findViewById<TextView>(R.id.personal).apply { visibility = View.VISIBLE; text = getString(R.string.detail_personal) + ": " + it }
        }

        val ring = findViewById<RingView>(R.id.ring)
        if (v.ring == null || v.ring!!.nodes.isEmpty()) ring.visibility = View.GONE
        else ring.setRing(v.ring, animate = v.isConfirmed, labels = true)

        findViewById<TextView>(R.id.stats).text = if (v.isClear) "" else getString(R.string.detail_stats, v.stats.reports, v.stats.confirmedWithin2Hops)

        val c = v.campaign
        findViewById<View>(R.id.campaign_title).visibility = if (c == null) View.GONE else View.VISIBLE
        findViewById<TextView>(R.id.campaign).apply {
            visibility = if (c == null) View.GONE else View.VISIBLE
            if (c != null) {
                text = getString(R.string.detail_campaign_line, c.name, c.size, c.firstSeen.take(10)) +
                    (if (c.pattern.isNotBlank()) "\n" + c.pattern else "") +
                    (if (c.cities.isNotEmpty()) "\n" + c.cities.joinToString(", ") else "")
            }
        }

        val ids = findViewById<LinearLayout>(R.id.ids)
        ids.removeAllViews()
        for (i in v.identifiers) {
            ids.addView(TextView(this).apply {
                setTextAppearance(R.style.T_Body)
                setPadding(0, dpi(4f), 0, dpi(4f))
                val icon = when (i.state) { Verdict.STATE_CONFIRMED -> "■ "; Verdict.STATE_REPORTED -> "▲ "; else -> "○ " }
                text = icon + "${i.type}  ${i.value}\n" + getString(R.string.detail_id_line, stateWord(i.state), i.reports)
                setTextIsSelectable(true)
            })
        }

        val sig = v.signals.joinToString("\n") { "· " + it.second }
        findViewById<View>(R.id.signals_title).visibility = if (sig.isBlank()) View.GONE else View.VISIBLE
        findViewById<TextView>(R.id.signals).apply { visibility = if (sig.isBlank()) View.GONE else View.VISIBLE; text = sig }

        findViewById<Button>(R.id.dispute).apply {
            visibility = if (v.isClear) View.GONE else View.VISIBLE
            setOnClickListener { dispute() }
        }
        findViewById<TextView>(R.id.engine).text = if (v.id.isBlank()) "" else getString(R.string.detail_engine, v.engine, v.latencyMs.toInt()) + " · " + v.id

        buildActions()
    }

    private fun stateWord(s: String) = getString(
        when (s) { Verdict.STATE_CONFIRMED -> R.string.state_confirmed; Verdict.STATE_REPORTED -> R.string.state_reported; else -> R.string.state_clear }
    )

    private fun buildActions() {
        val box = findViewById<LinearLayout>(R.id.actions)
        box.removeAllViews()
        if (v.isClear) return
        val ids = LinkedHashSet<String>()
        v.actions.forEach { if (it.id != "dispute" && it.id != "report") ids.add(it.id) }
        listOf("chakshu", "call_1930", "share_family").forEach { ids.add(it) }

        var first = true
        for (id in ids) {
            val a = v.actions.firstOrNull { it.id == id } ?: Verdict.Action(id, "", null, null)
            box.addView(button(Actions.label(this, a), first) { Actions.run(this, v, id, source) })
            first = false
            if (id == "chakshu") {
                box.addView(button(getString(R.string.action_copy_draft), false) {
                    Actions.copy(this, Actions.draft(v, a)); toast(getString(R.string.draft_copied))
                })
            }
        }
        val upi = v.identifiers.firstOrNull { it.type == "upi" }
        if (upi != null && !v.isConfirmed) {
            box.addView(button(getString(R.string.action_mark_safe), false) {
                PersonalBaseline.get(this).markSafe(upi.value); toast(getString(R.string.marked_safe))
            })
        }
    }

    private fun button(label: String, primary: Boolean, onClick: () -> Unit): Button =
        Button(this, null, 0, if (primary) R.style.Btn_Primary else R.style.Btn_Secondary).apply {
            text = label
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT)
                .apply { topMargin = dpi(8f) }
            setOnClickListener { onClick() }
        }

    /** Dispute: POST /api/dispute; falls back to an email draft the user sends themselves. */
    private fun dispute() {
        val target = v.primary ?: v.identifiers.firstOrNull()?.let { it.type to it.value } ?: return
        val field = EditText(this).apply {
            hint = getString(R.string.dispute_hint)
            setTextColor(getColor(R.color.text_hi))
            setHintTextColor(getColor(R.color.text_lo))
            minLines = 2
        }
        val wrap = LinearLayout(this).apply { setPadding(dpi(20f), dpi(8f), dpi(20f), 0); addView(field) }
        AlertDialog.Builder(this, android.R.style.Theme_Material_Dialog_Alert)
            .setTitle(getString(R.string.dispute_title) + ": " + target.second)
            .setView(wrap)
            .setPositiveButton(R.string.dispute_send) { _, _ ->
                val reason = field.text.toString()
                scope.launch {
                    try {
                        ApiClient(Prefs(this@VerdictActivity).apiBase).dispute(target.first, target.second, reason)
                        toast(getString(R.string.dispute_sent))
                    } catch (e: Exception) {
                        toast(getString(R.string.dispute_failed))
                        val body = "Dispute for ${target.first}:${target.second}\nVerdict ${v.id}\n\n$reason"
                        launch(Intent(Intent.ACTION_SENDTO, Uri.parse("mailto:?subject=" + Uri.encode("JAAL dispute") + "&body=" + Uri.encode(body))))
                    }
                }
            }
            .setNegativeButton(R.string.close, null)
            .show()
    }

    companion object {
        private const val EXTRA_VERDICT = "verdict"
        private const val EXTRA_SOURCE = "source"
        private const val EXTRA_DISPUTE = "dispute"
        private const val EXTRA_PERSONAL = "personal"

        fun intent(ctx: Context, v: Verdict, source: String, openDispute: Boolean = false, personal: String? = null): Intent =
            Intent(ctx, VerdictActivity::class.java)
                .putExtra(EXTRA_VERDICT, v.raw)
                .putExtra(EXTRA_SOURCE, source)
                .putExtra(EXTRA_DISPUTE, openDispute)
                .putExtra(EXTRA_PERSONAL, personal)
    }
}
