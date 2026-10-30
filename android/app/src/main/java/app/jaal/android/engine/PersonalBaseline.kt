package app.jaal.android.engine

import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import app.jaal.android.core.Identifier
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.Calendar

/**
 * The personal layer: a small on-device state machine. NEVER uploaded; only the derived booleans
 * (firstTimePayee, onCall) are sent as `context` with a check that was already going to the server.
 *
 * Learns:  known payees (UPI handles the user paid via a UPI app notification, or marked safe),
 *          typical amounts (last 50) and hours (24-bucket histogram) of outgoing payments.
 * Signals: first_time_payee, out_of_pattern, call_plus_payment, install_plus_call.
 * Out of scope: code_read_aloud (needs microphone or screen content; JAAL reads neither).
 */
class PersonalBaseline private constructor(private val file: File) {

    data class Signals(
        val firstTimePayee: Boolean = false,
        val outOfPattern: Boolean = false,
        val callPlusPayment: Boolean = false,
        val installPlusCall: Boolean = false
    ) {
        val any get() = firstTimePayee || outOfPattern || callPlusPayment || installPlusCall
        fun ids(): List<String> = buildList {
            if (firstTimePayee) add("first_time_payee")
            if (outOfPattern) add("out_of_pattern")
            if (callPlusPayment) add("call_plus_payment")
            if (installPlusCall) add("install_plus_call")
        }
    }

    private val knownPayees = HashSet<String>()
    private val amounts = ArrayList<Double>()
    private val hours = IntArray(24)
    private var lastUpiAppAt = 0L

    init { load() }

    // ---------------- learning ----------------

    @Synchronized
    fun markSafe(upi: String) { knownPayees.add(upi.lowercase()); save() }

    @Synchronized
    fun isKnown(upi: String) = knownPayees.contains(upi.lowercase())

    /** Called for every notification from a UPI app (before triage). Learns from "paid/debited" receipts. */
    @Synchronized
    fun onUpiAppNotification(text: String, ids: List<Identifier>, now: Long = System.currentTimeMillis()) {
        lastUpiAppAt = now
        if (PAID_RE.containsMatchIn(text)) {
            amountIn(text)?.let { amounts.add(it); while (amounts.size > 50) amounts.removeAt(0) }
            hours[hourOf(now)]++
            ids.filter { it.type == "upi" }.forEach { knownPayees.add(it.value) }
        }
        save()
    }

    // ---------------- evaluation ----------------

    @Synchronized
    fun evaluate(ctx: Context, ids: List<Identifier>, text: String, pkg: String?, now: Long = System.currentTimeMillis()): Signals {
        val upis = ids.filter { it.type == "upi" }
        val paymentContext = (pkg != null && pkg in UPI_APPS) || PAY_ASK_RE.containsMatchIn(text)
        val firstTimePayee = upis.isNotEmpty() && paymentContext && upis.any { !knownPayees.contains(it.value) }

        var outOfPattern = false
        val amt = amountIn(text)
        if (amt != null && paymentContext && amounts.size >= 5) {
            val sorted = amounts.sorted()
            val median = sorted[sorted.size / 2]
            if (median > 0 && amt > median * 3) outOfPattern = true
        }
        if (paymentContext && hours.sum() >= 20 && hours[hourOf(now)] == 0) outOfPattern = true

        val upiActive = (pkg != null && pkg in UPI_APPS) || now - lastUpiAppAt < CallState.WINDOW_MS
        val callPlusPayment = CallState.unknownCallWithin(now) && (upiActive || (upis.isNotEmpty() && paymentContext))

        checkRemoteInstalls(ctx)
        val installPlusCall = CallState.remoteInstallDuringCallAt > 0 && now - CallState.remoteInstallDuringCallAt < CallState.WINDOW_MS

        return Signals(firstTimePayee, outOfPattern, callPlusPayment, installPlusCall)
    }

    /**
     * install_plus_call, polling half: ACTION_PACKAGE_ADDED is delivered only to a runtime receiver
     * (registered by the notification listener while it is bound), so on every evaluation we also look at
     * the firstInstallTime of the remote-access packages declared in <queries>.
     */
    fun checkRemoteInstalls(ctx: Context) {
        if (CallState.lastUnknownCallAt == 0L) return
        val pm = ctx.packageManager
        for (p in REMOTE_ACCESS_PACKAGES) {
            val installedAt = try {
                if (Build.VERSION.SDK_INT >= 33) pm.getPackageInfo(p, PackageManager.PackageInfoFlags.of(0)).firstInstallTime
                else @Suppress("DEPRECATION") pm.getPackageInfo(p, 0).firstInstallTime
            } catch (e: PackageManager.NameNotFoundException) { continue }
            onPackageInstalled(p, installedAt)
        }
    }

    fun onPackageInstalled(pkg: String, at: Long = System.currentTimeMillis()) {
        if (pkg !in REMOTE_ACCESS_PACKAGES) return
        val callAt = CallState.lastUnknownCallAt
        if (callAt == 0L) return
        // Installed after the unknown call started and within the window.
        if (at >= callAt - 60_000 && CallState.unknownCallWithin(at)) {
            CallState.remoteInstallDuringCallAt = maxOf(CallState.remoteInstallDuringCallAt, at)
            CallState.remoteInstallPackage = pkg
        }
    }

    // ---------------- persistence ----------------

    private fun load() {
        try {
            if (!file.exists()) return
            val o = JSONObject(file.readText())
            o.optJSONArray("payees")?.let { a -> for (i in 0 until a.length()) knownPayees.add(a.optString(i)) }
            o.optJSONArray("amounts")?.let { a -> for (i in 0 until a.length()) amounts.add(a.optDouble(i)) }
            o.optJSONArray("hours")?.let { a -> for (i in 0 until minOf(24, a.length())) hours[i] = a.optInt(i) }
            lastUpiAppAt = o.optLong("lastUpiAppAt", 0L)
        } catch (_: Exception) { }
    }

    private fun save() {
        val o = JSONObject()
            .put("payees", JSONArray(knownPayees.toList()))
            .put("amounts", JSONArray(amounts))
            .put("hours", JSONArray(hours.toList()))
            .put("lastUpiAppAt", lastUpiAppAt)
        file.writeText(o.toString())
    }

    companion object {
        @Volatile private var instance: PersonalBaseline? = null
        fun get(ctx: Context): PersonalBaseline =
            instance ?: synchronized(this) { instance ?: PersonalBaseline(File(ctx.applicationContext.noBackupFilesDir, "baseline.json")).also { instance = it } }

        val UPI_APPS = setOf(
            "com.phonepe.app", "com.google.android.apps.nbu.paisa.user", "net.one97.paytm", "in.org.npci.upiapp",
            "com.dreamplug.androidapp", "com.mobikwik_new", "com.freecharge.android", "com.sbi.upi", "com.sbi.lotusintouch",
            "com.csam.icici.bank.imobile", "com.snapwork.hdfc", "com.axis.mobile", "money.super.payments", "com.naviapp",
            "in.amazon.mShop.android.shopping", "com.myairtelapp", "com.kotak.mobile.banking", "com.fampay.in"
        )

        val REMOTE_ACCESS_PACKAGES = setOf(
            "com.anydesk.anydeskandroid", "com.teamviewer.quicksupport.market", "com.teamviewer.teamviewer.market.mobile",
            "com.teamviewer.host.market", "com.sand.airdroid", "com.sand.airdroidbiz", "com.carriez.flutter_hbb",
            "com.splashtop.remote.pad.v2", "com.splashtop.sos", "com.nanosystems.supremo", "com.ultraviewer.android"
        )

        private val PAID_RE = Regex("(?i)\\b(paid|sent|debited|transferred)\\b|भुगतान|ડેબિટ")
        private val PAY_ASK_RE = Regex("(?i)\\b(pay|send|transfer|collect request|request money)\\b|भेजें|भुगतान करें")
        private val AMOUNT_RE = Regex("(?i)(?:rs\\.?|₹|inr)\\s?([0-9][0-9,]*(?:\\.[0-9]{1,2})?)")

        fun amountIn(text: String): Double? =
            AMOUNT_RE.find(text)?.groupValues?.get(1)?.replace(",", "")?.toDoubleOrNull()

        private fun hourOf(ms: Long) = Calendar.getInstance().apply { timeInMillis = ms }.get(Calendar.HOUR_OF_DAY)
    }
}
