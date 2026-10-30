package app.jaal.android

import android.app.Application
import app.jaal.android.data.PrefixStore
import app.jaal.android.engine.CallState
import app.jaal.android.service.JaalJobService
import app.jaal.android.ui.Notifier

class JaalApp : Application() {
    override fun onCreate() {
        super.onCreate()
        Notifier.createChannels(this)
        PrefixStore.load(this)
        CallState.start(this)
        JaalJobService.schedule(this)
        // Warm the regex tables off the main thread so the first notification triage is ~ms, not ~50 ms.
        Thread { app.jaal.android.core.Extract.triage("warm up 9876543210 a@ybl http://x.in") }.start()
    }
}
