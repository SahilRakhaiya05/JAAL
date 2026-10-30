package app.jaal.android.ui

import android.content.Context
import android.graphics.PixelFormat
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.VibrationEffect
import android.os.Vibrator
import android.provider.Settings
import android.util.Log
import android.view.ContextThemeWrapper
import android.view.Gravity
import android.view.LayoutInflater
import android.view.View
import android.view.WindowInsets
import android.view.WindowManager
import android.view.animation.PathInterpolator
import app.jaal.android.R
import app.jaal.android.data.Verdict
import app.jaal.android.engine.PersonalBaseline
import kotlin.math.min

/**
 * Floating VerdictCard over any app (SYSTEM_ALERT_WINDOW, TYPE_APPLICATION_OVERLAY), anchored top under the
 * status bar. clear -> nothing (silence). reported -> caution rule, auto-dismiss after 8 s.
 * confirmed -> tint + animated ring + one haptic tap, stays until dismissed.
 * Motion: enter translateY 24dp->0 + alpha over 220ms PathInterpolator(0.2,0.8,0.2,1); exit 140ms ease-in.
 * Animator duration scale 0 (reduced motion) makes all of this instant automatically.
 */
object OverlayController {
    private const val TAG = "JaalOverlay"
    private const val AUTO_DISMISS_MS = 8_000L
    private val main = Handler(Looper.getMainLooper())
    private var current: View? = null
    private val autoDismiss = Runnable { dismiss() }
    private val ENTER = PathInterpolator(0.2f, 0.8f, 0.2f, 1f)
    private val EXIT = PathInterpolator(0.42f, 0f, 1f, 1f)

    fun show(ctx: Context, v: Verdict, source: String, personal: PersonalBaseline.Signals?) {
        if (v.isClear) return
        main.post { showNow(ctx.applicationContext, v, source, personal) }
    }

    private fun showNow(app: Context, v: Verdict, source: String, personal: PersonalBaseline.Signals?) {
        if (!Settings.canDrawOverlays(app)) { Notifier.verdict(app, v, source); return }
        removeNow()
        val wm = app.getSystemService(WindowManager::class.java)
        val themed = ContextThemeWrapper(Lang.wrap(app), R.style.Theme_Jaal)
        val root = LayoutInflater.from(themed).inflate(R.layout.verdict_card, null)

        CardBinder.bind(
            root, v, source, personal, animateRing = true,
            onPrimary = { dismiss(); themed.launch(VerdictActivity.intent(themed, v, source)) },
            onSecondary = { id -> dismiss(); Actions.run(themed, v, id, source) },
            onClose = { dismiss() }
        )

        val (screenW, statusBar) = metrics(app, wm)
        val width = min(screenW - app.dpi(32f), app.dpi(400f))
        val lp = WindowManager.LayoutParams(
            width,
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL or
                WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
            PixelFormat.TRANSLUCENT
        ).apply {
            gravity = Gravity.TOP or Gravity.CENTER_HORIZONTAL
            y = statusBar + app.dpi(8f)
            title = "JAAL verdict"
        }

        try {
            wm.addView(root, lp)
        } catch (e: Exception) {
            Log.w(TAG, "overlay failed: ${e.message}")
            Notifier.verdict(app, v, source)
            return
        }
        current = root
        root.translationY = app.dp(24f)
        root.alpha = 0f
        root.animate().translationY(0f).alpha(1f).setDuration(220).setInterpolator(ENTER).start()
        root.announceForAccessibility(v.headline)

        if (v.isConfirmed) haptic(app) else main.postDelayed(autoDismiss, AUTO_DISMISS_MS)
    }

    fun dismiss() {
        main.post {
            val view = current ?: return@post
            main.removeCallbacks(autoDismiss)
            view.animate().alpha(0f).translationY(-view.context.dp(8f)).setDuration(140).setInterpolator(EXIT)
                .withEndAction { removeView(view) }.start()
            current = null
        }
    }

    private fun removeNow() {
        main.removeCallbacks(autoDismiss)
        current?.let { removeView(it) }
        current = null
    }

    private fun removeView(view: View) {
        try {
            view.context.applicationContext.getSystemService(WindowManager::class.java).removeView(view)
        } catch (_: Exception) { }
    }

    private fun metrics(app: Context, wm: WindowManager): Pair<Int, Int> {
        return if (Build.VERSION.SDK_INT >= 30) {
            val m = wm.currentWindowMetrics
            m.bounds.width() to m.windowInsets.getInsets(WindowInsets.Type.statusBars()).top
        } else {
            val id = app.resources.getIdentifier("status_bar_height", "dimen", "android")
            app.resources.displayMetrics.widthPixels to (if (id > 0) app.resources.getDimensionPixelSize(id) else app.dpi(24f))
        }
    }

    /** One tap, only for confirmed. */
    private fun haptic(ctx: Context) {
        try {
            val vib = ctx.getSystemService(Vibrator::class.java) ?: return
            if (Build.VERSION.SDK_INT >= 29) vib.vibrate(VibrationEffect.createPredefined(VibrationEffect.EFFECT_CLICK))
            else vib.vibrate(VibrationEffect.createOneShot(30, VibrationEffect.DEFAULT_AMPLITUDE))
        } catch (_: Exception) { }
    }
}
