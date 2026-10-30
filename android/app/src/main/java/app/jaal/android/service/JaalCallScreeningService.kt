package app.jaal.android.service

import android.os.Build
import android.provider.Settings
import android.telecom.Call
import android.telecom.CallScreeningService
import android.util.Log
import app.jaal.android.R
import app.jaal.android.core.Extract
import app.jaal.android.data.ApiClient
import app.jaal.android.data.PrefixStore
import app.jaal.android.data.Prefs
import app.jaal.android.data.RecentStore
import app.jaal.android.engine.CallState
import app.jaal.android.ui.Notifier
import app.jaal.android.ui.OverlayController
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject

/**
 * Holds ROLE_CALL_SCREENING (API 29+). The platform passes the incoming number WITHOUT call-log permission,
 * and for a non-dialer screening app only for numbers that are not in the user's contacts.
 * JAAL ALWAYS allows the call immediately (never blocks, never silences) and then, while it rings,
 * checks the number against the graph and shows the overlay ("Number reported 12 times, ring 482").
 */
class JaalCallScreeningService : CallScreeningService() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    override fun onScreenCall(details: Call.Details) {
        // Respond first: allow, no silence, no rejection.
        respondToCall(details, CallResponse.Builder().build())

        if (Build.VERSION.SDK_INT >= 29 && details.callDirection != Call.Details.DIRECTION_INCOMING) return
        val raw = details.handle?.schemeSpecificPart ?: return
        CallState.onUnknownIncoming(raw)
        val phone = Extract.normPhone(raw) ?: return
        val key = Extract.canonicalKey("phone", phone)
        val app = applicationContext

        scope.launch {
            if (!PrefixStore.isReady(app)) PrefixStore.syncIfStale(app)
            // Same privacy gate as notifications: only a prefix hit leaves the phone.
            if (!PrefixStore.contains(app, Extract.keyPrefix(key))) return@launch
            val prefs = Prefs(app)
            val body = JSONObject()
                .put("source", "android")
                .put("surface", "call")
                .put("reporter", prefs.deviceHash)
                .put("lang", prefs.lang)
                .put("identifiers", JSONArray().put(JSONObject().put("type", "phone").put("value", phone)))
                .put("context", JSONObject().put("onCall", true).put("unknownSender", true))
            try {
                val v = ApiClient(prefs.apiBase).check(body)
                if (v.isClear) return@launch
                val source = getString(R.string.source_call) + " · " + phone
                RecentStore.add(app, v, source)
                if (Settings.canDrawOverlays(app)) OverlayController.show(app, v, source, null)
                else Notifier.verdict(app, v, source)
            } catch (e: Exception) {
                Log.w("JaalCall", "call check failed: ${e.message}")
            }
        }
    }
}
