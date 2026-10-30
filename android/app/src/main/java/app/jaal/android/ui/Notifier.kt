package app.jaal.android.ui

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import app.jaal.android.R
import app.jaal.android.data.Verdict

/** Notification channels + the two notification surfaces (overlay fallback, guardian alert) + demo. */
object Notifier {
    const val CH_VERDICTS = "verdicts"
    const val CH_GUARDIAN = "guardian"
    const val CH_DEMO = "demo"
    const val EXTRA_DEMO = "app.jaal.android.DEMO"

    fun createChannels(ctx: Context) {
        val c = Lang.wrap(ctx)
        val nm = ctx.getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(NotificationChannel(CH_VERDICTS, c.getString(R.string.channel_verdicts), NotificationManager.IMPORTANCE_HIGH))
        nm.createNotificationChannel(NotificationChannel(CH_GUARDIAN, c.getString(R.string.channel_guardian), NotificationManager.IMPORTANCE_HIGH))
        nm.createNotificationChannel(NotificationChannel(CH_DEMO, c.getString(R.string.channel_demo), NotificationManager.IMPORTANCE_DEFAULT))
    }

    private fun detailIntent(ctx: Context, v: Verdict, source: String, req: Int): PendingIntent =
        PendingIntent.getActivity(
            ctx, req, VerdictActivity.intent(ctx, v, source),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

    /** Used when the overlay permission is missing. */
    fun verdict(ctx: Context, v: Verdict, source: String) {
        val c = Lang.wrap(ctx)
        val chip = c.getString(if (v.isConfirmed) R.string.state_confirmed else R.string.state_reported)
        val n = Notification.Builder(ctx, CH_VERDICTS)
            .setSmallIcon(R.drawable.ic_stat)
            .setContentTitle("$chip · ${v.headline}")
            .setContentText(v.reason)
            .setStyle(Notification.BigTextStyle().bigText(v.reason))
            .setSubText(source)
            .setColor(ctx.getColor(if (v.isConfirmed) R.color.state_confirmed else R.color.state_caution))
            .setContentIntent(detailIntent(ctx, v, source, v.id.hashCode()))
            .setAutoCancel(true)
            .build()
        notify(ctx, v.id.hashCode(), n)
    }

    fun guardianAlert(ctx: Context, v: Verdict, guardedNumber: String, id: Int) {
        val c = Lang.wrap(ctx)
        val b = Notification.Builder(ctx, CH_GUARDIAN)
            .setSmallIcon(R.drawable.ic_stat)
            .setContentTitle(c.getString(R.string.guardian_alert_title))
            .setContentText(v.headline)
            .setStyle(Notification.BigTextStyle().bigText(v.headline + "\n" + v.reason))
            .setColor(ctx.getColor(R.color.state_confirmed))
            .setContentIntent(detailIntent(ctx, v, c.getString(R.string.guardian), id))
            .setAutoCancel(true)
        if (guardedNumber.isNotBlank()) {
            // ACTION_DIAL only: opens the dialer pre-filled, never places the call.
            val dial = Intent(Intent.ACTION_DIAL, Uri.parse("tel:" + Uri.encode(guardedNumber)))
            val pi = PendingIntent.getActivity(ctx, id + 1, dial, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
            b.addAction(Notification.Action.Builder(null, c.getString(R.string.guardian_call), pi).build())
        }
        notify(ctx, id, b.build())
    }

    /** Debug demo: a realistic scam SMS posted by JAAL itself, flagged so the listener treats it as external. */
    fun postDemo(ctx: Context) {
        val n = Notification.Builder(ctx, CH_DEMO)
            .setSmallIcon(R.drawable.ic_stat)
            .setContentTitle("VM-SBIUPD")
            .setContentText(DEMO_TEXT)
            .setStyle(Notification.BigTextStyle().bigText(DEMO_TEXT))
            .addExtras(android.os.Bundle().apply { putBoolean(EXTRA_DEMO, true) })
            .setAutoCancel(true)
            .build()
        notify(ctx, 4242, n)
    }

    const val DEMO_TEXT =
        "Dear customer, your SBI KYC has expired and your account will be blocked today. " +
            "A refund of Rs 4,999 is pending. Pay Rs 10 verification fee to refund.desk@ybl to restore access " +
            "or call +91 98765 43210 immediately."

    private fun notify(ctx: Context, id: Int, n: Notification) {
        try {
            ctx.getSystemService(NotificationManager::class.java).notify(id, n)
        } catch (_: SecurityException) { /* POST_NOTIFICATIONS not granted */ }
    }
}
