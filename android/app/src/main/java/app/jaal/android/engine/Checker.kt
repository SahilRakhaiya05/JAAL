package app.jaal.android.engine

import android.content.Context
import android.provider.Settings
import android.util.Log
import app.jaal.android.core.Extract
import app.jaal.android.core.Identifier
import app.jaal.android.core.TriageContext
import app.jaal.android.core.TriageResult
import app.jaal.android.data.ApiClient
import app.jaal.android.data.PrefixStore
import app.jaal.android.data.Prefs
import app.jaal.android.data.RecentStore
import app.jaal.android.data.Verdict
import app.jaal.android.guardian.Guardian
import app.jaal.android.ui.Notifier
import app.jaal.android.ui.OverlayController
import org.json.JSONArray
import org.json.JSONObject

/**
 * The ambient pipeline, identical on every sensor:
 *   triage on device (<10 ms) -> 'ignore' discarded -> 'check' asks the local prefix set ->
 *   prefix hit or 'trigger' -> POST /api/check -> overlay for reported/confirmed, silence for clear.
 */
object Checker {
    private const val TAG = "JaalChecker"

    data class Input(
        val text: String,
        val surface: String,            // notification | call | clipboard | manual
        val app: String? = null,        // package name of the source app
        val appLabel: String? = null,   // shown on the card as the source
        val unknownSender: Boolean = false,
        val interactive: Boolean = false, // user asked explicitly: always ask the server, always show a result
        val identifiers: List<Identifier>? = null // pre-extracted (call screening)
    )

    sealed class Outcome {
        data class Discarded(val triage: TriageResult) : Outcome()
        data class NoPrefixHit(val triage: TriageResult) : Outcome()
        object NothingToCheck : Outcome()
        data class Checked(val verdict: Verdict, val personal: PersonalBaseline.Signals) : Outcome()
        data class Failed(val message: String) : Outcome()
    }

    /** Synchronous, cheap part. Safe to call on the listener's binder thread. */
    fun triage(ctx: Context, input: Input): Pair<TriageResult, PersonalBaseline.Signals> {
        val t0 = System.nanoTime()
        val onCall = CallState.unknownCallActive()
        val base = Extract.triage(input.text, TriageContext(unknownSender = input.unknownSender, onCall = onCall))
        val ids = input.identifiers ?: base.identifiers
        val personal = PersonalBaseline.get(ctx).evaluate(ctx, ids, input.text, input.app)
        // Personal escalation (on top of, not inside, the shared triage so phone/server parity holds):
        // a money identifier during/after an unknown call, or a remote-access install during a call, is a trigger.
        val escalate = ids.isNotEmpty() && (personal.callPlusPayment || personal.installPlusCall)
        val result = if (escalate && base.level != "trigger") base.copy(level = "trigger") else base
        Log.d(TAG, "triage ${result.level} ${result.score} ids=${ids.size} in ${(System.nanoTime() - t0) / 1000}us")
        return (if (input.identifiers != null) result.copy(identifiers = ids) else result) to personal
    }

    suspend fun process(ctx: Context, input: Input): Outcome {
        val app = ctx.applicationContext
        val (tri, personal) = triage(app, input)
        val ids = tri.identifiers

        if (!input.interactive) {
            if (tri.level == "ignore") return Outcome.Discarded(tri)
            if (tri.level == "check") {
                if (!PrefixStore.isReady(app)) PrefixStore.syncIfStale(app)
                val hit = ids.any { PrefixStore.contains(app, Extract.keyPrefix(it.key)) }
                if (!hit) return Outcome.NoPrefixHit(tri)
            }
        } else if (ids.isEmpty() && input.text.isBlank()) {
            return Outcome.NothingToCheck
        }

        val prefs = Prefs(app)
        val body = JSONObject()
            .put("source", "android")
            .put("surface", input.surface)
            .put("reporter", prefs.deviceHash)
            .put("lang", prefs.lang)
            .put("context", JSONObject().apply {
                put("onCall", CallState.unknownCallActive() || personal.callPlusPayment)
                put("unknownSender", input.unknownSender)
                put("firstTimePayee", personal.firstTimePayee)
                input.app?.let { put("app", it) }
            })
        // A prefix-hit 'check' sends only the identifiers; a 'trigger' or explicit check also sends text
        // (the server needs it for script similarity and strips names/amounts before storing).
        if (input.interactive || tri.level == "trigger") body.put("text", input.text)
        if (ids.isNotEmpty()) body.put("identifiers", JSONArray().apply {
            ids.forEach { put(JSONObject().put("type", it.type).put("value", it.value)) }
        })

        val verdict = try {
            ApiClient(prefs.apiBase).check(body)
        } catch (e: Exception) {
            Log.w(TAG, "check failed: ${e.message}")
            return Outcome.Failed(e.message ?: "network")
        }

        if (!verdict.isClear || input.interactive) RecentStore.add(app, verdict, input.appLabel ?: input.surface)

        if (!input.interactive && !verdict.isClear) {
            val source = input.appLabel ?: input.app ?: input.surface
            if (Settings.canDrawOverlays(app)) OverlayController.show(app, verdict, source, personal)
            else Notifier.verdict(app, verdict, source)
        }
        if (verdict.isConfirmed) Guardian.alertIfProtected(app, verdict)
        return Outcome.Checked(verdict, personal)
    }
}
