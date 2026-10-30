package app.jaal.android.service

import android.app.Notification
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import android.util.Log
import app.jaal.android.R
import app.jaal.android.core.Extract
import app.jaal.android.data.PrefixStore
import app.jaal.android.engine.CallState
import app.jaal.android.engine.Checker
import app.jaal.android.engine.PersonalBaseline
import app.jaal.android.guardian.Guardian
import app.jaal.android.ui.Notifier
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

/**
 * Reads ONLY the title + text of incoming notifications (any app: WhatsApp, Telegram, SMS, UPI apps, Gmail).
 * No AccessibilityService, no screen content, no contacts. Ongoing, media, group-summary and JAAL's own
 * notifications are ignored (except the flagged debug demo). Triage runs synchronously in < 10 ms; only a
 * prefix hit or a 'trigger' makes a network call.
 */
class JaalNotificationListener : NotificationListenerService() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val recent = LinkedHashMap<String, Long>()
    private var pkgReceiver: BroadcastReceiver? = null

    override fun onListenerConnected() {
        super.onListenerConnected()
        connected = true
        CallState.start(this)
        // install_plus_call: ACTION_PACKAGE_ADDED is not delivered to manifest receivers since API 26, so
        // register at runtime while the listener is bound (it is long-lived). Visibility limited to <queries>.
        if (pkgReceiver == null) {
            pkgReceiver = object : BroadcastReceiver() {
                override fun onReceive(c: Context, i: Intent) {
                    val pkg = i.data?.schemeSpecificPart ?: return
                    PersonalBaseline.get(c).onPackageInstalled(pkg)
                }
            }
            val f = IntentFilter(Intent.ACTION_PACKAGE_ADDED).apply { addDataScheme("package") }
            if (android.os.Build.VERSION.SDK_INT >= 33) registerReceiver(pkgReceiver, f, Context.RECEIVER_EXPORTED)
            else registerReceiver(pkgReceiver, f)
        }
        scope.launch { PrefixStore.syncIfStale(applicationContext) }
    }

    override fun onListenerDisconnected() {
        connected = false
        super.onListenerDisconnected()
    }

    override fun onDestroy() {
        pkgReceiver?.let { try { unregisterReceiver(it) } catch (_: Exception) { } }
        pkgReceiver = null
        scope.cancel()
        super.onDestroy()
    }

    override fun onNotificationPosted(sbn: StatusBarNotification) {
        val n = sbn.notification ?: return
        val extras = n.extras ?: return
        val pkg = sbn.packageName
        val isDemo = pkg == packageName && extras.getBoolean(Notifier.EXTRA_DEMO, false)
        if (pkg == packageName && !isDemo) return
        if (sbn.isOngoing) return
        if (n.flags and Notification.FLAG_GROUP_SUMMARY != 0) return
        if (n.category in SKIP_CATEGORIES) return
        if (extras.containsKey(Notification.EXTRA_MEDIA_SESSION)) return

        val title = extras.getCharSequence(Notification.EXTRA_TITLE)?.toString().orEmpty()
        val body = (extras.getCharSequence(Notification.EXTRA_BIG_TEXT) ?: extras.getCharSequence(Notification.EXTRA_TEXT))?.toString().orEmpty()
        if (title.isBlank() && body.isBlank()) return
        val text = if (title.isBlank()) body else "$title\n$body"

        // Apps re-post the same notification on updates; check each distinct text once per 2 minutes.
        val dedupeKey = pkg + ":" + text.hashCode()
        val now = System.currentTimeMillis()
        synchronized(recent) {
            recent.entries.removeAll { now - it.value > 120_000 }
            if (recent.containsKey(dedupeKey)) return
            recent[dedupeKey] = now
        }

        val app = applicationContext
        // Personal layer learns from UPI app receipts (on device only).
        if (pkg in PersonalBaseline.UPI_APPS) PersonalBaseline.get(app).onUpiAppNotification(text, Extract.extract(text), now)

        // WhatsApp/Telegram show a raw number as the title when the sender is not a saved contact.
        val unknownSender = PHONE_TITLE.matches(title.trim())
        val input = Checker.Input(
            text = text,
            surface = "notification",
            app = if (isDemo) "app.jaal.android.demo" else pkg,
            appLabel = if (isDemo) getString(R.string.source_demo) else appLabel(pkg),
            unknownSender = unknownSender
        )
        // Cheap synchronous triage; most notifications end here and never leave the phone.
        val (tri, _) = Checker.triage(app, input)
        if (tri.level != "ignore") scope.launch { Checker.process(app, input) }

        // Opportunistic background work on listener wakeups.
        Guardian.pollIfDue(app)
        if (PrefixStore.isStale(app)) scope.launch { PrefixStore.syncIfStale(app) }
    }

    private fun appLabel(pkg: String): String = try {
        val pm = packageManager
        pm.getApplicationLabel(pm.getApplicationInfo(pkg, 0)).toString()
    } catch (e: PackageManager.NameNotFoundException) {
        pkg
    } catch (e: Exception) {
        Log.w("JaalListener", "label failed", e); pkg
    }

    companion object {
        @Volatile var connected = false
            private set

        private val SKIP_CATEGORIES = setOf(
            Notification.CATEGORY_TRANSPORT, Notification.CATEGORY_PROGRESS, Notification.CATEGORY_SERVICE,
            Notification.CATEGORY_SYSTEM, Notification.CATEGORY_NAVIGATION, Notification.CATEGORY_ALARM,
            Notification.CATEGORY_STOPWATCH, Notification.CATEGORY_WORKOUT
        )
        private val PHONE_TITLE = Regex("^\\+?[0-9][0-9 ()-]{7,16}$")
    }
}
