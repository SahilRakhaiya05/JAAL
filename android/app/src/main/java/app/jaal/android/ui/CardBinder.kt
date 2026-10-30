package app.jaal.android.ui

import android.content.Context
import android.view.View
import android.widget.Button
import android.widget.ImageButton
import android.widget.TextView
import app.jaal.android.R
import app.jaal.android.data.Verdict
import app.jaal.android.engine.PersonalBaseline

/** Binds the VerdictCard + StateChip. Shared by the overlay and the detail screen header. */
object CardBinder {

    /** StateChip: word + icon shape per state, never colour alone. */
    fun bindChip(chip: TextView, state: String) {
        val c = chip.context
        when (state) {
            Verdict.STATE_CONFIRMED -> {
                chip.setText(R.string.state_confirmed)
                chip.setTextColor(c.getColor(R.color.ink_900))
                chip.setBackgroundResource(R.drawable.bg_chip_confirmed)
                chip.setCompoundDrawablesRelativeWithIntrinsicBounds(R.drawable.ic_state_confirmed, 0, 0, 0)
            }
            Verdict.STATE_REPORTED -> {
                chip.setText(R.string.state_reported)
                chip.setTextColor(c.getColor(R.color.state_caution))
                chip.setBackgroundResource(R.drawable.bg_chip_reported)
                chip.setCompoundDrawablesRelativeWithIntrinsicBounds(R.drawable.ic_state_reported, 0, 0, 0)
            }
            else -> {
                chip.setText(R.string.state_clear)
                chip.setTextColor(c.getColor(R.color.text_lo))
                chip.setBackgroundResource(R.drawable.bg_chip_clear)
                chip.setCompoundDrawablesRelativeWithIntrinsicBounds(R.drawable.ic_state_clear, 0, 0, 0)
            }
        }
    }

    fun personalLine(ctx: Context, s: PersonalBaseline.Signals?): String? {
        if (s == null || !s.any) return null
        return buildList {
            if (s.callPlusPayment) add(ctx.getString(R.string.personal_call_plus_payment))
            if (s.installPlusCall) add(ctx.getString(R.string.personal_install_plus_call))
            if (s.firstTimePayee) add(ctx.getString(R.string.personal_first_time_payee))
            if (s.outOfPattern) add(ctx.getString(R.string.personal_out_of_pattern))
        }.joinToString(" · ")
    }

    fun bind(
        root: View,
        v: Verdict,
        source: String,
        personal: PersonalBaseline.Signals?,
        animateRing: Boolean,
        onPrimary: () -> Unit,
        onSecondary: (String) -> Unit,
        onClose: () -> Unit
    ) {
        val ctx = root.context
        val card = root.findViewById<View>(R.id.card)
        card.setBackgroundResource(if (v.isConfirmed) R.drawable.bg_card_confirmed else R.drawable.bg_card)
        card.clipToOutline = true
        root.findViewById<View>(R.id.rule).visibility = if (v.state == Verdict.STATE_REPORTED) View.VISIBLE else View.GONE

        bindChip(root.findViewById(R.id.chip), v.state)
        root.findViewById<TextView>(R.id.source).text = source
        root.findViewById<TextView>(R.id.headline).text = v.headline
        root.findViewById<TextView>(R.id.reason).text = v.reason

        val p = root.findViewById<TextView>(R.id.personal)
        val pl = personalLine(ctx, personal)
        p.visibility = if (pl == null) View.GONE else View.VISIBLE
        p.text = pl

        val ring = root.findViewById<RingView>(R.id.ring)
        if (v.ring == null || v.ring.nodes.isEmpty()) ring.visibility = View.GONE
        else {
            ring.visibility = View.VISIBLE
            // Only confirmed animates.
            ring.setRing(v.ring, animate = animateRing && v.isConfirmed)
        }

        val primary = root.findViewById<Button>(R.id.primary)
        primary.setText(R.string.action_details)
        primary.setOnClickListener { onPrimary() }

        val secondary = root.findViewById<Button>(R.id.secondary)
        val first = v.actions.firstOrNull { it.id == "chakshu" || it.id == "call_1930" } ?: v.actions.firstOrNull()
        if (first != null) {
            secondary.text = Actions.label(ctx, first)
            secondary.setOnClickListener { onSecondary(first.id) }
        } else {
            secondary.setText(R.string.action_call_1930)
            secondary.setOnClickListener { onSecondary("call_1930") }
        }
        root.findViewById<ImageButton>(R.id.close).setOnClickListener { onClose() }
        card.setOnClickListener { onPrimary() }
    }
}
