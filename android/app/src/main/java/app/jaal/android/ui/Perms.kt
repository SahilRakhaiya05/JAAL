package app.jaal.android.ui

import android.Manifest
import android.app.NotificationManager
import android.app.role.RoleManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import app.jaal.android.service.JaalNotificationListener

object Perms {
    fun listenerEnabled(ctx: Context): Boolean {
        val cn = ComponentName(ctx, JaalNotificationListener::class.java)
        return if (Build.VERSION.SDK_INT >= 27) {
            ctx.getSystemService(NotificationManager::class.java).isNotificationListenerAccessGranted(cn)
        } else {
            Settings.Secure.getString(ctx.contentResolver, "enabled_notification_listeners")?.contains(cn.flattenToString()) == true
        }
    }

    fun overlay(ctx: Context) = Settings.canDrawOverlays(ctx)

    fun callScreeningSupported() = Build.VERSION.SDK_INT >= 29

    fun callRoleHeld(ctx: Context): Boolean =
        Build.VERSION.SDK_INT >= 29 && ctx.getSystemService(RoleManager::class.java)?.isRoleHeld(RoleManager.ROLE_CALL_SCREENING) == true

    fun postNotifications(ctx: Context) =
        Build.VERSION.SDK_INT < 33 || ctx.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED

    fun phoneState(ctx: Context) = ctx.checkSelfPermission(Manifest.permission.READ_PHONE_STATE) == PackageManager.PERMISSION_GRANTED

    fun listenerSettings() = Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)

    fun overlaySettings(ctx: Context) =
        Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:" + ctx.packageName))

    fun callRoleRequest(ctx: Context): Intent? =
        if (Build.VERSION.SDK_INT >= 29) ctx.getSystemService(RoleManager::class.java)?.createRequestRoleIntent(RoleManager.ROLE_CALL_SCREENING) else null
}
