package app.jaal.android.ui

import android.Manifest
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.view.View
import android.widget.Button
import app.jaal.android.R
import app.jaal.android.data.Prefs
import app.jaal.android.engine.CallState

/** ONE screen: what JAAL reads, what it never reads, and the grants. */
class OnboardingActivity : BaseActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_onboarding)
        findViewById<Button>(R.id.grant_notif).setOnClickListener { launch(Perms.listenerSettings()) }
        findViewById<Button>(R.id.grant_overlay).setOnClickListener { launch(Perms.overlaySettings(this)) }
        findViewById<Button>(R.id.grant_post).apply {
            visibility = if (Build.VERSION.SDK_INT >= 33) View.VISIBLE else View.GONE
            setOnClickListener { if (Build.VERSION.SDK_INT >= 33) requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), REQ_POST) }
        }
        findViewById<Button>(R.id.grant_call).apply {
            visibility = if (Perms.callScreeningSupported()) View.VISIBLE else View.GONE
            setOnClickListener { Perms.callRoleRequest(this@OnboardingActivity)?.let { startActivityForResult(it, REQ_ROLE) } }
        }
        findViewById<Button>(R.id.btn_continue).setOnClickListener {
            Prefs(this).onboarded = true
            startActivity(Intent(this, MainActivity::class.java))
            finish()
        }
    }

    override fun onResume() {
        super.onResume()
        refresh()
    }

    private fun refresh() {
        mark(R.id.grant_notif, R.string.grant_notif, Perms.listenerEnabled(this))
        mark(R.id.grant_overlay, R.string.grant_overlay, Perms.overlay(this))
        mark(R.id.grant_post, R.string.grant_post, Perms.postNotifications(this))
        mark(R.id.grant_call, R.string.grant_call, Perms.callRoleHeld(this))
    }

    private fun mark(id: Int, label: Int, granted: Boolean) {
        val b = findViewById<Button>(id)
        b.text = if (granted) "✓ " + getString(label) else getString(label)
        b.isEnabled = !granted
        b.alpha = if (granted) 0.6f else 1f
    }

    @Deprecated("platform Activity API")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        // Call screening granted: optionally ask for call state (ringing/offhook/idle). No call log, ever.
        if (requestCode == REQ_ROLE && Perms.callRoleHeld(this) && !Perms.phoneState(this)) {
            requestPermissions(arrayOf(Manifest.permission.READ_PHONE_STATE), REQ_PHONE)
        }
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == REQ_PHONE) CallState.start(applicationContext)
        refresh()
    }

    companion object {
        private const val REQ_POST = 1
        private const val REQ_ROLE = 2
        private const val REQ_PHONE = 3
    }
}
