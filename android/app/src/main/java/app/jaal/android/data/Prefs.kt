package app.jaal.android.data

import android.content.Context
import android.content.SharedPreferences
import app.jaal.android.BuildConfig
import app.jaal.android.core.Extract
import java.security.SecureRandom
import java.util.UUID

/** Small typed wrapper over SharedPreferences. Nothing here leaves the device except the salted hashes. */
class Prefs(ctx: Context) {
    private val sp: SharedPreferences = ctx.applicationContext.getSharedPreferences("jaal", Context.MODE_PRIVATE)

    var apiBase: String
        get() = sp.getString("apiBase", null)?.takeIf { it.isNotBlank() } ?: BuildConfig.DEFAULT_API_BASE
        set(v) = sp.edit().putString("apiBase", v.trim().trimEnd('/')).apply()

    var lang: String
        get() = sp.getString("lang", "en") ?: "en"
        set(v) = sp.edit().putString("lang", v).apply()

    var onboarded: Boolean
        get() = sp.getBoolean("onboarded", false)
        set(v) = sp.edit().putBoolean("onboarded", v).apply()

    /** Reporter id sent to the server: SHA-256(random salt + random install id). Never a hardware id. */
    val deviceHash: String
        get() = sp.getString("deviceHash", null) ?: newHash("d").also { sp.edit().putString("deviceHash", it).apply() }

    /** Separate identity used when this phone acts as a guardian. */
    val guardianHash: String
        get() = sp.getString("guardianHash", null) ?: newHash("g").also { sp.edit().putString("guardianHash", it).apply() }

    /** Set once this phone generated a pairing code: it is a protected device and sends guardian alerts. */
    var pairingCode: String?
        get() = sp.getString("pairingCode", null)
        set(v) = sp.edit().putString("pairingCode", v).apply()

    /** Set once this phone linked as a guardian: it polls alerts. */
    var isGuardian: Boolean
        get() = sp.getBoolean("isGuardian", false)
        set(v) = sp.edit().putBoolean("isGuardian", v).apply()

    /** Entered by the guardian, kept locally only, used for ACTION_DIAL on an alert. */
    var guardedNumber: String
        get() = sp.getString("guardedNumber", "") ?: ""
        set(v) = sp.edit().putString("guardedNumber", v.trim()).apply()

    var lastGuardianAlertAt: String
        get() = sp.getString("lastGuardianAlertAt", "") ?: ""
        set(v) = sp.edit().putString("lastGuardianAlertAt", v).apply()

    var lastGuardianPollMs: Long
        get() = sp.getLong("lastGuardianPollMs", 0L)
        set(v) = sp.edit().putLong("lastGuardianPollMs", v).apply()

    var lastClipboardHash: String
        get() = sp.getString("lastClipboardHash", "") ?: ""
        set(v) = sp.edit().putString("lastClipboardHash", v).apply()

    private fun newHash(kind: String): String {
        val salt = ByteArray(16).also { SecureRandom().nextBytes(it) }.joinToString("") { "%02x".format(it) }
        return kind + "_" + Extract.sha256Hex(salt + UUID.randomUUID().toString()).take(32)
    }
}
