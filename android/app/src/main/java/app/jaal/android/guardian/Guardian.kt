package app.jaal.android.guardian

import android.content.Context
import android.util.Log
import app.jaal.android.data.ApiClient
import app.jaal.android.data.Prefs
import app.jaal.android.data.Verdict
import app.jaal.android.ui.Notifier
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

/**
 * Guardian mode.
 *  Protected phone: POST /api/guardian/pair -> 6-digit code; on a confirmed verdict POST /api/guardian/alert.
 *  Guardian phone:  POST /api/guardian/link with the code; polls GET /api/guardian/alerts.
 * Polling cadence (honest): every 60 s while JAAL is in the foreground, on notification-listener wakeups
 * (throttled to 60 s), and via a JobScheduler periodic job (Android minimum 15 min, Doze may defer it).
 */
object Guardian {
    private const val TAG = "JaalGuardian"
    const val POLL_MS = 60_000L
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    fun alertIfProtected(ctx: Context, v: Verdict) {
        val prefs = Prefs(ctx)
        if (prefs.pairingCode == null || v.id.isEmpty()) return
        scope.launch {
            try {
                ApiClient(prefs.apiBase).guardianAlert(prefs.deviceHash, v.id)
            } catch (e: Exception) {
                Log.w(TAG, "alert failed: ${e.message}")
            }
        }
    }

    fun pollIfDue(ctx: Context) {
        val prefs = Prefs(ctx)
        if (!prefs.isGuardian) return
        if (System.currentTimeMillis() - prefs.lastGuardianPollMs < POLL_MS) return
        scope.launch { poll(ctx) }
    }

    /** Returns number of new alerts shown, or -1 on network failure. */
    suspend fun poll(ctx: Context): Int {
        val prefs = Prefs(ctx)
        if (!prefs.isGuardian) return 0
        prefs.lastGuardianPollMs = System.currentTimeMillis()
        return try {
            val arr = ApiClient(prefs.apiBase).guardianAlerts(prefs.guardianHash)
            var newest = prefs.lastGuardianAlertAt
            var shown = 0
            for (i in 0 until arr.length()) {
                val a = arr.optJSONObject(i) ?: continue
                val at = a.optString("at")
                if (at.isEmpty() || at <= prefs.lastGuardianAlertAt) continue // ISO-8601 sorts lexically
                val vj = a.optJSONObject("verdict") ?: continue
                Notifier.guardianAlert(ctx, Verdict.from(vj), prefs.guardedNumber, at.hashCode())
                shown++
                if (at > newest) newest = at
            }
            prefs.lastGuardianAlertAt = newest
            shown
        } catch (e: Exception) {
            Log.w(TAG, "poll failed: ${e.message}")
            -1
        }
    }
}
