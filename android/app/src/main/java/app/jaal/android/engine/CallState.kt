package app.jaal.android.engine

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.telephony.PhoneStateListener
import android.telephony.TelephonyCallback
import android.telephony.TelephonyManager
import android.util.Log
import java.util.concurrent.Executors

/**
 * On-device call state for the personal layer. Never uploaded.
 *
 * Sources (no call log permission, ever):
 *  - JaalCallScreeningService (role ROLE_CALL_SCREENING, API 29+) tells us an incoming call is from a
 *    number not in contacts (the platform only screens non-contacts for non-dialer apps).
 *  - TelephonyCallback / PhoneStateListener (needs READ_PHONE_STATE, optional) tells us ringing/offhook/idle
 *    so we know whether that unknown call is still active.
 * Without READ_PHONE_STATE we fall back to a time window after the unknown call rang.
 */
object CallState {
    private const val TAG = "JaalCall"
    const val WINDOW_MS = 15 * 60 * 1000L        // call_plus_payment / install_plus_call window
    private const val NO_STATE_ACTIVE_MS = 20 * 60 * 1000L

    @Volatile var lastUnknownCallAt = 0L; private set
    @Volatile var lastUnknownNumber: String? = null; private set
    @Volatile var phoneState = TelephonyManager.CALL_STATE_IDLE; private set
    @Volatile var lastCallEndedAt = 0L; private set
    @Volatile var hasStateFeed = false; private set
    @Volatile var remoteInstallDuringCallAt = 0L
    @Volatile var remoteInstallPackage: String? = null

    private var registered = false

    fun onUnknownIncoming(number: String?) {
        lastUnknownCallAt = System.currentTimeMillis()
        lastUnknownNumber = number
    }

    /** An unknown (non-contact) call is ringing or in progress right now. */
    fun unknownCallActive(now: Long = System.currentTimeMillis()): Boolean {
        if (lastUnknownCallAt == 0L) return false
        return if (hasStateFeed) {
            phoneState != TelephonyManager.CALL_STATE_IDLE && lastCallEndedAt < lastUnknownCallAt
        } else now - lastUnknownCallAt < NO_STATE_ACTIVE_MS
    }

    /** Unknown call active, or ended less than WINDOW_MS ago. */
    fun unknownCallWithin(now: Long = System.currentTimeMillis(), window: Long = WINDOW_MS): Boolean {
        if (lastUnknownCallAt == 0L) return false
        if (unknownCallActive(now)) return true
        val end = if (hasStateFeed && lastCallEndedAt >= lastUnknownCallAt) lastCallEndedAt else lastUnknownCallAt
        return now - end < window
    }

    private fun onState(state: Int) {
        if (phoneState != TelephonyManager.CALL_STATE_IDLE && state == TelephonyManager.CALL_STATE_IDLE) {
            lastCallEndedAt = System.currentTimeMillis()
        }
        phoneState = state
    }

    /** Idempotent. Registers the call-state feed if READ_PHONE_STATE was granted. */
    @Suppress("DEPRECATION")
    fun start(ctx: Context) {
        if (registered) return
        if (ctx.checkSelfPermission(Manifest.permission.READ_PHONE_STATE) != PackageManager.PERMISSION_GRANTED) return
        val tm = ctx.getSystemService(TelephonyManager::class.java) ?: return
        try {
            if (Build.VERSION.SDK_INT >= 31) {
                val cb = object : TelephonyCallback(), TelephonyCallback.CallStateListener {
                    override fun onCallStateChanged(state: Int) = onState(state)
                }
                tm.registerTelephonyCallback(Executors.newSingleThreadExecutor(), cb)
            } else {
                tm.listen(object : PhoneStateListener() {
                    @Deprecated("platform") override fun onCallStateChanged(state: Int, phoneNumber: String?) = onState(state)
                }, PhoneStateListener.LISTEN_CALL_STATE)
            }
            registered = true
            hasStateFeed = true
        } catch (e: Exception) {
            Log.w(TAG, "call state feed unavailable: ${e.message}")
        }
    }
}
