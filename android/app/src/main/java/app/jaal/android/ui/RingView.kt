package app.jaal.android.ui

import android.animation.ValueAnimator
import android.content.Context
import android.graphics.Canvas
import android.graphics.Paint
import android.text.TextPaint
import android.util.AttributeSet
import android.view.View
import android.view.animation.LinearInterpolator
import app.jaal.android.R
import app.jaal.android.data.Ring
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.ln
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sin

/**
 * RingCanvas (SPEC): centre node, hop1 on r=64, hop2 on r=128 (scaled to the canvas; elliptical on wide,
 * short canvases like the 72dp card thumbnail), node diameter 6..18dp by reports, only the centre (brand)
 * and confirmed nodes (state-confirmed) are coloured, others text-lo @40%, edges 1px @20%.
 *
 * Staged reveal (confirmed only — the only state allowed to animate):
 *   centre 0ms, hop1 staggered 24ms from 150ms, edges draw over 200ms, hop2 from 500ms, confirmed pulse at 900ms.
 * Reduced motion: when the system animator duration scale is 0, renders the complete frame, no stagger.
 */
class RingView @JvmOverloads constructor(ctx: Context, attrs: AttributeSet? = null) : View(ctx, attrs) {

    private class P(val node: Ring.Node, var x: Float = 0f, var y: Float = 0f, var r: Float = 0f, var appearAt: Float = 0f, var angle: Double = 0.0)

    private var ring: Ring? = null
    private var animateReveal = false
    private var showLabels = false
    private val pts = LinkedHashMap<String, P>()
    private var t = END // ms into the timeline
    private var animator: ValueAnimator? = null

    private val brand = ctx.getColor(R.color.brand)
    private val confirmed = ctx.getColor(R.color.state_confirmed)
    private val dim = ctx.getColor(R.color.node_dim)
    private val edgeColor = ctx.getColor(R.color.edge_dim)

    private val nodePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL }
    private val edgePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; strokeWidth = ctx.dp(1f); color = edgeColor }
    private val pulsePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; strokeWidth = ctx.dp(1.5f) }
    private val labelPaint = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
        color = ctx.getColor(R.color.text_lo); textSize = ctx.resources.getDimension(R.dimen.t_micro); textAlign = Paint.Align.CENTER
    }

    fun setRing(r: Ring?, animate: Boolean, labels: Boolean = false) {
        ring = r
        showLabels = labels
        animateReveal = animate && ValueAnimator.areAnimatorsEnabled()
        animator?.cancel()
        layoutNodes()
        contentDescription = r?.let {
            val c = it.nodes.count { n -> n.confirmed }
            "Ring of ${it.nodes.size} linked identifiers, $c confirmed"
        }
        if (animateReveal) {
            t = 0f
            animator = ValueAnimator.ofFloat(0f, END).apply {
                duration = END.toLong()
                interpolator = LinearInterpolator()
                addUpdateListener { t = it.animatedValue as Float; invalidate() }
                start()
            }
        } else {
            t = REVEAL_DONE
        }
        invalidate()
    }

    override fun onDetachedFromWindow() {
        animator?.cancel()
        super.onDetachedFromWindow()
    }

    override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
        super.onSizeChanged(w, h, oldw, oldh)
        layoutNodes()
    }

    private fun layoutNodes() {
        pts.clear()
        val r = ring ?: return
        if (width == 0 || height == 0) return
        val cx = width / 2f
        val cy = height / 2f
        val maxNode = context.dp(9f)
        val labelRoom = if (showLabels) context.dp(14f) else 0f
        val ry2 = max(height / 2f - maxNode - labelRoom, context.dp(8f))
        val rx2 = min(width / 2f - maxNode, ry2 * 2.4f)
        // Node size scale: 1 at the reference canvas (hop2 = 128dp), smaller on thumbnails.
        val k = min(1f, ry2 / context.dp(128f)).coerceAtLeast(0.35f)

        fun radius(n: Ring.Node): Float {
            val f = min(1.0, ln(1.0 + n.reports) / ln(51.0)).toFloat()
            return context.dp(3f + 6f * f) * k  // diameter 6..18dp
        }

        val center = r.nodes.firstOrNull { it.id == r.center } ?: r.nodes.firstOrNull { it.hop == 0 } ?: return
        pts[center.id] = P(center, cx, cy, radius(center), 0f)

        val hop1 = r.nodes.filter { it.hop == 1 && it.id != center.id }
        hop1.forEachIndexed { i, n ->
            val a = -PI / 2 + 2 * PI * i / max(1, hop1.size)
            pts[n.id] = P(n, cx + (rx2 / 2f) * cos(a).toFloat(), cy + (ry2 / 2f) * sin(a).toFloat(), radius(n), 150f + 24f * i, a)
        }
        // hop2: order by parent angle, then spread evenly so children sit near their hop1 parent.
        val parentAngle = HashMap<String, Double>()
        r.edges.forEach { e ->
            val s = pts[e.source]; val tg = pts[e.target]
            if (s != null && s.node.hop == 1) parentAngle.putIfAbsent(e.target, s.angle)
            if (tg != null && tg.node.hop == 1) parentAngle.putIfAbsent(e.source, tg.angle)
        }
        val hop2 = r.nodes.filter { it.hop >= 2 && it.id != center.id }.sortedBy { parentAngle[it.id] ?: 0.0 }
        val offset = (parentAngle[hop2.firstOrNull()?.id] ?: -PI / 2)
        hop2.forEachIndexed { i, n ->
            val a = offset + 2 * PI * i / max(1, hop2.size)
            pts[n.id] = P(n, cx + rx2 * cos(a).toFloat(), cy + ry2 * sin(a).toFloat(), radius(n), 500f + 24f * i, a)
        }
    }

    override fun onDraw(canvas: Canvas) {
        val r = ring ?: return
        if (pts.isEmpty()) layoutNodes()
        if (pts.isEmpty()) return

        // Edges: draw progressively over 200ms once both ends have started to appear.
        for (e in r.edges) {
            val a = pts[e.source] ?: continue
            val b = pts[e.target] ?: continue
            val start = max(a.appearAt, b.appearAt)
            val p = ((t - start) / 200f).coerceIn(0f, 1f)
            if (p <= 0f) continue
            val (from, to) = if (a.appearAt <= b.appearAt) a to b else b to a
            canvas.drawLine(from.x, from.y, from.x + (to.x - from.x) * p, from.y + (to.y - from.y) * p, edgePaint)
        }

        // Nodes: 150ms fade + grow from their appear time.
        for (p in pts.values) {
            val f = ((t - p.appearAt) / 150f).coerceIn(0f, 1f)
            if (f <= 0f) continue
            val isCenter = p.node.id == r.center || p.node.hop == 0
            nodePaint.color = when {
                p.node.confirmed && !isCenter -> confirmed
                isCenter -> brand
                else -> dim
            }
            nodePaint.alpha = (android.graphics.Color.alpha(nodePaint.color) * f).toInt()
            canvas.drawCircle(p.x, p.y, p.r * (0.6f + 0.4f * f), nodePaint)
            if (showLabels && isCenter && f >= 1f) {
                canvas.drawText(ellipsize(p.node.label), p.x, p.y + p.r + labelPaint.textSize + context.dp(4f), labelPaint)
            }
        }

        // Confirmed pulse at 900ms, two rounds.
        if (animateReveal && t >= PULSE_AT && t < END && animator?.isRunning == true) {
            val phase = ((t - PULSE_AT) % PULSE_MS) / PULSE_MS
            pulsePaint.color = confirmed
            pulsePaint.alpha = (153 * (1f - phase)).toInt()
            for (p in pts.values) {
                if (!p.node.confirmed) continue
                canvas.drawCircle(p.x, p.y, p.r + context.dp(10f) * phase, pulsePaint)
            }
        }
    }

    private fun ellipsize(s: String) = if (s.length > 28) s.take(27) + "…" else s

    companion object {
        private const val PULSE_AT = 900f
        private const val PULSE_MS = 900f
        private const val REVEAL_DONE = 900f
        private const val END = PULSE_AT + 2 * PULSE_MS
    }
}
